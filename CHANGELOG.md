# Changelog

All notable changes to **universal-ast-mapper** (AST-MCP). Format based on
[Keep a Changelog](https://keepachangelog.com/); this project follows semver and,
since 1.0.0, guarantees a stable MCP tool / CLI surface across the 1.x line.

---

## [1.14.0] — 2026-06-09 · Coupling metrics
- **`get_coupling`** + **`ast-map coupling [dir]`**: Robert C. Martin's per-file
  coupling metrics — afferent coupling (Ca, fan-in), efferent coupling (Ce,
  fan-out), and instability I = Ce/(Ca+Ce). High-Ca files are load-bearing (break
  carefully); high-instability files change freely. Derived from the import graph.
- Tests: 4 new assertions (109 total) verifying stable/unstable/middle files and
  the [0,1] instability bound.

## [1.13.0] — 2026-06-08 · Context-pack
- **`pack_context`** + **`ast-map pack <file> [symbol]`**: the minimal context to
  work on a symbol — its source, the signatures it depends on, and its dependents
  — with a token estimate, instead of reading whole files.

## [1.12.0] — 2026-06-08 · Git-aware analysis
- **`ast-map diff [base]`** + **`get_diff`**: changed symbols since a git ref,
  breaking changes (removed / signature-changed exports), and blast radius.
- **`ast-map risk`** + **`get_risk_map`**: rank files by churn × complexity.

## [1.11.0] — 2026-06-01 · Code-health dashboard
- **`ast-map report`** writes a premium self-contained HTML dashboard: health
  grade (A–F), stats, language breakdown, complexity hotspots, god nodes, dead
  code, and cycles. **`get_codebase_report`** MCP tool returns the same as JSON.

## [1.10.0] — 2026-06-01 · Source maps
- **`read_source_map`** MCP tool + **`ast-map sourcemap <file>`** CLI: trace a
  compiled JS/CSS file (inline `data:` or external `.map`) back to its original
  sources; honors `sourceRoot` and reports embedded `sourcesContent`.
- Ruby re-investigated and confirmed blocked (external-scanner grammar needs
  web-tree-sitter ≥0.22; engine upgrade would risk the 12 working languages).

## [1.9.0] — 2026-06-01 · Watch mode
- **`ast-map watch [dir]`** — debounced, coalesced rebuild of the dependency
  analysis (files · dead exports · cycles) on every source change; `-o file.html`
  regenerates the live explorer too.
- Explorer debug readout hidden by default (toggle with `d`).

## [1.8.0] — 2026-06-01 · Explorer detail sidebar
- Click a file in `ast-map explore` for a side panel: language, symbol count,
  symbols, **Imports** and **Imported by** (each clickable to navigate the graph).
- **1.8.1–1.8.3 (fixes):** explorer now reliably centers/fills the viewport —
  separated orphan files into a tidy grid, clamped the force layout to stop nodes
  being flung to huge coordinates, and sized the canvas from `innerWidth/innerHeight`.

## [1.7.0] — 2026-06-01 · Web UI graph explorer
- **`ast-map explore [dir]`** writes a self-contained, dependency-free interactive
  HTML: a force-directed file dependency graph (drag / zoom / pan / click-to-
  highlight / name filter). Opens in any browser, no build step.
- **1.7.1–1.7.3 (fixes):** auto-fit and layout tuning.

## [1.6.0] — 2026-06-01 · MCP resource endpoints
- Browseable resources: **`ast://languages`**, **`ast://skeleton/{path}`**
  (templated, one per file via `resources/list`), **`ast://graph`**. Agents can
  list/read codebase structure as resources, not just call tools.

## [1.5.0] — 2026-06-01 · `.d.ts` / ambient declarations
- Extract `declare function/const/class`, `declare module "x"`, and
  `declare namespace` (plus plain `namespace`); a `.d.ts` used to yield 0 symbols.
- New `namespace` symbol kind.

## [1.4.0] — 2026-06-01 · Dynamic import tracking
- Capture dynamic `import("...")` and CommonJS `require("...")` with an
  `isDynamic` flag; relative ones resolve and draw graph edges like static imports.

## [1.3.0] — 2026-06-01 · TS/JS decorators
- Class and method symbols carry a `decorators` field (`@Component`, `@Get(...)`),
  in skeletons and `get_call_graph`. Extends the Python decorator support to TS/JS.

## [1.2.0] — 2026-06-01 · File-level cross-package resolution
- In a monorepo, bare imports of a workspace package (`@org/utils`, `@org/utils/sub`)
  resolve to the real source file (prefers `src/` over `dist/`), so `resolve_imports`
  marks them in-project and `build_symbol_graph` draws cross-package edges.

## [1.1.0] — 2026-06-01 · Monorepo support
- **`analyze_workspace`** tool + **`ast-map workspace`** CLI: discover packages
  (npm/yarn `workspaces`, `pnpm-workspace.yaml`, `lerna.json`), map internal
  package dependencies, and detect circular package deps.

## [1.0.0] — 2026-06-01 · Stable release 🎉
- Locked public API (MCP tool names + schemas, CLI surface) for the 1.x line.
- Bundled **GitHub Action** (`action.yml`) running `ast-map validate` as a CI gate,
  plus a project CI workflow.
- 12 languages · 18 MCP tools / 17 CLI commands at release.

## [0.9.0] — 2026-05-31 · Scoped type-flow tracing
- **`trace_type`** tool + **`ast-map trace-type`** CLI: follow a named type through
  function params, return types, typed variables, and class fields. Completes the
  deeper-analysis suite.

## [0.8.7] — 2026-05-31 · Python decorators
- `decorators` field on Python symbols + `get_call_graph`; traces
  `@router.get(...)` → handler and stacked decorators.

## [0.8.6] — 2026-05-31 · Unused parameter detection
- **`find_unused_params`** tool + **`ast-map unused-params`** CLI: named functions
  whose params are never referenced (low false-positive; counts object shorthand).

## [0.8.5] — 2026-05-31 · Cyclomatic complexity
- **`get_complexity`** tool + **`ast-map complexity`** CLI: per-function score with
  low/moderate/high/very-high ratings and directory hotspots.

## [0.8.4] — 2026-05-31 · Duplicate symbol detection
- **`find_duplicate_symbols`** tool + **`ast-map duplicates`** CLI: exported names
  declared in 2+ files.

## [0.8.3] — 2026-05-31 · TSX/React component props
- Component symbols carry `propsType` + `props[]`; detects `React.FC<P>` and
  JSX-returning PascalCase functions. MCP server version now read from package.json.

## [0.8.2] — 2026-05-30 · Swift cross-file wiring
- `import <Module>` → that module's files (`Sources/<Module>/`). Completes
  cross-file graph/resolver support for all four v0.8.0 languages.

## [0.8.1] — 2026-05-30 · Kotlin + C/C++ cross-file wiring
- Kotlin FQCN/package index; C/C++ `#include` resolution with header↔impl pairing.
- Fixes: parse-cache rel-path leak; Kotlin call-graph extraction.

---

## Earlier (pre-session history)

- **0.8.0** — +4 languages: C · C++ · Kotlin · Swift (symbol extraction + imports).
- **0.7.0** — Go full module resolution; C# reverse `calledBy`; 4-suite test harness.
- **0.6.0** — +3 languages: Rust · Java · C#; cross-language resolver.
- **0.5.x** — `/ast-map` skill auto-install; iterative DFS; barrel re-exports; parse cache; call-graph aliases; `.ast-map.config.json`.
- **0.4.0** — `search_symbol`, `get_file_deps`, `get_top_symbols`, dead-code tiers.
- **0.3.0** — CLI; `find_dead_code`, `find_circular_deps`, `get_change_impact`, `get_call_graph`.
- **0.2.0** — import extraction; `resolve_imports`; `build_symbol_graph`.
- **0.1.0** — `get_skeleton_json`, `generate_skeleton`, `get_symbol_context`, `validate_architecture`.

[1.13.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.13.0
[1.12.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.12.0
[1.11.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.11.0
[1.10.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.10.0
[1.9.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.9.0
[1.8.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.8.0
[1.7.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.7.0
[1.6.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.6.0
[1.5.0]: https://github.com/6ixthxense/AST-MCP/relea