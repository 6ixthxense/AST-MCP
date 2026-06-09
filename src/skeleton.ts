import fs from "node:fs";
import path from "node:path";
import type { SkeletonFile } from "./types.js";
import type { SkeletonOptions } from "./config.js";
import { detectLanguage, supportedExtensions } from "./registry.js";
import { parseSource } from "./parser.js";
import { countSymbols, toOutline } from "./extractors/common.js";
import { extractScript } from "./sfc.js";

export const SCHEMA_VERSION = "1.1";
export const GRAMMAR_SOURCE = "tree-sitter-wasms@0.1.13";

// ─── In-process parse cache ───────────────────────────────────────────────────
// Keyed by "<absPath>|<detail>". Invalidated whenever the file's mtime changes.
// Survives for the lifetime of the process (MCP server) or a single CLI run.
interface CacheEntry { mtime: number; result: SkeletonFile }
const parseCache = new Map<string, CacheEntry>();

function cacheKey(absPath: string, detail: string) { return `${absPath}|${detail}`; }

function getCached(absPath: string, detail: string): SkeletonFile | null {
  try {
    const entry = parseCache.get(cacheKey(absPath, detail));
    if (!entry) return null;
    const mtime = fs.statSync(absPath).mtimeMs;
    return entry.mtime === mtime ? entry.result : null;
  } catch { return null; }
}

function setCached(absPath: string, detail: string, result: SkeletonFile): void {
  try {
    const mtime = fs.statSync(absPath).mtimeMs;
    parseCache.set(cacheKey(absPath, detail), { mtime, result });
  } catch { /* skip if stat fails */ }
}

export class UnsupportedLanguageError extends Error {
  constructor(public readonly ext: string) {
    super(`Unsupported file type "${ext}". Supported: ${supportedExtensions().join(", ")}`);
    this.name = "UnsupportedLanguageError";
  }
}

/**
 * Build a skeleton for a single file.
 * @param absPath absolute path on disk (already validated to be within root)
 * @param relPath path relative to root, used as the displayed `file`
 */
export async function buildSkeleton(
  absPath: string,
  relPath: string,
  opts: SkeletonOptions,
): Promise<SkeletonFile> {
  const ext = path.extname(absPath).toLowerCase();
  const entry = detectLanguage(absPath);
  if (!entry) throw new UnsupportedLanguageError(ext);

  const stat = fs.statSync(absPath);
  if (stat.size > opts.maxFileBytes) {
    throw new Error(
      `File is ${stat.size} bytes, exceeds maxFileBytes (${opts.maxFileBytes}). Increase the limit to parse it.`,
    );
  }

  // Return cached result if file hasn't changed. The cached SkeletonFile's
  // `.file` is whatever relPath the first caller used; the same absolute file
  // can be requested under a different root (different relPath), so override
  // `.file` per call to avoid leaking a stale rel path into callers/indexes.
  const cached = getCached(absPath, opts.detail);
  if (cached) {
    const wantFile = relPath.split(path.sep).join("/");
    return cached.file === wantFile ? cached : { ...cached, file: wantFile };
  }

  let source = fs.readFileSync(absPath, "utf8");
  let grammar = entry.grammar;
  if (entry.sfc) {
    const script = extractScript(source);
    source = script.code; // blank-padded script-only source (offsets preserved)
    grammar = script.grammar;
  }
  const root = await parseSource(grammar, source);
  let symbols = entry.extract(root, source);
  if (opts.detail === "outline") symbols = toOutline(symbols);

  const directives = entry.extractDirectives ? entry.extractDirectives(root, source) : [];
  const imports = entry.extractImports ? entry.extractImports(root, source) : [];

  const result: SkeletonFile = {
    schemaVersion: SCHEMA_VERSION,
    file: relPath.split(path.sep).join("/"),
    language: entry.language,
    generatedAt: new Date().toISOString(),
    parser: { engine: "tree-sitter", grammar: `${grammar} (${GRAMMAR_SOURCE})` },
    symbolCount: countSymbols(symbols),
    ...(directives.length > 0 ? { directives } : {}),
    ...(imports.length > 0 ? { imports } : {}),
    symbols,
  };

  setCached(absPath, opts.detail, result);
  return result;
}

/** Recursively collect supported source files under a directory. */
export function collectSourceFiles(absDir: string, opts: SkeletonOptions): string[] {
  const supported = new Set(supportedExtensions());
  const ignore = new Set(opts.ignore);
  const results: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) {
        if (e.isDirectory()) continue;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(full);
      } else if (e.isFile() && supported.has(path.extname(e.name).toLowerCase())) {
        results.push(full);
      }
    }
  };

  walk(absDir);
  return results.sort();
}
