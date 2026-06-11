# universal-ast-mapper v1.27.0 — Test-coverage mapping

## ✨ What's new

### `get_test_coverage` (MCP) / `ast-map tests` (CLI, alias `coverage`)
Structural test coverage with **zero instrumentation** — no test runner, no
coverage tooling, works on a cold checkout:

```bash
ast-map tests .
#  Covered: 7/52 (13%) of source files have at least one test
#
#  Untested sources (by risk: fan-in, then symbols)
#  Ca    Syms   File
#  32    7      src/types.ts        ← load-bearing and untested
#  19    14     src/parser.ts
#  ...
```

**Two pairing signals:**
- **import** — a test file imports the source file (graph edge; definitive).
- **name** — conventions across languages: `auth.test.ts` → `auth.ts`,
  `auth_test.go`, `test_utils.py` → `utils.py`, `AuthTest.java` → `Auth.java`,
  `foo-smoke.mjs` → `foo.*`, bare `test/<name>.*` → `<name>.*`.
  Ambiguity resolves to the candidate sharing the longest path prefix.

**Smart classification:** test files detected by directory (`test/`, `tests/`,
`__tests__/`, `spec/`, `e2e/`, …) or basename; **fixtures / mocks / testdata
directories are excluded from both sides** so sample code doesn't pollute the
map. Test files that match nothing are reported as `orphanTests` (usually
integration/e2e suites).

**Risk-ranked output:** untested sources sorted by fan-in (Ca), then symbol
count — the load-bearing files nothing tests come first.

**CLI options:** `-u/--untested` · `--links` (show every test→source pair) ·
`-n/--top N` · `--json`.

> This is file-level coverage ("does anything test this file?"), not line
> coverage. It answers the triage question line coverage can't ask on an
> uninstrumented repo: *where are the blind spots?*

## 🔧 Internals
- New module `src/testmap.ts` (`mapTestCoverage`, `isTestFile`,
  `testNameTarget`, `isFixtureFile`).
- New fixture tree `test/fixtures/testmap/`. Tests: +9 checks in
  `test/analysis.mjs` — **153 total, all green**.

## 📦 Surface
**30 MCP tools / 32 CLI commands / 5 MCP prompts.** Additive only — no
breaking changes.
