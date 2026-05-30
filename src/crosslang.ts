import fs from "node:fs";
import path from "node:path";
import type { ImportRef, SkeletonFile, SymbolNode } from "./types.js";

/**
 * Project-wide indexes used to resolve cross-file imports for languages that
 * don't use relative paths (Java/C#).
 */
export interface CrossLangIndex {
  /** Java: "com.example.Foo" -> relFile that declares it. */
  javaFqcn: Map<string, string>;
  /** Java: package -> list of relFiles in that package (for wildcard imports). */
  javaPackages: Map<string, string[]>;
  /** C#: "App.Services" -> relFiles that declare any type in that namespace. */
  csharpNamespaces: Map<string, string[]>;
  /** C#: "App.Models.Inventory" -> relFile that declares it (for `using <ns>` + bare type lookup). */
  csharpTypes: Map<string, string>;
  /** Kotlin: "com.example.Foo" -> relFile (FQCN-style, mirrors Java). */
  kotlinFqcn: Map<string, string>;
  /** Kotlin: package -> list of relFiles (for wildcard imports). */
  kotlinPackages: Map<string, string[]>;
}

const TYPE_KINDS = new Set(["class", "interface", "enum", "struct"]);

/** Walk a symbol tree and yield each top-level type-like symbol. */
function topTypeSymbols(symbols: SymbolNode[]): SymbolNode[] {
  return symbols.filter((s) => TYPE_KINDS.has(s.kind));
}

