#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";

import { resolveOptions, loadProjectConfig, type SkeletonOptions } from "./config.js";
import { initDiskCache, defaultCacheDir } from "./diskcache.js";
import { buildSkeletonsBulk, gatherSkeletons } from "./pool.js";
import {
  buildSkeleton,
  collectSourceFiles,
  toPosix,
  UnsupportedLanguageError,
} from "./skeleton.js";
import { renderHtml, renderCombinedHtml } from "./html.js";
import { supportedLanguages } from "./registry.js";
import type { SkeletonFile } from "./types.js";
import {
  findSymbol,
  findRelatedSymbols,
  findServerImports,
  isApiRoute,
  findMissingTryCatch,
  checkGeneralRules,
  GENERAL_RULE_DEFAULTS,
  type GeneralRuleThresholds,
} from "./analysis.js";
import { resolveFileImports } from "./resolver.js";
import { buildSymbolGraph } from "./graph.js";
import { computeCoupling, findLayerViolations, computeModuleCoupling } from "./metrics.js";
import { findDeadExports, findCircularDeps, getChangeImpact, getFileDeps, getTopSymbols, findDuplicateSymbols } from "./graph-analysis.js";
import { buildCallGraph } from "./callgraph.js";
import { searchSymbols } from "./search.js";
import { semanticSearch } from "./semantic.js";
import { mapTestCoverage } from "./testmap.js";
import { computeFileComplexity } from "./complexity.js";
import { findUnusedParams } from "./unused-params.js";
import { traceTypeInFile } from "./typeflow.js";
import { discoverWorkspace, findPackageCycles } from "./workspace.js";
import { readSourceMap } from "./sourcemap.js";
import { buildReport } from "./report.js";
import { runQualityGate } from "./check.js";
import { computeDiff, computeRisk, isGitRepo } from "./gitdiff.js";
import { packContext } from "./contextpack.js";
import { registerPrompts } from "./prompts.js";

import { parseRootsFromEnv, resolvePathInRoots, type ResolvedPath } from "./roots.js";

/**
 * Security boundary. AST_MAP_ROOT may list several roots (path-delimiter
 * separated); AST_MAP_UNLOCKED=1 allows any absolute path. The first root is
 * the primary — relative inputs resolve against it.
 */
const ROOTS = parseRootsFromEnv();
const ROOT = ROOTS.roots[0];

// Persistent parse cache (disable with AST_MAP_NO_CACHE=1 or "cache": false in config).
if (process.env.AST_MAP_NO_CACHE !== "1" && loadProjectConfig(ROOT).cache !== false) {
  initDiskCache(defaultCacheDir(ROOT));
}

function resolveInRoot(input: string): ResolvedPath {
  return resolvePathInRoots(input, ROOTS);
}

function htmlPathFor(rel: string, opts: SkeletonOptions): string {
  const outDir = opts.outputDir ? path.resolve(ROOT, opts.outputDir) : path.join(ROOT, ".ast-map");
  return path.join(outDir, `${rel}-skeleton.html`);
}

function writeHtml(skel: SkeletonFile, rel: string, opts: SkeletonOptions): string {
  const target = htmlPathFor(rel, opts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderHtml(skel), "utf8");
  return target;
}

/** Run a per-file analysis over a directory, collecting results and per-file errors. */
async function perFile<T>(
  absDir: string,
  root: string,
  fn: (abs: string, rel: string) => Promise<T | null>,
): Promise<{ results: T[]; errors: Array<{ file: string; error: string }>; count: number }> {
  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const files = collectSourceFiles(absDir, opts);
  const results: T[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const fileRel = toPosix(path.relative(root, file));
    try {
      const r = await fn(file, fileRel);
      if (r) results.push(r);
    } catch (err) {
      errors.push({ file: fileRel, error: describeError(err) });
    }
  }
  return { results, errors, count: files.length };
}

