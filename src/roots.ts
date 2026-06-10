import fs from "node:fs";
import path from "node:path";

// ─── Root resolution (MCP server security boundary) ──────────────────────────
// By default the server only reads files inside AST_MAP_ROOT (or cwd).
// Two opt-in escapes:
//   • Multi-root  — AST_MAP_ROOT can list several roots separated by the
//     platform path delimiter (";" on Windows, ":" on POSIX):
//       AST_MAP_ROOT=C:\proj\app;C:\proj\lib
//   • Unlocked    — AST_MAP_UNLOCKED=1 allows ANY existing absolute path the
//     client asks for. Relative paths still resolve against the primary root.

export interface RootsConfig {
  /** All allowed roots (first one is the primary, used for relative inputs). */
  roots: string[];
  /** When true, absolute paths outside every root are also allowed. */
  unlocked: boolean;
}

export function parseRootsFromEnv(env: NodeJS.ProcessEnv = process.env): RootsConfig {
  const raw = env.AST_MAP_ROOT ?? process.cwd();
  const roots = raw
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => path.resolve(p));
  return {
    roots: roots.length > 0 ? roots : [path.resolve(process.cwd())],
    unlocked: env.AST_MAP_UNLOCKED === "1",
  };
}

export interface ResolvedPath {
  abs: string;
  /** Path relative to the root it landed in (or to its own dirname when unlocked-outside). */
  rel: string;
  /** The root directory this path belongs to (its own dir when unlocked-outside). */
  root: string;
}

function within(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (rel === "") return path.basename(abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * Resolve a client-supplied path against the allowed roots.
 * Throws when the path escapes every root and unlocked mode is off.
 */
export function resolvePathInRoots(input: string, cfg: RootsConfig): ResolvedPath {
  const primary = cfg.roots[0];
  const abs = path.resolve(primary, input);

  for (const root of cfg.roots) {
    const rel = within(root, abs);
    if (rel !== null) return { abs, rel, root };
  }

  if (cfg.unlocked) {
    if (!fs.existsSync(abs)) {
      throw new Error(`Path "${input}" does not exist (resolved to ${abs}).`);
    }
    const stat = fs.statSync(abs);
    const root = stat.isDirectory() ? abs : path.dirname(abs);
    return { abs, rel: path.basename(abs), root };
  }

  throw new Error(
    `Path "${input}" is outside the allowed root${cfg.roots.length > 1 ? "s" : ""} ` +
      `(${cfg.roots.join(", ")}). Either set AST_MAP_ROOT to that project ` +
      `(multiple roots allowed, separated by "${path.delimiter}"), or set ` +
      `AST_MAP_UNLOCKED=1 to allow any absolute path.`,
  );
}
