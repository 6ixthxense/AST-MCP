# universal-ast-mapper v1.28.0 — Test coverage in the dashboard

## ✨ What's new

### The health dashboard now shows your testing blind spots
`ast-map report` / `get_codebase_report` surface v1.27's structural test
coverage right on the dashboard:

- **Test coverage card** — a coverage bar (tested/total sources, colored
  green ≥ 70% / amber ≥ 40% / red below) followed by the **untested sources
  ranked by risk** — fan-in (Ca) first, then symbol count — so the
  load-bearing files nothing tests are at the top. Capped at 12 with a
  "+N more" note.
- **Test coverage stat tile** in the header grid, next to dead exports,
  cycles and SDP violations.
- **Health score** now includes a structural-coverage penalty (capped at
  8 points, proportional to the untested share) — a repo where most source
  files have no tests at all scores lower.

### Root fallback — `ast-map report src` just works
Reports are usually run on `src/` only, where there are no test files. The
dashboard now detects this and **pulls test files in from the project root
automatically**, pairing them with the scanned sources; the card notes
"(from project root)".

## 🔧 Internals
- `ReportData` gains `testCoverage` (testFiles, sourceFiles, testedSources,
  coverageRatio, untestedCount, untested[], rootFallback) — purely additive.
- CLI `ast-map report` summary line shows `tests N%`.
- Still a single self-contained HTML file, dark-mode aware.
- Tests: +6 checks in `test/analysis.mjs` — **159 total, all green**.

## 📦 Surface
No new tools/commands — enhances `ast-map report` + `get_codebase_report`.
Additive only; health scores may shift slightly due to the new coverage
penalty (re-anchor CI baselines with `ast-map check --update-baseline` after
upgrading).
