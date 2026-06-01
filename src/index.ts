#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";

import { resolveOptions, loadProjectConfig, type SkeletonOptions } from "./config.js";
import {
  buildSkeleton,
  collectSourceFiles,
  UnsupportedLanguageError,
} from "./skeleton.js";
import { renderHtml, renderCombinedHtml } from "./html.js";
import { detectLanguage, supportedLanguages } from "./registry.js";
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
import { findDeadExports, findCircularDeps, getChangeImpact, getFileDeps, getTopSymbols, findDuplicateSymbols } from "./graph-analysis.js";
import { buildCallGraph } from "./callgraph.js";
import { searchSymbols } from "./search.js";
import { computeFileComplexity } from "./complexity.js";
import { findUnusedParams } from "./unused-params.js";
import { traceTypeInFile } from "./typeflow.js";

/** Files may only be read inside this root (override with AST_MAP_ROOT). */
const ROOT = path.resolve(process.env.AST_MAP_ROOT ?? process.cwd());

interface ResolvedPath {
  abs: string;
  rel: string;
}

function resolveInRoot(input: string): ResolvedPath {
  const abs = path.resolve(ROOT, input);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path "${input}" is outside the allowed root (${ROOT}). ` +
        `Set the AST_MAP_ROOT environment variable to the project you want to map.`,
    );
  }
  return { abs, rel: rel === "" ? path.basename(abs) : rel };
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
      const { abs, rel } = resolveInRoot(input);
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
      const { abs, rel } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const files = collectSourceFiles(abs, opts);
        const results: Array<Record<string, unknown>> = [];
        const successSkeletons = [];
        let totalSymbols = 0;
        for (const file of files) {
          const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
          try {
            const skel = await buildSkeleton(file, fileRel, opts);
            totalSymbols += skel.symbolCount;
            const htmlPath = opts.emitHtml ? writeHtml(skel, fileRel, opts) : null;
            successSkeletons.push(skel);
            results.push({
              file: skel.file,
              language: skel.language,
              symbolCount: skel.symbolCount,
              htmlPath,
            });
          } catch (err) {
            results.push({ file: fileRel.split(path.sep).join("/"), error: describeError(err) });
          }
        }

        let combinedHtmlPath: string | null = null;
        if (opts.combineHtml && successSkeletons.length > 0) {
          const outDir = opts.outputDir
            ? path.resolve(ROOT, opts.outputDir)
            : path.join(ROOT, ".ast-map");
          fs.mkdirSync(outDir, { recursive: true });
          combinedHtmlPath = path.join(outDir, "index.html");
          fs.writeFileSync(combinedHtmlPath, renderCombinedHtml(successSkeletons), "utf8");
        }

        return jsonText({
          mode: "directory",
          root: ROOT,
          directory: rel.split(path.sep).join("/"),
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
      const { abs, rel } = resolveInRoot(input);
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
      const { abs } = resolveInRoot(input);
      const projectConfig = loadProjectConfig(ROOT);
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
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
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
      const { abs, rel } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      const resolved = await resolveFileImports(skel, abs, ROOT);

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
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. build_symbol_graph requires a directory.`);
      }

      const opts = resolveOptions({ detail, emitHtml: false });
      const files = collectSourceFiles(abs, opts);

      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, ROOT);

      if (outputFile) {
        const { abs: outAbs } = resolveInRoot(outputFile);
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, JSON.stringify(graph, null, 2), "utf8");
        return jsonText({
          directory: rel,
          scanned: files.length,
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
          scanned: files.length,
          stats: graph.stats,
          warning:
            `Graph has ${graph.nodes.length} nodes — too large to return inline. ` +
            `Use the outputFile parameter to write it to disk, then read specific sections with get_file_deps or get_change_impact.`,
          ...(errors.length > 0 ? { errors } : {}),
        });
      }

      return jsonText({
        directory: rel,
        scanned: files.length,
        ...(errors.length > 0 ? { errors } : {}),
        graph,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: find_dead_code ──────────────────────────────── */
server.registerTool(
  "find_dead_code",
  {
    title: "Find dead (unreferenced) exports",
    description:
      "Scan a directory, build the import graph, and return exported symbols that are never " +
      "imported by any other file in the scan root. These are candidates for removal.\n" +
      "Note: entry-point symbols (e.g. Next.js page exports) are technically 'dead' within " +
      "the codebase graph — use your judgement before deleting them.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to scan, relative to project root or absolute within it."),
      detail: z
        .enum(["outline", "full"])
        .optional()
        .describe('"outline" (default) is sufficient for dead-code detection.'),
    },
  },
  async ({ path: input, detail }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_dead_code requires a directory.`);
      }

      const opts = resolveOptions({ detail, emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, ROOT);
      const dead = findDeadExports(graph);

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        deadExportCount: dead.length,
        ...(errors.length > 0 ? { errors } : {}),
        deadExports: dead,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: find_circular_deps ──────────────────────────── */
server.registerTool(
  "find_circular_deps",
  {
    title: "Find circular import dependencies",
    description:
      "Scan a directory and detect circular import chains (A → B → C → A). " +
      "Each result includes the full cycle path with repeated start node at the end for clarity.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to scan, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_circular_deps requires a directory.`);
      }

      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, ROOT);
      const cycles = findCircularDeps(graph);

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        cycleCount: cycles.length,
        ...(errors.length > 0 ? { errors } : {}),
        cycles,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: find_duplicate_symbols ──────────────────────── */
