# v1.11.0 — Code-health dashboard

A premium, at-a-glance view of a codebase's health — one self-contained HTML page
you can open, share, or attach to a PR.

## ✨ `ast-map report`

```bash
ast-map report          # → ast-report.html
ast-map report src -o health.html
ast-map report --json   # the same data as JSON
```

The dashboard shows:

- a **health grade (A–F)** and score, computed from dead code, cycles, complexity,
  and god-node concentration;
- headline **stats** — files, symbols, import edges, average/max complexity, dead
  exports, cycles;
- **language breakdown** bars;
- **complexity hotspots** (worst functions, colour-coded by rating);
- **god nodes** — the most-imported symbols (highest blast radius);
- **dead exports** and **circular dependencies** lists.

It's a single HTML file with inline styles, no dependencies, light/dark aware.

## 🤖 `get_codebase_report` MCP tool

The same summary as structured JSON, so an agent can get a whole-repo health read
in one call. The MCP server now exposes **21 tools**.

## 🧪 Tests

Eight new assertions in `test/analysis.mjs` (grade/score ranges, language
breakdown, cycle detection, hotspot ordering, self-contained HTML). All green.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.11.0
```
