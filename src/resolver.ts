import fs from "node:fs";
import path from "node:path";
import { buildSkeleton } from "./skeleton.js";
import { resolveOptions } from "./config.js";
import { findSymbol } from "./analysis.js";
import type { ImportRef, SkeletonFile } from "./types.js";

export interface ResolvedImport extends ImportRef {
  /** Absolute path to the resolved module file. null for external packages or unresolvable paths. */
  resolvedPath: string | null;
  /** Path relative to project root. null when unresolvable. */
  resolvedRel: string | null;
  /** Symbol kind from the target file (function, class, etc.). */
  kind?: string;
  /** One-line signature of the resolved symbol. */
  signature?: string | null;
  /** Parameter list extracted from the signature, e.g. "(id: string, opts?: Options)". */
  params?: string | null;
  /** True if the symbol was found and verified in the target file. */
  found: boolean;
  /** "relative" = local file import; "external" = npm package. */
  importKind: "relative" | "external";
}

const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

// TypeScript ESM: `import from "./foo.js"` actually means `./foo.ts` on disk.
// Map each JS-family extension to the TS-family equivalents we should try first.
const JS_TO_TS: Record<string, string[]> = {
  ".js":  [".ts",  ".tsx", ".js"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

/**
 * Resolve a relative import path from a source file to an absolute path on disk.
 * Handles TypeScript ESM convention (`.js` in source → `.ts` on disk).
 * Returns null for external packages or when the file cannot be found.
 */
export function resolveImportPath(importFrom: string, fromAbs: string): string | null {
  if (!importFrom.startsWith(".")) return null;

  const fromDir = path.dirname(fromAbs);
  const candidate = path.resolve(fromDir, importFrom);
  const declaredExt = path.extname(candidate).toLowerCase();

  // If the import has a JS-family extension, try the TS equivalents first
  if (declaredExt && JS_TO_TS[declaredExt]) {
    const base = candidate.slice(0, candidate.length - declaredExt.length);
    for (const ext of JS_TO_TS[declaredExt]) {
      const p = base + ext;
      if (fs.existsSync(p)) return p;
    }
  }

  // Exact match (already has extension or points to a file)
  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
  } catch {
    // not found — try with extensions
  }

  // Try appending source extensions
  for (const ext of SRC_EXTS) {
    const p = candidate + ext;
    if (fs.existsSync(p)) return p;
  }

  // Try index file inside the directory
  for (const ext of SRC_EXTS) {
    const p = path.join(candidate, `index${ext}`);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * For each import in `skel`, resolve the target file and look up the symbol.
 * Returns enriched Reference Objects with resolved path, signature, and params.
 */
export async function resolveFileImports(
  skel: SkeletonFile,
  absPath: string,
  root: string,
): Promise<ResolvedImport[]> {
  if (!skel.imports || skel.imports.length === 0) return [];

  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const results: ResolvedImport[] = [];

  for (const imp of skel.imports) {
    const isExternal = !imp.from.startsWith(".");
    const resolvedAbs = isExternal ? null : resolveImportPath(imp.from, absPath);
    const resolvedRel = resolvedAbs
      ? path.relative(root, resolvedAbs).split(path.sep).join("/")
      : null;

    let found = false;
    let kind: string | undefined;
    let signature: string | null | undefined;
    let params: string | null | undefined;

    if (resolvedAbs && !imp.isSideEffect && !imp.isNamespaceImport && imp.symbol !== "*") {
      try {
        const targetSkel = await buildSkeleton(resolvedAbs, resolvedRel!, opts);
        const targetSym = findSymbol(targetSkel.symbols, imp.symbol);
        if (targetSym) {
          found = true;
          kind = targetSym.kind;
          signature = targetSym.signature ?? null;
          if (signature) {
            const m = signature.match(/\([^)]*\)/);
            params = m ? m[0] : null;
          }
        }
      } catch {
        // target file unresolvable or parse error — leave found=false
      }
    } else if (resolvedAbs) {
      // Namespace import or side-effect: file exists = success
      found = true;
    }

    const resolved: ResolvedImport = {
      ...imp,
      resolvedPath: resolvedAbs,
      resolvedRel,
      found,
      importKind: isExternal ? "external" : "relative",
    };
    if (kind !== undefined) resolved.kind = kind;
    if (signature !== undefined) resolved.signature = signature;
    if (params !== undefined) resolved.params = params;

    results.push(resolved);
  }

  return results;
}