server.registerTool(
  "find_duplicate_symbols",
  {
    title: "Find duplicate exported symbols",
    description:
      "Scan a directory and return symbol names that are exported from more than one file. " +
      "These are often accidental collisions (copy-paste, parallel implementations) that make " +
      "a codebase harder to navigate. Each result lists every file/kind that declares the name.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to scan, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_duplicate_symbols requires a directory.`);
      }

      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, ROOT);
      const duplicates = findDuplicateSymbols(graph);

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        duplicateCount: duplicates.length,
        ...(errors.length > 0 ? { errors } : {}),
        duplicates,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_complexity ──────────────────────────────── */
server.registerTool(
  "get_complexity",
  {
    title: "Get cyclomatic complexity per function",
    description:
      "Compute AST-based cyclomatic complexity for every function/method in a FILE or DIRECTORY. " +
      "Each function gets a score (1 + decision points: if / for / while / case / catch / ternary / && / ||) " +
      "and a rating (low <=5, moderate <=10, high <=20, very-high >20). For a directory, returns per-file " +
      "results plus the highest-complexity hotspots across the scan.",
    inputSchema: {
      path: z.string().describe("File or directory, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const opts = resolveOptions({ detail: "outline", emitHtml: false });
        const files = collectSourceFiles(abs, opts);
        const results = [];
        const errors: Array<{ file: string; error: string }> = [];
        for (const file of files) {
          const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
          try {
            const fc = await computeFileComplexity(file, fileRel);
            if (fc) results.push(fc);
          } catch (err) {
            errors.push({ file: fileRel, error: describeError(err) });
          }
        }
        const hotspots = results
          .flatMap((r) => r.functions.map((f) => ({ file: r.file, ...f })))
          .sort((a, b) => b.complexity - a.complexity)
          .slice(0, 15);
        return jsonText({
          directory: rel.split(path.sep).join("/"),
          scanned: files.length,
          ...(errors.length > 0 ? { errors } : {}),
          hotspots,
          files: results,
        });
      }

      const fc = await computeFileComplexity(abs, rel.split(path.sep).join("/"));
      if (!fc) return errorText(`Unsupported file type: ${input}`);
      return jsonText(fc);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: find_unused_params ──────────────────────────── */
server.registerTool(
  "find_unused_params",
  {
    title: "Find unused function parameters",
    description:
      "Scan a FILE or DIRECTORY for named functions/methods that declare parameters never " +
      "referenced in their body. Skips `_`-prefixed params (conventionally intentional), " +
      "anonymous callbacks, and destructured bindings to avoid false positives.",
    inputSchema: {
      path: z.string().describe("File or directory, relative to project root or absolute within it."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const opts = resolveOptions({ detail: "outline", emitHtml: false });
        const files = collectSourceFiles(abs, opts);
        const results = [];
        const errors: Array<{ file: string; error: string }> = [];
        for (const file of files) {
          const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
          try {
            const r = await findUnusedParams(file, fileRel);
            if (r && r.functions.length > 0) results.push(r);
          } catch (err) {
            errors.push({ file: fileRel, error: describeError(err) });
          }
        }
        const unusedParamCount = results.reduce(
          (sum, r) => sum + r.functions.reduce((a, f) => a + f.unused.length, 0), 0,
        );
        return jsonText({
          directory: rel.split(path.sep).join("/"),
          scanned: files.length,
          ...(errors.length > 0 ? { errors } : {}),
          unusedParamCount,
          files: results,
        });
      }

      const r = await findUnusedParams(abs, rel.split(path.sep).join("/"));
      if (!r) return errorText(`Unsupported file type: ${input}`);
      return jsonText(r);
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
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. trace_type requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const refs = [];
      const errors: Array<{ file: string; error: string }> = [];
      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
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
        directory: rel.split(path.sep).join("/"),
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
      const { abs, rel } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }

      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch {
          // skip parse errors
        }
      }

      const graph = buildSymbolGraph(skeletons, ROOT);
      const targetNodeId = `${rel.split(path.sep).join("/")}::${symbol}`;
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
      const { abs, rel } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }

      // Collect skeletons for the scan directory (for calledBy lookup)
      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];

      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch {
          // skip
        }
      }

      const result = await buildCallGraph(abs, funcName, ROOT, skeletons);

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
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. search_symbol requires a directory.`);
      }
      const matches = await searchSymbols(abs, name, ROOT, { matchType, kind, exportedOnly });
      return jsonText({
        directory: rel.split(path.sep).join("/"),
        pattern: name,
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
      const { abs, rel } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is a directory. Provide a single file path.`);
      }
      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(scanRoot, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skeletons, ROOT);
      const fileId = rel.split(path.sep).join("/");
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

/* ─────────────────── tool: get_top_symbols ─────────────────────────────── */
server.registerTool(
  "get_top_symbols",
  {
    title: "Get most-imported symbols (God Node detector)",
    description:
      "Scan a directory and return the N symbols that are imported by the most files. " +
      "These are your codebase's 'God Nodes' — high-coupling, high-risk symbols where a " +
      "breaking change would have maximum blast radius. Use before a major refactor to " +
      "identify which symbols need the most care.",
    inputSchema: {
      path: z
        .string()
        .describe("Directory to scan, relative to project root or absolute within it."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of top symbols to return. Default 10."),
    },
  },
  async ({ path: input, limit }) => {
    try {
      const { abs, rel } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_top_symbols requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skeletons, ROOT);
      const top = getTopSymbols(graph, limit ?? 10);
      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        topSymbols: top,
      });
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logging; stdout is reserved for the MCP protocol.
  process.stderr.write(`universal-ast-mapper running. root=${ROOT}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
