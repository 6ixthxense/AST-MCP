import fs from "node:fs";
import path from "node:path";

// ─── TS/JS path-alias resolution (tsconfig.json → compilerOptions.paths) ─────
// Resolves aliased bare imports like `@/components/Button` using the NEAREST
// tsconfig.json / jsconfig.json above the importing file (monorepo-safe),
// following relative `extends` chains. Returns absolute candidate *bases*
// (no extension probing here — the resolver owns file-existence logic).

interface AliasPattern {
  /** Text before the single `*` (or the whole key for exact patterns). */
  prefix: string;
  /** Text after the `*` ("" when the key ends with `*`). */
  suffix: string;
  /** True when the key contains no `*` (must match exactly). */
  exact: boolean;
  /** Substitution targets, absolute-resolved against configDir + baseUrl. */
  targets: string[];
}

interface AliasConfig {
  patterns: AliasPattern[];
}

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

/**
 * Tolerant JSONC parse. String-aware: comments and trailing commas are removed
 * with a character walk, never with regex — naive stripping corrupts configs
 * whose strings contain comment-like text (e.g. Next.js `"include": ["**\/*.ts"]`
 * pairs the `/*` inside `"@/*"` with the `*\/` inside the glob).
 */
function parseJsonc(raw: string): any | null {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < raw.length) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (c === "\\") { out += raw[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
    } else if (c === "/" && raw[i + 1] === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i += 2;
    } else if (c === ",") {
      // trailing comma: skip when the next non-whitespace char closes a scope
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === "}" || raw[j] === "]") i++; // drop the comma
      else { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Read a config file, following relative `extends` (child overrides parent). */
function readConfigChain(configPath: string, depth = 0): { baseUrl?: string; paths?: Record<string, string[]>; dir: string } | null {
  if (depth > 5) return null;
  let raw: string;
  try { raw = fs.readFileSync(configPath, "utf8"); } catch { return null; }
  const json = parseJsonc(raw);
  if (!json || typeof json !== "object") return null;

  const dir = path.dirname(configPath);
  let baseUrl: string | undefined;
  let paths: Record<string, string[]> | undefined;
  let baseDir = dir;

  const ext = json.extends;
  if (typeof ext === "string" && ext.startsWith(".")) {
    let parentPath = path.resolve(dir, ext);
    if (!parentPath.endsWith(".json")) parentPath += ".json";
    const parent = readConfigChain(parentPath, depth + 1);
    if (parent) {
      baseUrl = parent.baseUrl;
      paths = parent.paths;
      baseDir = parent.dir; // paths in a parent resolve against the parent's dir
    }
  }

  const co = json.compilerOptions;
  if (co && typeof co === "object") {
    if (typeof co.baseUrl === "string") { baseUrl = co.baseUrl; baseDir = dir; }
    if (co.paths && typeof co.paths === "object") { paths = co.paths as Record<string, string[]>; baseDir = dir; }
  }
  return { baseUrl, paths, dir: baseDir };
}

function buildAliasConfig(configPath: string): AliasConfig | null {
  const merged = readConfigChain(configPath);
  if (!merged || !merged.paths) return null;

  const base = path.resolve(merged.dir, merged.baseUrl ?? ".");
  const patterns: AliasPattern[] = [];
  for (const [key, targets] of Object.entries(merged.paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const star = key.indexOf("*");
    const abs = targets
      .filter((t): t is string => typeof t === "string")
      .map((t) => path.resolve(base, t));
    if (abs.length === 0) continue;
    if (star === -1) {
      patterns.push({ prefix: key, suffix: "", exact: true, targets: abs });
    } else {
      patterns.push({ prefix: key.slice(0, star), suffix: key.slice(star + 1), exact: false, targets: abs });
    }
  }
  // Longest prefix wins (TypeScript's matching rule).
  patterns.sort((a, b) => b.prefix.length - a.prefix.length);
  return patterns.length > 0 ? { patterns } : null;
}

// dir → config path (or null when none found up the tree)
const configPathCache = new Map<string, string | null>();
// config path → parsed alias config (or null when it has no paths)
const aliasCache = new Map<string, AliasConfig | null>();

function findNearestConfig(fromDir: string): string | null {
  const cached = configPathCache.get(fromDir);
  if (cached !== undefined) return cached;

  let dir = fromDir;
  let result: string | null = null;
  const visited: string[] = [];
  for (;;) {
    const hit = configPathCache.get(dir);
    if (hit !== undefined) { result = hit; break; }
    visited.push(dir);
    let found: string | null = null;
    for (const name of CONFIG_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) { found = p; break; }
    }
    if (found) { result = found; break; }
    const parent = path.dirname(dir);
    if (parent === dir || dir.includes("node_modules")) { result = null; break; }
    dir = parent;
  }
  for (const d of visited) configPathCache.set(d, result);
  return result;
}

/** Test-only: clear the per-process caches. */
export function clearAliasCaches(): void {
  configPathCache.clear();
  aliasCache.clear();
}

/**
 * Map an aliased bare import to absolute candidate base paths (no extension
 * probing). Empty array = not an alias / no config / no pattern match.
 */
export function aliasCandidates(importFrom: string, fromAbs: string): string[] {
  if (importFrom.startsWith(".") || path.isAbsolute(importFrom)) return [];

  const configPath = findNearestConfig(path.dirname(fromAbs));
  if (!configPath) return [];

  let cfg = aliasCache.get(configPath);
  if (cfg === undefined) {
    cfg = buildAliasConfig(configPath);
    aliasCache.set(configPath, cfg);
  }
  if (!cfg) return [];

  for (const p of cfg.patterns) {
    if (p.exact) {
      if (importFrom === p.prefix) return p.targets;
      continue;
    }
    if (
      importFrom.length >= p.prefix.length + p.suffix.length &&
      importFrom.startsWith(p.prefix) &&
      importFrom.endsWith(p.suffix)
    ) {
      const star = importFrom.slice(p.prefix.length, importFrom.length - p.suffix.length);
      return p.targets.map((t) => t.replace("*", star));
    }
  }
  return [];
}
