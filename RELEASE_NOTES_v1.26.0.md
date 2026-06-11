# universal-ast-mapper v1.26.0 — Coupling overlay in the explorer

## ✨ What's new

### `ast-map explore` — color by coupling
The interactive graph explorer gains a **color mode dropdown**:

- **`color: folder`** — the existing per-directory hues (default).
- **`color: coupling`** — every node shaded by its **instability**
  I = Ce/(Ca+Ce) on a green → yellow → red scale:
  - 🟢 **I = 0, stable** — pure dependency targets (everyone imports them;
    break carefully).
  - 🔴 **I = 1, volatile** — pure consumers (they churn when anything below
    them changes).
  - Orphan files (no in-scope edges) stay gray.

A **legend** appears in coupling mode, and the hover tooltip + detail sidebar
now show **Ca / Ce / I** for every file — the same Robert C. Martin metrics as
`get_coupling`, computed from the deduped file-level import edges.

One glance now answers: *which files are load-bearing, and which are the
volatile hotspots riding on top of them?*

## 🔧 Internals
- Explorer nodes carry `ca` / `ce` / `inst` in the embedded `DATA` payload.
- Still a single self-contained HTML file — no external scripts, dark-mode aware.
- Tests: +5 checks in `test/analysis.mjs` — **144 total, all green**.

## 📦 Surface
No new tools/commands — enhances `ast-map explore` (and the MCP-side explorer
HTML). Additive only; no breaking changes.
