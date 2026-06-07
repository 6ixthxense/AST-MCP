# v1.8.1 — Explorer self-heal sizing

Defensive fix for the graph explorer rendering small in a corner when the canvas
reports a zero size at load (or after the container resizes). The render loop now
re-measures the canvas each frame and re-fits when the size changes, so the graph
reliably centers and fills the viewport.

If you still see an old layout, it's a cached file — hard-refresh (Ctrl/Cmd+Shift+R)
or re-open the freshly generated HTML.

```bash
npm install -g universal-ast-mapper@1.8.1
```
