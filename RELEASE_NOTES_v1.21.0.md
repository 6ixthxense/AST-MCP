# universal-ast-mapper v1.21.0 — Quality gate (`ast-map check`)

## ✨ What's new

### `ast-map check` — a real CI gate
One command that **fails the build when code quality regresses**:

```bash
ast-map check src --update-baseline   # anchor today's metrics (commit the file)
ast-map check src                     # CI: non-zero exit on any regression
```

Two complementary mechanisms:

- **Baseline ratchet** — compares against a committed `.ast-map.baseline.json`
  and fails when **cycles, dead exports, SDP violations, very-high-complexity
  functions** go up or the **health score** goes down. Re-anchor with
  `--update-baseline` after deliberate changes.
- **Absolute thresholds** — `--max-cycles`, `--max-dead-exports`,
  `--max-sdp-violations`, `--max-very-high-complexity`, `--max-complexity`,
  `--min-score`, or set them once in `.ast-map.config.json` under `"check"`.

`--json` emits the full gate result (metrics, baseline, failures) for tooling.

### New MCP tool: `check_quality_gate`
Same gate, callable by agents — thresholds from project config, optional
`updateBaseline`, returns metrics + baseline + structured failures. **28 tools.**

### GitHub Action: gate mode
`action.yml` gains `mode: validate | check | both` and `check-args`, so the
existing marketplace action can run the quality gate directly:

```yaml
- uses: 6ixthxense/AST-MCP@v1
  with: { path: src, mode: check }
```

## 🔧 API
New module `check`: `runQualityGate`, `metricsFromReport`, `BASELINE_FILENAME`,
plus `CheckMetrics` / `CheckThresholds` / `CheckResult` types.
`AstMapConfig` gains `check` thresholds. All additive.

## 🧪 Tests
New `test/check-smoke.mjs` (13 checks): thresholds, baseline write/ratchet,
regression detection (introduces a real cycle + dead export in a sandbox
project), re-anchoring, custom baseline path. Wired into `npm test`.

## 🔄 Breaking changes
None — additive. **28 MCP tools / 30 CLI commands / 5 MCP prompts / 14 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.21.0
```

---
**npm:** [universal-ast-mapper@1.21.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.21.0)
