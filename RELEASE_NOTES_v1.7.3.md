# v1.7.3 — Explorer layout overhaul

The graph kept bunching in a corner because **orphan files** (no import edges in
the scanned scope — test fixtures, scripts, entrypoints) sprawled under
repulsion and blew up the bounding box, shrinking the real graph into a corner.

Fixed by separating the two:

- **Connected files** are force-laid and centered — the dependency graph now
  fills the viewport.
- **Orphan files** are parked in a compact, dimmed grid just below the graph,
  instead of floating everywhere.
- Auto-fit is computed over the whole tidy layout; verified centered and on-screen
  at both small (preview-pane) and full-window sizes.

Double-click to re-fit; pan/zoom/drag hands control back.

```bash
npm install -g universal-ast-mapper@1.7.3
```
