# v1.8.3 — Explorer sizing from the viewport

Final piece of the explorer-fit saga. The canvas size was being read from
`getBoundingClientRect()`, which can report a wrong/zero size in some host
environments (embedded viewers, certain load timings) — leaving the graph tiny in
a corner. Since the canvas is a viewport-filling fixed element, it now sizes
straight from `innerWidth` / `innerHeight` (minus the toolbar), which is reliable.

- Canvas + fit now derive from the window viewport, not the measured rect.
- A small debug readout (bottom-left) shows the live `W/H/zoom/fit/bbox` so any
  remaining sizing issue is visible at a glance.
- Verified centered and filling even when `getBoundingClientRect()` returns zero.

```bash
npm install -g universal-ast-mapper@1.8.3
```
