# AST-MCP — Universal Code Skeleton & Dependency Graph

An **MCP server + CLI tool** that turns source code into structured, machine-readable skeletons and symbol-level dependency graphs — so AI agents can reason about large codebases without reading every file.

Built on [tree-sitter](https://tree-sitter.github.io/) WASM grammars. Zero regex guessing — real AST parsing.

**Supported languages:** TypeScript · TSX · JavaScript (ESM/CJS) · Python · Go · Rust · Java · C# · C · C++ · Kotlin · Swift

| Capability               | TS/JS | Python | Go  | Rust | Java | C#  | C   | C++ | Kt  | Swift |
|--------------------------|:-----:|:------:|:---:|:----:|:----:|:---:|:---:|:---:|:---:|:-----:|
| Symbol extraction        | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    |
| Imports parsing          | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    |
| Graph `imports` edges    | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    |
| `resolve_imports` enrich | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | ✅  | ✅  | ✅  | ✅    |
| Call graph callee origin | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | —   | —   | ✅  | —     |
| Reverse `calledBy`       | ✅    | ✅     | ✅  | ✅   | ✅   | ✅  | —   | —   | ✅  | —     |

> As of v0.8.2, all four v0.8.0 languages have **cross-file graph + resolver** wiring: Kotlin (FQCN/package index), C/C++ (`#include` with header↔impl pairing), and Swift (module = directory under `Sources/`). Call-graph callee origin is resolved for Kotlin; for C/C++/Swift it stays limited because their imports don't name individual symbols. (Ruby grammar in `tree-sitter-wasms@0.1.13` is unstable and was skipped.)

Each language uses the resolution strategy that fits it:
- **TS/JS/Python** — relative paths (`./foo`, `..mod`) resolved against the importing file's directory, with TS-ESM `.js` → `.ts` rewriting.
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
ast-map search   <pattern> [dir]   [-m contains|exact|regex] [-k kind] [-e]
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
  "rules": {
    "large-file":       { "maxLines": 400 },
    "too-many-imports": { "maxImports": 20 },
    "god-export":       { "maxExports": 15 }
  }
}
```

The config is read live — changes take effect on the next call without restarting the MCP server.

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
      - uses: 6ixthxense/AST-MCP@v1.0.0
        with:
          path: src
          max-lines: "400"
          max-imports: "20"
          max-exports: "15"
```

The action runs `ast-map validate` and fails the job on threshold violations. You can also call any CLI command directly with `npx -p universal-ast-mapper ast-map <command>`.

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
| **0.8.5** | **Cyclomatic complexity** — new `get_complexity` MCP tool + `ast-map complexity` (alias `cx`, `--min N`) CLI: per-function AST-based complexity score (`1 + if/for/while/case/catch/ternary/&&/\|\|`) with low/moderate/high/very-high ratings and directory hotspots. Server now 16 tools. |
| **0.8.4** | **Duplicate symbol detection** — new `find_duplicate_symbols` MCP tool + `ast-map duplicates` (alias `dupes`) CLI command: finds symbol names exported from more than one file, with every file/kind that declares each name. |
| **0.8.3** | **TSX/React component props** — component symbols now carry extracted prop fields. PascalCase functions/arrows that return JSX or are typed `React.FC<P>`/`FC<P>` get `propsType` (named props type) + `props[]` (name, type, optional), resolved from same-file `interface`/`type` declarations or inline object types. Plus: MCP server now reports its real version from `package.json` (was hardcoded `0.5.3`). |
| **0.8.2** | **Swift cross-file wiring** — `import <Module>` resolves to that module's files (module = the `Sources/<Module>/` directory, else parent dir), wired into `build_symbol_graph` + `resolve_imports`. System modules (Foundation, UIKit, …) stay external. Completes cross-file graph/resolver support for all four v0.8.0 languages. |
| **0.8.1** | **Cross-file graph wiring for Kotlin & C/C++** — Kotlin FQCN/package index + C/C++ `#include` resolution (with header↔impl pairing) wired into `build_symbol_graph`, `resolve_imports`, and `get_call_graph`. Fixes a parse-cache rel-path leak (stale `.file` poisoned the cross-lang index → doubled paths) and Kotlin call-graph extraction (`function_declaration` name + field-less `call_expression`). |
| **0.8.0** | **4 new languages: C · C++ · Kotlin · Swift** — symbol extraction + imports parsing. C++ tracks access_specifier through class bodies. Kotlin handles `package`/`object`/`data class`. Swift handles `class`/`struct`/`enum` (all under `class_declaration`) and `protocol_declaration`. Ruby grammar in tree-sitter-wasms@0.1.13 is unstable — skipped. |
| **0.7.0** | Go full resolution (reads `go.mod`, resolves package-as-directory) · C# reverse `calledBy` via call-site scanning · `csharpTypes` index lets `using` directives resolve to specific types · 4-suite test harness (smoke + graph-smoke + resolver-smoke + callgraph-smoke) |
| **0.6.0** | **3 new languages: Rust · Java · C#** (extractors + import parsing) · cross-language resolver in `crosslang.ts` (Java FQCN index, C# namespace index, Rust `crate::` module walk) · symbol-graph `imports` edges + `resolveFileImports` enrichment + `get_call_graph` callee resolution rewired through it · Java `package` and C# `namespace` captured as directives |
| **0.5.3** | Auto-install `/ast-map` Claude Code skill on `npm install` · `postinstall` writes `~/.claude/skills/ast-map/SKILL.md` + registers trigger in `CLAUDE.md` (idempotent, CI-safe) |
| **0.5.2** | Iterative DFS in `findCircularDeps` (eliminates stack overflow on large codebases) · `build_symbol_graph` inline size guard (>2000 nodes → stats + warning) · integration test suite (`test/analysis.mjs`) |
| **0.5.1** | Re-export tracking (`export { X } from './foo'`, barrel files) · `export const` surfaced as symbols · `const X = class {}` support · Python relative import fix · parser instance cache |
| **0.5.0** | Call graph destructuring aliases · in-process parse cache · `.ast-map.config.json` · general validation rules (large-file, too-many-imports, god-export) |
| **0.4.0** | `search_symbol` · `get_file_deps` · `get_top_symbols` · dead code confidence tiers · 3 new CLI commands |
| **0.3.0** | `ast-map` CLI · `find_dead_code` · `find_circular_deps` · `get_change_impact` · `get_call_graph` |
| **0.2.0** | Import extraction · `resolve_imports` · `build_symbol_graph` |
| **0.1.0** | `get_skeleton_json` · `generate_skeleton` · `get_symbol_context` · `validate_architecture` |
