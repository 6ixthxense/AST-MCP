# AST-MCP — Universal Code Skeleton & Dependency Graph

An **MCP server + CLI tool** that turns source code into structured, machine-readable skeletons and symbol-level dependency graphs — so AI agents can reason about large codebases without reading every file.

Built on [tree-sitter](https://tree-sitter.github.io/) WASM grammars. Zero regex guessing — real AST parsing.

**30 MCP tools / 32 CLI commands / 5 MCP prompts** spanning skeletons, dependency graphs, and deep analysis — dead code, cycles, change-impact, complexity, duplicates, unused params, type-flow, decorators, test-coverage mapping — plus monorepo support, an interactive **graph explorer** with a **coupling overlay** (`ast-map explore`), **watch mode**, a one-page **health dashboard** with test-coverage, coupling and SDP cards (`ast-map report`), a **persistent parse cache + parallel parsing** (warm re-scans skip parsing entirely), and a **CI quality gate** (`ast-map check`, baseline ratchet).

**Supported languages:** TypeScript · TSX · JavaScript (ESM/CJS) · Python · Go · Rust · Java · C# · C · C++ · Kotlin · Swift · Vue · Svelte (SFC `<script>`) · **PHP** · **Ruby**

| Capability               | TS/JS | Python | Go  | Rust | Java | C#  | C   | C++ | Kt  | Swift | PHP | Ruby |
|--------------------------|:-----:|:------:|:---:|:----:|:----:|:---:|:---:|:---:|:---:|:-----:|:---:|:----:|
| Symbol extraction        | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    | ✅  | ✅   |
| Imports parsing          | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    | ✅  | ✅   |
| Graph `imports` edges    | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    | —   | —    |
| `resolve_imports` enrich | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    | —   | —    |
| Call graph callee origin | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | —   | —   | ✅  | —     | —   | —    |
| Reverse `calledBy`       | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | —   | —   | ✅  | —     | —   | —    |

> As of v0.8.2, all four v0.8.0 languages have **cross-file graph + resolver** wiring: Kotlin (FQCN/package index), C/C++ (`#include` with header↔impl pairing), and Swift (module = directory under `Sources/`). Call-graph callee origin is resolved for Kotlin; for C/C++/Swift it stays limited because their imports don't name individual symbols. (PHP & Ruby landed in v1.22.0 — symbol extraction + imports; cross-file graph wiring for them is the next step. Ruby was unblocked by upgrading `web-tree-sitter` to 0.21.0.)

Each language uses the resolution strategy that fits it:
- **TS/JS/Python** — relative paths (`./foo`, `..mod`) resolved against the importing file's directory, with TS-ESM `.js` → `.ts` rewriting. **Path aliases** (`@/*` etc.) resolve via the nearest `tsconfig.json`/`jsconfig.json` (`paths` + `baseUrl`, relative `extends`). *(v1.24.0)*
- **Go** — `go.mod` ancestor lookup → module path prefix → package directory → all `.go` files (skips `_test.go`).
- **Rust** — `Cargo.toml` ancestor → `crate::` / `self::` / `super::` walks; supports `mod.rs` + Rust-2018 sibling-dir style.
- **Java** — project-wide FQCN index (`package + "." + className → file`) built lazily on first cross-lang call; supports wildcard imports.
- **C#** — namespace-to-files index plus a `<ns>.<TypeName>` index so `using App.Models` + `new Inventory()` resolves to the right file.
- **Kotlin** — project-wide FQCN index (`package + "." + ClassName → file`), like Java; wildcard `import pkg.*` pulls every file in the package.
- **C / C++** — `#include "..."` resolved against the including file's directory; headers auto-paired with same-name `.c`/`.cpp`/`.cc`/`.cxx` impl files. `<system>` includes stay external.

For C# and Go (where imports don't name the called symbol), reverse `calledBy` falls back to **call-site scanning** of candidate files.

---

## Quick Start

```bash
npm install && npm run build

# CLI
ast-map --help
ast-map langs
ast-map dead src/
ast-map validate src/

# Or without installing globally
node dist/cli.js dead src/
```

---

## Two Ways to Use

| Mode | Entry Point | When to Use |
|------|-------------|-------------|
| **CLI** (`ast-map`) | `dist/cli.js` | Terminal, CI scripts, quick checks |
| **MCP Server** | `dist/index.js` | AI agents (Claude, Cursor, etc.) |

---

## MCP Setup — Claude Desktop

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ast-mapper": {
      "command": "node",
      "args": ["C:\\path\\to\\AST-MCP\\dist\\index.js"],
      "env": {
        "AST_MAP_ROOT": "C:\\path\\to\\your\\project"
      }
    }
  }
}
```

> `AST_MAP_ROOT` is the security boundary — the server only reads files inside this path.

Since **v1.23.0** the boundary is configurable:

- **Multi-root** — list several projects in `AST_MAP_ROOT`, separated by the OS path delimiter (`;` on Windows, `:` on macOS/Linux). The first root is the primary (relative paths resolve against it):

```json
      "env": { "AST_MAP_ROOT": "C:\\proj\\app;C:\\proj\\chem_sc_su" }
