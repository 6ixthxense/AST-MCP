# universal-ast-mapper v1.23.0 — Configurable root boundary

## ✨ What's new

The MCP server's security boundary (`AST_MAP_ROOT`) is now configurable —
you no longer have to restart with a different root to analyze another project.

### Multi-root
`AST_MAP_ROOT` accepts **several roots**, separated by the OS path delimiter
(`;` on Windows, `:` on macOS/Linux). Absolute paths inside any listed root are
allowed; relative paths resolve against the first (primary) root.

```json
"env": { "AST_MAP_ROOT": "C:\\proj\\app;C:\\proj\\chem_sc_su" }
```

### Unlocked mode
`AST_MAP_UNLOCKED=1` lets the server analyze **any existing absolute path** the
client asks for — the "analyze whatever I point at" setup for personal use.
The default stays locked, so published behavior is unchanged unless you opt in.

```json
"env": { "AST_MAP_ROOT": "C:\\proj\\app", "AST_MAP_UNLOCKED": "1" }
```

### Correct cross-root results
Every tool resolves rel-paths and graph roots against the **matched** root (not
the primary), so skeletons, graphs, reports, diffs, and quality gates on an
outside-root project produce correct relative paths. The boundary error message
now explains both escape hatches.

## 🔧 API
New module `roots`: `parseRootsFromEnv`, `resolvePathInRoots`, `RootsConfig`.
The CLI shares the same parser (uses the primary root). All additive.

## 🧪 Tests
New `test/roots-smoke.mjs` (13 checks): parsing, multi-root, escape rejection,
unlocked resolution. End-to-end verified over MCP stdio: locked mode rejects an
outside path; unlocked mode produces a correct report + skeleton for it.

## 🔄 Breaking changes
None — locked-by-default behavior is identical. **28 MCP tools / 30 CLI commands / 5 MCP prompts / 16 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.23.0
```

---
**npm:** [universal-ast-mapper@1.23.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.23.0)
