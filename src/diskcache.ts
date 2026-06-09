import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SkeletonFile } from "./types.js";

// ─── Persistent (on-disk) parse cache ─────────────────────────────────────────
// Content-hash keyed: the key embeds schemaVersion + grammar source + detail +
// the file's raw bytes, so entries never go stale — a changed file simply maps
// to a new key. Stored as sharded JSON files under <root>/.ast-map/cache.
// Enabled by calling initDiskCache() once at startup (CLI / MCP server / worker).

let cacheDir: string | null = null;

/** Enable (or disable with null) the disk cache for this process. */
export function initDiskCache(dir: string | null): void {
  cacheDir = dir;
}

/** The currently active cache directory, or null when disabled. */
export function diskCacheDir(): string | null {
  return cacheDir;
}

/** Conventional cache location for a project root. */
export function defaultCacheDir(root: string): string {
  return path.join(root, ".ast-map", "cache");
}

/** Stable cache key for a (source, detail, schema, grammar) tuple. */
export function diskCacheKey(
  source: string,
  detail: string,
  schemaVersion: string,
  grammarSource: string,
): string {
  return crypto
    .createHash("sha1")
    .update(`${schemaVersion}\0${grammarSource}\0${detail}\0`)
    .update(source)
    .digest("hex");
}

function shardPath(dir: string, key: string): string {
  return path.join(dir, key.slice(0, 2), key.slice(2) + ".json");
}

/** Read a cached skeleton, or null on miss / disabled / corrupt entry. */
export function diskCacheGet(key: string): SkeletonFile | null {
  if (!cacheDir) return null;
  try {
    const raw = fs.readFileSync(shardPath(cacheDir, key), "utf8");
    const parsed = JSON.parse(raw) as { skel?: SkeletonFile };
    return parsed.skel ?? null;
  } catch {
    return null;
  }
}

/** Persist a skeleton under the given key (best-effort, never throws). */
export function diskCachePut(key: string, skel: SkeletonFile): void {
  if (!cacheDir) return;
  try {
    const file = shardPath(cacheDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ skel }));
    fs.renameSync(tmp, file);
  } catch {
    /* cache write failures are non-fatal */
  }
}

export interface DiskCacheStats {
  dir: string;
  entries: number;
  bytes: number;
}

/** Count entries + total size of a cache directory. */
export function diskCacheStats(dir: string): DiskCacheStats {
  let entries = 0;
  let bytes = 0;
  const walk = (d: string) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        entries++;
        try { bytes += fs.statSync(p).size; } catch { /* skip */ }
      }
    }
  };
  walk(dir);
  return { dir, entries, bytes };
}

/** Remove every entry in a cache directory. Returns how many were removed. */
export function clearDiskCache(dir: string): number {
  const { entries } = diskCacheStats(dir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return entries;
}
