# AST-MCP — Universal Code Skeleton & Dependency Graph

**Your agent reads 65,000 tokens to change one function. This makes it 1,200.**

An **MCP server + CLI** that parses source into structured skeletons and symbol-level
dependency graphs, so an agent can answer *"what does this touch?"* without opening every
file. Built on [tree-sitter](https://tree-sitter.github.io/) WASM grammars — real AST
parsing, no regex guessing.

```bash
npx universal-ast-mapper report src/     # health grade for any repo, no install
```

---

## The one that matters: `pack_context`

Instead of reading a file plus everything it imports, ask for the *minimal* context around a
symbol — its own source, the **signatures** of what it depends on, and who depends on it:

```
$ ast-map pack src/metrics.ts computeCoupling

Context Pack — src/metrics.ts::computeCoupling
  ~190 tokens vs ~3810 reading the same files in full  95% less
```

Measured across this repo's own symbols: **51–98% fewer tokens, ~90% typical.** Bigger files
with more dependencies save more — which is exactly where an agent's context budget goes.
Every pack reports `tokenEstimate`, `baselineTokens` and `savedPercent`, so the saving is a
number you can check rather than a claim.

---

## Install & connect

```bash
npm install -g universal-ast-mapper     # ast-map on your PATH
```

**Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "ast-mapper": {
      "command": "npx",
      "args": ["-y", "universal-ast-mapper"],
      "env": { "AST_MAP_ROOT": "C:\\path\\to\\your\\project" }
    }
  }
}
```

`AST_MAP_ROOT` is the security boundary — the server reads nothing outside it. Two opt-in
escapes:

| Setting | Effect |
|---|---|
| `AST_MAP_ROOT` with `;` / `:` separators | multiple project roots; the first is primary for relative paths |
| `AST_MAP_UNLOCKED=1` | allow **any** absolute path the client asks for. Personal setups only |

---

## What it does

**19 MCP tools · 32 CLI commands · 5 MCP prompts · 3 MCP resources.** Full tool docs:
**[docs/tools.md](docs/tools.md)**.

The workhorse is **`analyze`**, which covers twelve structural questions behind one `kind`:

| `kind` | Answers |
|---|---|
| `dead` | which exports nobody imports |
| `cycles` | which imports form a loop |
| `duplicates` | which name is exported from two places |
| `top` | which symbols have the widest blast radius (God Nodes) |
| `coupling` | per-file Ca / Ce / instability |
| `modules` | the same, per directory, plus cross-module edges |
| `layers` | where stable code depends on volatile code (SDP breaks) |
| `tests` | which sources have no test touching them |
| `complexity` | which functions are the hairiest |
| `unused-params` | which parameters are declared and never read |
| `risk` | churn × complexity — what's most worth refactoring |
| `workspace` | monorepo packages, internal deps, package cycles |

The rest are their own tools because their inputs genuinely differ: `pack_context`,
`get_codebase_report`, `check_quality_gate`, `get_diff`, `build_symbol_graph`,
`get_change_impact`, `get_call_graph`, `get_file_deps`, `search_symbol`, `semantic_search`,
`trace_type`, `resolve_imports`, `read_source_map`, `validate_architecture`,
`generate_skeleton`, `get_symbol_context`, `get_skeleton_json`, `list_supported_languages`.

Plus an interactive **graph explorer** (`ast-map explore`), a one-page **health dashboard**
(`ast-map report`), **watch mode**, a **persistent parse cache + parallel parsing**, and a
**CI quality gate** with a baseline ratchet (`ast-map check`).

---

## Languages

TypeScript · TSX · JavaScript (ESM/CJS) · Python · Go · Rust · Java · C# · C · C++ · Kotlin ·
Swift · Vue · Svelte (SFC `<script>`) · PHP · Ruby

| Capability | TS/JS | Python | Go | Rust | Java | C# | C | C++ | Kt | Swift | PHP | Ruby |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Symbol extraction | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Imports parsing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Graph `imports` edges | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `resolve_imports` enrich | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Call-graph callee origin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — |
| Reverse `calledBy` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | ✅ | — | — | — |

Each language gets the resolution strategy that fits it — relative paths and `tsconfig`
aliases for TS/JS/Python, `go.mod` for Go, `Cargo.toml` for Rust, a project-wide FQCN index
for Java/Kotlin, namespace indexes for C#, `#include` with header↔impl pairing for C/C++.
Where imports don't name the called symbol (C#, Go), reverse `calledBy` falls back to
call-site scanning. PHP and Ruby currently do symbols + imports; cross-file graph wiring is
next.

---

## CLI

Defaults to `cwd` as root; override with `AST_MAP_ROOT`. Add `--json` to any command.

