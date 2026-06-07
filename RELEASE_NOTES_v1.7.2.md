# v1.7.2 — Explorer fit (for real)

The v1.7.1 fit was incomplete — the graph still bunched in a corner. Fixed:

- **Continuous auto-fit** until you interact (the earlier version stopped fitting
  after a fixed number of frames, freezing a bad view).
- **Robust canvas sizing** — falls back to the window size if the canvas reports
  zero at load (which left every node initialized at the origin / top-left).
- **Centered node init** + slightly stronger centering so stray nodes don't drift.

Double-click still re-fits; any pan/zoom/drag hands control back to you.

```bash
npm install -g universal-ast-mapper@1.7.2
```
