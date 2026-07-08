import fs from "node:fs";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import { findSymbol } from "./analysis.js";
import {
  buildCrossLangIndex,
  resolveCrossLangTarget,
  resolvePythonAbsoluteImport,
  resolveRubyBareRequire,
  type CrossLangIndex,
} from "./crosslang.js";
import type { ImportRef, SkeletonFile } from "./types.js";
import { resolveWorkspaceImportCached } from "./workspace.js";
import { aliasCandidates } from "./tsconfig.js";

export interface ResolvedImport extends ImportRef {
  resolvedPath: string | null;
  resolvedRel: string | null;
  kind?: string;
  signature?: string | null;
  params?: string | null;
  found: boolean;
  importKind: "relative" | "external";
}

const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".vue", ".svelte"];

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

// Non-JS path-based languages need their own extension + index-file
// conventions (Python's `pkg/__init__.py`, Ruby has no index convention).
const LANG_PROBE: Record<string, { exts: string[]; index: string[] }> = {
  python: { exts: [".py"], index: ["__init__.py"] },
  ruby: { exts: [".rb"], index: [] },
};

/**
 * Resolve a relative import path to an absolute file path, using the
 * extension/index conventions of `language` (defaults to TS/JS).
 * Returns null for external packages or when the file cannot be found.
 */
export function resolveImportPath(importFrom: string, fromAbs: string, language?: string): string | null {
  if (!importFrom.startsWith(".")) return null;

  const fromDir = path.dirname(fromAbs);
  const candidate = path.resolve(fromDir, importFrom);

  const langProbe = language ? LANG_PROBE[language] : undefined;
  if (langProbe) return probeCandidateWith(candidate, langProbe.exts, langProbe.index);

  const declaredExt = path.extname(candidate).toLowerCase();

  if (declaredExt && JS_TO_TS[declaredExt]) {
    const base = candidate.slice(0, candidate.length - declaredExt.length);
    for (const ext of JS_TO_TS[declaredExt]) {
      const p = base + ext;
      if (fs.existsSync(p)) return p;
    }
  }

  return probeCandidate(candidate);
}

/** Probe a path base: exact file → +extensions → /index.<ext>. */
function probeCandidate(candidate: string): string | null {
  return probeCandidateWith(candidate, SRC_EXTS, SRC_EXTS.map((ext) => `index${ext}`));
}

function probeCandidateWith(candidate: string, exts: string[], indexNames: string[]): string | null {
  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
  } catch { /* not found */ }

  for (const ext of exts) {
    const p = candidate + ext;
    if (fs.existsSync(p)) return p;
  }
  for (const name of indexNames) {
    const p = path.join(candidate, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Resolve an import in a path-based language (TS/JS/Python/Ruby) to an
 * absolute file path: relative imports resolve directly; bare specifiers try
 * language-specific conventions (Python absolute dotted imports, Ruby
 * lib/app-relative requires) before falling back to TS path-aliases /
 * monorepo workspace packages.
 */
export function resolvePathBasedImport(
  importFrom: string,
  fromAbs: string,
  root: string,
  language: string,
): string | null {
  if (importFrom.startsWith(".")) return resolveImportPath(importFrom, fromAbs, language);
  if (language === "python") {
    const abs = resolvePythonAbsoluteImport(importFrom, root);
    if (abs) return abs;
  }
  if (language === "ruby") {
    const abs = resolveRubyBareRequire(importFrom, root);
    if (abs) return abs;
  }
  return resolveAliasedImport(importFrom, fromAbs) ?? resolveWorkspaceImportCached(importFrom, root);
}

/**
 * Resolve a tsconfig/jsconfig path-aliased bare import (e.g. `@/components/X`
 * with `"@/*": ["./src/*"]`) to an absolute file path, using the nearest
 * config above the importing file. Returns null when not an alias.
 */
export function resolveAliasedImport(importFrom: string, fromAbs: string): string | null {
  for (const base of aliasCandidates(importFrom, fromAbs)) {
    const declaredExt = path.extname(base).toLowerCase();
    if (declaredExt && JS_TO_TS[declaredExt]) {
      const stem = base.slice(0, base.length - declaredExt.length);
      for (const ext of JS_TO_TS[declaredExt]) {
        const p = stem + ext;
        if (fs.existsSync(p)) return p;
      }
    }
    const hit = probeCandidate(base);
    if (hit) return hit;
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
      // Only FQCN/namespace-indexed languages contribute (Rust/Go/C/C++
      // resolve via direct filesystem walks, no index needed).
      if (ext !== ".java" && ext !== ".cs" && ext !== ".kt" && ext !== ".kts" && ext !== ".swift" && ext !== ".php") continue;
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
  language: string,
): Promise<ResolvedImport> {
  const isBare = !imp.from.startsWith(".");
  const resolvedAbs = resolvePathBasedImport(imp.from, fromAbs, root, language);
  const treatedExternal = isBare && !resolvedAbs;
  const resolvedRel = resolvedAbs
    ? path.relative(root, resolvedAbs).split(path.sep).join("/")
    : null;

  let enrichment: PartialEnrichment = { found: false };
  if (resolvedAbs && !imp.isSideEffect && !imp.isNamespaceImport && imp.symbol !== "*") {
    enrichment = await lookupSymbolInTarget(resolvedAbs, resolvedRel!, imp.symbol);
  } else if (resolvedAbs) {
    enrichment = { found: true };
  }

  return assembleResolved(imp, resolvedAbs, resolvedRel, treatedExternal, enrichment);
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

const CROSS_LANG = new Set(["java", "csharp", "rust", "go", "kotlin", "c", "cpp", "swift", "php"]);

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
      results.push(await enrichRelativeImport(imp, absPath, root, skel.language));
    }
  }

  return results;
}