```
ast-map report    [dir]  [-o report.html]   # health grade + dashboard
ast-map explore   [dir]  [-o out.html]      # interactive graph
ast-map watch     [dir]  [-o out.html]      # rebuild on change
ast-map check     [dir]  [--update-baseline] [--min-score N] [--max-cycles N]

ast-map pack      <file> [symbol] [--scan <d>]   # minimal context pack
ast-map impact    <file> <symbol> [--scan <d>]   # blast radius
ast-map calls     <file> <fn>     [--scan <d>]   # call graph
ast-map deps      <file>          [--scan <d>]   # imports / imported-by
ast-map symbol    <file> <name>   [-k kind] [--related]

ast-map dead|cycles|duplicates|top|coupling|layers|modules|tests|risk  [dir]
ast-map complexity|unused-params  <path>
ast-map search <pattern> [dir]   [-m contains|exact|regex] [-k kind] [-e]
ast-map find   <query>   [dir]   [-l N]     # semantic: search by meaning
ast-map trace-type <type> [dir]
ast-map workspace [dir]                     # monorepo packages

ast-map skeleton <path>  [-d outline|full] [--html] [--combine] [-o dir]
ast-map graph    <dir>   [-o graph.json]
ast-map validate <path>  [--max-lines N] [--max-imports N] [--max-exports N]
ast-map imports  <file> · ast-map sourcemap <file> · ast-map diff [base]
ast-map langs · ast-map cache [stats|clear]
```

```bash
# Which source files have no tests at all?
ast-map tests . --untested

# Don't know the name? Search by meaning
ast-map find "remove expired cache entries" src/

# Blast radius before touching sanitize()
ast-map impact src/utils.ts sanitize --scan src/

# Machine-readable
ast-map dead src/ --json | jq '.deadExports[] | select(.kind == "function")'
```

---

## Config — `.ast-map.config.json`

Project root, all fields optional, read live (no restart):

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
  "check": { "maxCycles": 0, "maxSdpViolations": 10, "minScore": 70 }
}
```

---

## Performance

- **Persistent parse cache** — each skeleton is stored under `<root>/.ast-map/cache`, keyed by
  SHA-1 of content + detail + schema/grammar version. A changed file hashes to a new key, so
  entries are **never stale by construction**. Warm re-scans skip parsing entirely.
- **Worker-thread parallel parsing** — batches of ≥64 files spread over a pool sized from your
  CPU count (max 8). Any worker failure falls back to sequential.
- **Incremental watch** — `ast-map watch` keeps skeletons in memory across rebuilds and
  re-parses only the file you saved. On a 2,000-file project: ~1.15s → ~0.32s per save.

| Env var | Effect |
|---|---|
| `AST_MAP_NO_CACHE=1` | disable the disk cache for this run |
| `AST_MAP_WORKERS=0` | force sequential parsing |
| `AST_MAP_WORKERS=N` | force a pool of N workers |

---

## MCP prompts & resources

Prompts are named workflows an MCP client can invoke from its slash menu — each returns a
ready-to-run instruction that chains the right tools:

| Prompt | Args | What it does |
|---|---|---|
| `architecture_audit` | `dir?` | God Nodes → cycles → violations → coupling → SDP, then a ranked summary |
| `safe_refactor` | `file`, `symbol` | blast radius → call graph → minimal context before a change |
| `dead_code_cleanup` | `dir?` | unused exports, each verified zero-impact before deletion |
| `health_check` | `dir?` | grade A–F → risk map → layer violations → the 3 files to fix first |
| `onboard_codebase` | `dir?` | languages → structure → core symbols → module map |

Resources expose the codebase as browseable URIs: `ast://languages`,
`ast://skeleton/{path}` (templated, enumerable), `ast://graph`.

---

## GitHub Action — architecture gate in CI

```yaml
name: Architecture
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: 6ixthxense/AST-MCP@v2
        with:
          path: src
          mode: check                 # validate | check | both
          check-args: "--min-score 70 --max-cycles 0"
```

Commit a baseline once (`ast-map check src --update-baseline`) and the job fails whenever
cycles, dead exports, SDP violations, or complexity regress past it. Any CLI command also
works directly via `npx -p universal-ast-mapper ast-map <command>`.

---

## Schema

```jsonc
// SymbolNode
{
  "name": "validateSession", "kind": "function", "exported": true,
  "range": { "startLine": 42, "endLine": 58 },
  "signature": "async function validateSession(token: string): Promise<Session | null>",
  "doc": "Verify a session token.", "children": []
}

// SkeletonFile (schemaVersion 1.1)
{
  "schemaVersion": "1.1", "file": "src/lib/auth.ts", "language": "typescript",
  "parser": { "engine": "web-tree-sitter", "grammar": "typescript" },
  "symbolCount": 12, "directives": ["use server"],
  "imports": [{ "symbol": "hash", "from": "./crypto.js", "kind": "named" }],
  "symbols": []
}
```

`kind` is one of `class · interface · struct · function · method · type · enum · const · var ·
field · namespace`.

---

## Stability

**v2.0.0 is a breaking release.** Twelve MCP tools were folded into `analyze({ kind, … })` —
see the [CHANGELOG](CHANGELOG.md#200--2026-09-09--tool-surface-cut-in-half) for the
old-name → new-name table. Response shapes are unchanged, so a client only renames the call.
**The CLI is unaffected.**

Across the `2.x` line: MCP tool names and input schemas, CLI commands and flags, and the
skeleton JSON are stable; new tools and new *optional* inputs may be added. Not public: the
`src/` module layout and the generated HTML markup.

---

## Contributing a language

1. Add a `src/extractors/<lang>.ts` exporting `extract<Lang>` (and optionally
   `extractImports<Lang>` / `extractDirectives<Lang>`).
2. Register the file extensions in `src/registry.ts`.
3. Add a fixture under `test/fixtures/` and assertions in `test/smoke.mjs`.

`npm test` runs every `test/*.mjs` automatically — no list to update.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
