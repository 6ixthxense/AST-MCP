# v1.8.2 — Explorer stability fix

The real reason the graph kept shrinking into a corner: a **force-layout
blow-up**. When two file nodes happened to initialize very close together, the
repulsion term `2200 / distance²` became enormous and flung a node to coordinates
in the thousands. That exploded the bounding box, so auto-fit zoomed all the way
out (min zoom) and the actual graph collapsed into a tiny cluster in the corner.
(Small graphs sometimes got lucky with their random start and looked fine — which
is why it was intermittent.)

Fixed by clamping the simulation:

- **Distance floor** — repulsion is capped (minimum effective distance), so the
  force can never spike.
- **Velocity cap** — a node can't move more than a fixed amount per frame.

Verified on the full repo (87 files): max node coordinate stays bounded, the
graph centers exactly, and fills the viewport.

```bash
npm install -g universal-ast-mapper@1.8.2
```
