import fs from "node:fs";
import path from "node:path";

export interface WorkspacePackage {
  /** Package name from its package.json (e.g. "@org/utils"). */
  name: string;
  /** Directory relative to the workspace root (forward-slashed). */
  dir: string;
  /** Workspace-internal package names this package depends on. */
  internalDeps: string[];
  /** All declared dependency names (prod + dev + peer + optional). */
  allDeps: string[];
}

export interface WorkspaceInfo {
  root: string;
  /** Detected workspace tool, or "none" when no config was found. */
  tool: "npm" | "pnpm" | "lerna" | "none";
  packages: WorkspacePackage[];
  /** Internal edges: { from: pkgName, to: pkgName }. */
  edges: Array<{ from: string; to: string }>;
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Minimal `packages:` list reader for pnpm-workspace.yaml (no YAML dep). */
function readPnpmPatterns(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  let inPackages = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const m = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (m) out.push(m[1].trim());
      else if (/^\S/.test(line)) break; // next top-level key
    }
  }
  return out;
}

/** Expand a workspace glob pattern to package directories containing package.json. */
function expandPattern(rootAbs: string, pattern: string): string[] {
  const clean = pattern.replace(/\/+$/, "");
  const dirs: string[] = [];

  const hasPkg = (dir: string) => fs.existsSync(path.join(dir, "package.json"));

  if (!clean.includes("*")) {
    const abs = path.resolve(rootAbs, clean);
    if (hasPkg(abs)) dirs.push(abs);
    return dirs;
  }

  if (clean.endsWith("/**")) {
    const base = path.resolve(rootAbs, clean.slice(0, -3));
    walkForPackages(base, dirs, 6);
    return dirs;
  }

  // `prefix/*` — immediate subdirectories.
  if (clean.endsWith("/*")) {
    const base = path.resolve(rootAbs, clean.slice(0, -2));
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return dirs; }
    for (const e of entries) {
      if (e.isDirectory() && !IGNORE_DIRS.has(e.name) && hasPkg(path.join(base, e.name))) {
        dirs.push(path.join(base, e.name));
      }
    }
    return dirs;
  }

  // Fallback: bounded recursive scan under the non-glob prefix.
  const prefix = clean.split("*")[0];
  walkForPackages(path.resolve(rootAbs, prefix), dirs, 6);
  return dirs;
}

function walkForPackages(base: string, out: string[], depth: number): void {
  if (depth < 0) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
  if (fs.existsSync(path.join(base, "package.json"))) out.push(base);
  for (const e of entries) {
    if (e.isDirectory() && !IGNORE_DIRS.has(e.name)) {
      walkForPackages(path.join(base, e.name), out, depth - 1);
    }
  }
}

function depNames(pkg: any): string[] {
  const out = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const d = pkg?.[key];
    if (d && typeof d === "object") for (const k of Object.keys(d)) out.add(k);
  }
  return [...out];
}

/**
 * Discover the packages in a JS/TS monorepo and the dependency edges between
 * them. Supports npm/yarn `workspaces`, pnpm-workspace.yaml, and lerna.json.
 */
export function discoverWorkspace(rootAbs: string): WorkspaceInfo {
  const rootPkg = readJson(path.join(rootAbs, "package.json"));
  let tool: WorkspaceInfo["tool"] = "none";
  const patterns: string[] = [];

  // npm / yarn workspaces
  const ws = rootPkg?.workspaces;
  if (Array.isArray(ws)) { patterns.push(...ws); tool = "npm"; }
  else if (ws && Array.isArray(ws.packages)) { patterns.push(...ws.packages); tool = "npm"; }

  // pnpm
  const pnpmFile = path.join(rootAbs, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmFile)) {
    patterns.push(...readPnpmPatterns(pnpmFile));
    tool = "pnpm";
  }

  // lerna
  const lerna = readJson(path.join(rootAbs, "lerna.json"));
  if (lerna && Array.isArray(lerna.packages)) {
    patterns.push(...lerna.packages);
    if (tool === "none") tool = "lerna";
  }

  // Dedupe patterns, expand to package dirs.
  const dirSet = new Set<string>();
  for (const p of [...new Set(patterns)]) {
    for (const d of expandPattern(rootAbs, p)) dirSet.add(d);
  }

  const packages: WorkspacePackage[] = [];
  const nameToPkg = new Map<string, WorkspacePackage>();
  const pending: Array<{ pkg: WorkspacePackage; deps: string[] }> = [];

  for (const dirAbs of [...dirSet].sort()) {
    const pj = readJson(path.join(dirAbs, "package.json"));
    if (!pj || !pj.name) continue;
    const rel = path.relative(rootAbs, dirAbs).split(path.sep).join("/");
    const allDeps = depNames(pj);
    const wp: WorkspacePackage = { name: pj.name, dir: rel || ".", internalDeps: [], allDeps };
    packages.push(wp);
    nameToPkg.set(pj.name, wp);
    pending.push({ pkg: wp, deps: allDeps });
  }

  // Resolve internal deps now that all package names are known.
  const edges: Array<{ from: string; to: string }> = [];
  for (const { pkg, deps } of pending) {
    for (const d of deps) {
      if (nameToPkg.has(d) && d !== pkg.name) {
        pkg.internalDeps.push(d);
        edges.push({ from: pkg.name, to: d });
      }
    }
    pkg.internalDeps.sort();
  }

  return { root: rootAbs, tool, packages, edges };
}

/** Detect circular dependencies among workspace packages (package-level). */
export function findPackageCycles(info: WorkspaceInfo): string[][] {
  const adj = new Map<string, string[]>();
  for (const p of info.packages) adj.set(p.name, p.internalDeps.slice());

  const color = new Map<string, "white" | "gray" | "black">();
  for (const k of adj.keys()) color.set(k, "white");
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): void => {
    color.set(node, "gray");
    path.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next);
      if (c === "gray") {
        const start = path.indexOf(next);
        const raw = path.slice(start);
        const min = raw.reduce((b, n, i) => (n < raw[b] ? i : b), 0);
        const canon = [...raw.slice(min), ...raw.slice(0, min)];
        const key = canon.join(">");
        if (!seen.has(key)) { seen.add(key); cycles.push([...canon, canon[0]]); }
      } else if (c === "white") {
        dfs(next);
      }
    }
    path.pop();
    color.set(node, "black");
  };

  for (const k of adj.keys()) if (color.get(k) === "white") dfs(k);
  return cycles;
}
