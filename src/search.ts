import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import type { SymbolNode } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SymbolMatch {
  file: string;
  /** Full qualified name — nested symbols use dot notation: "MyClass.render" */
  symbol: string;
  kind: string;
  exported: boolean;
  range: { startLine: number; endLine: number };
  signature?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively yield every symbol in a file, including nested ones. */
function* flattenSymbols(
  symbols: SymbolNode[],
  file: string,
  parentName?: string,
): Generator<SymbolMatch> {
  for (const sym of symbols) {
    const fullName = parentName ? `${parentName}.${sym.name}` : sym.name;
    yield {
      file,
      symbol: fullName,
      kind: sym.kind,
      exported: sym.exported ?? false,
      range: sym.range,
      ...(sym.signature ? { signature: sym.signature } : {}),
    };
    if (sym.children.length > 0) {
      yield* flattenSymbols(sym.children, file, fullName);
    }
  }
}

function makeMatcher(
  pattern: string,
  matchType: "exact" | "contains" | "regex",
): (name: string) => boolean {
  if (matchType === "exact") {
    return (name) => name === pattern || name.endsWith(`.${pattern}`);
  }
  if (matchType === "regex") {
    const re = new RegExp(pattern, "i");
    return (name) => re.test(name);
  }
  // contains (default) — case-insensitive
  const lower = pattern.toLowerCase();
  return (name) => name.toLowerCase().includes(lower);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface SearchOptions {
  matchType?: "exact" | "contains" | "regex";
  kind?: string;
  exportedOnly?: boolean;
  detail?: "outline" | "full";
}

/**
 * Search for symbols by name pattern across all source files in a directory.
 * Traverses nested symbols (methods inside classes, etc.) with dot-notation names.
 *
 * @param dirAbs    Absolute path of directory to scan.
 * @param pattern   Name to search for (matched per `matchType`).
 * @param root      Project root (for relative paths in results).
 * @param options   matchType, kind filter, exportedOnly, detail level.
 */
export async function searchSymbols(
  dirAbs: string,
  pattern: string,
  root: string,
  options: SearchOptions = {},
): Promise<SymbolMatch[]> {
  const { matchType = "contains", kind, exportedOnly = false, detail = "outline" } = options;
  const test = makeMatcher(pattern, matchType);
  const opts = resolveOptions({ detail, emitHtml: false });
  const files = collectSourceFiles(dirAbs, opts);
  const results: SymbolMatch[] = [];

  for (const file of files) {
    const fileRel = path.relative(root, file).split(path.sep).join("/");
    try {
      const skel = await buildSkeleton(file, fileRel, opts);
      for (const match of flattenSymbols(skel.symbols, skel.file)) {
        if (!test(match.symbol)) continue;
        if (kind && match.kind !== kind) continue;
        if (exportedOnly && !match.exported) continue;
        results.push(match);
      }
    } catch {
      // skip unreadable / unparseable files
    }
  }

  return results;
}
