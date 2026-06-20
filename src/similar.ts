import type { SkeletonFile, SymbolNode } from "./types.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SimilarEntry {
  file: string;
  symbol: string;
  kind: string;
  line: number;
  signature?: string | null;
  /** Fingerprint used for grouping. */
  fingerprint: string;
}

export interface SimilarGroup {
  fingerprint: string;
  description: string;
  count: number;
  entries: SimilarEntry[];
}

export interface SimilarOptions {
  /** Minimum group size to report (default 2). */
  minGroupSize?: number;
  /** Kinds to include (default: function, method, class). */
  kinds?: string[];
}

// ─── Fingerprinting ────────────────────────────────────────────────────────────

/**
 * Build a structural fingerprint for a symbol.
 * Two symbols with the same fingerprint are structurally similar (not textually identical).
 */
function fingerprint(sym: SymbolNode): string | null {
  const kind = sym.kind;
  if (!["function", "method", "class", "struct"].includes(kind)) return null;

  const sig = sym.signature ?? "";

  // Param count from signature
  const paramMatch = sig.match(/\(([^)]*)\)/);
  const paramStr = paramMatch?.[1]?.trim() ?? "";
  const paramCount = paramStr === "" ? 0 : paramStr.split(",").length;

  // Presence of return type annotation
  const hasReturnType = sig.includes("): ") || sig.includes(") :") || sig.includes("->");

  // Async?
  const isAsync = sig.includes("async ") || sig.includes("suspend ") || sig.includes("async def ");

  // Visibility
  const visibility = sym.visibility;

  // Child count bucket for classes
  const childCount = sym.children.length;
  const childBucket = childCount === 0 ? "0" : childCount <= 3 ? "1-3" : childCount <= 8 ? "4-8" : "9+";

  // Line length bucket
  const lineCount = sym.range.endLine - sym.range.startLine + 1;
  const sizeBucket = lineCount <= 5 ? "xs" : lineCount <= 20 ? "sm" : lineCount <= 60 ? "md" : "lg";

  // Has nested functions?
  const hasNested = sym.children.some((c) => c.kind === "function" || c.kind === "method");

  if (kind === "class" || kind === "struct") {
    return `${kind}|children:${childBucket}|vis:${visibility}|size:${sizeBucket}`;
  }

  return `${kind}|params:${paramCount}|async:${isAsync}|ret:${hasReturnType}|vis:${visibility}|size:${sizeBucket}|nested:${hasNested}`;
}

// ─── Collector ────────────────────────────────────────────────────────────────

function collect(
  symbols: SymbolNode[],
  file: string,
  kinds: Set<string>,
  out: SimilarEntry[],
): void {
  for (const sym of symbols) {
    if (kinds.has(sym.kind)) {
      const fp = fingerprint(sym);
      if (fp) {
        out.push({
          file,
          symbol: sym.name,
          kind: sym.kind,
          line: sym.range.startLine,
          signature: sym.signature,
          fingerprint: fp,
        });
      }
    }
    if (sym.children.length > 0) collect(sym.children, file, kinds, out);
  }
}

// ─── Human-readable description ───────────────────────────────────────────────

function describeFingerprint(fp: string): string {
  const parts = Object.fromEntries(fp.split("|").map((p) => p.split(":")));
  const kind = fp.split("|")[0];
  const segments: string[] = [`${kind}s`];

  if (parts.params) segments.push(`${parts.params} param(s)`);
  if (parts.async === "true") segments.push("async");
  if (parts.ret === "true") segments.push("typed return");
  if (parts.children) segments.push(`${parts.children} children`);
  if (parts.size) segments.push(`size:${parts.size}`);
  if (parts.vis) segments.push(parts.vis);

  return segments.join(", ");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Find groups of structurally similar symbols across multiple skeleton files. */
export function findSimilar(skeletons: SkeletonFile[], opts: SimilarOptions = {}): SimilarGroup[] {
  const minGroupSize = opts.minGroupSize ?? 2;
  const kinds = new Set(opts.kinds ?? ["function", "method", "class", "struct"]);

  const entries: SimilarEntry[] = [];
  for (const skel of skeletons) {
    collect(skel.symbols, skel.file, kinds, entries);
  }

  // Group by fingerprint
  const groups = new Map<string, SimilarEntry[]>();
  for (const entry of entries) {
    const g = groups.get(entry.fingerprint) ?? [];
    g.push(entry);
    groups.set(entry.fingerprint, g);
  }

  return [...groups.entries()]
    .filter(([, g]) => g.length >= minGroupSize)
    .map(([fp, g]) => ({
      fingerprint: fp,
      description: describeFingerprint(fp),
      count: g.length,
      entries: g.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => b.count - a.count);
}
