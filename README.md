# AST-MCP — Universal Code Skeleton & Dependency Graph

An **MCP server + CLI tool** that turns source code into structured, machine-readable skeletons and symbol-level dependency graphs — so AI agents can reason about large codebases without reading every file.

Built on [tree-sitter](https://tree-sitter.github.io/) (WASM grammars). Zero regex guessing — real AST parsing.

**Supported languages:** TypeScript · TSX · JavaScript (ESM, CJS) · Python · Go

---

## Quick Start

```bash
npm install && npm run build

# Use as CLI
npx ast-map langs
npx ast-map dead src/
npx ast-map cycles src/

# Or install globally
npm link
ast-map --help
```

---

## Two Ways to Use

| Mode | Entry Point | Use When |
|---|---|---|
| **CLI** (`ast-map`) | `dist/cli.js` | Running analysis from terminal, CI scripts, quick checks |
| **MCP Server** | `dist/index.js` | AI agents (Claude Desktop, Cursor, etc.) calling tools directly |

---

## CLI — `ast-map`

All commands default to the current working directory as root.  
Override with `AST_MAP_ROOT=/path/to/project ast-map <command>`.

### Commands

```
ast-map langs
ast-map skeleton <path>     [-d outline|full] [--html] [--combine] [-o dir]
ast-map symbol   <file> <name>   [-k kind] [--related]
ast-map imports  <file>
ast-map graph    <dir>      [-o graph.json]
ast-map validate <path>
ast-map dead     <dir>
ast-map cycles   <dir>
ast-map impact   <file> <symbol>  [--scan <dir>]
ast-map calls    <file> <fn>      [--scan <dir>]
```

Add `--json` to any command for machine-readable output:

```bash
ast-map dead src/ --json | jq '.deadExports[] | select(.kind == "function")'
```

### Examples

```bash
# What does this file export?
ast-map skeleton src/lib/auth.ts

# Show me the source of validateSession, including types it references
ast-map symbol src/lib/auth.ts validateSession --related

# Check all imports resolve correctly
ast-map imports src/pages/login.tsx

# Find unused exports in src/
ast-map dead src/

# Any circular import loops?
ast-map cycles src/

# If I change sanitize() in utils.ts, what else breaks?
ast-map impact src/utils.ts sanitize --scan src/

# What does buildGraph() call, and who calls it?
ast-map calls src/graph.ts buildSymbolGraph --scan src/

# Build full symbol graph, save to file
ast-map graph src/ -o graph.json

# Validate Next.js architecture
ast-map validate src/
```

---

## MCP Server — Connect to Claude Desktop

Edit your Claude Desktop config:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ast-mapper": {
      "command": "node",
      "args": ["C:\\path\\to\\AST-MCP\\dist\\index.js"],
      "env": {
        "AST_MAP_ROOT": "C:\\path\\to\\the\\project\\you\\want\\to\\analyze"
      }
    }
  }
}
```

> `AST_MAP_ROOT` is the security boundary — the server only reads files inside this directory.

---

## MCP Tools Reference

### `list_supported_languages`
Returns all supported languages and their file extensions.

---

### `get_skeleton_json`
Parse a single file → return normalized JSON skeleton (no HTML). Use when the AI needs structure only.

```json
{
  "schemaVersion": "1.1",
  "file": "src/lib/auth.ts",
  "language": "typescript",
  "imports": [
    { "symbol": "prisma", "from": "./prisma", "isDefault": true }
  ],
  "symbols": [
    { "name": "validateSession", "kind": "function", "exported": true,
      "range": { "startLine": 12, "endLine": 34 } }
  ]
}
```

---

### `generate_skeleton`
Map a file **or directory** → compact JSON + self-contained HTML views.

Options: `detail` (`outline`|`full`), `emitHtml`, `combineHtml` (single `index.html` with sidebar), `outputDir`.

---

### `resolve_imports`
For a source file, resolve each import to its target symbol with kind, signature, and parameter list.

```json
{
  "file": "src/app/login/page.tsx",
  "resolved": [
    {
      "symbol": "validateSession", "from": "../../lib/auth",
      "resolvedRel": "src/lib/auth.ts", "kind": "function",
      "signature": "async function validateSession(token: string): Promise<Session>",
      "found": true, "importKind": "relative"
    }
  ]
}
```

---

### `build_symbol_graph`
Scan a directory → build a two-layer dependency graph.

**Nodes:** `"file"` (one per source file) and `"symbol"` (one per function/class/type).  
**Edges:** `"contains"` (structural hierarchy) and `"imports"` (cross-file dependency).

```json
{
  "stats": { "fileCount": 42, "symbolNodeCount": 380, "edgeCount": 712 },
  "edges": [
    { "from": "src/app/route.ts", "to": "src/lib/auth.ts::validateSession", "edgeType": "imports" }
  ]
}
```

Use `outputFile` to write the graph to disk for large projects.

---

### `get_symbol_context`
Extract exact source lines of a named symbol. Token-efficient: a 300-line file → ~40 lines of relevant code.  
Use `includeRelated: true` to also pull related types referenced in the signature.

---

### `validate_architecture`
Scan for Next.js App Router violations:
- `client-server-boundary` — `"use client"` file importing a server-only module
- `api-missing-try-catch` — API route handler with no try/catch

---

### `find_dead_code` ✦ New in v0.3
Scan a directory → find exported symbols with **zero incoming import edges**.  
These are candidates for deletion (note: framework entry-points like Next.js page exports are technically dead within the graph).

```json
{
  "deadExportCount": 3,
  "deadExports": [
    { "file": "src/utils/format.ts", "symbol": "formatDate", "kind": "function" }
  ]
}
```

---

### `find_circular_deps` ✦ New in v0.3
Detect circular import chains using DFS. Each cycle is canonicalised to avoid duplicates.

```json
{
  "cycleCount": 1,
  "cycles": [
    { "cycle": ["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"], "length": 3 }
  ]
}
```

---

### `get_change_impact` ✦ New in v0.3
Given a file + symbol, reverse-traverse the import graph to compute **blast radius**: which files/symbols break if this symbol changes.

```json
{
  "targetNodeId": "src/lib/auth.ts::validateSession",
  "direct": [
    { "file": "src/app/login/page.tsx", "symbol": "validateSession" }
  ],
  "transitive": [
    { "file": "src/middleware.ts" }
  ],
  "totalFiles": 5
}
```

---

### `get_call_graph` ✦ New in v0.3
Parse a function body with tree-sitter → extract every call expression, resolve callees via the import map, and find which files import the function (calledBy). Supports TypeScript, JavaScript, Python, and Go.

```json
{
  "file": "src/lib/auth.ts",
  "function": "validateSession",
  "functionRange": { "startLine": 12, "endLine": 34 },
  "calls": [
    { "callee": "prisma.session.findUnique", "line": 15, "calleeFileRel": "src/lib/prisma.ts" },
    { "callee": "jwt.verify", "line": 20, "isExternal": true, "calleeFileRel": "jsonwebtoken" }
  ],
  "calledBy": [
    { "file": "src/app/api/auth/route.ts" }
  ]
}
```

---

## Power Prompts (MCP)

### Full Architecture Audit

```
Scan src/ with build_symbol_graph, then:
1. Find the 5 most-imported symbols (God Nodes)
2. Check for circular dependencies with find_circular_deps
3. Validate Next.js architecture with validate_architecture
4. Pick the highest-impact issue and show me the source with get_symbol_context
```

### Safe Refactor Checklist

```
Before I refactor [functionName] in [file]:
1. Run get_change_impact on src/[file] symbol=[functionName] --scan src/
2. List all direct and transitive dependents
3. Run get_call_graph to show what it currently calls
4. Summarise what I need to update alongside the refactor
```

---

## Schema Reference

### `ImportRef`
```typescript
interface ImportRef {
  symbol: string              // imported name, or "*" for namespace/side-effect
  from: string                // module specifier as written in source
  alias?: string              // import { Foo as Bar } → "Bar"
  isTypeOnly?: boolean        // import type { ... }
  isNamespaceImport?: boolean // import * as Foo
  isDefault?: boolean         // import Foo from ...
  isSideEffect?: boolean      // import "module"
}
```

### `SkeletonFile` (schema v1.1)
```typescript
interface SkeletonFile {
  schemaVersion: "1.1"
  file: string                // relative path, forward-slashed
  language: string
  generatedAt: string         // ISO timestamp
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
├── index.ts            — MCP server + all tool registrations
├── cli.ts              — ast-map CLI binary (10 commands)
├── types.ts            — SkeletonFile, SymbolNode, ImportRef
├── config.ts           — SkeletonOptions, resolveOptions()
├── registry.ts         — Language detection + extractor registry
├── parser.ts           — tree-sitter WASM loader + node helpers
├── skeleton.ts         — buildSkeleton(), collectSourceFiles()
├── resolver.ts         — resolveImportPath(), resolveFileImports()
├── graph.ts            — buildSymbolGraph(), GraphNode, GraphEdge
├── graph-analysis.ts   — findDeadExports(), findCircularDeps(), getChangeImpact()
├── callgraph.ts        — buildCallGraph() with AST-level call extraction
├── analysis.ts         — findSymbol(), architecture validation helpers
├── html.ts             — renderHtml(), renderCombinedHtml()
└── extractors/
    ├── common.ts       — makeSymbol(), toOutline()
    ├── typescript.ts   — extractTypeScript(), extractImportsTS()
    ├── python.ts       — extractPython(), extractImportsPython()
    └── go.ts           — extractGo(), extractImportsGo()
```

## Adding a Language

1. Pick a grammar from `tree-sitter-wasms` (~36 bundled).
2. Write `src/extractors/<lang>.ts` exporting `extract()` and `extractImports()`.
3. Register one line in `src/registry.ts`.

No changes to the core pipeline or any tool.

---

## Changelog

| Version | What changed |
|---|---|
| **0.3.0** | `ast-map` CLI · `find_dead_code` · `find_circular_deps` · `get_change_impact` · `get_call_graph` |
| **0.2.0** (v1.1) | Import extraction · `resolve_imports` · `build_symbol_graph` |
| **0.1.0** | Initial release: `get_skeleton_json`, `generate_skeleton`, `get_symbol_context`, `validate_architecture` |