function jsonText(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorText(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/** Read the package version at runtime so it never drifts from package.json. */
const PKG_VERSION = (() => {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
})();

const server = new McpServer({
  name: "universal-ast-mapper",
  version: PKG_VERSION,
});

registerPrompts(server);

/* ----------------------- tool: list_supported_languages ----------------------- */
server.registerTool(
  "list_supported_languages",
  {
    title: "List supported languages",
    description:
      "Returns the languages and file extensions this server can map into a code skeleton.",
    inputSchema: {},
  },
  async () => jsonText({ root: ROOT, languages: supportedLanguages() }),
);

/* --------------------------- tool: get_skeleton_json -------------------------- */
server.registerTool(
  "get_skeleton_json",
  {
    title: "Get code skeleton (JSON only)",
    description:
      "Parse a single source file and return its normalized skeleton as JSON. " +
      "Does NOT write an HTML file. Use this when you only need the structure for reasoning.",
    inputSchema: {
      path: z.string().describe("File path, relative to the project root or absolute within it."),
      detail: z
        .enum(["outline", "full"])
        .optional()
        .describe('"outline" (default) = names+kinds+ranges; "full" adds signatures and docs.'),
    },
  },
  async ({ path: input, detail }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(
          `"${input}" is a directory. Use generate_skeleton for directories.`,
        );
      }
      const opts = resolveOptions({ detail, emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      return jsonText(skel);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* --------------------------- tool: generate_skeleton -------------------------- */
server.registerTool(
  "generate_skeleton",
  {
    title: "Generate code skeleton (JSON + HTML)",
    description:
      "Map a source FILE or DIRECTORY into a normalized code skeleton. Returns compact JSON " +
      "for the agent and writes a self-contained collapsible HTML view per file (under " +
      "<root>/.ast-map by default). For a single file the full skeleton is returned inline; " +
      "for a directory a summary with per-file HTML paths is returned.",
    inputSchema: {
      path: z.string().describe("File or directory path, relative to the project root or absolute within it."),
      detail: z.enum(["outline", "full"]).optional().describe('Default "outline".'),
      emitHtml: z.boolean().optional().describe("Write per-file HTML views. Default true."),
      combineHtml: z
        .boolean()
        .optional()
        .describe(
          "Merge all per-file skeletons into a single <outputDir>/index.html with a sidebar, " +
          "search, and collapsible sections. Only applies to directory scans. Default false.",
        ),
      outputDir: z
        .string()
        .optional()
        .describe("Directory for HTML output, relative to root. Default '.ast-map'."),
    },
  },
  async ({ path: input, detail, emitHtml, combineHtml, outputDir }) => {
    try {
      const opts = resolveOptions({ detail, emitHtml, combineHtml, outputDir });
      const { abs, rel, root } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const files = collectSourceFiles(abs, opts);
        const results: Array<Record<string, unknown>> = [];
        const successSkeletons = [];
        let totalSymbols = 0;
        const items = files.map((file) => ({
          abs: file,
          rel: toPosix(path.relative(root, file)),
        }));
        const built = await buildSkeletonsBulk(items, opts);
        for (let i = 0; i < built.length; i++) {
          const r = built[i];
          if (r) {
            const skel = r.skel;
            totalSymbols += skel.symbolCount;
            const htmlPath = opts.emitHtml ? writeHtml(skel, items[i].rel, opts) : null;
            successSkeletons.push(skel);
            results.push({
              file: skel.file,
              language: skel.language,
              symbolCount: skel.symbolCount,
              htmlPath,
            });
          } else {
            results.push({ file: items[i].rel, error: "parse failed or unsupported file type" });
          }
        }

        let combinedHtmlPath: string | null = null;
        if (opts.combineHtml && successSkeletons.length > 0) {
          const outDir = opts.outputDir
            ? path.resolve(root, opts.outputDir)
            : path.join(root, ".ast-map");
          fs.mkdirSync(outDir, { recursive: true });
          combinedHtmlPath = path.join(outDir, "index.html");
          fs.writeFileSync(combinedHtmlPath, renderCombinedHtml(successSkeletons), "utf8");
        }

        return jsonText({
          mode: "directory",
          root: root,
          directory: toPosix(rel),
          fileCount: files.length,
          totalSymbols,
          combinedHtmlPath,
          results,
        });
      }

      // single file
      const skel = await buildSkeleton(abs, rel, opts);
      const htmlPath = opts.emitHtml ? writeHtml(skel, rel, opts) : null;
      return jsonText({ mode: "file", htmlPath, skeleton: skel });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_symbol_context ─────────────────────────────── */
server.registerTool(
  "get_symbol_context",
  {
    title: "Get symbol source context",
    description:
      "Extract the exact source lines of a specific named symbol (function, class, interface, etc.) " +
      "from a file. Returns the raw code block — ideal for focused AI refactoring without sending the " +
      "whole file. Token-efficient: a 300-line file becomes ~40 lines of relevant code. " +
      "Use includeRelated=true to also receive related types/interfaces referenced in the symbol's signature.",
    inputSchema: {
      path: z.string().describe("File path, relative to the project root or absolute within it."),
      symbol: z.string().describe("Name of the symbol to extract (function/class/interface/type name)."),
      kind: z
        .enum(["function", "class", "interface", "type", "method", "const", "var", "enum"])
        .optional()
        .describe("Narrow by kind when multiple symbols share the same name."),
      includeRelated: z
        .boolean()
        .optional()
        .describe(
          "Also return related types/interfaces referenced in the symbol's signature. Default false.",
        ),
    },
  },
  async ({ path: input, symbol, kind, includeRelated }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }
      const source = fs.readFileSync(abs, "utf8");
      const sourceLines = source.split("\n");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);

      const found = findSymbol(skel.symbols, symbol, kind);
      if (!found) {
        const available = skel.symbols.map((s) => `${s.name} (${s.kind})`).join(", ");
        return errorText(
          `Symbol "${symbol}" not found in ${rel}. Top-level symbols: ${available || "(none)"}`,
        );
      }

      const code = sourceLines.slice(found.range.startLine - 1, found.range.endLine).join("\n");

      const result: Record<string, unknown> = {
        file: rel,
        symbol: found.name,
        kind: found.kind,
        range: found.range,
        lines: found.range.endLine - found.range.startLine + 1,
        code,
      };

      if (includeRelated) {
        const related = findRelatedSymbols(skel.symbols, found, sourceLines);
        if (related.length > 0) result.related = related;
      }

      return jsonText(result);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ───────────────── tool: validate_architecture ─────────────────────────────── */
server.registerTool(
  "validate_architecture",
  {
    title: "Validate architecture — Next.js + general rules",
    description:
      "Scan files for architecture violations. Two rule sets run together:\n\n" +
      "Next.js App Router rules:\n" +
      "  (1) client-server-boundary — 'use client' components importing server-only modules.\n" +
      "  (2) api-missing-try-catch — API route handlers with no try/catch.\n\n" +
      "General rules (any project):\n" +
      "  (3) large-file — files exceeding maxLines (default 500).\n" +
      "  (4) too-many-imports — files with more than maxImports imports (default 15).\n" +
      "  (5) god-export — files exporting more than maxExports symbols (default 10).\n\n" +
      "Thresholds can be overridden per-call or set globally in .ast-map.config.json.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "File or directory to scan (relative to root or absolute within it). Use '.' to scan the whole project.",
        ),
      maxLines: z.number().int().optional().describe("Override large-file threshold (default 500)."),
      maxImports: z.number().int().optional().describe("Override too-many-imports threshold (default 15)."),
      maxExports: z.number().int().optional().describe("Override god-export threshold (default 10)."),
    },
  },
  async ({ path: input, maxLines, maxImports, maxExports }) => {
    try {
      const { abs, root } = resolveInRoot(input);
      const projectConfig = loadProjectConfig(root);
      const opts = resolveOptions({ detail: "full", emitHtml: false }, projectConfig);
      const stat = fs.statSync(abs);

      const filesToCheck: string[] = stat.isDirectory()
        ? collectSourceFiles(abs, opts)
        : [abs];

      // Merge thresholds: call param → config file → defaults
      const thresholds: GeneralRuleThresholds = {
        largeFileLines:  maxLines   ?? projectConfig.rules?.["large-file"]?.maxLines    ?? GENERAL_RULE_DEFAULTS.largeFileLines,
        tooManyImports:  maxImports ?? projectConfig.rules?.["too-many-imports"]?.maxImports ?? GENERAL_RULE_DEFAULTS.tooManyImports,
        godExportCount:  maxExports ?? projectConfig.rules?.["god-export"]?.maxExports   ?? GENERAL_RULE_DEFAULTS.godExportCount,
      };

      interface Violation {
        file: string;
        rule: string;
        severity: "error" | "warning";
        message: string;
        line?: number;
      }

      const violations: Violation[] = [];

      for (const file of filesToCheck) {
        const fileRel = toPosix(path.relative(root, file));
        let source: string;
        try {
          source = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }

        let skel;
        try {
          skel = await buildSkeleton(file, fileRel, opts);
        } catch {
          continue;
        }

        // Next.js Rule 1: "use client" boundary (AST-based, no comment false-positives)
        if (skel.directives?.includes("use client")) {
          for (const imp of findServerImports(source)) {
            violations.push({
              file: fileRel, rule: "client-server-boundary", severity: "error",
              message: `"use client" file imports server-only module "${imp.label}" (${imp.module})`,
              line: imp.line,
            });
          }
        }

        // Next.js Rule 2: API route try/catch
        if (isApiRoute(fileRel)) {
          const sourceLines = source.split("\n");
          for (const sym of findMissingTryCatch(skel.symbols, sourceLines)) {
            violations.push({
              file: fileRel, rule: "api-missing-try-catch", severity: "warning",
              message: `API handler "${sym.name}" has no try/catch`,
              line: sym.range.startLine,
            });
          }
        }

        // General rules (Rules 3–5)
        const importCount = skel.imports?.length ?? 0;
        for (const v of checkGeneralRules(fileRel, source, skel.symbols, importCount, thresholds)) {
          violations.push(v);
        }
      }

      const errors = violations.filter((v) => v.severity === "error").length;
      const warnings = violations.filter((v) => v.severity === "warning").length;

      return jsonText({
        scanned: filesToCheck.length,
        violations: violations.length,
        errors,
        warnings,
        thresholds,
        summary: violations.length === 0
          ? "✓ No architecture violations found."
          : `Found ${errors} error(s) and ${warnings} warning(s).`,
        results: violations,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: resolve_imports ────────────────────────────────── */
server.registerTool(
  "resolve_imports",
  {
    title: "Resolve imports to source definitions",
    description:
      "For a given source file, resolves each import statement to its target file and symbol. " +
      "Returns a Reference Object per import with: resolved path, symbol kind, one-line signature, " +
      "parameter list, and whether the symbol was found. " +
      "Only relative imports (starting with '.') are resolved — external packages are flagged. " +
      "Use this to trace what a file depends on before refactoring or to verify API contracts.",
    inputSchema: {
      path: z.string().describe("File path, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      const resolved = await resolveFileImports(skel, abs, root);

      return jsonText({
        file: rel,
        importCount: resolved.length,
        resolved,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: build_symbol_graph ──────────────────────────────── */
server.registerTool(
  "build_symbol_graph",
  {
    title: "Build symbol-level dependency graph",
    description:
      "Scan a directory and build a symbol-level dependency graph.\n" +
      "Nodes:\n" +
      "  - file nodes: one per scanned source file\n" +
      "  - symbol nodes: one per function/class/type/etc. (id = '<file>::<Name>' or '<file>::<Class>.<method>')\n" +
      "Edges:\n" +
      "  - 'contains': file → symbol, or parent-symbol → child-symbol (structural hierarchy)\n" +
      "  - 'imports': importing-file → imported-symbol-node (cross-file dependency)\n" +
      "Use to trace data flow: query edges where edgeType='imports' to see what a file pulls in, " +
      "or where to='src/foo.ts::myFn' to see every file that depends on that symbol.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to scan, relative to project root or absolute within it."),
      detail: z
        .enum(["outline", "full"])
        .optional()
        .describe('"outline" (default) omits signatures; "full" includes them on symbol nodes.'),
      outputFile: z
        .string()
        .optional()
        .describe(
          "If provided, write the graph JSON to this path (relative to root) and return only stats. " +
          "Recommended for large projects to avoid bloated inline responses.",
        ),
    },
  },
  async ({ path: input, detail, outputFile }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. build_symbol_graph requires a directory.`);
      }

      const { skeletons, errors } = await gatherSkeletons(abs, root, detail);

      const graph = buildSymbolGraph(skeletons, root);

      if (outputFile) {
        const { abs: outAbs } = resolveInRoot(outputFile);
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, JSON.stringify(graph, null, 2), "utf8");
        return jsonText({
          directory: rel,
          scanned: skeletons.length + errors.length,
          graphFilePath: outAbs,
          stats: graph.stats,
          ...(errors.length > 0 ? { errors } : {}),
        });
      }

      // Guard against bloated inline responses for large graphs.
      // 2000 nodes ≈ ~50–80 source files; beyond that inline JSON becomes unusable in an MCP context.
      const INLINE_NODE_LIMIT = 2000;
      if (graph.nodes.length > INLINE_NODE_LIMIT) {
        return jsonText({
          directory: rel,
          scanned: skeletons.length + errors.length,
          stats: graph.stats,
          warning:
            `Graph has ${graph.nodes.length} nodes — too large to return inline. ` +
            `Use the outputFile parameter to write it to disk, then read specific sections with get_file_deps or get_change_impact.`,
          ...(errors.length > 0 ? { errors } : {}),
        });
      }

      return jsonText({
        directory: rel,
        scanned: skeletons.length + errors.length,
        ...(errors.length > 0 ? { errors } : {}),
        graph,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: analyze ─────────────────────────────────────── */
server.registerTool(
  "analyze",
  {
    title: "Analyze a directory (dead code, cycles, coupling, complexity, …)",
    description:
      "Run one structural analysis over a directory. Pick `kind`:\n" +
      "• `dead` — exported symbols no other file imports (removal candidates; entry points look dead too).\n" +
      "• `cycles` — circular import chains (A → B → C → A), full path per cycle.\n" +
      "• `duplicates` — one symbol name exported from several files (copy-paste, parallel impls).\n" +
      "• `top` — the most-imported symbols, i.e. God Nodes with the widest blast radius. `limit` (default 10).\n" +
      "• `coupling` — per-FILE Ca (fan-in) / Ce (fan-out) / instability I=Ce/(Ca+Ce).\n" +
      "• `modules` — the same metrics aggregated per DIRECTORY, plus weighted cross-module edges. " +
      "Use this for the architectural bird's-eye view; use `coupling` to find the individual load-bearing file.\n" +
      "• `layers` — Stable Dependencies Principle breaks: a stable file importing a more volatile one. " +
      "`minGap` (0-1) filters by how far uphill the dependency points.\n" +
      "• `tests` — two numbers: `coverageRatio` counts sources a test *names* (imports directly or " +
      "matches by filename), `reachRatio` also counts what those files import transitively — use the " +
      "second for integration-style suites, which exercise far more than they name. `untested` means " +
      "neither, and is the list worth acting on, ranked by risk. Neither number is line coverage. " +
      "`untestedOnly` trims the lists but keeps both ratios.\n" +
      "• `complexity` — cyclomatic complexity per function plus the worst hotspots. Accepts a single FILE.\n" +
      "• `unused-params` — declared parameters never referenced in the body. Accepts a single FILE.\n" +
      "• `risk` — git churn × complexity, ranking the files most worth refactoring or testing. Needs a git repo.\n" +
      "• `workspace` — monorepo packages (npm/yarn/pnpm/lerna), their internal deps, and package cycles.\n\n" +
      "For a one-shot health summary across several of these at once, use get_codebase_report instead.",
    inputSchema: {
      kind: z
        .enum([
          "dead", "cycles", "duplicates", "top", "coupling", "modules",
          "layers", "tests", "complexity", "unused-params", "risk", "workspace",
        ])
        .describe("Which analysis to run — see the description for what each returns."),
      path: z
        .string()
        .optional()
        .describe("Directory to scan (a FILE is allowed for complexity / unused-params). Default project root."),
      limit: z.number().int().min(1).max(100).optional().describe("`top` only: how many symbols. Default 10."),
      minGap: z.number().optional().describe("`layers` only: minimum instability gap, 0-1. Default 0."),
      untestedOnly: z.boolean().optional().describe("`tests` only: drop the links/tested/reached lists, keeping both ratios and `untested`. Default false."),
      detail: z
        .enum(["outline", "full"])
        .optional()
        .describe('`dead` only: parse detail. "outline" (default) is enough.'),
    },
  },
  async ({ kind, path: input, limit, minGap, untestedOnly, detail }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      const dir = toPosix(rel) || ".";
      const isDir = fs.statSync(abs).isDirectory();

      // complexity / unused-params also accept a single file; the rest need a directory.
      if (!isDir && kind !== "complexity" && kind !== "unused-params") {
        return errorText(`"${input}" is not a directory. analyze kind="${kind}" requires a directory.`);
      }

      // Built once, only for the kinds that walk the import graph.
      let cached: { skeletons: SkeletonFile[]; errors: Array<{ file: string; error: string }> } | null = null;
      const gather = async () => (cached ??= await gatherSkeletons(abs, root, detail));
      const graphOf = async () => {
        const g = await gather();
        return { graph: buildSymbolGraph(g.skeletons, root), ...g };
      };
      /** Common envelope for the graph-backed kinds. */
      const scanned = (g: { skeletons: SkeletonFile[]; errors: Array<unknown> }) => ({
        directory: dir,
        scanned: g.skeletons.length + g.errors.length,
        ...(g.errors.length > 0 ? { errors: g.errors } : {}),
      });

      switch (kind) {
        case "dead": {
          const g = await graphOf();
          const dead = findDeadExports(g.graph);
          return jsonText({ ...scanned(g), deadExportCount: dead.length, deadExports: dead });
        }
        case "cycles": {
          const g = await graphOf();
          const cycles = findCircularDeps(g.graph);
          return jsonText({ ...scanned(g), cycleCount: cycles.length, cycles });
        }
        case "duplicates": {
          const g = await graphOf();
          const duplicates = findDuplicateSymbols(g.graph);
          return jsonText({ ...scanned(g), duplicateCount: duplicates.length, duplicates });
        }
        case "top": {
          const g = await graphOf();
          return jsonText({ ...scanned(g), topSymbols: getTopSymbols(g.graph, limit ?? 10) });
        }
        case "coupling": {
          const g = await graphOf();
          const metrics = computeCoupling(g.graph);
          return jsonText({ ...scanned(g), count: metrics.length, files: metrics });
        }
        case "modules": {
          const g = await graphOf();
          const mc = computeModuleCoupling(g.graph);
          return jsonText({ ...scanned(g), moduleCount: mc.modules.length, ...mc });
        }
        case "layers": {
          const g = await graphOf();
          const violations = findLayerViolations(g.graph, minGap ?? 0);
          return jsonText({ ...scanned(g), count: violations.length, violations });
        }
        case "tests": {
          const g = await graphOf();
          const map = mapTestCoverage(g.graph);
          // untestedOnly trims the lists, never the headline numbers — dropping
          // reachRatio here would leave only the number that reads too low.
          return jsonText(untestedOnly
            ? {
                ...scanned(g),
                untestedSources: map.untestedSources,
                coverageRatio: map.coverageRatio,
                reachedSources: map.reachedSources,
                reachRatio: map.reachRatio,
                untested: map.untested,
              }
            : { ...scanned(g), ...map });
        }
        case "complexity": {
          if (!isDir) {
            const fc = await computeFileComplexity(abs, dir);
            return fc ? jsonText(fc) : errorText(`Unsupported file type: ${input}`);
          }
          const { results, errors, count } = await perFile(abs, root, computeFileComplexity);
          const hotspots = results
            .flatMap((r) => r.functions.map((f) => ({ file: r.file, ...f })))
            .sort((a, b) => b.complexity - a.complexity)
            .slice(0, 15);
          return jsonText({
            directory: dir, scanned: count,
            ...(errors.length > 0 ? { errors } : {}),
            hotspots, files: results,
          });
        }
        case "unused-params": {
          if (!isDir) {
            const r = await findUnusedParams(abs, dir);
            return r ? jsonText(r) : errorText(`Unsupported file type: ${input}`);
          }
          const { results, errors, count } = await perFile(abs, root, findUnusedParams);
          const withHits = results.filter((r) => r.functions.length > 0);
          return jsonText({
            directory: dir, scanned: count,
            ...(errors.length > 0 ? { errors } : {}),
            unusedParamCount: withHits.reduce((s, r) => s + r.functions.reduce((a, f) => a + f.unused.length, 0), 0),
            files: withHits,
          });
        }
        case "risk": {
          if (!isGitRepo(root)) return errorText("Not a git repository (or git is unavailable).");
          const files = await computeRisk(abs, root);
          return jsonText({ directory: dir, count: files.length, files: files.slice(0, 50) });
        }
        case "workspace": {
          const info = discoverWorkspace(abs);
          return jsonText({
            root: dir,
            tool: info.tool,
            packageCount: info.packages.length,
            packages: info.packages,
            edges: info.edges,
            packageCycles: findPackageCycles(info),
          });
        }
      }
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: trace_type ──────────────────────────────────── */
server.registerTool(
  "trace_type",
  {
    title: "Trace a type through the code",
    description:
      "Find everywhere a named type flows through a directory: function parameters and return " +
      "types, typed variables, and class fields. A scoped, AST-based type-flow view (best for " +
      "TS/Python) \u2014 no full type inference, so it tracks where the type is *named* in signatures.",
    inputSchema: {
      type: z.string().describe('Type name to trace, e.g. "Inventory".'),
      path: z.string().describe("Directory to scan, relative to project root or absolute within it."),
    },
  },
  async ({ type: typeName, path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. trace_type requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const refs = [];
      const errors: Array<{ file: string; error: string }> = [];
      for (const file of files) {
        const fileRel = toPosix(path.relative(root, file));
        try {
          refs.push(...(await traceTypeInFile(file, fileRel, typeName)));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }
      const byRole: Record<string, number> = { param: 0, return: 0, variable: 0, field: 0 };
      for (const r of refs) byRole[r.role]++;
      return jsonText({
        type: typeName,
        directory: toPosix(rel),
        scanned: files.length,
        refCount: refs.length,
        byRole,
        ...(errors.length > 0 ? { errors } : {}),
        refs,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: read_source_map ─────────────────────────────── */
server.registerTool(
  "read_source_map",
  {
    title: "Read a compiled file's source map",
    description:
      "Given a compiled JS/CSS file with an inline (`data:`) or external `sourceMappingURL`, " +
      "return the original source paths it maps back to. Useful for tracing built output in " +
      "dist/ back to the real source files.",
    inputSchema: {
      path: z.string().describe("Compiled file path, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      const info = readSourceMap(abs, toPosix(rel));
      if (!info) return errorText(`No source map found for "${input}".`);
      return jsonText(info);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_codebase_report ─────────────────────────── */
server.registerTool(
  "get_codebase_report",
  {
    title: "Codebase health report",
    description:
      "Scan a directory and return a one-shot health summary: file/symbol counts, language " +
      "breakdown, a health grade (A\u2013F) and score, complexity hotspots, god nodes (most-imported " +
      "symbols), dead exports, circular dependencies, module coupling, SDP violations, and structural " +
      "test coverage (untested sources ranked by risk). The `ast-map report` CLI renders this as HTML.",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan. Defaults to the project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_codebase_report requires a directory.`);
      }
      const data = await buildReport(abs, root);
      return jsonText({ directory: toPosix(rel) || ".", ...data });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: check_quality_gate ──────────────────────────── */
server.registerTool(
  "check_quality_gate",
  {
    title: "Quality gate (thresholds + baseline ratchet)",
    description:
      "Run the CI quality gate over a directory: evaluates absolute thresholds (from " +
      "`.ast-map.config.json` \u2192 `check`) and a **baseline ratchet** against " +
      "`.ast-map.baseline.json` \u2014 fails when cycles, dead exports, SDP violations, " +
      "very-high-complexity functions, or the health score regress. " +
      "Set updateBaseline to re-anchor the baseline at the current metrics.",
    inputSchema: {
      path: z.string().optional().describe("Directory to gate. Defaults to the project root."),
      baseline: z.string().optional().describe("Baseline file path. Default .ast-map.baseline.json."),
      updateBaseline: z.boolean().optional().describe("Write current metrics as the new baseline."),
    },
  },
  async ({ path: input, baseline, updateBaseline }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. check_quality_gate requires a directory.`);
      }
      const thresholds = loadProjectConfig(root).check;
      const result = await runQualityGate(abs, root, {
        baselinePath: baseline,
        thresholds,
        updateBaseline,
      });
      return jsonText({ directory: toPosix(rel) || ".", ...result });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_diff ────────────────────────────────────── */
server.registerTool(
  "get_diff",
  {
    title: "Git-aware change diff + blast radius",
    description:
      "Compare the working tree against a git ref (default HEAD) and return which symbols were " +
      "added/removed/modified per file, which changes are potentially **breaking** (removed or " +
      "signature-changed exports), and the **blast radius** \u2014 files that depend on those breaking changes.",
    inputSchema: {
      base: z.string().optional().describe("Git ref to compare against. Default HEAD."),
      path: z.string().optional().describe("Limit to a subdirectory. Default project root."),
    },
  },
  async ({ base, path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!isGitRepo(root)) return errorText("Not a git repository (or git is unavailable).");
      const data = await computeDiff(abs, root, base ?? "HEAD");
      return jsonText({ directory: toPosix(rel) || ".", ...data });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: pack_context ────────────────────────────────── */
server.registerTool(
  "pack_context",
  {
    title: "Minimal context pack for a symbol",
    description:
      "Assemble the *minimal* context needed to understand or change a symbol \u2014 the symbol's own " +
      "source, the signatures of what it depends on (resolved imports), and the files that depend on " +
      "it \u2014 instead of reading whole files. Returns a token estimate so you can see the savings.",
    inputSchema: {
      path: z.string().describe("File containing the symbol (relative to root or absolute within it)."),
      symbol: z.string().optional().describe("Symbol name to centre the pack on. Omit for the whole file."),
      scan: z.string().optional().describe("Directory to scan for dependents. Default: project root."),
    },
  },
  async ({ path: input, symbol, scan }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) return errorText(`"${input}" is a directory; pass a file.`);
      const scanAbs = scan ? resolveInRoot(scan).abs : root;
      const pack = await packContext(abs, toPosix(rel), root, symbol, scanAbs);
      return jsonText(pack);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_change_impact ───────────────────────────── */
server.registerTool(
  "get_change_impact",
  {
    title: "Get change impact (blast radius)",
    description:
      "Given a file and a symbol name, find every file/symbol in the project that directly or " +
      "transitively depends on it via imports. Use this before refactoring to understand blast radius.\n" +
      "Returns: { direct, transitive, totalFiles } where direct = files that import the symbol " +
      "directly, transitive = further dependents up the chain.",
    inputSchema: {
      path: z
        .string()
        .describe("File containing the symbol, relative to project root or absolute within it."),
      symbol: z.string().describe("Name of the exported symbol to analyse."),
      scanDir: z
        .string()
        .optional()
        .describe(
          "Directory to build the dependency graph from. Defaults to the directory of the given file.",
        ),
    },
  },
  async ({ path: input, symbol, scanDir }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }

      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];

      for (const file of files) {
        const fileRel = toPosix(path.relative(root, file));
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch {
          // skip parse errors
        }
      }

      const graph = buildSymbolGraph(skeletons, root);
      const targetNodeId = `${toPosix(rel)}::${symbol}`;
      const impact = getChangeImpact(graph, targetNodeId);

      if (!impact) {
        return errorText(
          `Symbol "${symbol}" not found in graph for "${rel}". ` +
            `Check the symbol name and ensure the file is inside the scan directory.`,
        );
      }

      return jsonText(impact);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_call_graph ──────────────────────────────── */
server.registerTool(
  "get_call_graph",
  {
    title: "Get function-level call graph",
    description:
      "For a named function in a file, return:\n" +
      "  - calls: every function/method this function calls, with line number and resolved file\n" +
      "  - calledBy: files that import (and thus likely call) this function\n" +
      "Supports TypeScript, JavaScript, Python, and Go. " +
      "Cross-file calls are resolved via the import graph; local calls are flagged isLocal=true.",
    inputSchema: {
      path: z
        .string()
        .describe("File path, relative to project root or absolute within it."),
      function: z.string().describe("Name of the function or method to analyse."),
      scanDir: z
        .string()
        .optional()
        .describe(
          "Directory to scan for reverse import lookup (calledBy). " +
            "Defaults to the directory of the given file.",
        ),
    },
  },
  async ({ path: input, function: funcName, scanDir }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }

      // Collect skeletons for the scan directory (for calledBy lookup)
      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];

      for (const file of files) {
        const fileRel = toPosix(path.relative(root, file));
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch {
          // skip
        }
      }

      const result = await buildCallGraph(abs, funcName, root, skeletons);

      if (!result) {
        return errorText(
          `Function "${funcName}" not found in "${rel}", or the file language is unsupported.`,
        );
      }

      return jsonText(result);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: search_symbol ───────────────────────────────── */
server.registerTool(
  "search_symbol",
  {
    title: "Search symbols by name",
    description:
      "Find symbols (functions, classes, types, methods, …) by name across all source files " +
      "in a directory. Supports exact match, contains (default), or regex.\n" +
      "Useful when you know a symbol name but not which file it lives in.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to search in, relative to project root or absolute within it."),
      name: z.string().describe("Symbol name to search for."),
      matchType: z
        .enum(["contains", "exact", "regex"])
        .optional()
        .describe('"contains" (default) — case-insensitive substring. "exact" — full name. "regex" — JS regex.'),
      kind: z
        .enum(["function", "class", "interface", "type", "method", "const", "var", "enum", "struct", "field"])
        .optional()
        .describe("Filter by symbol kind."),
      exportedOnly: z
        .boolean()
        .optional()
        .describe("Only return exported symbols. Default false."),
    },
  },
  async ({ path: input, name, matchType, kind, exportedOnly }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. search_symbol requires a directory.`);
      }
      const matches = await searchSymbols(abs, name, root, { matchType, kind, exportedOnly });
      return jsonText({
        directory: toPosix(rel),
        pattern: name,
        matchCount: matches.length,
        matches,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: semantic_search ─────────────────────── */
server.registerTool(
  "semantic_search",
  {
    title: "Search symbols by meaning",
    description:
      "Find symbols by *meaning*, not exact name. Tokenizes identifiers (camelCase/snake_case), " +
      "expands programming synonyms (fetch≈get≈load, remove≈delete≈destroy, …), applies light " +
      "stemming and fuzzy matching, and ranks with BM25-style IDF weighting over symbol names, " +
      "doc comments, signatures and file paths.\n" +
      'Use when you know what code *does* but not what it\'s called: "remove expired sessions", ' +
      '"parse config file", "validate user input".',
    inputSchema: {
      path: z
        .string()
        .describe("Directory to search in, relative to project root or absolute within it."),
      query: z
        .string()
        .describe('What the code does, e.g. "delete old cache entries" or "load user settings".'),
      limit: z.number().int().min(1).max(100).optional().describe("Max results. Default 20."),
      kind: z
        .enum(["function", "class", "interface", "type", "method", "const", "var", "enum", "struct", "field"])
        .optional()
        .describe("Filter by symbol kind."),
      exportedOnly: z
        .boolean()
        .optional()
        .describe("Only return exported symbols. Default false."),
    },
  },
  async ({ path: input, query, limit, kind, exportedOnly }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. semantic_search requires a directory.`);
      }
      const matches = await semanticSearch(abs, query, root, { limit, kind, exportedOnly });
      return jsonText({
        directory: toPosix(rel),
        query,
        matchCount: matches.length,
        matches,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_file_deps ───────────────────────────────── */
server.registerTool(
  "get_file_deps",
  {
    title: "Get file-level import dependencies",
    description:
      "For a single file, show:\n" +
      "  - imports: what this file imports from other files (with symbol names)\n" +
      "  - importedBy: which files import from this file (with symbol names)\n" +
      "More focused than build_symbol_graph — use this for quick dependency lookup without needing the full graph.",
    inputSchema: {
      path: z.string().describe("File to inspect, relative to project root or absolute within it."),
      scanDir: z
        .string()
        .optional()
        .describe("Directory to build the graph from. Defaults to the directory of the given file."),
    },
  },
  async ({ path: input, scanDir }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }
      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = toPosix(path.relative(root, file));
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skeletons, root);
      const fileId = toPosix(rel);
      const result = getFileDeps(graph, fileId);
      if (!result) {
        return errorText(`"${rel}" was not found in the graph. Ensure it is inside the scan directory and is a supported source file.`);
      }
      return jsonText(result);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

function describeError(err: unknown): string {
  if (err instanceof UnsupportedLanguageError) return err.message;
  if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
    return `File not found. Check the path (resolved against root ${ROOT}).`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ─────────────────── MCP resources (browseable structure) ──────────────── */

server.registerResource(
  "languages",
  "ast://languages",
  {
    title: "Supported languages",
    description: "Languages and file extensions this server can map.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({ root: ROOT, languages: supportedLanguages() }, null, 2),
    }],
  }),
);

server.registerResource(
  "skeleton",
  new ResourceTemplate("ast://skeleton/{+path}", {
    list: async () => {
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(ROOT, opts);
      return {
        resources: files.map((f) => {
          const rel = toPosix(path.relative(ROOT, f));
          return { uri: `ast://skeleton/${rel}`, name: rel, mimeType: "application/json" };
        }),
      };
    },
  }),
  {
    title: "File skeleton",
    description: "Normalized code skeleton (symbols, imports, ranges) for one source file.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const rel = decodeURIComponent(String(variables.path)).split(path.sep).join("/");
    const { abs, rel: safeRel } = resolveInRoot(rel);
    const opts = resolveOptions({ detail: "outline", emitHtml: false });
    const skel = await buildSkeleton(abs, toPosix(safeRel), opts);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(skel, null, 2) }],
    };
  },
);

server.registerResource(
  "graph",
  "ast://graph",
  {
    title: "Symbol dependency graph",
    description: "Symbol-level dependency graph for the whole root (guarded by node count).",
    mimeType: "application/json",
  },
  async (uri) => {
    const opts = resolveOptions({ detail: "outline", emitHtml: false });
    const files = collectSourceFiles(ROOT, opts);
    if (files.length > 1500) {
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ note: `Too large to inline (${files.length} files). Use build_symbol_graph on a subdirectory.`, files: files.length }, null, 2),
        }],
      };
    }
    const skels: SkeletonFile[] = [];
    for (const file of files) {
      const fileRel = toPosix(path.relative(ROOT, file));
      try { skels.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
    }
    const graph = buildSymbolGraph(skels, ROOT);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(graph, null, 2) }],
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logging; stdout is reserved for the MCP protocol.
  process.stderr.write(
    `universal-ast-mapper running. roots=${ROOTS.roots.join(path.delimiter)}` +
      (ROOTS.unlocked ? " (UNLOCKED: any absolute path allowed)" : "") + "\n",
  );

  // A typo'd AST_MAP_ROOT otherwise starts cleanly and then fails on every call
  // with a confusing per-tool error. Say it once, here, where it is obvious.
  const bad = ROOTS.roots.filter((r) => !fs.existsSync(r));
  if (bad.length > 0) {
    process.stderr.write(
      `WARNING: ${bad.length === 1 ? "root does not exist" : "these roots do not exist"}: ` +
        `${bad.join(", ")}\n` +
        "  Every tool call will fail until AST_MAP_ROOT points at a real directory.\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
