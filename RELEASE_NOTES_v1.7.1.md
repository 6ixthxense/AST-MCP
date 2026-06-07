# v1.7.1 — Explorer fit fix

Patch on v1.7.0's graph explorer. The graph clustered in the centre and left
most of the screen empty; now it **auto-fits the viewport** so the whole graph
fills the available space.

- Auto-fit runs while the layout settles, then hands control to the user.
- Roomier force layout (stronger node repulsion, weaker centering) so nodes
  spread out instead of bunching.
- **Double-click** the canvas to re-fit at any time.
- Any pan/zoom/drag stops auto-fit so it never fights your interaction.

No API changes.

```bash
npm install -g universal-ast-mapper@1.7.1
```
