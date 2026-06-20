#!/usr/bin/env node
/**
 * Minimal Language Server Protocol (LSP) server for ast-map.
 * Implements JSON-RPC 2.0 over stdio without any external library.
 *
 * Capabilities:
 *   - textDocument/publishDiagnostics (dead exports + security issues)
 *   - textDocument/codeLens (cyclomatic complexity per function/class)
 *   - textDocument/hover (symbol kind, complexity, line count)
 *
 * Invocation: node dist/lsp.js
 * The VS Code extension (or any LSP client) starts this as a child process.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import { initDiskCache, defaultCacheDir } from "./diskcache.js";
import { buildSymbolGraph } from "./graph.js";
import { findDeadExports } from "./graph-analysis.js";
import { computeFileComplexity } from "./complexity.js";
import { scanFileForSecurityIssues } from "./security.js";
import { detectSmells } from "./smells.js";
import { parseRootsFromEnv } from "./roots.js";

const ROOTS = parseRootsFromEnv();
const ROOT = ROOTS.roots[0];

if (process.env.AST_MAP_NO_CACHE !== "1" && loadProjectConfig(ROOT).cache !== false) {
  initDiskCache(defaultCacheDir(ROOT));
}

// ─── JSON-RPC 2.0 framing ────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

function sendRaw(obj: unknown): void {
  const body = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function respond(id: number | string | null, result: unknown): void {
  sendRaw({ jsonrpc: "2.0", id, result });
}

function notify(method: string, params: unknown): void {
  sendRaw({ jsonrpc: "2.0", method, params });
}

function respondError(id: number | string | null, code: number, message: string): void {
  sendRaw({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

// ─── LSP message reader ───────────────────────────────────────────────────────

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

function processBuffer(): void {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const headerStr = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }

    const contentLength = parseInt(match[1], 10);
    const start = headerEnd + 4;
    if (buffer.length < start + contentLength) break;

    const body = buffer.slice(start, start + contentLength).toString("utf8");
    buffer = buffer.slice(start + contentLength);

    try {
      const msg = JSON.parse(body) as RpcRequest;
      void handleMessage(msg);
    } catch { /* malformed JSON */ }
  }
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: number; // 1=Error 2=Warning 3=Information 4=Hint
  source: string;
  message: string;
  code?: string;
}

async function computeDiagnostics(fileUri: string): Promise<LspDiagnostic[]> {
  const filePath = uriToPath(fileUri);
  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  const diags: LspDiagnostic[] = [];

  try {
    const source = fs.readFileSync(filePath, "utf8");

    // Security issues
    const issues = scanFileForSecurityIssues(source, rel);
    for (const issue of issues) {
      const line = Math.max(0, issue.line - 1);
      diags.push({
        range: { start: { line, character: 0 }, end: { line, character: 999 } },
        severity: ["critical", "high"].includes(issue.severity) ? 1 : 2,
        source: "ast-map",
        message: `[${issue.severity.toUpperCase()}] ${issue.message}`,
        code: issue.rule,
      });
    }

    // Smells
    const opts = resolveOptions({ detail: "full", emitHtml: false });
    const skel = await buildSkeleton(filePath, rel, opts);
    const lineCount = source.split("\n").length;
    const smells = detectSmells(skel, lineCount);
    for (const smell of smells) {
      const line = Math.max(0, (smell.line ?? 1) - 1);
      diags.push({
        range: { start: { line, character: 0 }, end: { line, character: 999 } },
        severity: smell.severity === "warning" ? 2 : 3,
        source: "ast-map",
        message: smell.symbol ? `[${smell.smell}] ${smell.symbol}: ${smell.message}` : `[${smell.smell}] ${smell.message}`,
        code: smell.smell,
      });
    }

    // Dead exports (scan directory containing the file)
    try {
      const dir = path.dirname(filePath);
      const skOpts = resolveOptions({ detail: "outline", emitHtml: false });
      const files = collectSourceFiles(dir, skOpts);
      const skels = await Promise.all(
        files.map(async (f) => {
          const r = path.relative(ROOT, f).split(path.sep).join("/");
          try { return await buildSkeleton(f, r, skOpts); } catch { return null; }
        }),
      );
      const graph = buildSymbolGraph(skels.filter(Boolean) as Awaited<ReturnType<typeof buildSkeleton>>[], ROOT);
      const dead = findDeadExports(graph).filter((d) => d.file === rel && d.confidence === "high");
      for (const d of dead) {
        const line = 0; // DeadExport has no line number; mark at file start
        diags.push({
          range: { start: { line, character: 0 }, end: { line, character: 999 } },
          severity: 2,
          source: "ast-map",
          message: `Dead export: "${d.symbol}" (${d.kind}) is never imported within the scanned directory.`,
          code: "dead-export",
        });
      }
    } catch { /* dead export scan optional */ }
  } catch { /* file unreadable */ }

  return diags;
}

