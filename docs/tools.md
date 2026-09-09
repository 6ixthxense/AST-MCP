# MCP Tools Reference

Every tool the `universal-ast-mapper` MCP server exposes. For the CLI equivalents see
[the CLI reference in the README](../README.md#cli-reference).

### `list_supported_languages`
Returns all supported languages and their file extensions.

---

### `get_skeleton_json`
Parse a single source file → return normalized JSON skeleton (no HTML written).  
Use when the AI needs file structure only.

```json
{
  "schemaVersion": "1.1",
  "file": "src/lib/auth.ts",
  "language": "typescript",
  "directives": ["use server"],
  "imports": [
    { "symbol": "prisma", "from": "./prisma", "isDefault": true }
  ],
  "symbols": [
    { "name": "validateSession", "kind": "function", "exported": true,
      "range": { "startLine": 12, "endLine": 34 } }
  ]
}
```

**Params:** `path`, `detail` (`"outline"` | `"full"`)

---

### `generate_skeleton`
Map a file **or directory** → compact JSON + self-contained HTML views.

**Params:** `path`, `detail`, `emitHtml` (default `true`), `combineHtml` (single `index.html` with sidebar + search), `outputDir`

---

### `get_symbol_context`
Extract exact source lines of a named symbol. Token-efficient: a 300-line file → ~40 lines.  
Use `includeRelated: true` to also pull related types referenced in the signature.

**Params:** `path`, `symbol`, `kind` (optional), `includeRelated`

---

### `resolve_imports`
Resolve every import in a file to its target symbol with kind, signature, and params.

```json
{
  "resolved": [
    {
      "symbol": "validateSession", "from": "../../lib/auth",
      "resolvedRel": "src/lib/auth.ts", "kind": "function",
      "signature": "async function validateSession(token: string): Promise<Session>",
      "params": "(token: string)",
      "found": true, "importKind": "relative"
    }
  ]
}
```

**Params:** `path`

---

### `build_symbol_graph`
Scan a directory → build a two-layer dependency graph.

- **Nodes:** `"file"` (one per source file) and `"symbol"` (one per function/class/type/const)
- **Edges:** `"contains"` (structural hierarchy) and `"imports"` (cross-file dependency)

```json
{
  "stats": { "fileCount": 42, "symbolNodeCount": 380, "edgeCount": 712 },
  "edges": [
    { "from": "src/app/route.ts", "to": "src/lib/auth.ts::validateSession", "edgeType": "imports" }
  ]
}
```

Use `outputFile` to write the graph to disk for large projects.

**Params:** `path`, `detail`, `outputFile`

---

### `analyze`

One structural analysis over a directory, selected by `kind`. Replaces the twelve
single-purpose tools that existed through v1.x.

| `kind` | Returns | Extra input |
|---|---|---|
| `dead` | Exported symbols no other file imports. Entry points look dead too — judge before deleting. | `detail` |
| `cycles` | Circular import chains (A → B → C → A), full path per cycle. | |
| `duplicates` | One symbol name exported from several files. | |
| `top` | Most-imported symbols — the God Nodes with the widest blast radius. | `limit` (10) |
| `coupling` | Per-**file** Ca (fan-in) / Ce (fan-out) / instability `I = Ce/(Ca+Ce)`. | |
| `modules` | The same metrics per **directory**, plus weighted cross-module edges. | |
| `layers` | Stable Dependencies Principle breaks: a stable file importing a volatile one. | `minGap` (0) |
| `tests` | Which sources have tests and which don't, untested ranked by risk. File-level, not line coverage. | `untestedOnly` |
| `complexity` | Cyclomatic complexity per function + worst hotspots. Accepts a single **file**. | |
| `unused-params` | Parameters declared but never referenced. Accepts a single **file**. | |
| `risk` | git churn × complexity — the files most worth refactoring or testing. Needs a git repo. | |
| `workspace` | Monorepo packages (npm/yarn/pnpm/lerna), internal deps, package cycles. | |

`path` defaults to the project root. Graph-backed kinds return `directory`, `scanned`, and
`errors` (only when a file failed to parse) alongside their payload.

```jsonc
// analyze { "kind": "layers", "path": "src", "minGap": 0.3 }
{
  "directory": "src",
  "scanned": 48,
  "count": 4,
  "violations": [
    { "from": "src/types.ts", "to": "src/graph.ts",
      "fromInstability": 0, "toInstability": 0.42, "severity": 0.42 }
  ]
}
```

For a one-shot summary spanning several kinds at once, use
[`get_codebase_report`](#get_codebase_report) instead.

### `trace_type`
**Scoped type-flow tracing.** Find everywhere a named type flows through a directory — function **parameters** and **return types**, typed **variables**, and class **fields**. AST-based (no full type inference), so it tracks where a type is *named* in signatures; works best for TS/Python but resolves return/param types in any language that annotates them.

```json
{
  "type": "Inventory",
  "byRole": { "param": 3, "return": 2, "variable": 1, "field": 1 },
  "refs": [ { "file": "src/svc.ts", "symbol": "make", "role": "return", "line": 4 } ]
}
```

**Params:** `type`, `path`

---

> **Monorepo note:** once a workspace is detected, `resolve_imports` and `build_symbol_graph` resolve cross-package imports (`@org/pkg`) to real source files and draw cross-package edges.

### `read_source_map`
Given a compiled JS/CSS file with an inline (`data:`) or external `sourceMappingURL`, return the **original source files** it maps back to (honors `sourceRoot`; reports embedded `sourcesContent`).

```json
{ "file": "dist/bundle.js", "mapKind": "inline", "sources": ["../src/app.ts", "../src/util.ts"], "hasContent": true }
```

**Params:** `path`

---

### `get_codebase_report`
A one-shot **codebase health summary**: file/symbol counts, language breakdown, a health **grade (A–F)** + score, complexity hotspots, god nodes, dead exports, circular dependencies, **module coupling** (per-directory instability), and **layer violations** (SDP). Rendered as a premium HTML dashboard by `ast-map report`.

```json
{ "grade": "B", "score": 82, "fileCount": 120, "symbolCount": 1400,
  "complexity": { "average": 4.1, "max": 22, "hotspots": [ … ] },
  "godNodes": [ … ], "dead": { "count": 3, "items": [ … ] }, "cycles": { "count": 0, "items": [] } }
```

**Params:** `path` (optional, defaults to root)

---

### `get_diff`
**Git-aware.** Compare the working tree to a git ref (default `HEAD`) and return which symbols were added/removed/modified per file, which changes are potentially **breaking** (removed or signature-changed exports), and the **blast radius** — files that depend on those breaking changes. Untracked new files count as additions.

```json
{ "summary": { "filesChanged": 2, "added": 1, "removed": 1, "modified": 1, "breaking": 2, "impactedFiles": 1 },
  "breaking": [ { "file": "src/a.ts", "symbol": "foo", "reason": "signature changed" } ],
  "impactedFiles": ["src/b.ts"] }
```

**Params:** `base` (optional), `path` (optional)

---

### `pack_context`
**Token-efficient.** Assemble the *minimal* context to understand or change a symbol — its own source, the **signatures** of what it depends on (resolved imports), and the files that depend on it — instead of reading whole files. Returns a token estimate so you can see the savings.

```json
{ "primary": { "symbol": "login", "startLine": 8, "endLine": 12, "source": "…" },
  "dependencies": [ { "file": "utils.ts", "symbols": [ { "name": "hashPassword", "signature": "…" } ] } ],
  "dependents": [ { "file": "router.ts" } ], "tokenEstimate": 56 }
```

**Params:** `path`, `symbol` (optional), `scan` (optional)

---

### `get_change_impact`
Given a file + symbol, reverse-traverse the import graph to compute **blast radius**.

```json
{
  "targetNodeId": "src/lib/auth.ts::validateSession",
  "direct": [{ "file": "src/app/login/page.tsx", "symbol": "validateSession" }],
  "transitive": [{ "file": "src/middleware.ts" }],
  "totalFiles": 5
}
```

**Params:** `path`, `symbol`, `scanDir`

---

### `get_call_graph`
Parse a function body → extract every call expression, resolve callees via the import map, find reverse importers.

```json
{
  "calls": [
    { "callee": "prisma.session.findUnique", "line": 15, "calleeFileRel": "src/lib/prisma.ts" },
    { "callee": "jwt.verify", "line": 20, "isExternal": true, "calleeFileRel": "jsonwebtoken" }
  ],
  "calledBy": [
    { "file": "src/app/api/auth/route.ts" }
  ]
}
```

Supports all 8 languages with per-language call extraction (TS/JS `member_expression`, Rust `field_expression`/`scoped_identifier`, Java `method_invocation`, C# `invocation_expression`, etc.) and constructor calls (`new Foo`).  
Handles TS/JS destructured aliases (`const { sign } = jwt`), Java FQCN imports, C# `using` namespaces (via project-wide type index), Rust `use crate::path::Item`, Go `pkg.Func` (via go.mod module path), Kotlin FQCN/package imports, C/C++ `#include`, and Swift module imports (`import <Module>` → files under `Sources/<Module>/`). Reverse `calledBy` uses call-site scanning for C# and Go where import statements don't name the called symbol.

**Params:** `path`, `function`, `scanDir`

---

### `search_symbol`
Find symbols by name across all source files in a directory.

**Params:** `path`, `name`, `matchType` (`"contains"` | `"exact"` | `"regex"`), `kind`, `exportedOnly`

---

### `semantic_search`
Find symbols by **meaning**, not exact name — for when you know what the code *does* but not what it's called.

No embeddings, no network: identifier tokenization (camelCase / snake_case / acronyms), a built-in programming thesaurus (`fetch≈get≈load`, `remove≈delete≈clear`, `unused≈dead`, …), light stemming, fuzzy matching, and BM25-style IDF ranking over symbol names, doc comments, signatures and file paths. Results carry a normalized `score` and `matchedTerms` explaining *why* each symbol matched.

```
semantic_search("find unused exported code") →
  1.000  findDeadExports    (find, unused≈dead, export)
  0.557  DeadExport         (unused≈dead, export)
```

**Params:** `path`, `query`, `limit` (default 20), `kind`, `exportedOnly`

---

### `get_file_deps`
For a single file, show what it imports and what imports it (with symbol names).  
More focused than `build_symbol_graph` — use for quick dependency lookup.

**Params:** `path`, `scanDir`

---

### `validate_architecture`
Scan for architecture violations across two rule sets.

**Next.js App Router rules:**
- `client-server-boundary` — `"use client"` file importing a server-only module *(error)*
- `api-missing-try-catch` — API route handler with no try/catch *(warning)*

**General structural rules (any project):**
- `large-file` — file exceeds `maxLines` (default 500) *(warning)*
- `too-many-imports` — file has more than `maxImports` imports (default 15) *(warning)*
- `god-export` — file exports more than `maxExports` symbols (default 10) *(warning)*

Thresholds can be set per-call or in `.ast-map.config.json`.

**Params:** `path`, `maxLines`, `maxImports`, `maxExports`

---

### `check_quality_gate`
Run the CI quality gate: **absolute thresholds** (from `.ast-map.config.json` → `"check"`) plus a **baseline ratchet** against `.ast-map.baseline.json` — fails when cycles, dead exports, SDP violations, very-high-complexity functions rise, or the health score drops. Set `updateBaseline` to re-anchor at the current metrics. Same engine as `ast-map check`.

**Params:** `path`, `baseline`, `updateBaseline`

---

