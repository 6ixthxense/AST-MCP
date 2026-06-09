// Smoke test for the persistent parse cache (diskcache.ts) and the
// worker-pool bulk builder (pool.ts). Run after `npm run build`:
//   node test/cache-smoke.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  initDiskCache, diskCacheDir, defaultCacheDir,
  diskCacheKey, diskCacheGet, diskCachePut,
  diskCacheStats, clearDiskCache,
} from "../dist/diskcache.js";
import { buildSkeleton, SCHEMA_VERSION, GRAMMAR_SOURCE } from "../dist/skeleton.js";
import { buildSkeletonsBulk } from "../dist/pool.js";
import { resolveOptions } from "../dist/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..", "src");

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ast-map-cache-"));
const opts = resolveOptions({ detail: "full", emitHtml: false });

console.log("disk cache:");
check("defaultCacheDir ends with .ast-map/cache",
  defaultCacheDir("/x").split(path.sep).join("/").endsWith(".ast-map/cache"));

// key stability + sensitivity
const k1 = diskCacheKey("abc", "full", SCHEMA_VERSION, GRAMMAR_SOURCE);
const k2 = diskCacheKey("abc", "full", SCHEMA_VERSION, GRAMMAR_SOURCE);
const k3 = diskCacheKey("abd", "full", SCHEMA_VERSION, GRAMMAR_SOURCE);
const k4 = diskCacheKey("abc", "outline", SCHEMA_VERSION, GRAMMAR_SOURCE);
check("key is deterministic", k1 === k2);
check("key changes with content", k1 !== k3);
check("key changes with detail", k1 !== k4);

// disabled by default in-process
initDiskCache(null);
check("disabled cache returns null", diskCacheGet(k1) === null);

initDiskCache(tmp);
check("diskCacheDir reflects init", diskCacheDir() === tmp);

// real file round-trip through buildSkeleton
const target = path.join(srcDir, "config.ts");
const first = await buildSkeleton(target, "src/config.ts", opts);
const statsAfter = diskCacheStats(tmp);
check("buildSkeleton wrote a cache entry", statsAfter.entries >= 1);

// simulate a fresh process: put/get round-trip with the same key
const source = fs.readFileSync(target, "utf8");
const key = diskCacheKey(source, "full", SCHEMA_VERSION, GRAMMAR_SOURCE);
const cached = diskCacheGet(key);
check("cache hit for built file", cached !== null);
check("cached skeleton matches symbolCount", cached && cached.symbolCount === first.symbolCount);

// rel-path override on hit
diskCachePut(key, { ...first, file: "elsewhere/config.ts" });
const renamed = await buildSkeleton(target, "src/config.ts", opts);
check("hit overrides stale rel path", renamed.file === "src/config.ts");

// stats + clear
const removed = clearDiskCache(tmp);
check("clear removes entries", removed >= 1);
check("stats after clear is zero", diskCacheStats(tmp).entries === 0);

console.log("worker pool:");
initDiskCache(null);
const allFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const items = allFiles.map((f) => ({ abs: path.join(srcDir, f), rel: `src/${f}` }));

// force parallel path
process.env.AST_MAP_WORKERS = "2";
const par = await buildSkeletonsBulk(items, opts, true);
delete process.env.AST_MAP_WORKERS;
check("bulk returns one result per file", par.length === items.length);
check("all src files parsed", par.every((r) => r !== null));
check("results carry complexity", par.every((r) => r.complexity !== undefined));
check("rel paths preserved in order",
  par.every((r, i) => r.skel.file === items[i].rel));

// sequential fallback gives identical symbol counts
process.env.AST_MAP_WORKERS = "0";
const seq = await buildSkeletonsBulk(items, opts, false);
delete process.env.AST_MAP_WORKERS;
check("sequential fallback parses all", seq.every((r) => r !== null));
check("parallel == sequential symbolCount",
  par.every((r, i) => r.skel.symbolCount === seq[i].skel.symbolCount));

fs.rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll cache/pool checks passed.");
