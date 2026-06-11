# Changelog

All notable changes to **universal-ast-mapper** (AST-MCP). Format based on
[Keep a Changelog](https://keepachangelog.com/); this project follows semver and,
since 1.0.0, guarantees a stable MCP tool / CLI surface across the 1.x line.

---

## [1.26.0] — 2026-06-11 · Coupling overlay in the explorer
- **`ast-map explore` color modes** — new toolbar dropdown: `color: folder`
  (existing per-directory hues) or **`color: coupling`** — nodes shaded by
  **instability** I = Ce/(Ca+Ce) on a green (0, stable) → yellow → red
  (1, volatile) scale; orphan files stay gray.
- **Legend** (bottom-left, shown in coupling mode) explains the scale; the hover
  tooltip and the detail sidebar now show **Ca / Ce / I** per file.
- Explorer nodes carry `ca` / `ce` / `inst` computed from the deduped file-level
  import edges — same definition as `get_coupling` (Robert C. Martin metrics).
- Still a single self-contained HTML file, dark-mode aware, zero dependencies.
- Tests: +5 checks in `test/analysis.mjs` (144 total).

## [1.25.0] — 2026-06-11 · Semantic symbol search
- **New MCP tool `semantic_search`** + **CLI `ast-map find <query> [dir]`** — find
  symbols by *meaning*, not exact name: "remove expired cache entries" →
  `clearDiskCache`, "find unused exported code" → `findDeadExports`.
- Pure lexical semantics — **no embeddings, no network, no model downloads**:
  - **Identifier tokenization**: camelCase / PascalCase / snake_case / kebab-case /
    digit and acronym boundaries (`getHTTPServerByID` → `get http server by id`).
  - **Programming thesaurus**: 60 synonym groups (`fetch≈get≈load≈retrieve`,
    `remove≈delete≈clear`, `unused≈dead`, `auth≈login≈session`, …).
  - **Light stemming** (plural/gerund/past: `users`→`user`) + **fuzzy matching**
    (edit distance ≤ 1 on tokens ≥ 4 chars).
  - **BM25-style ranking**: corpus IDF (rare tokens weigh more), field weights
    (name 3× > doc 2× > signature 1.5× > path/kind 1×), match-type weights
    (direct > synonym > fuzzy), coverage bonus, and length normalization so
    focused names (`login`) outrank composites (`handleLogin`).
- Results include a normalized `score` (0–1) and `matchedTerms` explaining each hit
  (`unused≈dead` = synonym, `cach~cache` = fuzzy).
- Options: `limit` (default 20), `kind` filter, `exportedOnly`.
- New module `semantic` (`semanticSearch`, `splitIdentifier`, `stem`). Tests: +8
  checks in `test/analysis.mjs` (139 total). **29 MCP tools / 31 CLI commands.**

## [1.24.0] — 2026-06-10 · TS path-alias resolution
- Bare imports like `@/components/Button` now resolve through **`tsconfig.json` /
  `jsconfig.json` `compilerOptions.paths`** (+ `baseUrl`): nearest-config lookup above
  the importing file (monorepo-safe, per-process cached), relative `extends` chains
  (child `paths` replace the parent's, per TS semantics), longest-prefix pattern
  matching, candidate probing with the usual extension/index logic.
- **String-aware JSONC parser** — comments/trailing commas are stripped with a
  character walk, not regex (naive stripping corrupts Next.js configs where `"@/*"`
  pairs with the `*/` inside `"**/*.ts"` include globs).
- Wired into `resolve_imports` (aliased imports report `importKind: "relative"` +
  resolved file), `build_symbol_graph` (alias edges before workspace-package fallback),
  and the call graph (callee origin + reverse `calledBy`).
- Real-world effect (Next.js app, 186 files): import graph 31 → **324 edges**;
  dead exports 210 → 153; god nodes now reflect true usage.
- New module `tsconfig` (`aliasCandidates`, `clearAliasCaches`) + `resolveAliasedImport`
  in the resolver. Tests: new `test/tsalias-smoke.mjs` (15 checks), wired into `npm test`.

## [1.23.0] — 2026-06-10 · Configurable root boundary (multi-root + unlocked)
- **`AST_MAP_ROOT` accepts multiple roots**, separated by the OS path delimiter
  (`;` Windows / `:` POSIX). The first root is primary; absolute paths inside any
  listed root are allowed.
- **`AST_MAP_UNLOCKED=1`** — opt-in: the MCP server analyzes **any existing absolute
  path** the client asks for. Default behavior is unchanged (locked to the root list).
- Every tool now computes rel-paths and graph roots against the **matched** root, so
  reports/graphs on outside-root projects come out correct.
- Clearer boundary error message (suggests both escape hatches).
- New module `roots` (`parseRootsFromEnv`, `resolvePathInRoots`); CLI shares the parser.
- Tests: new `test/roots-smoke.mjs` (13 checks) + end-to-end verified over MCP stdio
  (locked rejects / unlocked analyzes an outside project).

## [1.22.1] — 2026-06-10 · Docs
- README refreshed to match v1.20–1.22: 28 tools / 30 commands, PHP+Ruby capability
  columns, `cache`/`check` CLI + config + env-var docs, `check_quality_gate` reference,
  Action `mode: check` example, new Performance section. No code changes.

## [1.22.0] — 2026-06-10 · PHP & Ruby support
- **PHP** (`.php`): classes/interfaces/traits/enums, methods with visibility modifiers,
  class consts + properties, namespaces; imports from `use` (incl. grouped `use A\{B, C}`
  and aliases) and `require`/`include` (side-effect).
- **Ruby** (`.rb`, `.rake`): classes, modules (→ namespace), methods, `self.` singleton
  methods, constants; **section-style visibility** (`private`/`protected`/`public`);
  imports from `require` / `require_relative`.
- **web-tree-sitter 0.20.8 → 0.21.0** — unblocks the Ruby grammar (external-scanner
  crash on the old runtime); no API change, all grammars + suites re-verified.
- Tests: `Sample.php` + `sample.rb` fixtures, 30 new smoke assertions. **16 languages.**

## [1.21.0] — 2026-06-10 · Quality gate (`ast-map check`)
- **`ast-map check [dir]`** — CI quality gate with two mechanisms: a **baseline ratchet**
  (vs a committed `.ast-map.baseline.json`; fails when cycles, dead exports, SDP violations,
  very-high-complexity functions rise or the health score drops; `--update-baseline`
  re-anchors) and **absolute thresholds** (CLI flags or `.ast-map.config.json` → `"check"`).
  Non-zero exit on failure; `--json` for tooling.
- New MCP tool **`check_quality_gate`** (28 tools) — same gate for agents.
- **GitHub Action**: `mode: validate | check | both` + `check-args` inputs.
- New module `check` (`runQualityGate`, `metricsFromReport`); `AstMapConfig.check`.
- Tests: new `test/check-smoke.mjs` (13 checks), wired into `npm test`.

## [1.20.0] — 2026-06-10 · Incremental cache + parallel parsing
- **Persistent parse cache**: skeletons are cached on disk under `<root>/.ast-map/cache`,
  keyed by content hash + detail + schema/grammar versions — never stale by construction,
  survives across processes (warm hits on large files ~60× faster than a re-parse).
  On by default; disable with `AST_MAP_NO_CACHE=1` or `"cache": false` in config.
- **Parallel parsing**: bulk scans distribute work over a worker-thread pool
  (auto-sized, engages at ≥ 64 files, `AST_MAP_WORKERS` override, sequential fallback
  on any worker failure). `report` computes per-file complexity in the workers too.
- New CLI command `ast-map cache [stats|clear]`.
- New modules `diskcache` and `pool` (`buildSkeletonsBulk`); `AstMapConfig.cache`.
- Tests: new `test/cache-smoke.mjs` (18 checks), wired into `npm test`.

## [1.19.0] — 2026-06-09 · Dashboard: coupling + SDP
- The health dashboard (`ast-map report` / `get_codebase_report`) now surfaces the
  v1.14–1.16 architecture metrics: a **Module coupling** card (per-directory instability
  bars with Ca/Ce) and a **Layer violations** card (stable→volatile SDP inversions),
  plus an **SDP violations** stat tile.
- SDP violations now factor into the health score (small capped penalty), so a codebase
  that systematically depends "uphill" on the stability gradient scores lower.
- `ReportData` gains `layerViolations` and `modules`; purely additive.
- Tests: 4 new assertions (131 total) — report carries the new data and the HTML renders
  both cards.

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
[1.5.0]: https://github.com/6ixthxense/AST-MCP/releases/tag/v1.5.0