```

- **Unlocked** — set `AST_MAP_UNLOCKED: "1"` to let the server analyze **any absolute path** the client asks for (relative paths still resolve against the primary root). Use this for a personal "analyze anything" setup; keep it off for shared/untrusted environments:

```json
      "env": { "AST_MAP_ROOT": "C:\\proj\\app", "AST_MAP_UNLOCKED": "1" }
```

---

## CLI Reference

All commands default to `cwd` as root. Override with `AST_MAP_ROOT=/path/to/project ast-map <cmd>`.  
Add `--json` to any command for machine-readable output.

```
ast-map langs
ast-map skeleton <path>            [-d outline|full] [--html] [--combine] [-o dir]
ast-map symbol   <file> <name>     [-k kind] [--related]
ast-map imports  <file>
ast-map graph    <dir>             [-o graph.json]
ast-map validate <path>            [--max-lines N] [--max-imports N] [--max-exports N]
ast-map dead     <dir>
ast-map cycles   <dir>
ast-map duplicates <dir>           [alias: dupes]
ast-map complexity <path>          [alias: cx] [--min N]
ast-map unused-params <path>       [alias: unused]
ast-map trace-type <type> [dir]    [alias: flow]
ast-map workspace [dir]            [alias: ws]
ast-map explore   [dir]            [-o out.html]
ast-map watch     [dir]            [-o out.html]
ast-map sourcemap <file>
ast-map report    [dir]            [-o report.html]
ast-map diff      [base]           [--dir <d>]   # git-aware changed symbols + impact
ast-map risk      [dir]            [-n N]        # churn × complexity
ast-map pack      <file> [symbol]  [--scan <d>] # minimal context pack
ast-map coupling  [dir]            [-n N]        # Ca / Ce / instability per file
ast-map layers    [dir]            [-g gap]      # SDP: stable→volatile violations
ast-map modules   [dir]                          # directory-level coupling + edges
ast-map cache     [stats|clear]                  # persistent parse cache (.ast-map/cache)
ast-map check     [dir]            [--update-baseline] [--min-score N] [--max-cycles N] ...
ast-map search   <pattern> [dir]   [-m contains|exact|regex] [-k kind] [-e]
ast-map find     <query> [dir]     [-l N] [-k kind] [-e]   # semantic: by meaning
ast-map tests    [dir]             [alias: coverage] [-u] [--links] [-n N]
ast-map deps     <file>            [--scan <dir>]
ast-map top      <dir>             [-n 10]
ast-map impact   <file> <symbol>   [--scan <dir>]
ast-map calls    <file> <fn>       [--scan <dir>]
```

### Examples

```bash
# What does this file export?
ast-map skeleton src/lib/auth.ts

# Show source of validateSession + related types
ast-map symbol src/lib/auth.ts validateSession --related

# Find unused exports
ast-map dead src/

# Detect circular imports
ast-map cycles src/

# Check architecture + structural health
ast-map validate src/
ast-map validate src/ --max-lines 300 --max-imports 20

# Find all symbols named like "handler" across the project
ast-map search handler src/ --exported

# Don't know the name? Search by meaning
ast-map find "remove expired cache entries" src/

# Which source files have no tests at all?
ast-map tests . --untested

# What does this file import / what imports it?
ast-map deps src/lib/auth.ts --scan src/

# Top 10 most-imported symbols (God Node detector)
ast-map top src/

# Blast radius of changing sanitize()
ast-map impact src/utils.ts sanitize --scan src/

# Full call graph for a function
ast-map calls src/graph.ts buildSymbolGraph --scan src/

# Build symbol graph, write to file (large projects)
ast-map graph src/ -o graph.json

