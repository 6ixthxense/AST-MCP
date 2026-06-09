# Changelog

All notable changes to **universal-ast-mapper** (AST-MCP). Format based on
[Keep a Changelog](https://keepachangelog.com/); this project follows semver and,
since 1.0.0, guarantees a stable MCP tool / CLI surface across the 1.x line.

---

## [1.18.0] — 2026-06-09 · Vue & Svelte SFC support
- `.vue` and `.svelte` **single-file components** are now first-class inputs. The
  `<script>` / `<script setup>` block is lifted out and parsed with the TS/JS extractor
  (grammar chosen from `lang="ts"`), so component symbols and imports are extracted and
  wired into the dependency graph — including edges from a component into a plain `.ts`
  module, and into other components.
- Offsets are preserved: everything outside the script is blank-padded, so every symbol
  range still points at the exact line/column in the original SFC.
- New languages `vue` and `svelte` (extensions `.vue`, `.svelte`); resolver now resolves
  imports of `.vue` / `.svelte` files. **14 languages.**
- Tests: 8 new assertions (127 total) + Vue/Svelte fixtures — symbol extraction, import
  capture, and cross-file graph edges for both.

## [1.17.0] — 2026-06-09 · MCP prompts
- The server now registers **MCP prompts** — named, parameterized workflows a client
  can invoke from its prompt/slash menu, each returning a ready-to-run instruction that
  chains the right tools: `architecture_audit` (dir?), `safe_refactor` (file, symbol),
  `dead_code_cleanup` (dir?), `health_check` (dir?), `onboard_codebase` (dir?).
- The Cookbook recipes become first-class, discoverable, and one call away — no pasting.
- New `test/prompts-smoke.mjs` (12 checks): `prompts/list` returns all 5, argument
  interpolation works, and rendered prompts reference real tools. Wired into CI.

## [1.16.0] — 2026-06-09 · Module coupling
- **`get_module_coupling`** + **`ast-map modules`** (alias `mods`): aggregates the
  file-level import graph up to the **directory/module level** — per-module afferent
  (Ca) / efferent (Ce) coupling and instability, plus the weighted inter-module edges.
  Intra-module imports (files importing siblings in the same directory) are ignored;
  only cross-module dependencies count. The architectural view above per-file coupling.
- Tests: 5 new assertions (119 total) — a three-module ui→api→core gradient with the
  expected stability ordering and edge count.

## [1.15.0] — 2026-06-09 · Layer-violation detection
- **`get_layer_violations`** + **`ast-map layers`** (alias `sdp`): detect violations of
  Robert C. Martin's **Stable Dependencies Principle** — a stable file (low instability)
  that imports a more volatile one (high instability). Such dependencies point "uphill"
  on the stability gradient and drag stable code along every time the volatile file churns.
  Sorted by severity (the instability gap crossed). `minGap` filters small gaps.
- Builds directly on the v1.14.0 coupling metrics.
- Tests: 5 new assertions (114 total) — clean fixture yields none, a synthetic
  stable→volatile graph yields exactly one with the correct severity.

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
- Component s