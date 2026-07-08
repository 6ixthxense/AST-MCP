#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";

import { resolveOptions, loadProjectConfig, type SkeletonOptions } from "./config.js";
import { initDiskCache, defaultCacheDir } from "./diskcache.js";
import { buildSkeletonsBulk } from "./pool.js";
import {
  buildSkeleton,
  collectSourceFiles,
  UnsupportedLanguageError,
} from "./skeleton.js";
import { renderHtml, renderCombinedHtml } from "./html.js";
import { detectLanguage, supportedLanguages } from "./registry.js";
import type { SkeletonFile, SymbolNode } from "./types.js";
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
import { computeCoupling } from "./coupling.js";
import { findLayerViolations } from "./layers.js";
import { computeModuleCoupling } from "./modulecoupling.js";
import { registerPrompts } from "./prompts.js";
import { detectSmells, type SmellResult } from "./smells.js";
import { scanFileForSecurityIssues } from "./security.js";
import { buildClassDiagram, buildDepsDiagram, buildModulesDiagram } from "./diagram.js";
import { buildFixSuggestions } from "./fix.js";
import { generateTestFile, detectTestFramework, type TestFramework } from "./testgen.js";
import { tryAiEnhanceTests } from "./ai-testgen.js";
import { aiRefactorBatch, readSource } from "./ai-refactor.js";
import { buildExplainResult, aiExplain } from "./explain.js";
import { findSimilar } from "./similar.js";
import { mergeCoverage, detectFormat, type CoverageFormat } from "./covmerge.js";
import { loadPlugins, runPlugins } from "./plugins.js";
import { buildIndex, loadIndex, getSkeletons as getIndexSkeletons, isIndexFresh } from "./indexstore.js";
import { checkArchRules, loadArchRules } from "./arch-rules.js";
import { buildDocOutput, renderMarkdown, renderDocHtml, aiEnhanceDocs } from "./docgen.js";

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

function jsonText(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Strip debug/null fields from a SymbolNode to reduce token usage. */
function pruneSymbol(sym: SymbolNode): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: sym.name,
    kind: sym.kind,
    visibility: sym.visibility,
    range: sym.range,
  };
  if (sym.exported) out.exported = true;
  if (sym.signature) out.signature = sym.signature;
  if (sym.doc) out.doc = sym.doc;
  if (sym.propsType) out.propsType = sym.propsType;
  if (sym.props && sym.props.length > 0) out.props = sym.props;
  if (sym.decorators && sym.decorators.length > 0) out.decorators = sym.decorators;
  if (sym.children && sym.children.length > 0) out.children = sym.children.map(pruneSymbol);
  return out;
}

/** Strip metadata-only fields from a SkeletonFile to reduce token usage. */
function pruneSkeletonFile(skel: SkeletonFile): Record<string, unknown> {
  const out: Record<string, unknown> = {
    file: skel.file,
    language: skel.language,
    symbolCount: skel.symbolCount,
    symbols: skel.symbols.map(pruneSymbol),
  };
  if (skel.directives && skel.directives.length > 0) out.directives = skel.directives;
  if (skel.imports && skel.imports.length > 0) out.imports = skel.imports;
  return out;
}

// In-process analysis result cache: avoids re-scanning unchanged files within a session.
// Key: fileAbsPath + '\0' + analysisType. Invalidated by mtime.
const _analysisCache = new Map<string, { mtime: number; result: unknown }>();

function _acGet<T>(fileAbs: string, type: string): T | null {
  const k = fileAbs + "\0" + type;
  const e = _analysisCache.get(k);
  if (!e) return null;
  try {
    if (fs.statSync(fileAbs).mtimeMs !== e.mtime) { _analysisCache.delete(k); return null; }
    return e.result as T;
  } catch { return null; }
}

function _acPut(fileAbs: string, type: string, result: unknown): void {
  try { _analysisCache.set(fileAbs + "\0" + type, { mtime: fs.statSync(fileAbs).mtimeMs, result }); } catch { /* skip */ }
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
      return jsonText(pruneSkeletonFile(skel));
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
          rel: path.relative(root, file).split(path.sep).join("/"),
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
      return jsonText({ mode: "file", htmlPath, skeleton: pruneSkeletonFile(skel) });
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
        const fileRel = path.relative(root, file).split(path.sep).join("/");
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

      const opts = resolveOptions({ detail, emitHtml: false });
      const files = collectSourceFiles(abs, opts);

      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, root);

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
      // 400 nodes ≈ ~10–15 source files; beyond that inline JSON becomes unusable in an MCP context.
      const INLINE_NODE_LIMIT = 400;
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