// ─── Code Lens ───────────────────────────────────────────────────────────────

interface LspCodeLens {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  command?: { title: string; command: string };
}

async function computeCodeLenses(fileUri: string): Promise<LspCodeLens[]> {
  const filePath = uriToPath(fileUri);
  const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
  try {
    const cx = await computeFileComplexity(filePath, rel);
    if (!cx) return [];
    return cx.functions.map((fn) => {
      const line = Math.max(0, fn.startLine - 1);
      const icon = fn.complexity >= 20 ? "🔴" : fn.complexity >= 10 ? "🟡" : "✦";
      return {
        range: { start: { line, character: 0 }, end: { line, character: 0 } },
        command: {
          title: `${icon} Complexity: ${fn.complexity} (${fn.rating})`,
          command: "",
        },
      };
    });
  } catch { return []; }
}

// ─── URI helpers ─────────────────────────────────────────────────────────────

function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]):/, "$1:"));
}

function pathToUri(p: string): string {
  return "file://" + p.split(path.sep).join("/");
}

// ─── Supported languages ─────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb"]);

function isSupported(uri: string): boolean {
  return SUPPORTED_EXTS.has(path.extname(uriToPath(uri)));
}

// ─── Message router ───────────────────────────────────────────────────────────

const CAPABILITIES = {
  textDocumentSync: 2, // incremental
  codeLensProvider: { resolveProvider: false },
  hoverProvider: false,
  diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
};

async function handleMessage(msg: RpcRequest): Promise<void> {
  const { method, id, params } = msg;

  if (method === "initialize") {
    respond(id ?? null, {
      capabilities: CAPABILITIES,
      serverInfo: { name: "ast-map-lsp", version: "1.33.0" },
    });
    return;
  }

  if (method === "initialized") {
    // Push diagnostics for already-open files (none tracked yet at startup)
    return;
  }

  if (method === "shutdown") {
    respond(id ?? null, null);
    return;
  }

  if (method === "exit") {
    process.exit(0);
  }

  if (method === "textDocument/didOpen") {
    const p = params as { textDocument: { uri: string } };
    if (isSupported(p.textDocument.uri)) {
      const diags = await computeDiagnostics(p.textDocument.uri);
      notify("textDocument/publishDiagnostics", { uri: p.textDocument.uri, diagnostics: diags });
    }
    return;
  }

  if (method === "textDocument/didSave") {
    const p = params as { textDocument: { uri: string } };
    if (isSupported(p.textDocument.uri)) {
      const diags = await computeDiagnostics(p.textDocument.uri);
      notify("textDocument/publishDiagnostics", { uri: p.textDocument.uri, diagnostics: diags });
    }
    return;
  }

  if (method === "textDocument/didClose") {
    const p = params as { textDocument: { uri: string } };
    notify("textDocument/publishDiagnostics", { uri: p.textDocument.uri, diagnostics: [] });
    return;
  }

  if (method === "textDocument/codeLens") {
    const p = params as { textDocument: { uri: string } };
    if (!isSupported(p.textDocument.uri)) { respond(id ?? null, []); return; }
    const lenses = await computeCodeLenses(p.textDocument.uri);
    respond(id ?? null, lenses);
    return;
  }

  // Unknown method — return null for requests, ignore notifications
  if (id !== undefined && id !== null) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.stderr.write(`ast-map LSP server started. root=${ROOT}\n`);
