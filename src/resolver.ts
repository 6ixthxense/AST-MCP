import fs from "node:fs";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import { findSymbol } from "./analysis.js";
import {
  buildCrossLangIndex,
  resolveCrossLangTarget,
  type CrossLangIndex,
} from "./crosslang.js";
import type { ImportRef, SkeletonFile } from "./types.js";

export interface ResolvedImport extends ImportRef {
  resolvedPath: string | null;
  resolvedRel: string | null;
  kind?: string;
  signature?: string | null;
  params?: string | null;
  found: boolean;
  importKind: "relative" | "external";
}

const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

function extractParams(sig: string): string | null {
  const start = sig.indexOf("(");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < sig.length; i++) {
    if (sig[i] === "(") depth++;
    else if (sig[i] === ")") {
      depth--;
      if (depth === 0) return sig.slice(start, i + 1);
    }
  }
  return null;
}

const JS_TO_TS: Record<string, string[]> = {
  ".js":  [".ts",  ".tsx", ".js"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

/**
 * Resolve a TS/JS-style relative import path to an absolute file path.
 * Returns null for external packages or when the file cannot be found.
 */
export function resolveImportPath(importFrom: string, fromAbs: string): string | null {
  if (!importFrom.startsWith(".")) return null;

  const fromDir = path.dirname(fromAbs);
  const candidate = path.resolve(fromDir, importFrom);
  const declaredExt = path.extname(candidate).toLowerCase();

  if (declaredExt && JS_TO_TS[declaredExt]) {
    const base = candidate.slice(0, candidate.length - declaredExt.length);
    for (const ext of JS_TO_TS[declaredExt]) {
      const p = base + ext;
      if (fs.existsSync(p)) return p;
    }
  }

  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
  } catch { /* not found */ }

  for (const ext of SRC_EXTS) {
    const p = candidate + ext;
    if (fs.existsSync(p)) return p;
  }
  for (const ext of SRC_EXTS) {
    const p = path.join(candidate, `index${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ─── Cross-language index cache ──────────────────────────────────────────── */
// Java/C# need a project-wide index to resolve fully-qualified imports.
// Built lazily on first cross-language resolve, then reused for the process
// lifetime (the MCP server is per-root, so this is safe).

const indexCache = new Map<string, Promise<CrossLangIndex>>();

export async function getOrBuildCrossLangIndex(root: string): Promise<CrossLangIndex> {
  const key = path.resolve(root);
  let p = indexCache.get(key);
  if (p) return p;

  p = (async () => {
    const opts = resolveOptions({ detail: "outline", emitHtml: false });
    const files = collectSourceFiles(key, opts);
    const skels: SkeletonFile[] = [];
    for (const abs of files) {
      const ext = path.extname(abs).toLowerCase();
      // Only Java/C# contribute to the index (Rust resolves via direct
      // module-path walk against the filesystem, no index needed).
      if (ext !== ".java" && ext !== ".cs") continue;
      const rel = path.relative(key, abs).split(path.sep).join("/");
      try {
        skels.push(await buildSkeleton(abs, rel, opts));
      } catch { /* skip unparsable files */ }
    }
    return buildCrossLangIndex(skels);
  })();

  indexCache.set(key, p);
  return p;
}

/** Test/debug hook: drop the cached index (rebuilds on next call). */
export function clearCrossLangIndexCache(): void {
  indexCache.clear();
}

/* ─── Per-language enrichment ─────────────────────────────────────────────── */

interface PartialEnrichment {
  kind?: string;
  signature?: string | null;
  params?: string | null;
  found: boolean;
}

async function lookupSymbolInTarget(
  targetAbs: string,
  targetRel: string,
  symbol: string,
): Promise<PartialEnrichment> {
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  try {
    const targetSkel = await buildSkeleton(targetAbs, targetRel, opts);
    const sym = findSymbol(targetSkel.symbols, symbol);
    if (sym) {
      const signature = sym.signature ?? null;
      const out: PartialEnrichment = { found: true, kind: sym.kind };
      if (signature !== undefined) out.signature = signature;
      if (signature) {
        const params = extractParams(signature);
        if (params) out.params = params;
      }
      return out;
    }
  } catch { /* unresolvable / parse error */ }
  return { found: false };
}

async function enrichRelativeImport(
  imp: ImportRef,
  fromAbs: string,
  root: string,
): Promise<ResolvedImport> {
  const isExternal = !imp.from.startsWith(".");
  const resolvedAbs = isExternal ? null : resolveImportPath(imp.from, fromAbs);
  const resolvedRel = resolvedAbs
    ? path.relative(root, resolvedAbs).split(path.sep).join("/")
    : null;

  let enrichment: PartialEnrichment = { found: false };
  if (resolvedAbs && !imp.isSideEffect && !imp.isNamespaceImport && imp.symbol !== "*") {
    enrichment = await lookupSymbolInTarget(resolvedAbs, resolvedRel!, imp.symbol);
  } else if (resolvedAbs) {
    enrichment = { found: true };
  }

  return assembleResolved(imp, resolvedAbs, resolvedRel, isExternal, enrichment);
}

async function enrichCrossLangImport(
  imp: ImportRef,
  skel: SkeletonFile,
  fromAbs: string,
  root: string,
  index: CrossLangIndex,
): Promise<ResolvedImport> {
  const target = resolveCrossLangTarget(imp, skel, fromAbs, root, index);
  if (!target) {
    return assembleResolved(imp, null, null, true, { found: false });
  }

  if (target.kind === "file") {
    // Namespace-style (Java wildcard / C# using). Point to the first file —
    // useful for navigation; the symbol itself isn't a specific declaration.
    const firstRel = target.files[0];
    const firstAbs = path.resolve(root, firstRel);
    return assembleResolved(imp, firstAbs, firstRel, false, { found: true });
  }

  // Symbol-level (Java FQCN, Rust crate::path::Item)
  const targetAbs = path.resolve(root, target.file);
  const enrichment = await lookupSymbolInTarget(targetAbs, target.file, target.symbol);
  return assembleResolved(imp, targetAbs, target.file, false, enrichment);
}

function assembleResolved(
  imp: ImportRef,
  resolvedAbs: string | null,
  resolvedRel: string | null,
  isExternal: boolean,
  enrichment: PartialEnrichment,
): ResolvedImport {
  const out: ResolvedImport = {
    ...imp,
    resolvedPath: resolvedAbs,
    resolvedRel,
    found: enrichment.found,
    importKind: isExternal ? "external" : "relative",
  };
  if (enrichment.kind !== undefined) out.kind = enrichment.kind;
  if (enrichment.signature !== undefined) out.signature = enrichment.signature;
  if (enrichment.params !== undefined) out.params = enrichment.params;
  return out;
}

/* ─── Public entry point ──────────────────────────────────────────────────── */

const CROSS_LANG = new Set(["java", "csharp", "rust", "go"]);

export async function resolveFileImports(
  skel: SkeletonFile,
  absPath: string,
  root: string,
): Promise<ResolvedImport[]> {
  if (!skel.imports || skel.imports.length === 0) return [];

  const results: ResolvedImport[] = [];

  // Lazy-build the cross-lang index only when actually needed.
  let indexPromise: Promise<CrossLangIndex> | null = null;
  const getIndex = () =>
    (indexPromise ??= getOrBuildCrossLangIndex(root));

  for (const imp of skel.imports) {
    if (CROSS_LANG.has(skel.language)) {
      results.push(await enrichCrossLangImport(imp, skel, absPath, root, await getIndex()));
    } else {
      results.push(await enrichRelativeImport(imp, absPath, root));
    }
  }

  return results;
}
