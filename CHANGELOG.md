# Changelog

All notable changes to **universal-ast-mapper** (AST-MCP). Format based on
[Keep a Changelog](https://keepachangelog.com/); this project follows semver and,
since 1.0.0, guarantees a stable MCP tool / CLI surface across the 1.x line.

---

## [2.0.6] — 2026-06-21 · patch

- **perf:** switch all MCP tool responses to compact JSON (no indent) — ~20% token reduction on every call
- **perf:** skeleton responses now strip null/empty fields (`rawKind`, null `doc`/`signature`, empty `props`/`decorators`/`children`) via `pruneSymbol()` + `pruneSkeletonFile()` — significant token reduction on dense TypeScript files
- **perf:** reduce `INLINE_NODE_LIMIT` from 2000 → 400 in `build_symbol_graph` — prevents accidental ~4 MB inline graph payloads
- **feat:** add `limit` parameter to `find_dead_code`, `detect_code_smells`, `scan_security` — defaults to 100, use `0` for all; responses include `truncated` + `showing` when capped

---


## [2.0.5] — 2026-06-21 · patch

- **feat:** node highlight on hover in Dependency Graph — connected nodes stay bright, unconnected nodes dim to 10% opacity
- **feat:** Files page detail panel — click any file to see symbols, smells, and metadata in a side panel
- **feat:** 🌡️ Complexity Map page — D3 treemap (size = LOC, color = smells density, green → red) with tooltip
- **feat:** Dependency Graph search/filter — type to highlight matching nodes, dim everything else
- **feat:** Export JSON button on every Run Commands result tab — downloads raw data as `<cmd>-export.json`
- **feat:** Smells filter bar — filter by severity (error/warning/info) + file pattern
- **feat:** Security filter bar — filter by severity (critical/high/medium/low) + file pattern

---
## [2.0.4] — 2026-06-21 · patch

- **feat:** overhaul Dependency Graph in `ast-map serve` web UI — visible edges with directional arrows, file name labels on every node, node size/shade scaled by connection count (hub files are larger/brighter), scroll-to-zoom + drag-to-pan via `d3.zoom`, collision force to prevent overlap, tooltip shows full path + connection count

---


## [2.0.3] — 2026-06-21 · patch

- **fix:** resolve `Uncaught SyntaxError: Unexpected string` in `ast-map serve` web UI that made all Run Commands buttons inoperable — `\'` sequences inside the TypeScript template literal were being consumed to bare `'`, producing adjacent JS string literals the browser parser rejected; refactored `renderRun()` to use `data-cmd`/`data-run` attributes with delegated event listeners instead of inline `onclick`/`onkeydown` handlers

---

## [2.0.2] — 2026-06-21 · patch

- **feat:** interactive **Run Commands** page in `ast-map serve` web UI — 15 one-click analysis commands (dead exports, circular deps, duplicates, similar code, complexity, symbol search, change impact, file deps, explain symbol, code smells, security scan, arch rules, Mermaid diagram, Markdown docs, top symbols) with a two-panel layout: command palette on the left, closeable result tabs on the right

---

## [2.0.1] — 2026-06-21 · patch

- **fix:** add `prepare` script so `dist/` is built automatically on `npm install` (cloners no longer need a separate `npm run build`)
- **fix:** bump `hono` transitive dep via `npm audit fix` (path traversal + CORS issues in unused middleware; no runtime impact on stdio MCP server)
- **docs:** comprehensive README update — 44 MCP tools / 49 CLI commands, all v1.33–v2.0 features documented, `arch.rules` config, updated project layout, full changelog
- **ci:** `example-validate.yml` now builds from source instead of relying on published npm package; `action.yml` switches from `npx -p` to `npm exec --package` (npm 10 compatibility)

---

## [2.0.0] — 2026-06-20 · persistent index, live reload, TF-IDF rerank, auto-patch, arch rules, doc gen

### Breaking
- CLI version bumped to 2.0.0; MCP protocol surface is additive (backward-compatible).

### New CLI commands
- `ast-map index [dir]` — build/refresh `.ast-map/index.json` persistent skeleton cache (hash-based incremental rebuild, 10-100× faster on warm runs)
- `ast-map arch [dir]` — enforce architecture import rules from `.ast-map.json` `arch.rules`; exits non-zero on errors (CI-friendly)
- `ast-map patch [dir]` — interactive auto-patch: collects smells + security issues, calls Claude, shows colored unified diff, applies with `y/N` per issue (`-y` auto-accepts)
- `ast-map doc [dir]` — generate Markdown or HTML API reference from skeletons (`--html`, `--ai` with Claude descriptions, `--exported-only`)
- `find` command gains `--rerank` flag — TF-IDF cosine pre-ranking + Claude API re-ranking for better semantic search

### Enhanced
- `gatherSkeletons()` automatically reads from `.ast-map/index.json` when present and fresh (hash-verified) — all CLI commands benefit
- `ast-map serve` gains `--watch` option for SSE-based live reload (`/events` endpoint)
- Web UI (`ast-map serve`) auto-reconnects to SSE stream and refreshes on file changes

### New MCP tools (3 added)
- `build_index` — build or refresh the persistent skeleton index
- `check_arch_rules` — enforce `.ast-map.json` architecture rules, return structured violations
- `generate_docs` — produce Markdown or HTML API docs, optionally enhanced with Claude

### New source modules
- `src/indexstore.ts` — `buildIndex()`, `loadIndex()`, `saveIndex()`, `isIndexFresh()`, `getSkeletons()`
- `src/arch-rules.ts` — `checkArchRules()`, `loadArchRules()`, manual `globToRegex()` (no dependencies)
- `src/patch.ts` — `generatePatch()`, `interactivePatch()`, colored unified diff, readline y/N prompt
- `src/docgen.ts` — `buildDocOutput()`, `renderMarkdown()`, `renderDocHtml()`, `aiEnhanceDocs()`
- `src/embeddings.ts` — `buildTfIdfVectors()`, `cosineSearch()`, `rerankWithClaude()`

### Modified source modules
- `src/config.ts` — `AstMapConfig` gains `arch?: { rules: ArchRule[] }` field
- `src/serve.ts` — `ServeOptions` gains `watch?: boolean`; SSE `/events` endpoint added
- `src/webapp.ts` — EventSource client for live reload with auto-reconnect
- `src/ai-refactor.ts` — `callClaude` is now exported for reuse

### Tests
- 364 tests total (up from 296); 5 new test sections: Index Store, Arch Rules, Doc Generation, Embeddings/TF-IDF, Patch

---

## [1.35.0] — 2026-06-20 · explain, similar, incremental, coverage merge, plugins, web UI

### New CLI commands
- `ast-map explain <file> <symbol>` — structural explanation of any symbol: purpose, callers, deps, smells, change risk; `--ai` adds Claude prose explanation
- `ast-map similar [dir]` — find structurally similar/duplicate functions via AST fingerprinting (no AI)
- `ast-map serve [dir]` — interactive web SPA at `http://localhost:7337` — dark theme dashboard, D3 dependency graph, all analysis pages
- `ast-map covmerge <report>` — merge structural coverage map with actual Istanbul/lcov/Clover/Cobertura report
- `ast-map plugins [dir]` — run custom JS lint plugins from `.ast-map/plugins/`
- `--changed-since <ref>` flag on `smells` and `security` — incremental analysis via git diff

### New MCP tools (4 added)
- `explain_symbol` — structural + optional AI explanation of any symbol
- `find_similar` — AST fingerprint groups across a directory
- `merge_coverage` — Istanbul/lcov/Clover/Cobertura report merged with structural map
- `run_plugins` — load and run `.ast-map/plugins/*.mjs` custom rules

### New source modules
- `src/explain.ts` — `buildExplainResult()` + `aiExplain()` (Claude via node:https)
- `src/similar.ts` — `findSimilar()` with 7-component structural fingerprint
- `src/incremental.ts` — content-hash state + `filterToGitChanged()` + `detectChanges()`
- `src/covmerge.ts` — 4-format coverage parser + `mergeCoverage()` merger
- `src/plugins.ts` — `loadPlugins()` / `runPlugins()` / `EXAMPLE_PLUGIN` scaffold
- `src/serve.ts` — `startServe()` HTTP server with 10 REST endpoints + 5 s cache
- `src/webapp.ts` — self-contained SPA template (D3.js from CDN, dark theme, 8 pages)

### Other changes
- `ast-map init` now scaffolds `.ast-map/plugins/example.mjs` alongside the config
- 296 tests (up from 242), 0 failures

## [1.34.0] — 2026-06-20 · MCP tools, AI refactor, LSP server, PR comments, ast-map init

### New MCP tools (7 added)
- `detect_code_smells` — scan file/dir for 6 smell patterns; returns structured list
- `scan_security` — static scan with 12 rules; filterable by `min_severity`
- `generate_diagram` — Mermaid class/deps/modules diagram from any directory
- `get_fix_suggestions` — prioritised fix suggestions (P1–P3) from dead exports + smells + security
- `generate_tests` — test stubs for a single file (all 6 frameworks)
- `generate_tests_ai` — AI-enhanced tests via Claude API; falls back to stubs gracefully
- `ai_refactor` — sends smells/security to Claude; returns before/after code + explanation

### AI refactor (`src/ai-refactor.ts`)
- `ast-map fix --ai` — sends detected issues to Claude and returns concrete refactored code
- Structured `<before>/<after>/<explanation>` XML response format
- `aiRefactorBatch()` runs one API call per issue; failures degrade gracefully with `error` field
- `--limit <n>` caps API calls per run (default 3)

### LSP server (`src/lsp.ts`, binary `ast-map-lsp`)
- Full JSON-RPC 2.0 over stdio — no external LSP library, zero new npm deps
- `textDocument/publishDiagnostics` — dead exports (Warning), security issues (Error/Warning), smells (Warning/Information)
- `textDocument/codeLens` — cyclomatic complexity above every function/class (🔴 ≥20, 🟡 ≥10)
- VS Code extension updated to start LSP client (`vscode-languageclient`) on activation, falling back to on-save polling

### GitHub Actions PR comment (`action.yml`)
- New `mode: pr-comment` — posts/updates a health score comment on every PR
- Shows: score with delta (↑/↓/→), grade, files/symbols/dead/cycles/complexity/coverage table
- `github-token` input; automatically updates existing comment rather than posting duplicates

### `ast-map init` (new CLI command)
- Interactive wizard (readline) or `--defaults` for non-interactive
- Writes `.ast-map.json` with thresholds, smell limits, security min-severity, ignore patterns
- `--json` flag emits defaults without writing any file

### Tests
- `test/analysis.mjs` — +10 checks (AI refactor + LSP file existence); 242 total, 0 failed

## [1.33.0] — 2026-06-20 · AI testgen + VS Code extension

### AI-powered test generation (`src/ai-testgen.ts`)
- New `--ai` flag for `ast-map testgen` — sends source code + generated stubs to Claude API and
  returns tests with **real assertions** instead of TODO placeholders.
- Uses `node:https` (no new npm dep) to call `POST /v1/messages` on `api.anthropic.com`.
- Auto-reads `ANTHROPIC_API_KEY`; `--api-key` and `--model` flags override per invocation.
- `tryAiEnhanceTests()` never throws — falls back silently to stubs when key is absent.
- Terminal output appended with `[AI]` tag; JSON output includes `aiEnhanced: boolean`.

### VS Code Extension (`vscode-ext/`)
- New standalone VS Code extension project (`@ast-map/vscode`):
  - **Complexity Code Lens** — cyclomatic score shown above every function/class; yellow ≥10, red ≥20.
  - **Dead-export diagnostics** — high-confidence dead exports underlined as `Warning`.
  - **Security diagnostics** — critical/high issues shown as `Error`, medium/low as `Warning`.
  - **Issues Tree View** — sidebar panel listing smells and security issues across the workspace.
  - **Commands**: Generate Tests, Generate Tests (AI), Run Smells, Scan Security, Show Diagram, Open Report.
  - **Status Bar** — shows live health score `AST B 82`; opens report on click.
  - Configuration: `astMap.cliPath`, `astMap.enableCodeLens`, `astMap.enableDiagnostics`, `astMap.anthropicApiKey`.

### Tests
- `test/analysis.mjs` — +9 checks for `ai-testgen.ts` (graceful fallback, shape, 232 total, 0 failed).

## [1.28.0] — 2026-06-11 · Test coverage in the dashboard
- The health dashboard (`ast-map report` / `get_codebase_report`) now surfaces
  v1.27's structural test coverage:
  - **Test coverage card** — coverage bar (tested/total sources, % colored
    green ≥ 70 / amber ≥ 40 / red below) + the **untested sources ranked by
    risk** (fan-in Ca, then symbol count), capped at 12 with a "+N more" note.
  - **Test coverage stat tile** in the header grid.
- **Root fallback** — reporting on `src/` only (no test files in the scanned
  dir)? Test files are pulled in from the project root automatically and the
  card notes "(from project root)".
- **Health score** now includes a structural-coverage penalty (capped at 8
  points, proportional to the untested share).
- `ReportData` gains `testCoverage` (testFiles, sourceFiles, testedSources,
  coverageRatio, untestedCount, untested[], rootFallback) — additive.
- CLI `ast-map report` summary line now shows `tests N%`.
- Tests: +6 checks in `test/analysis.mjs` (159 total).

## [1.27.0] — 2026-06-11 · Test-coverage mapping
- **New MCP tool `get_test_coverage`** + **CLI `ast-map tests [dir]`** (alias
  `coverage`) — structural test coverage with zero instrumentation: which source
  files have tests at all, and which have **none**.
- Two pairing signals:
  - **import** — a test file imports the source file (graph edge; definitive).
  - **name** — conventions: `auth.test.ts` → `auth.ts`, `auth_test.go`,
    `test_utils.py` → `utils.py`, `AuthTest.java` → `Auth.java`,
    `foo-smoke.mjs` → `foo.*`, and bare `test/<name>.*` → `<name>.*`;
    ambiguity resolved by longest shared path prefix.
- Test files detected by directory (`test/`, `tests/`, `__tests__/`, `spec/`, `e2e/`)
  or basename pattern; **fixtures/mocks/testdata dirs excluded from both sides**.
- Output: coverage ratio, test→source `links` (with `via`), `tested`,
  **`untested` ranked by risk** (fan-in Ca, then symbol count — load-bearing
  files with no tests first), and `orphanTests` (no source matched; usually
  integration/e2e).
- CLI: `-u/--untested`, `--links`, `-n/--top`, `--json`.
- New module `testmap` (`mapTestCoverage`, `isTestFile`, `testNameTarget`,
  `isFixtureFile`) + `test/fixtures/testmap/` fixture tree. Tests: +9 checks
  in `test/analysis.mjs` (153 total). **30 MCP tools / 32 CLI commands.**

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