/* ─────────────────── tool: find_api_surface ────────────────────────────── */
server.registerTool(
  "find_api_surface",
  {
    title: "Find public API surface",
    description:
      "Scan a directory and return every exported symbol — the public API surface of the codebase. " +
      "Useful for generating documentation, detecting API breakage, and understanding what a package exposes.\n\n" +
      "Returns symbols grouped by file, each with name, kind, range, and optional signature. " +
      "Use detail='full' to include signatures and docs. Pass kind to filter to specific symbol types.",
    inputSchema: {
      path: z.string().describe("Directory to scan, relative to project root or absolute within it."),
      detail: z.enum(["outline", "full"]).optional().describe('"outline" (default) = names+kinds; "full" adds signatures and docs.'),
      kind: z
        .enum(["function", "class", "interface", "type", "const", "var", "enum", "method"])
        .optional()
        .describe("Filter to a specific symbol kind."),
    },
  },
  async ({ path: input, detail, kind }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText("find_api_surface requires a directory.");
      }

      const opts = resolveOptions({ detail, emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const errors: Array<{ file: string; error: string }> = [];

      interface ApiSymbol {
        name: string;
        kind: string;
        range: { startLine: number; endLine: number };
        signature?: string | null;
        doc?: string | null;
      }
      interface ApiFile { file: string; language: string; symbols: ApiSymbol[] }
      const apiFiles: ApiFile[] = [];
      let totalSymbols = 0;

      function collectExported(syms: SymbolNode[], result: ApiSymbol[]): void {
        for (const s of syms) {
          if (s.exported && (!kind || s.kind === kind)) {
            const entry: ApiSymbol = { name: s.name, kind: s.kind, range: s.range };
            if (s.signature) entry.signature = s.signature;
            if (s.doc) entry.doc = s.doc;
            result.push(entry);
          }
          if (s.children?.length) collectExported(s.children, result);
        }
      }

      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          const skel = await buildSkeleton(file, fileRel, opts);
          const exported: ApiSymbol[] = [];
          collectExported(skel.symbols, exported);
          if (exported.length > 0) {
            totalSymbols += exported.length;
            apiFiles.push({ file: fileRel, language: skel.language, symbols: exported });
          }
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        filesWithExports: apiFiles.length,
        totalExportedSymbols: totalSymbols,
        ...(kind ? { kindFilter: kind } : {}),
        ...(errors.length > 0 ? { errors } : {}),
        files: apiFiles,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: find_orphan_types ───────────────────────────── */
server.registerTool(
  "find_orphan_types",
  {
    title: "Find orphan types and interfaces",
    description:
      "Scan a directory and return exported `type` and `interface` declarations that are never " +
      "imported by any other file in the scan root. These are candidates for cleanup or documentation.\n\n" +
      "Unlike dead functions/classes (high-confidence removals), orphan types may still be used as " +
      "structural contracts or re-exported — review before deleting.",
    inputSchema: {
      path: z.string().describe("Directory to scan, relative to project root or absolute within it."),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Max orphan types to return (default 100). Use 0 for all."),
    },
  },
  async ({ path: input, limit }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText("find_orphan_types requires a directory.");
      }

      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }

      const graph = buildSymbolGraph(skeletons, root);
      const allDead = findDeadExports(graph);
      const maxResults = (limit ?? 100) === 0 ? Infinity : (limit ?? 100);
      const orphans = allDead
        .filter(d => d.kind === "type" || d.kind === "interface")
        .slice(0, maxResults === Infinity ? undefined : maxResults);

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        orphanCount: orphans.length,
        orphans,
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
      limit: z
        .number()
        .int()
        .optional()
        .describe("Max dead exports to return (default 100). Use 0 for all."),
    },
  },
  async ({ path: input, detail, limit }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_dead_code requires a directory.`);
      }

      const opts = resolveOptions({ detail, emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, root);
      const dead = findDeadExports(graph);
      const cap = limit === 0 ? dead.length : (limit ?? 100);
      const deadExports = dead.slice(0, cap);

      return jsonText({
        directory: rel.split(path.sep).join("/"),
        scanned: files.length,
        deadExportCount: dead.length,
        ...(dead.length > cap ? { truncated: true, showing: cap } : {}),
        ...(errors.length > 0 ? { errors } : {}),
        deadExports,
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
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_circular_deps requires a directory.`);
      }

      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, root);
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
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. find_duplicate_symbols requires a directory.`);
      }

      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      const errors: Array<{ file: string; error: string }> = [];

      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch (err) {
          errors.push({ file: fileRel, error: describeError(err) });
        }
      }

      const graph = buildSymbolGraph(skeletons, root);
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
      const { abs, rel, root } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const opts = resolveOptions({ detail: "outline", emitHtml: false });
        const files = collectSourceFiles(abs, opts);
        const results = [];
        const errors: Array<{ file: string; error: string }> = [];
        for (const file of files) {
          const fileRel = path.relative(root, file).split(path.sep).join("/");
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
      const { abs, rel, root } = resolveInRoot(input);
      const stat = fs.statSync(abs);

      if (stat.isDirectory()) {
        const opts = resolveOptions({ detail: "outline", emitHtml: false });
        const files = collectSourceFiles(abs, opts);
        const results = [];
        const errors: Array<{ file: string; error: string }> = [];
        for (const file of files) {
          const fileRel = path.relative(root, file).split(path.sep).join("/");
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
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. trace_type requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const refs = [];
      const errors: Array<{ file: string; error: string }> = [];
      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
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

/* ─────────────────── tool: analyze_workspace ───────────────────────────── */
server.registerTool(
  "analyze_workspace",
  {
    title: "Analyze a monorepo workspace",
    description:
      "Discover the packages in a JS/TS monorepo (npm/yarn `workspaces`, pnpm-workspace.yaml, or " +
      "lerna.json) and the dependency edges between them. Returns each package's name, directory, " +
      "and workspace-internal dependencies, plus any circular dependencies between packages.",
    inputSchema: {
      path: z.string().optional().describe("Workspace root directory. Defaults to the project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. analyze_workspace requires a directory.`);
      }
      const info = discoverWorkspace(abs);
      const cycles = findPackageCycles(info);
      return jsonText({
        root: rel.split(path.sep).join("/") || ".",
        tool: info.tool,
        packageCount: info.packages.length,
        packages: info.packages,
        edges: info.edges,
        packageCycles: cycles,
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
      const info = readSourceMap(abs, rel.split(path.sep).join("/"));
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
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", ...data });
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
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", ...result });
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
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", ...data });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_risk_map ────────────────────────────────── */
server.registerTool(
  "get_risk_map",
  {
    title: "Refactor risk map (churn \u00d7 complexity)",
    description:
      "Rank files by refactor risk = git churn (number of commits touching the file) \u00d7 the file's " +
      "max function complexity. Surfaces the files that are both frequently changed and complex \u2014 " +
      "the most valuable refactor / test targets.",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan. Default project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!isGitRepo(root)) return errorText("Not a git repository (or git is unavailable).");
      const files = await computeRisk(abs, root);
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", count: files.length, files: files.slice(0, 50) });
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
      const pack = await packContext(abs, rel.split(path.sep).join("/"), root, symbol, scanAbs);
      return jsonText(pack);
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_coupling ────────────────────────────────── */
server.registerTool(
  "get_coupling",
  {
    title: "Coupling metrics (afferent / efferent / instability)",
    description:
      "Compute Robert C. Martin's coupling metrics per file from the import graph: afferent coupling " +
      "(Ca, fan-in), efferent coupling (Ce, fan-out), and instability I = Ce/(Ca+Ce) (0 = stable, " +
      "1 = unstable). High-Ca files are load-bearing; high-instability files change freely.",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan. Default project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_coupling requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const metrics = computeCoupling(buildSymbolGraph(skels, root));
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", count: metrics.length, files: metrics });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_layer_violations ────────────────────────── */
server.registerTool(
  "get_layer_violations",
  {
    title: "Layer violations (Stable Dependencies Principle)",
    description:
      "Find dependencies that point the wrong way on the stability gradient: a stable file " +
      "(low instability) that imports a more volatile file (high instability). Per Robert C. Martin's " +
      "Stable Dependencies Principle, stable code should not depend on volatile code — it gets dragged " +
      "along every time the volatile file churns. Results are sorted by severity (the instability gap).",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan. Default project root."),
      minGap: z.number().optional().describe("Only report violations whose instability gap exceeds this (0-1). Default 0."),
    },
  },
  async ({ path: input, minGap }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_layer_violations requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const violations = findLayerViolations(buildSymbolGraph(skels, root), minGap ?? 0);
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", count: violations.length, violations });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_module_coupling ─────────────────────────── */
server.registerTool(
  "get_module_coupling",
  {
    title: "Module coupling (directory-level Ca / Ce / instability)",
    description:
      "Aggregate the import graph up to the directory/module level: per-module afferent (Ca) / " +
      "efferent (Ce) coupling and instability, plus the weighted inter-module edges. Intra-module " +
      "imports (files importing siblings in the same directory) are ignored — only cross-module " +
      "dependencies count. The architectural bird's-eye view above per-file coupling.",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan. Default project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_module_coupling requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const mc = computeModuleCoupling(buildSymbolGraph(skels, root));
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", moduleCount: mc.modules.length, ...mc });
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
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try {
          skeletons.push(await buildSkeleton(file, fileRel, opts));
        } catch {
          // skip parse errors
        }
      }

      const graph = buildSymbolGraph(skeletons, root);
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
        const fileRel = path.relative(root, file).split(path.sep).join("/");
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
        directory: rel.split(path.sep).join("/"),
        query,
        matchCount: matches.length,
        matches,
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: get_test_coverage ───────────────────────────── */
server.registerTool(
  "get_test_coverage",
  {
    title: "Test-coverage map (tests ↔ sources)",
    description:
      "Structural test coverage: pair test files with the source files they exercise and list " +
      "source files no test touches. Two signals: a test file *importing* a source file " +
      "(definitive) and naming conventions (auth.test.ts → auth.ts, test_utils.py → utils.py). " +
      "No instrumentation or test runner needed. Untested files are ranked by risk " +
      "(fan-in, then symbol count). This is file-level coverage, not line coverage.",
    inputSchema: {
      path: z.string().optional().describe("Directory to scan (should include the test files). Default project root."),
      untestedOnly: z.boolean().optional().describe("Return only the untested-sources list. Default false."),
    },
  },
  async ({ path: input, untestedOnly }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_test_coverage requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const map = mapTestCoverage(buildSymbolGraph(skels, root));
      const dir = rel.split(path.sep).join("/") || ".";
      if (untestedOnly) {
        return jsonText({ directory: dir, untestedSources: map.untestedSources, coverageRatio: map.coverageRatio, untested: map.untested });
      }
      return jsonText({ directory: dir, ...map });
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
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skeletons, root);
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
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText(`"${input}" is not a directory. get_top_symbols requires a directory.`);
      }
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skeletons, root);
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

/* ─────────────────── tool: detect_code_smells ──────────────────────────── */
server.registerTool(
  "detect_code_smells",
  {
    title: "Detect code smells",
    description:
      "Scan a file or directory for structural code smells: god classes (too many methods/fields), " +
      "long methods, long parameter lists, primitive obsession, shallow wrappers, and large files. " +
      "Returns a list of smell results with file, line, symbol, severity, and message.",
    inputSchema: {
      path: z.string().describe("File or directory path relative to project root."),
      max_methods: z.number().int().optional().describe("God-class threshold: max public methods (default 10)."),
      max_fields: z.number().int().optional().describe("God-class threshold: max fields (default 8)."),
      max_method_lines: z.number().int().optional().describe("Long-method threshold: max lines (default 60)."),
      max_params: z.number().int().optional().describe("Long-param-list threshold: max params (default 4)."),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Max smells to return (default 100). Use 0 for all."),
    },
  },
  async ({ path: input, max_methods, max_fields, max_method_lines, max_params, limit }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const smellOpts = { maxMethods: max_methods, maxFields: max_fields, maxMethodLines: max_method_lines, maxParams: max_params };
      const allSmells: SmellResult[] = [];
      const filesToScan = fs.statSync(abs).isDirectory() ? collectSourceFiles(abs, opts) : [abs];
      for (const fileAbs of filesToScan) {
        const fileRel = path.relative(root, fileAbs).split(path.sep).join("/");
        try {
          const cached = _acGet<SmellResult[]>(fileAbs, "smells");
          if (cached) { allSmells.push(...cached); continue; }
          const skel = await buildSkeleton(fileAbs, fileRel, opts);
          const lineCount = fs.readFileSync(fileAbs, "utf8").split("\n").length;
          const fileSmells = detectSmells(skel, lineCount, smellOpts);
          _acPut(fileAbs, "smells", fileSmells);
          allSmells.push(...fileSmells);
        } catch { /* skip */ }
      }
      const cap = limit === 0 ? allSmells.length : (limit ?? 100);
      const smells = allSmells.slice(0, cap);
      return jsonText({ path: rel, scanned: filesToScan.length, total: allSmells.length, ...(allSmells.length > cap ? { truncated: true, showing: cap } : {}), smells });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: scan_security ───────────────────────────────── */
server.registerTool(
  "scan_security",
  {
    title: "Scan for security issues",
    description:
      "Static security scan across 12 rules: eval, innerHTML, dangerously-set-inner-html, " +
      "child-process, shell-exec, weak-crypto, hardcoded-secret, sql-injection, http-url, " +
      "no-rate-limit, prototype-pollution. Returns issues with file, rule, severity, line, and snippet.",
    inputSchema: {
      path: z.string().describe("File or directory path relative to project root."),
      min_severity: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Only return issues at or above this severity (default: low = all)."),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Max issues to return (default 100). Use 0 for all."),
    },
  },
  async ({ path: input, min_severity, limit }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const order = ["critical", "high", "medium", "low"] as const;
      const minIdx = order.indexOf((min_severity as (typeof order)[number]) ?? "low");
      const allIssues: ReturnType<typeof scanFileForSecurityIssues> = [];
      const filesToScan = fs.statSync(abs).isDirectory() ? collectSourceFiles(abs, opts) : [abs];
      for (const fileAbs of filesToScan) {
        const fileRel = path.relative(root, fileAbs).split(path.sep).join("/");
        try {
          type IssueList = ReturnType<typeof scanFileForSecurityIssues>;
          const cached = _acGet<IssueList>(fileAbs, "security");
          const issues = cached ?? (() => {
            const src = fs.readFileSync(fileAbs, "utf8");
            const r = scanFileForSecurityIssues(src, fileRel);
            _acPut(fileAbs, "security", r);
            return r;
          })();
          allIssues.push(...issues.filter((i) => order.indexOf(i.severity as (typeof order)[number]) <= minIdx));
        } catch { /* skip */ }
      }
      const cap = limit === 0 ? allIssues.length : (limit ?? 100);
      const issues = allIssues.slice(0, cap);
      return jsonText({ path: rel, scanned: filesToScan.length, total: allIssues.length, ...(allIssues.length > cap ? { truncated: true, showing: cap } : {}), issues });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: analyze_pr_diff ────────────────────────────── */
server.registerTool(
  "analyze_pr_diff",
  {
    title: "Analyze PR diff vs base branch",
    description:
      "Compare the working tree against a base git ref and return a comprehensive diff report:\n" +
      "  • Per-file symbol changes (added/removed/modified exports, signature changes)\n" +
      "  • Breaking changes — removed/renamed exported symbols with blast-radius impact\n" +
      "  • Code smells and security issues found only in changed files\n" +
      "  • Summary counts for quick CI integration\n\n" +
      "Requires the path to be inside a git repository. Use base='HEAD~1' to compare the last commit, " +
      "or base='main' (default) to compare the current branch against main.",
    inputSchema: {
      path: z.string().describe("Directory to scan, relative to project root or absolute within it."),
      base: z.string().optional().describe("Base git ref to diff against (default: main)."),
    },
  },
  async ({ path: input, base }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) {
        return errorText("analyze_pr_diff requires a directory.");
      }
      if (!isGitRepo(root)) {
        return errorText("Not a git repository. analyze_pr_diff requires git.");
      }

      const baseRef = base ?? "main";
      const diff = await computeDiff(abs, root, baseRef);

      const smellsOpts = resolveOptions({ detail: "full", emitHtml: false });
      const changedSmells: SmellResult[] = [];
      const changedSecurity: ReturnType<typeof scanFileForSecurityIssues> = [];

      for (const fd of diff.files) {
        if (fd.status === "deleted") continue;
        const fileAbs = path.resolve(root, fd.file);
        try {
          const cached = _acGet<SmellResult[]>(fileAbs, "smells");
          if (cached) { changedSmells.push(...cached); }
          else {
            const skel = await buildSkeleton(fileAbs, fd.file, smellsOpts);
            const lineCount = fs.readFileSync(fileAbs, "utf8").split("\n").length;
            const s = detectSmells(skel, lineCount, {});
            _acPut(fileAbs, "smells", s);
            changedSmells.push(...s);
          }
        } catch { /* skip */ }
        try {
          type IssueList = ReturnType<typeof scanFileForSecurityIssues>;
          const cachedSec = _acGet<IssueList>(fileAbs, "security");
          if (cachedSec) { changedSecurity.push(...cachedSec); }
          else {
            const src = fs.readFileSync(fileAbs, "utf8");
            const issues = scanFileForSecurityIssues(src, fd.file);
            _acPut(fileAbs, "security", issues);
            changedSecurity.push(...issues);
          }
        } catch { /* skip */ }
      }

      return jsonText({
        base: baseRef,
        summary: {
          ...diff.summary,
          smells: changedSmells.length,
          securityIssues: changedSecurity.length,
        },
        breaking: diff.breaking,
        impactedFiles: diff.impactedFiles,
        files: diff.files,
        smells: changedSmells.slice(0, 50),
        security: changedSecurity.slice(0, 50),
      });
    } catch (err) {
      return errorText(describeError(err));
    }
  },
);

/* ─────────────────── tool: generate_diagram ───────────────────────────── */
server.registerTool(
  "generate_diagram",
  {
    title: "Generate Mermaid diagram",
    description:
      "Generate a Mermaid diagram of the codebase. " +
      "type=class: classDiagram of classes/interfaces/enums and their relationships. " +
      "type=deps: file dependency graph (graph TD). " +
      "type=modules: collapsed module-level dependency graph (graph LR).",
    inputSchema: {
      path: z.string().describe("Directory to scan."),
      type: z
        .enum(["class", "deps", "modules"])
        .optional()
        .describe("Diagram type: class | deps | modules (default: deps)."),
      max_nodes: z.number().int().optional().describe("Max nodes in deps diagram (default 50)."),
    },
  },
  async ({ path: input, type, max_nodes }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) return errorText("generate_diagram requires a directory.");
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skeletons: SkeletonFile[] = [];
      for (const file of files) {
        const fileRel = path.relative(root, file).split(path.sep).join("/");
        try { skeletons.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
      }
      const diagramType = type ?? "deps";
      let result;
      if (diagramType === "class") {
        result = buildClassDiagram(skeletons);
      } else if (diagramType === "modules") {
        const graph = buildSymbolGraph(skeletons, root);
        result = buildModulesDiagram(graph);
      } else {
        const graph = buildSymbolGraph(skeletons, root);
        result = buildDepsDiagram(graph, max_nodes ?? 50);
      }
      return jsonText({ path: rel, ...result });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: get_fix_suggestions ─────────────────────────── */
server.registerTool(
  "get_fix_suggestions",
  {
    title: "Get fix suggestions",
    description:
      "Return actionable, prioritised fix suggestions derived from dead exports, code smells, " +
      "and security issues. Each suggestion has a kind, file, line, description, before/after snippet, " +
      "and priority (1=must fix, 2=should fix, 3=nice to have).",
    inputSchema: {
      path: z.string().describe("File or directory path."),
      min_priority: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("Only return suggestions at or above this priority (1=must, 2=should, 3=nice). Default 3 (all)."),
    },
  },
  async ({ path: input, min_priority }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const filesToScan = fs.statSync(abs).isDirectory() ? collectSourceFiles(abs, opts) : [abs];
      const skeletons: SkeletonFile[] = [];
      const allSmells: SmellResult[] = [];
      const allSecurity: ReturnType<typeof scanFileForSecurityIssues> = [];

      for (const fileAbs of filesToScan) {
        const fileRel = path.relative(root, fileAbs).split(path.sep).join("/");
        try {
          const skel = await buildSkeleton(fileAbs, fileRel, opts);
          skeletons.push(skel);
          const source = fs.readFileSync(fileAbs, "utf8");
          allSmells.push(...detectSmells(skel, source.split("\n").length));
          allSecurity.push(...scanFileForSecurityIssues(source, fileRel));
        } catch { /* skip */ }
      }

      const graph = buildSymbolGraph(skeletons, root);
      const dead = findDeadExports(graph);
      const minP = min_priority ?? 3;
      const suggestions = buildFixSuggestions({ dead, smells: allSmells, security: allSecurity, skeletons })
        .filter((s) => s.priority <= minP);

      return jsonText({ path: rel, scanned: filesToScan.length, total: suggestions.length, suggestions });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: generate_tests ──────────────────────────────── */
server.registerTool(
  "generate_tests",
  {
    title: "Generate test stubs",
    description:
      "Generate test stubs for a source file using its AST skeleton. " +
      "Supports vitest, jest, mocha, node:test, pytest, and gotest. " +
      "Returns the generated test file content and metadata (testCount, framework, testFilePath).",
    inputSchema: {
      path: z.string().describe("Source file path relative to project root."),
      framework: z
        .enum(["vitest", "jest", "mocha", "node", "pytest", "gotest"])
        .optional()
        .describe("Test framework. Auto-detected from package.json when omitted."),
      exported_only: z
        .boolean()
        .optional()
        .describe("Only generate tests for exported symbols (default: true)."),
    },
  },
  async ({ path: input, framework, exported_only }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) return errorText("generate_tests requires a single file.");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      const fw = (framework as TestFramework | undefined) ?? detectTestFramework(root);
      const result = generateTestFile(skel, abs, { framework: fw, exportedOnly: exported_only ?? true });
      return jsonText(result);
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: generate_tests_ai ───────────────────────────── */
server.registerTool(
  "generate_tests_ai",
  {
    title: "Generate tests with AI (Claude)",
    description:
      "Generate tests for a source file using the AST skeleton for structure, then enhance them " +
      "with Claude to produce real assertions instead of TODO placeholders. " +
      "Requires ANTHROPIC_API_KEY env var or explicit api_key. Falls back to stubs if the API is unavailable.",
    inputSchema: {
      path: z.string().describe("Source file path relative to project root."),
      framework: z
        .enum(["vitest", "jest", "mocha", "node", "pytest", "gotest"])
        .optional()
        .describe("Test framework. Auto-detected when omitted."),
      api_key: z.string().optional().describe("Anthropic API key (overrides ANTHROPIC_API_KEY env var)."),
      model: z.string().optional().describe("Claude model ID (default: claude-sonnet-4-6)."),
    },
  },
  async ({ path: input, framework, api_key, model }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) return errorText("generate_tests_ai requires a single file.");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      const fw = (framework as TestFramework | undefined) ?? detectTestFramework(root);
      const stubs = generateTestFile(skel, abs, { framework: fw, exportedOnly: true });
      const sourceCode = fs.readFileSync(abs, "utf8");
      const result = await tryAiEnhanceTests(stubs, sourceCode, skel.language, { apiKey: api_key, model });
      return jsonText(result);
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: ai_refactor ─────────────────────────────────── */
server.registerTool(
  "ai_refactor",
  {
    title: "AI-powered refactoring suggestions",
    description:
      "Send smells or security issues from a file to Claude and receive concrete refactored code. " +
      "Returns before/after code blocks and an explanation for each issue found. " +
      "Requires ANTHROPIC_API_KEY env var or explicit api_key.",
    inputSchema: {
      path: z.string().describe("Source file to refactor."),
      kind: z
        .enum(["smell", "security", "both"])
        .optional()
        .describe("Which issues to refactor: smell | security | both (default: both)."),
      api_key: z.string().optional().describe("Anthropic API key (overrides ANTHROPIC_API_KEY env var)."),
      model: z.string().optional().describe("Claude model ID (default: claude-sonnet-4-6)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Max issues to send to AI (default 3 to control cost)."),
    },
  },
  async ({ path: input, kind, api_key, model, limit }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) return errorText("ai_refactor requires a single file.");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);
      const source = readSource(abs);
      const lang = skel.language;
      const cap = limit ?? 3;

      const targets: Parameters<typeof aiRefactorBatch>[0] = [];
      const wantSmells = (kind ?? "both") !== "security";
      const wantSecurity = (kind ?? "both") !== "smell";

      if (wantSmells) {
        const smells = detectSmells(skel, source.split("\n").length);
        for (const smell of smells.slice(0, cap - targets.length)) {
          targets.push({ kind: "smell", smell, sourceCode: source, filePath: rel, language: lang });
        }
      }
      if (wantSecurity && targets.length < cap) {
        const issues = scanFileForSecurityIssues(source, rel);
        for (const sec of issues.slice(0, cap - targets.length)) {
          targets.push({ kind: "security", security: sec, sourceCode: source, filePath: rel, language: lang });
        }
      }

      if (targets.length === 0) return jsonText({ path: rel, message: "No issues found to refactor.", results: [] });

      const results = await aiRefactorBatch(targets, { apiKey: api_key, model });
      return jsonText({ path: rel, total: results.length, results });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: explain_symbol ──────────────────────────────── */
server.registerTool(
  "explain_symbol",
  {
    title: "Explain a symbol (purpose, callers, deps, risk)",
    description:
      "Provide a structural explanation of any named symbol: what it does, who calls it, " +
      "what it depends on, smells, complexity rating, and estimated change risk. " +
      "With ai=true, Claude writes a prose explanation using the structural data (requires ANTHROPIC_API_KEY).",
    inputSchema: {
      path: z.string().describe("File containing the symbol, relative to project root."),
      symbol: z.string().describe("Symbol name to explain."),
      scanDir: z.string().optional().describe("Directory to build the dependency graph from. Default: file directory."),
      ai: z.boolean().optional().describe("Use Claude AI to generate a prose explanation. Default false."),
      api_key: z.string().optional().describe("Anthropic API key (overrides ANTHROPIC_API_KEY)."),
      model: z.string().optional().describe("Claude model ID (default: claude-sonnet-4-6)."),
    },
  },
  async ({ path: input, symbol, scanDir, ai, api_key, model }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (fs.statSync(abs).isDirectory()) return errorText("explain_symbol requires a single file.");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const skel = await buildSkeleton(abs, rel, opts);

      const scanRoot = scanDir ? resolveInRoot(scanDir).abs : path.dirname(abs);
      const skFiles = collectSourceFiles(scanRoot, opts);
      const skels: SkeletonFile[] = [];
      for (const f of skFiles) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const graph = buildSymbolGraph(skels, root);
      const targetId = `${rel}::${symbol}`;
      const impact = getChangeImpact(graph, targetId);

      const sourceCode = fs.readFileSync(abs, "utf8");
      const smellMessages = detectSmells(skel, sourceCode.split("\n").length).map((s) => s.message);
      const cx = await computeFileComplexity(abs, rel);
      const fnCx = cx?.functions.find((f) => f.name === symbol);

      let result = buildExplainResult(symbol, skel, graph, impact, smellMessages, fnCx?.rating);

      if (ai) {
        result = await aiExplain(result, sourceCode, { apiKey: api_key, model });
      }

      return jsonText(result);
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: find_similar ────────────────────────────────── */
server.registerTool(
  "find_similar",
  {
    title: "Find structurally similar symbols",
    description:
      "Find groups of functions/methods/classes that share the same structural fingerprint " +
      "(param count, async, return type, size, nesting) across a directory. " +
      "Highlights duplication and consolidation candidates — no AI or text comparison needed.",
    inputSchema: {
      path: z.string().describe("Directory to scan, relative to project root or absolute within it."),
      kinds: z.array(z.string()).optional().describe("Symbol kinds to include (default: function, method, class)."),
      min_group_size: z.number().int().min(2).optional().describe("Minimum group size to report (default 2)."),
    },
  },
  async ({ path: input, kinds, min_group_size }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input);
      if (!fs.statSync(abs).isDirectory()) return errorText("find_similar requires a directory.");
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const groups = findSimilar(skels, { kinds, minGroupSize: min_group_size });
      return jsonText({ directory: rel.split(path.sep).join("/"), groupCount: groups.length, groups });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: merge_coverage ──────────────────────────────── */
server.registerTool(
  "merge_coverage",
  {
    title: "Merge actual coverage with structural map",
    description:
      "Enrich the structural test coverage map (which files have tests) with actual line/branch " +
      "percentages from a real coverage report. Supports Istanbul JSON, lcov, Clover XML, Cobertura XML. " +
      "Returns enriched per-file coverage, dead tests (tested but 0% actual), and uncovered files.",
    inputSchema: {
      report: z.string().describe("Path to the coverage report file (relative to project root or absolute)."),
      path: z.string().optional().describe("Project directory to scan for structural map. Default project root."),
      format: z
        .enum(["auto", "istanbul", "lcov", "clover", "cobertura"])
        .optional()
        .describe("Coverage format. Default auto-detected from file extension/content."),
    },
  },
  async ({ report, path: input, format }) => {
    try {
      const { abs: reportAbs } = resolveInRoot(report);
      if (!fs.existsSync(reportAbs)) return errorText(`Coverage report not found: ${report}`);
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) return errorText("merge_coverage requires a directory.");
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const { mapTestCoverage } = await import("./testmap.js");
      const structuralMap = mapTestCoverage(buildSymbolGraph(skels, root));
      const merged = mergeCoverage(reportAbs, structuralMap, abs, (format ?? "auto") as CoverageFormat);
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", ...merged });
    } catch (err) { return errorText(describeError(err)); }
  },
);

/* ─────────────────── tool: run_plugins ─────────────────────────────────── */
server.registerTool(
  "run_plugins",
  {
    title: "Run custom lint plugins",
    description:
      "Load and run all `.mjs`/`.js` plugins from `<root>/.ast-map/plugins/` against the current skeletons. " +
      "Each plugin exports an `AstMapPlugin` with an `id` and a `run(ctx)` function that returns violations. " +
      "Returns per-plugin violation lists with file, line, symbol, severity, and message.",
    inputSchema: {
      path: z.string().optional().describe("Project directory. Defaults to project root."),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs, rel, root } = resolveInRoot(input ?? ".");
      if (!fs.statSync(abs).isDirectory()) return errorText("run_plugins requires a directory.");
      const plugins = await loadPlugins(abs);
      if (plugins.length === 0) {
        return jsonText({ directory: rel.split(path.sep).join("/") || ".", plugins: [], message: "No plugins found in .ast-map/plugins/" });
      }
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const skels: SkeletonFile[] = [];
      for (const f of files) {
        const r = path.relative(root, f).split(path.sep).join("/");
        try { skels.push(await buildSkeleton(f, r, opts)); } catch { /* skip */ }
      }
      const results = await runPlugins(plugins, { root: abs, skeletons: skels });
      const totalViolations = results.reduce((s, r) => s + r.violations.length, 0);
      return jsonText({ directory: rel.split(path.sep).join("/") || ".", pluginCount: plugins.length, totalViolations, plugins: results });
    } catch (err) { return errorText(describeError(err)); }
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
          const rel = path.relative(ROOT, f).split(path.sep).join("/");
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
    const skel = await buildSkeleton(abs, safeRel.split(path.sep).join("/"), opts);
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
      const fileRel = path.relative(ROOT, file).split(path.sep).join("/");
      try { skels.push(await buildSkeleton(file, fileRel, opts)); } catch { /* skip */ }
    }
    const graph = buildSymbolGraph(skels, ROOT);
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(graph, null, 2) }],
    };
  },
);

/* --------------------------- tool: build_index -------------------------------- */
server.registerTool(
  "build_index",
  {
    title: "Build persistent skeleton index",
    description:
      "Builds or refreshes the persistent skeleton index at .ast-map/index.json. " +
      "Subsequent commands read from the index (hash-verified) for 10-100x faster analysis.",
    inputSchema: {
      dir: z.string().optional().describe("Directory to scan (default: root)."),
      force: z.boolean().optional().describe("Rebuild all files, ignoring cached hashes."),
    },
  },
  async ({ dir, force }) => {
    const { abs } = dir ? resolveInRoot(dir) : { abs: ROOT };
    if (force) {
      const indexFile = path.join(ROOT, ".ast-map", "index.json");
      try { fs.unlinkSync(indexFile); } catch { /* fine */ }
    }
    const t0 = Date.now();
    const store = await buildIndex(ROOT, abs);
    return jsonText({ root: ROOT, scanDir: abs, fileCount: store.fileCount, builtAt: store.builtAt, elapsedMs: Date.now() - t0 });
  },
);

/* ------------------------- tool: check_arch_rules ----------------------------- */
server.registerTool(
  "check_arch_rules",
  {
    title: "Check architecture import rules",
    description:
      "Enforces forbidden/required import rules declared in .ast-map.json under `arch.rules`. " +
      "Returns a list of violations with severity (error | warning).",
    inputSchema: {
      dir: z.string().optional().describe("Directory to scan (default: root)."),
    },
  },
  async ({ dir }) => {
    const { abs } = dir ? resolveInRoot(dir) : { abs: ROOT };
    const projectConfig = loadProjectConfig(ROOT);
    const rules = loadArchRules(projectConfig);
    if (rules.length === 0) return jsonText({ message: "No arch rules configured. Add arch.rules to .ast-map.json.", violations: [] });

    let skeletons: SkeletonFile[];
    const store = loadIndex(ROOT);
    if (store && isIndexFresh(store)) {
      const prefix = path.relative(ROOT, abs).split(path.sep).join("/");
      skeletons = getIndexSkeletons(store, prefix || undefined);
    } else {
      const opts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(abs, opts);
      const items = files.map(f => ({ abs: f, rel: path.relative(ROOT, f).split(path.sep).join("/") }));
      const built = await buildSkeletonsBulk(items, opts);
      skeletons = built.filter(Boolean).map(r => r!.skel);
    }

    const graph = buildSymbolGraph(skeletons, ROOT);
    const violations = checkArchRules(graph, rules);
    return jsonText({ ruleCount: rules.length, violationCount: violations.length, violations });
  },
);

/* --------------------------- tool: generate_docs ------------------------------ */
server.registerTool(
  "generate_docs",
  {
    title: "Generate API documentation",
    description:
      "Generates Markdown or HTML API documentation from the skeleton of a directory. " +
      "Optionally enhances descriptions with Claude (requires ANTHROPIC_API_KEY).",
    inputSchema: {
      dir: z.string().optional().describe("Directory to document (default: root)."),
      format: z.enum(["markdown", "html"]).optional().describe("Output format (default: markdown)."),
      exportedOnly: z.boolean().optional().describe("Include only exported symbols (default: true)."),
      ai: z.boolean().optional().describe("Use Claude API to add symbol descriptions."),
      apiKey: z.string().optional().describe("Anthropic API key (overrides env var)."),
    },
  },
  async ({ dir, format, exportedOnly, ai, apiKey }) => {
    const { abs } = dir ? resolveInRoot(dir) : { abs: ROOT };
    const opts = resolveOptions({ detail: "full", emitHtml: false });
    const files = collectSourceFiles(abs, opts);
    const items = files.map(f => ({ abs: f, rel: path.relative(ROOT, f).split(path.sep).join("/") }));
    const built = await buildSkeletonsBulk(items, opts);
    const skeletons = built.filter(Boolean).map(r => r!.skel);

    let output = buildDocOutput(skeletons, { exportedOnly: exportedOnly !== false });
    if (ai) {
      output = await aiEnhanceDocs(output, { apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
    }

    const rendered = format === "html" ? renderDocHtml(output) : renderMarkdown(output);
    return { content: [{ type: "text" as const, text: rendered }] };
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
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