# Machine-readable output
ast-map dead src/ --json | jq '.deadExports[] | select(.kind == "function")'
```

---

## MCP Tools Reference

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

### `find_dead_code`
Scan a directory → find exported symbols with zero incoming import edges.

Returns two confidence tiers:
- `"high"` — functions, classes, consts (very likely unused)
- `"low"` — interfaces, types, enums (may be used as type annotations only)

> Note: framework entry-points (Next.js pages, route handlers) are technically "dead" inside the graph — review before deleting.

**Params:** `path`, `detail`

---

### `find_circular_deps`
Detect circular import chains (A → B → C → A) using DFS.  
Each cycle is canonicalised to avoid duplicates.

```json
{
  "cycles": [
    { "cycle": ["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"], "length": 3 }
  ]
}
```

**Params:** `path`

---

### `find_duplicate_symbols`
Scan a directory → find symbol names exported from **more than one file** (accidental collisions / parallel implementations). Each result lists every file + kind that declares the name.

```json
{
  "duplicates": [
    { "symbol": "validate", "count": 2, "locations": [
      { "file": "src/a.ts", "kind": "function" },
      { "file": "src/b.ts", "kind": "function" }
    ]}
  ]
}
```

**Params:** `path`

---

### `get_complexity`
Compute **AST-based cyclomatic complexity** per function/method for a file or directory. Score = `1 + decision points` (if / for / while / case / catch / ternary / `&&` / `||`), with a rating: `low` (≤5), `moderate` (≤10), `high` (≤20), `very-high` (>20). Directory scans also return the highest-complexity **hotspots** across all files.

```json
{
  "file": "src/auth.ts",
  "maxComplexity": 12,
  "functions": [
    { "name": "validate", "complexity": 12, "rating": "high", "startLine": 8, "endLine": 40 }
  ]
}
```

**Params:** `path`

---

### `find_unused_params`
Scan a file or directory for **named functions/methods with parameters that are never used** in the body. Skips `_`-prefixed params (conventionally intentional), anonymous callbacks, and destructured bindings — and correctly treats object-shorthand (`{ id }`) as a use — to keep false positives near zero.

```json
{ "file": "src/x.ts", "functions": [ { "function": "greet", "line": 3, "unused": ["salutation"] } ] }
```

**Params:** `path`

---

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

### `analyze_workspace`
**Monorepo support.** Discover the packages in a JS/TS monorepo (npm/yarn `workspaces`, `pnpm-workspace.yaml`, or `lerna.json`) and the dependency edges between them. Returns each package's name, directory, and workspace-internal dependencies, plus any circular dependencies between packages.

```json
{
  "tool": "npm", "packageCount": 3,
  "packages": [ { "name": "@demo/a", "dir": "packages/a", "internalDeps": ["@demo/b"] } ],
  "edges": [ { "from": "@demo/a", "to": "@demo/b" } ],
  "packageCycles": []
}
```

**Params:** `path` (optional, defaults to root)

---

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

### `get_risk_map`
Rank files by **refactor risk = git churn × max complexity** — the files that are both frequently changed and complex (the best refactor / test targets).

```json
{ "files": [ { "file": "src/callgraph.ts", "churn": 7, "maxComplexity": 69, "risk": 483 } ] }
```

**Params:** `path` (optional)

---

### `get_coupling`
Per-file **coupling metrics** (Robert C. Martin): afferent coupling **Ca** (fan-in), efferent coupling **Ce** (fan-out), and **instability** I = Ce/(Ca+Ce) (0 = stable / load-bearing, 1 = unstable / volatile).

```json
{ "files": [ { "file": "src/types.ts", "afferent": 27, "efferent": 0, "instability": 0 } ] }
```

**Params:** `path` (optional)

---

### `get_layer_violations`
Find dependencies that point **the wrong way on the stability gradient** — a stable file (low instability) importing a more volatile one (high instability), violating Martin's **Stable Dependencies Principle**. Sorted by severity (the instability gap crossed).

```json
{ "violations": [ { "from": "src/skeleton.ts", "to": "src/registry.ts", "fromInstability": 0.36, "toInstability": 0.6, "severity": 0.24 } ] }
```

**Params:** `path` (optional), `minGap` (optional, 0–1)

---

### `get_module_coupling`
Aggregate the import graph up to the **directory/module level** — per-module Ca / Ce / instability plus the weighted inter-module edges. Intra-module imports are ignored, so this is the architectural bird's-eye view above per-file coupling.

```json
{
  "modules": [ { "module": "src/extractors", "files": 11, "afferent": 1, "efferent": 1, "instability": 0.5 } ],
  "edges": [ { "from": "src/extractors", "to": "src", "weight": 75 } ]
}
```

**Params:** `path` (optional)

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

### `get_test_coverage`
Structural test coverage: pair test files with the source files they exercise, and list source files **no test touches** — no instrumentation or test runner needed, works on a cold checkout.

Two signals: a test file *importing* a source file (definitive), and naming conventions (`auth.test.ts` → `auth.ts`, `test_utils.py` → `utils.py`, `FooTest.java` → `Foo.java`, `test/<name>.*` → `<name>.*`). Fixture/mock directories are excluded from both sides. Untested files are ranked by risk (fan-in, then symbol count); unmatched test files are reported as `orphanTests` (usually integration/e2e).

> File-level coverage ("does anything test this file?"), not line coverage.

**Params:** `path`, `untestedOnly`

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

### `get_top_symbols`
Return the N most-imported symbols — your codebase's "God Nodes" where a breaking change has maximum blast radius.

**Params:** `path`, `limit` (default 10)

---

## Project Config — `.ast-map.config.json`

Place in your project root. All fields optional.

```json
{
  "ignore": ["dist", "coverage", ".turbo"],
  "maxFileBytes": 500000,
  "outputDir": ".ast-map",
  "cache": true,
  "rules": {
    "large-file":       { "maxLines": 400 },
    "too-many-imports": { "maxImports": 20 },
    "god-export":       { "maxExports": 15 }
  },
  "check": {
    "maxCycles": 0,
    "maxSdpViolations": 10,
    "minScore": 70
  }
}
```

- `cache` — persistent parse cache in `<root>/.ast-map/cache` (default `true`; also disabled by `AST_MAP_NO_CACHE=1`). Inspect/clear with `ast-map cache [stats|clear]`.
- `check` — default thresholds for `ast-map check` / `check_quality_gate`; CLI flags override per run.

The config is read live — changes take effect on the next call without restarting the MCP server.

---

## Performance — cache & parallel parsing

Since **v1.20.0**, bulk scans are fast twice over:

- **Persistent parse cache** — every parsed file's skeleton is stored under `<root>/.ast-map/cache`, keyed by a SHA-1 of its content + detail + schema/grammar versions. A changed file hashes to a new key, so entries are **never stale by construction**, and the cache survives across processes — a re-run on an unchanged repo skips parsing entirely (warm hits on large files ≈ 60× faster).
- **Worker-thread parallel parsing** — batches of ≥ 64 files are distributed over a pool sized from your CPU count (max 8); smaller batches stay sequential so there's no startup-cost penalty. Any worker failure falls back to sequential parsing.

| Env var | Effect |
|---------|--------|
| `AST_MAP_NO_CACHE=1` | disable the disk cache for this run |
| `AST_MAP_WORKERS=0`  | force sequential parsing |
| `AST_MAP_WORKERS=N`  | force a pool of N workers (bypasses the batch-size gate) |

`ast-map cache` shows entry count + size; `ast-map cache clear` wipes it. `.ast-map/` is already in the default ignore list — add it to `.gitignore` if it isn't.

---

## Power Prompts

### Full Architecture Audit
```
Use build_symbol_graph on src/, then:
1. get_top_symbols — find the 5 God Nodes
2. find_circular_deps — any cycles?
3. validate_architecture — architecture violations + structural warnings
4. For the worst issue, show source with get_symbol_context
```

### Safe Refactor Checklist
```
Before refactoring [functionName] in [file]:
1. get_change_impact — who depends on it?
2. get_call_graph — what does it call?
3. get_symbol_context with includeRelated=true — show me the full signature + types
4. Summarise what needs to change alongside the refactor
```

### Dead Code Cleanup
```
Run find_dead_code on src/.
Show high-confidence results grouped by file.
For each candidate, use get_change_impact to confirm it's truly unreachable,
then show the source with get_symbol_context so I can verify before deleting.
```

---

## Adding a Language

1. Pick a grammar from `tree-sitter-wasms` (~36 bundled grammars).
2. Write `src/extractors/<lang>.ts` — export `extract()` and `extractImports()`.
3. Add one entry to `src/registry.ts`.

No changes to the core pipeline or any MCP tool.

---

## Schema Reference

### `SymbolNode`
```typescript
interface SymbolNode {
  name: string
  kind: "class" | "interface" | "struct" | "function" | "method"
       | "type" | "enum" | "const" | "var" | "field"
  visibility: "public" | "private"
  exported?: boolean
  signature?: string          // full detail only
  doc?: string                // full detail only
  range: { startLine: number; endLine: number }
  children: SymbolNode[]
}
```

### `ImportRef`
```typescript
interface ImportRef {
  symbol: string              // imported name, or "*"
  from: string                // module specifier as written in source
  alias?: string              // import { Foo as Bar } → "Bar"
  isTypeOnly?: boolean
  isNamespaceImport?: boolean
  isDefault?: boolean
  isSideEffect?: boolean
}
```

### `SkeletonFile` (schema v1.1)
```typescript
interface SkeletonFile {
  schemaVersion: "1.1"
  file: string                // relative path, forward-slashed
  language: string
  generatedAt: string
  parser: { engine: "tree-sitter"; grammar: string }
  symbolCount: number
  directives?: string[]       // e.g. ["use client"]
  imports?: ImportRef[]
  symbols: SymbolNode[]
}
```

---

## Project Layout

```
src/
├── index.ts            — MCP server + all 14 tool registrations
├── cli.ts              — ast-map CLI (13 commands)
├── types.ts            — SkeletonFile, SymbolNode, ImportRef
├── config.ts           — SkeletonOptions, resolveOptions(), loadProjectConfig()
├── registry.ts         — language detection + extractor registry
├── parser.ts           — tree-sitter WASM loader + AST node helpers
├── skeleton.ts         — buildSkeleton(), collectSourceFiles() + parse cache
├── resolver.ts         — resolveImportPath(), resolveFileImports() (TS/JS/Python relative)
├── crosslang.ts        — Java FQCN / C# namespace / Rust crate / Go module resolvers + index cache
├── graph.ts            — buildSymbolGraph() (language-aware second pass)
├── graph-analysis.ts   — findDeadExports(), findCircularDeps(), getChangeImpact(),
│                         getFileDeps(), getTopSymbols()
├── callgraph.ts        — buildCallGraph() — AST-level call extraction
├── analysis.ts         — findSymbol(), validate helpers, checkGeneralRules()
├── html.ts             — renderHtml(), renderCombinedHtml()
├── search.ts           — searchSymbols()
└── extractors/
    ├── common.ts       — makeSymbol(), toOutline()
    ├── typescript.ts   — TS/JS/TSX: symbols + imports + re-exports
    ├── python.ts       — Python: symbols + relative import resolution
    ├── go.ts           — Go: symbols + imports
    ├── rust.ts         — Rust: struct/trait/enum/impl + `use` imports
    ├── java.ts         — Java: class/interface/enum/method/field + package + imports
    └── csharp.ts       — C#: namespace recursion + class/struct/interface/property + `using`
