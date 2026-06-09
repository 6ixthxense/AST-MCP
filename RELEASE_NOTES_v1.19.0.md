# v1.19.0 — Dashboard: coupling + SDP

v1.14–1.16 added per-file coupling, module coupling, and Stable-Dependencies-Principle
checks as tools. v1.19.0 brings them into the **premium health dashboard** so you see
them at a glance.

## ✨ What's new in `ast-map report` / `get_codebase_report`

- **Module coupling** card — per-directory instability bars (with Ca / Ce), so you can
  see which directories are the stable core and which are volatile at a glance.
- **Layer violations** card — the stable→volatile dependencies (SDP inversions), worst
  first, each tagged with its severity (instability gap).
- **SDP violations** stat tile alongside Files / Symbols / Cycles / Dead exports.
- SDP inversions now **factor into the health score** (small, capped penalty): a codebase
  that systematically depends "uphill" on the stability gradient grades lower.

It's still a single self-contained HTML file — no external scripts, dark-mode aware.

## 🔧 API
`ReportData` gains `layerViolations` and `modules`. Purely additive — the existing
fields are unchanged.

## 🧪 Tests
4 new assertions (131 total): the report carries the new data and the rendered HTML
includes both new cards. All suites green.

## 🔄 Breaking changes
None — additive. **27 MCP tools / 28 CLI commands / 5 MCP prompts / 14 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.19.0
```

---
**npm:** [universal-ast-mapper@1.19.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.19.0)
