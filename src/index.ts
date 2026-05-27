#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveOptions, type SkeletonOptions } from "./config.js";
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
  hasDirective,
  findServerImports,
  isApiRoute,
  findMissingTryCatch,
} from "./analysis.js";
import { resolveFileImports } from "./resolver.js";
import { buildSymbolGraph } from "./graph.js";

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

const server = new McpServer({
  name: "universal-ast-mapper",
  version: "0.2.0",
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
          const fileRel = path.relative(ROOT, file);
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
    title: "Validate Next.js App Router architecture",
    description:
      "Scan files for Next.js App Router architecture violations:\n" +
      "  (1) client-server-boundary — 'use client' components importing server-only modules " +
      "(prisma, next/headers, next/cookies, lib/auth, lib/auditLog, lib/apiAuth, server-only).\n" +
      "  (2) api-missing-try-catch — API route handlers (GET/POST/PUT/DELETE/PATCH) with no try/catch, " +
      "causing unhandled errors to leak as unstructured 500 responses.\n" +
      "Returns structured violations with file paths, line numbers, and severity.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "File or directory to scan (relative to root or absolute within it). Use '.' to scan the whole project.",
        ),
    },
  },
  async ({ path: input }) => {
    try {
      const { abs } = resolveInRoot(input);
      const opts = resolveOptions({ detail: "full", emitHtml: false });
      const stat = fs.statSync(abs);

      const filesToCheck: string[] = stat.isDirectory()
        ? collectSourceFiles(abs, opts)
        : [abs];

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

        // Rule 1: "use client" files must not import server-only modules
        if (hasDirective(source, "use client")) {
          for (const imp of findServerImports(source)) {
            violations.push({
              file: fileRel,
              rule: "client-server-boundary",
              severity: "error",
              message: `"use client" file imports server-only module "${imp.label}" (${imp.module})`,
              line: imp.line,
            });
          }
        }

        // Rule 2: API route handlers should have try/catch
        if (isApiRoute(fileRel)) {
          try {
            const skel = await buildSkeleton(file, fileRel, opts);
            const sourceLines = source.split("\n");
            for (const sym of findMissingTryCatch(skel.symbols, sourceLines)) {
              violations.push({
                file: fileRel,
                rule: "api-missing-try-catch",
                severity: "warning",
                message: `API handler "${sym.name}" has no try/catch — unhandled errors produce unstructured 500 responses`,
                line: sym.range.startLine,
              });
            }
          } catch {
            // skip parse errors silently
          }
        }
      }

      const errors = violations.filter((v) => v.severity === "error").length;
      const warnings = violations.filter((v) => v.severity === "warning").length;

      return jsonText({
        scanned: filesToCheck.length,
        violations: violations.length,
        errors,
        warnings,
        summary:
          violations.length === 0
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
