# universal-ast-mapper v1.20.0 — Incremental cache + parallel parsing

## ✨ What's new

### Persistent parse cache (`.ast-map/cache`)
Every `buildSkeleton` result is now cached **on disk**, keyed by a SHA-1 of the
file's content + detail level + schema/grammar versions:

- **Never stale by construction** — a changed file simply hashes to a new key;
  no mtime races, no invalidation logic to get wrong.
- **Survives across processes** — the second `ast-map report`, `graph`, `scan`
  or MCP tool call on an unchanged repo skips parsing entirely. Warm hits on
  large files measured **~60× faster** than a re-parse.
- **On by default**, scoped to the project: `<root>/.ast-map/cache`, sharded
  JSON files, atomic writes. Disable with `AST_MAP_NO_CACHE=1` or
  `"cache": false` in `.ast-map.config.json`.
- New CLI command: **`ast-map cache [stats|clear]`** (`--json` supported).

### Parallel parsing (worker threads)
Bulk scans (`report`, directory `generate_skeleton`, every CLI command that
walks the tree) now distribute parse work across a **worker-thread pool**:

- Auto-sized from CPU count (max 8), only engages for batches ≥ 64 files —
  small repos stay sequential, so there is **no startup-cost regression**.
- `AST_MAP_WORKERS=N` overrides (0 = force sequential, ≥2 = force parallel).
- Any worker failure falls back to sequential parsing — parallelism is an
  optimisation, never a requirement.
- For `report`, per-file complexity is computed in the workers too.

## 🔧 API
- New module `diskcache`: `initDiskCache`, `defaultCacheDir`, `diskCacheKey`,
  `diskCacheGet/Put`, `diskCacheStats`, `clearDiskCache`.
- New module `pool`: `buildSkeletonsBulk(items, opts, withComplexity?)`.
- `AstMapConfig` gains `cache?: boolean`. All additive.

## 🧪 Tests
New `test/cache-smoke.mjs` suite (18 checks): key determinism/sensitivity,
disk round-trips through `buildSkeleton`, rel-path override on hits,
stats/clear, parallel-vs-sequential equivalence. `npm test` now runs it.
All existing suites green (131 analysis checks unchanged).

## 🔄 Breaking changes
None — additive. **27 MCP tools / 29 CLI commands / 5 MCP prompts / 14 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.20.0
```

---
**npm:** [universal-ast-mapper@1.20.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.20.0)