```

---

## MCP resources

Beyond tools, the server exposes the codebase as **browseable MCP resources**, so an agent (or MCP client UI) can list and read structure directly:

| URI | What |
|-----|------|
| `ast://languages` | supported languages + extensions |
| `ast://skeleton/{path}` | the skeleton for one source file (templated; `resources/list` enumerates every file) |
| `ast://graph` | the whole-root symbol dependency graph (guarded by file count) |

---

## MCP prompts — one-call recipes

The server also registers **prompts**: named, parameterized workflows an MCP client can invoke directly (they show up in the client's prompt/slash menu). Each returns a ready-to-run instruction that chains the right tools, so you don't paste the recipe by hand.

| Prompt | Args | What it does |
|--------|------|--------------|
| `architecture_audit` | `dir?` | God Nodes → cycles → rule violations → module coupling → SDP breaks, then a prioritized summary |
| `safe_refactor` | `file`, `symbol` | blast radius → call graph → minimal context before changing a symbol |
| `dead_code_cleanup` | `dir?` | unused exports, each verified zero-impact before deletion |
| `health_check` | `dir?` | grade A–F → risk map → layer violations, with the 3 files to fix first |
| `onboard_codebase` | `dir?` | languages → structure → core symbols → module map, as a "start here" guide |

---

## GitHub Action — architecture gate in CI

Use AST-MCP as a CI check with the bundled composite action (`action.yml`):

```yaml
# .github/workflows/architecture.yml
name: Architecture
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: 6ixthxense/AST-MCP@v1
        with:
          path: src
          max-lines: "400"
          max-imports: "20"
          max-exports: "15"
```

The action runs `ast-map validate` and fails the job on threshold violations.

Since **v1.21.0** the action can also run the **quality gate** (baseline ratchet + thresholds). Commit a baseline once (`ast-map check src --update-baseline`), then:

```yaml
      - uses: 6ixthxense/AST-MCP@v1
        with:
          path: src
          mode: check                 # validate | check | both
          check-args: "--min-score 70 --max-cycles 0"
```

The job fails whenever cycles, dead exports, SDP violations, or complexity regress past the committed `.ast-map.baseline.json`. You can also call any CLI command directly with `npx -p universal-ast-mapper ast-map <command>`.

---

## Stability (1.0)

As of **v1.0.0**, the public surface is stable across the `1.x` line:

- **MCP tool names and input schemas** — no breaking changes; new tools and new *optional* inputs may be added.
- **CLI commands and flags** — stable; new commands/flags may be added.
- **Skeleton JSON** — `schemaVersion` follows additive-compatible evolution; new *optional* fields (e.g. `props`, `decorators`) may appear without a major bump.

Not part of the public API: the internal `src/` module layout and the generated HTML markup.

---

## Changelog

| Version | What changed |
|---------|--------------|
| **1.28.0** | **Test coverage in the dashboard** — `ast-map report` / `get_codebase_report` gain a **Test coverage** card (coverage bar + untested sources ranked by risk with Ca/symbols) and stat tile; structural coverage now factors into the health score (capped penalty). Reporting on `src/` only? Test files are **pulled in from the project root automatically**. |
| **1.27.0** | **Test-coverage mapping** — new MCP tool `get_test_coverage` + CLI `ast-map tests` (alias `coverage`): pairs test files with the sources they exercise (import edges + naming conventions) and lists **untested sources ranked by risk** (fan-in, then symbols). Fixture dirs excluded; orphan tests reported. File-level, zero instrumentation. (**30 tools / 32 commands**) |
| **1.26.0** | **Coupling overlay in the explorer** — `ast-map explore` gains a `color: coupling` mode: nodes shaded by **instability** I = Ce/(Ca+Ce) on a green (stable) → red (volatile) scale, with a legend, and Ca / Ce / I readouts in the hover tooltip and detail sidebar. Spot load-bearing files and volatile hotspots at a glance. |
| **1.25.0** | **Semantic symbol search** — new MCP tool `semantic_search` + CLI `ast-map find <query>`: find symbols by *meaning* ("remove expired sessions" → `clearDiskCache`). Identifier tokenization + 60-group programming thesaurus + stemming + fuzzy matching + BM25-style IDF ranking over names, docs, signatures and paths. No embeddings, no network. (**29 tools / 31 commands**) |
| **1.24.0** | **TS path-alias resolution** — bare imports like `@/components/Button` now resolve via the **nearest** `tsconfig.json`/`jsconfig.json` (`compilerOptions.paths` + `baseUrl`, relative `extends` chains, longest-prefix matching, string-aware JSONC parser). Wired into `resolve_imports`, the symbol graph, and the call graph — on a real Next.js app this took the import graph from 31 to **324 edges** and cut false dead-exports by ~30%. |
| **1.23.0** | **Configurable root boundary** — `AST_MAP_ROOT` accepts **multiple roots** (path-delimiter separated) and `AST_MAP_UNLOCKED=1` allows analyzing **any absolute path** on request (default stays locked). Analysis/graph/report rel-paths now computed against the matched root, so cross-root results are correct. New `roots` module + 13-check test suite. |
| **1.22.0** | **PHP & Ruby support** — `.php` (classes, interfaces, traits, enums, methods with visibility, `use` imports incl. grouped, require/include) and `.rb`/`.rake` (classes, modules, methods, `self.` singleton methods, `private` section tracking, require/require_relative). Unblocked by upgrading `web-tree-sitter` 0.20.8 → 0.21.0 (all existing grammars re-verified). **16 languages**. |
| **1.21.0** | **Quality gate** — `ast-map check` fails CI when quality regresses: **baseline ratchet** vs `.ast-map.baseline.json` (cycles · dead exports · SDP · very-high complexity · score; `--update-baseline` re-anchors) + absolute thresholds (flags or config `"check"`). New MCP tool `check_quality_gate` (**28 tools**); GitHub Action gains `mode: check`. |
| **1.20.0** | **Incremental cache + parallel parsing** — persistent content-hash parse cache in `.ast-map/cache` (on by default, never stale, warm hits ~60× faster on large files; `ast-map cache stats|clear`, `AST_MAP_NO_CACHE`, `"cache": false`) + worker-thread **parallel parsing** for bulk scans (auto-sized, `AST_MAP_WORKERS` override, sequential fallback). |
| **1.19.0** | **Dashboard: coupling + SDP** — `ast-map report` / `get_codebase_report` now include **module coupling** (per-directory instability bars) and **layer violations** (stable→volatile, SDP) cards, plus an SDP stat; SDP inversions also factor into the health score. The v1.14–1.16 metrics are now visual. |
| **1.18.0** | **Vue & Svelte SFC support** — `.vue` and `.svelte` single-file components are now parsed: the `<script>` / `<script setup>` block is lifted out (TS or JS) and its symbols + imports extracted, with cross-file graph edges into plain modules. Blank-padding keeps every symbol's line numbers pointing at the original SFC. **14 languages**. |
| **1.17.0** | **MCP prompts** — the server now registers 5 parameterized **prompts** (`architecture_audit`, `safe_refactor`, `dead_code_cleanup`, `health_check`, `onboard_codebase`): named workflows a client can invoke from its prompt menu, each chaining the right tools. The Cookbook recipes, one call away. |
| **1.16.0** | **Module coupling** — new `get_module_coupling` MCP tool + `ast-map modules` (alias `mods`) CLI: aggregates the import graph to the **directory/module level** — per-module Ca / Ce / instability plus weighted inter-module edges (intra-module imports ignored). The bird's-eye view above per-file coupling. **27 MCP tools**. |
| **1.15.0** | **Layer-violation detection** — new `get_layer_violations` MCP tool + `ast-map layers` (alias `sdp`) CLI: flags dependencies that break Martin's **Stable Dependencies Principle** — a stable file (low instability) importing a more volatile one — sorted by the instability gap. Builds directly on the coupling metrics. **26 MCP tools**. |
| **1.14.0** | **Coupling metrics** — new `get_coupling` MCP tool + `ast-map coupling [dir]` CLI: per-file afferent (Ca) / efferent (Ce) coupling and **instability** I = Ce/(Ca+Ce), the way to spot load-bearing files (high Ca) vs. volatile ones (high I). **25 MCP tools**. |
| **1.13.0** | **Context-pack** — new `pack_context` MCP tool + `ast-map pack <file> [symbol]` CLI: the minimal context to work on a symbol (its source + the signatures it depends on + its dependents) with a token estimate, instead of reading whole files. **24 MCP tools**. |
| **1.12.0** | **Git-aware analysis** — `ast-map diff [base]` + `get_diff` tool: changed symbols since a ref, **breaking changes** (removed / signature-changed exports), and blast radius. `ast-map risk` + `get_risk_map` tool: rank files by churn × complexity. Brings a time/history dimension. **23 MCP tools**. |
| **1.11.0** | **Code-health dashboard** — new `ast-map report` CLI writes a premium self-contained HTML overview (grade A–F, stats, language breakdown, complexity hotspots, god nodes, dead code, cycles) + `get_codebase_report` MCP tool for the same as JSON. |
| **1.10.0** | **Source-map support** — new `read_source_map` MCP tool + `ast-map sourcemap <file>` CLI: given a compiled JS/CSS file with an inline (`data:`) or external `sourceMappingURL`, returns the original source files it maps back to (honors `sourceRoot`). Traces `dist/` output back to source. |
| **1.9.0** | **Watch mode** — `ast-map watch [dir]` recomputes the dependency analysis (file count · dead exports · cycles) on every source-file change, debounced; `-o file.html` also regenerates the live explorer each time. Plus: the explorer debug readout is now hidden (toggle with `d`). |
| **1.8.2** | **Explorer stability fix** — clamp the force layout (distance floor + velocity cap) so nodes that initialize close together can't be flung to huge coordinates, which was blowing up the bounding box and shrinking the whole graph into a corner. Now reliably centers and fills. |
| **1.8.1** | **Explorer self-heal sizing** — the explorer now re-checks canvas size every frame and re-fits, so it always centers/fills even if the canvas reports zero size at load (and survives container resizes). |
| **1.8.0** | **Explorer detail sidebar** — click a file in `ast-map explore` to open a side panel: language, symbol count, its symbols, the files it imports, and the files that import it — each clickable to jump to that file. |
| **1.7.3** | **Explorer layout overhaul** — only connected files are force-laid (centered + filling the viewport); orphan files with no in-scope deps are parked in a tidy grid below instead of sprawling. Verified centered at any window size. |
| **1.7.2** | **Explorer fit, really this time** — continuous auto-fit until you interact, robust canvas sizing, and centered node init, so the graph fills the viewport instead of bunching in a corner. |
| **1.7.1** | **Explorer fit fix** — the `ast-map explore` graph now auto-fits the viewport (spreads to fill the screen instead of clustering in the centre); double-click re-fits. |
| **1.7.0** | **Web UI graph explorer** — `ast-map explore [dir]` writes a self-contained, dependency-free interactive HTML: a force-directed file dependency graph (drag, zoom, click-to-highlight neighbours, filter by name). No build step, no external scripts — just open it in a browser. |
| **1.6.0** | **MCP resource endpoints** — the server now exposes browseable resources: `ast://languages`, `ast://skeleton/{path}` (templated, one per source file via `resources/list`), and `ast://graph`. Agents can list and read codebase structure as resources, not just call tools. |
| **1.5.0** | **`.d.ts` / ambient declarations** — `declare function/const/class`, `declare module "x"`, and `declare namespace` (and plain `namespace`) are now extracted (previously a `.d.ts` yielded 0 symbols). Adds a `namespace` symbol kind; declared APIs surface as exported, nested under their module/namespace. |
| **1.4.0** | **Dynamic import tracking** — dynamic `import("...")` and CommonJS `require("...")` calls (anywhere in a file) are now captured as imports with an `isDynamic` flag. Relative dynamic imports resolve and draw graph edges like static ones, so lazy-loaded routes/modules show up in the dependency graph. |
| **1.3.0** | **TS/JS decorators** — class and method symbols now carry a `decorators` field (`@Component({...})`, `@Injectable()`, `@Get("/x")`), in skeletons and `get_call_graph`. Extends the Python decorator support (v0.8.7) to TypeScript/JavaScript — traces Angular/NestJS-style framework wiring to its class/handler. |
| **1.2.0** | **File-level cross-package resolution** — in a monorepo, bare imports of a workspace package (`@org/utils`, `@org/utils/sub`) now resolve to the actual source file (preferring `src/` over built `dist/`), so `resolve_imports` marks them in-project and `build_symbol_graph` draws cross-package edges. Builds on the v1.1.0 workspace discovery. |
| **1.1.0** | **Monorepo support** — new `analyze_workspace` MCP tool + `ast-map workspace` (alias `ws`) CLI: discovers packages from npm/yarn `workspaces`, `pnpm-workspace.yaml`, or `lerna.json`, maps internal package dependencies, and flags circular package deps. **19 MCP tools**. |
| **1.0.0** | **Stable release.** Locks the public API (MCP tool names + schemas, CLI surface) for the 1.x line. Adds a **GitHub Action** (`action.yml`) to run `ast-map validate` as a CI architecture gate, plus a project CI workflow. Caps a 12-language engine with 18 MCP tools / 17 CLI commands spanning skeletons, dependency graphs, and deep analysis (dead code · cycles · impact · complexity · duplicates · unused params · decorators · type flow). |
| **0.9.0** | **Scoped type-flow tracing** — new `trace_type` MCP tool + `ast-map trace-type` (alias `flow`) CLI: follow a named type through function params, return types, typed variables, and class fields across a directory. Completes the deeper-analysis suite (dead code · cycles · impact · complexity · duplicates · unused params · type flow). **18 MCP tools**. |
| **0.8.7** | **Python decorators in the call graph** — function/method symbols now carry a `decorators` field (`@router.get("/x")` → `router.get("/x")`), surfaced in skeletons (outline + full) and in `get_call_graph`. Traces framework wiring like FastAPI/Flask routes and `@staticmethod`/`@property` stacks to their handler. |
| **0.8.6** | **Unused parameter detection** — new `find_unused_params` MCP tool + `ast-map unused-params` (alias `unused`) CLI: named functions whose params are never referenced. Skips `_`-prefixed/destructured/anonymous and treats object-shorthand as a use (low false-positive). Server now 17 tools. |
| **0.8.5** | **Cyclomatic complexity** — new `get_complexity` MCP tool + `ast-map complexity` (alias `cx`) CLI: per-function cyclomatic complexity with low/moderate/high/very-high ratings, file or directory scope. |
| **0.8.4** | **Duplicate symbol detection** — `find_duplicate_symbols` / `ast-map duplicates` (alias `dupes`): symbol names exported from more than one file. |
| **0.8.1–0.8.3** | Kotlin + C/C++ cross-file wiring · Swift module resolution (`Sources/<Module>/`) · TSX/React component props (`propsType` + `props[]`, `React.FC<P>` detection). |
| **0.1.0–0.8.0** | Foundation: skeleton extraction (`get_skeleton_json`, `generate_skeleton`, `get_symbol_context`, `validate_architecture`) · import resolution + symbol graph · dead code / cycles / impact / call graph · CLI · 12 languages (+Rust · Java · C# · Go · C · C++ · Kotlin · Swift) · `/ast-map` skill auto-install · barrel re-exports · parse cache. |