function getDirectiveValue(skel: SkeletonFile, prefix: string): string | null {
  const hit = (skel.directives ?? []).find((d) => d.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function getAllDirectiveValues(skel: SkeletonFile, prefix: string): string[] {
  return (skel.directives ?? [])
    .filter((d) => d.startsWith(prefix))
    .map((d) => d.slice(prefix.length));
}

/**
 * Build Java + C# indexes from already-parsed skeletons.
 * Cheap: O(symbols), no extra file reads.
 */
export function buildCrossLangIndex(skeletons: SkeletonFile[]): CrossLangIndex {
  const index: CrossLangIndex = {
    javaFqcn: new Map(),
    javaPackages: new Map(),
    csharpNamespaces: new Map(),
    csharpTypes: new Map(),
    kotlinFqcn: new Map(),
    kotlinPackages: new Map(),
  };

  for (const skel of skeletons) {
    if (skel.language === "java") {
      const pkg = getDirectiveValue(skel, "package:");
      if (!pkg) continue;
      const pkgFiles = index.javaPackages.get(pkg) ?? [];
      pkgFiles.push(skel.file);
      index.javaPackages.set(pkg, pkgFiles);
      for (const sym of topTypeSymbols(skel.symbols)) {
        index.javaFqcn.set(`${pkg}.${sym.name}`, skel.file);
      }
    } else if (skel.language === "csharp") {
      const namespaces = getAllDirectiveValues(skel, "namespace:");
      for (const ns of namespaces) {
        const arr = index.csharpNamespaces.get(ns) ?? [];
        if (!arr.includes(skel.file)) arr.push(skel.file);
        index.csharpNamespaces.set(ns, arr);
      }
      // Map every top-level type to <ns>.<TypeName>. For files with multiple
      // namespaces this is approximate (we don't know per-symbol scoping
      // without per-symbol namespace tracking) but accurate for the common case
      // of one namespace per file.
      for (const sym of topTypeSymbols(skel.symbols)) {
        for (const ns of namespaces) {
          index.csharpTypes.set(`${ns}.${sym.name}`, skel.file);
        }
      }
    } else if (skel.language === "kotlin") {
      const pkg = getDirectiveValue(skel, "package:");
      if (!pkg) continue;
      const pkgFiles = index.kotlinPackages.get(pkg) ?? [];
      pkgFiles.push(skel.file);
      index.kotlinPackages.set(pkg, pkgFiles);
      for (const sym of topTypeSymbols(skel.symbols)) {
        index.kotlinFqcn.set(`${pkg}.${sym.name}`, skel.file);
      }
    }
  }

  return index;
}

/* ─── Rust module resolution ──────────────────────────────────────────────── */

function findCargoRoot(fromAbs: string, projectRoot: string): string | null {
  let dir = path.dirname(fromAbs);
  const stop = path.resolve(projectRoot);
  while (true) {
    if (fs.existsSync(path.join(dir, "Cargo.toml"))) return dir;
    if (dir === stop || dir === path.dirname(dir)) return null;
    dir = path.dirname(dir);
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Walk module path segments down from a base dir, returning the resolved .rs file. */
function walkRustModule(base: string, segs: string[]): string | null {
  if (segs.length === 0) {
    // base IS the target module dir/file. Try canonical roots.
    for (const candidate of ["mod.rs", "lib.rs", "main.rs"]) {
      const p = path.join(base, candidate);
      if (existsFile(p)) return p;
    }
    if (existsFile(base + ".rs")) return base + ".rs";
    return null;
  }
  const [head, ...rest] = segs;
  if (rest.length === 0) {
    // Terminal segment: `head.rs` or `head/mod.rs`.
    const p1 = path.join(base, `${head}.rs`);
    if (existsFile(p1)) return p1;
    const p2 = path.join(base, head, "mod.rs");
    if (existsFile(p2)) return p2;
    return null;
  }
  // Non-terminal: descend into a directory module.
  const subDir = path.join(base, head);
  if (existsDir(subDir)) return walkRustModule(subDir, rest);
  // Rust-2018 style: `head.rs` next to a sibling `head/` directory.
  if (existsFile(path.join(base, `${head}.rs`)) && existsDir(path.join(base, head))) {
    return walkRustModule(path.join(base, head), rest);
  }
  return null;
}

/**
 * Resolve a Rust `use` path to an absolute .rs file.
 * Handles `crate::`, `self::`, `super::` prefixes; anything else is treated
 * as an external crate (e.g. `std::`, `tokio::`) and returns null.
 *
 * @param importFrom Full use path, e.g. "crate::foo::Bar"
 * @param fromAbs   Absolute path of the importing file
 * @param projectRoot Absolute project root (security boundary)
 */
export function resolveRustModule(
  importFrom: string,
  fromAbs: string,
  projectRoot: string,
): string | null {
  const segs = importFrom.split("::");
  if (segs.length === 0) return null;

  // Strip the imported item name (last segment) — leaves the module path.
  const moduleSegs = segs.slice(0, -1);
  if (moduleSegs.length === 0) return null;

  const head = moduleSegs[0];
  let base: string;
  let remaining: string[];

  if (head === "crate") {
    const cargoRoot = findCargoRoot(fromAbs, projectRoot);
    if (!cargoRoot) return null;
    base = path.join(cargoRoot, "src");
    if (!existsDir(base)) base = cargoRoot;
    remaining = moduleSegs.slice(1);
  } else if (head === "self") {
    base = path.dirname(fromAbs);
    remaining = moduleSegs.slice(1);
  } else if (head === "super") {
    let dir = path.dirname(fromAbs);
    let i = 0;
    while (moduleSegs[i] === "super") {
      dir = path.dirname(dir);
      i++;
    }
    base = dir;
    remaining = moduleSegs.slice(i);
  } else {
    return null; // external crate
  }

  return walkRustModule(base, remaining);
}


/* ─── Go module resolution ────────────────────────────────────────────────── */

interface GoModule {
  modulePath: string;
  moduleDir: string;
}

// Cache per project root.
const goModuleCache = new Map<string, GoModule | null>();

function readGoModulePath(modFile: string): string | null {
  try {
    const txt = fs.readFileSync(modFile, "utf8");
    const m = /^\s*module\s+(\S+)/m.exec(txt);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Locate the go.mod ancestor (within projectRoot) of `fromAbs`. */
function findGoModule(fromAbs: string, projectRoot: string): GoModule | null {
  const key = path.resolve(projectRoot);
  if (goModuleCache.has(key)) {
    // Cached at the project root level — assumes one go.mod per project root.
    // For monorepos with multiple modules, ResolveGoImport falls back to a
    // walk-up search below.
    const cached = goModuleCache.get(key);
    if (cached) return cached;
  }

  let dir = path.dirname(fromAbs);
  const stop = key;
  while (true) {
    const modFile = path.join(dir, "go.mod");
    if (existsFile(modFile)) {
      const modPath = readGoModulePath(modFile);
      if (modPath) {
        const result: GoModule = { modulePath: modPath, moduleDir: dir };
        if (dir === stop) goModuleCache.set(key, result);
        return result;
      }
    }
    if (dir === stop || dir === path.dirname(dir)) return null;
    dir = path.dirname(dir);
  }
}

/**
 * Resolve a Go import path to a list of .go files in the resolved package
 * directory. Returns null for stdlib / third-party / unresolvable paths.
 *
 * Go semantics:
 *   - A package is a directory containing one or more .go files.
 *   - `import "github.com/x/y/z"` maps to <moduleDir>/<subpath> when the prefix
 *     matches the current module's path.
 */
export function resolveGoImport(
  importFrom: string,
  fromAbs: string,
  projectRoot: string,
): string[] | null {
  const mod = findGoModule(fromAbs, projectRoot);
  if (!mod) return null;

  let subPath: string;
  if (importFrom === mod.modulePath) {
    subPath = "";
  } else if (importFrom.startsWith(mod.modulePath + "/")) {
    subPath = importFrom.slice(mod.modulePath.length + 1);
  } else {
    return null; // external / stdlib
  }

  const pkgDir = subPath ? path.join(mod.moduleDir, subPath) : mod.moduleDir;
  if (!existsDir(pkgDir)) return null;

  // Collect every .go file in the directory (Go packages span all files in dir).
  // Skip _test.go files — call graph cares about production code.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pkgDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".go")) continue;
    if (e.name.endsWith("_test.go")) continue;
    const abs = path.join(pkgDir, e.name);
    const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
    files.push(rel);
  }
  return files.length > 0 ? files : null;
}

/** Test/debug hook: drop the cached Go module info. */
export function clearGoModuleCache(): void {
  goModuleCache.clear();
}


/* ─── C / C++ #include resolution ─────────────────────────────────────────── */

const HEADER_EXTS = [".h", ".hpp", ".hxx", ".hh"];
const IMPL_EXTS = [".c", ".cpp", ".cc", ".cxx"];

/**
 * Resolve a C/C++ `#include "foo.h"` to in-project files.
 * Convention: also pair foo.h with foo.c/.cpp in the same directory so the
 * graph captures the header → impl relationship.
 * `#include <foo.h>` (system headers) returns null (external).
 */
export function resolveCInclude(
  importFrom: string,
  fromAbs: string,
  projectRoot: string,
): string[] | null {
  // System headers like stdio.h, vector, etc. — leave to external.
  const isSystemHeader =
    !importFrom.includes("/") && !importFrom.includes(".") ||
    /^(stdio|stdlib|string|vector|memory|cstdint|cstdlib|cstring|iostream)/.test(importFrom);
  // We only check the actual filesystem; if a system header happens to exist
  // locally we still link it, otherwise it falls through to null.

  const fromDir = path.dirname(fromAbs);
  const headerAbs = path.resolve(fromDir, importFrom);
  const out: string[] = [];

  if (existsFile(headerAbs)) {
    const rel = path.relative(projectRoot, headerAbs).split(path.sep).join("/");
    // Reject paths that escape the project root.
    if (!rel.startsWith("..")) out.push(rel);

    // Pair foo.h with foo.{c,cpp,cc,cxx} in the same directory.
    const ext = path.extname(headerAbs).toLowerCase();
    if (HEADER_EXTS.includes(ext)) {
      const base = headerAbs.slice(0, -ext.length);
      for (const implExt of IMPL_EXTS) {
        const implAbs = base + implExt;
        if (existsFile(implAbs)) {
          const implRel = path.relative(projectRoot, implAbs).split(path.sep).join("/");
          if (!implRel.startsWith("..")) out.push(implRel);
        }
      }
    }
  }

  if (isSystemHeader && out.length === 0) return null;
  return out.length > 0 ? out : null;
}

/* ─── Generic cross-language target resolver ──────────────────────────────── */

export type CrossLangTarget =
  | { kind: "symbol"; file: string; symbol: string }
  | { kind: "file"; files: string[] };

/**
 * Resolve an ImportRef in a non-relative-path language to a graph target.
 * Returns null for unresolvable / external imports.
 */
export function resolveCrossLangTarget(
  imp: ImportRef,
  skel: SkeletonFile,
  fromAbs: string,
  projectRoot: string,
  index: CrossLangIndex,
): CrossLangTarget | null {
  if (skel.language === "java") {
    if (imp.symbol === "*") {
      // wildcard: pull all files in the package
      const files = index.javaPackages.get(imp.from);
      if (files && files.length > 0) return { kind: "file", files: files.slice() };
      return null;
    }
    const targetFile = index.javaFqcn.get(imp.from);
    if (targetFile) return { kind: "symbol", file: targetFile, symbol: imp.symbol };
    return null;
  }

  if (skel.language === "csharp") {
    const files = index.csharpNamespaces.get(imp.from);
    if (files && files.length > 0) {
      // Exclude self — a file `using App;` while declaring in App shouldn't self-edge.
      const filtered = files.filter((f) => f !== skel.file);
      if (filtered.length > 0) return { kind: "file", files: filtered };
    }
    return null;
  }

  if (skel.language === "rust") {
    const abs = resolveRustModule(imp.from, fromAbs, projectRoot);
    if (!abs) return null;
    const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
    return { kind: "symbol", file: rel, symbol: imp.symbol };
  }

  if (skel.language === "go") {
    const files = resolveGoImport(imp.from, fromAbs, projectRoot);
    if (!files || files.length === 0) return null;
    const filtered = files.filter((f) => f !== skel.file);
    if (filtered.length === 0) return null;
    return { kind: "file", files: filtered };
  }

  if (skel.language === "kotlin") {
    if (imp.symbol === "*") {
      const files = index.kotlinPackages.get(imp.from);
      if (files && files.length > 0) {
        const filtered = files.filter((f) => f !== skel.file);
        if (filtered.length > 0) return { kind: "file", files: filtered };
      }
      return null;
    }
    const targetFile = index.kotlinFqcn.get(imp.from);
    if (targetFile && targetFile !== skel.file) {
      return { kind: "symbol", file: targetFile, symbol: imp.symbol };
    }
    return null;
  }

  if (skel.language === "c" || skel.language === "cpp") {
    const files = resolveCInclude(imp.from, fromAbs, projectRoot);
    if (!files || files.length === 0) return null;
    const filtered = files.filter((f) => f !== skel.file);
    if (filtered.length === 0) return null;
    return { kind: "file", files: filtered };
  }

  return null;
}
