# v1.29.0 — Graph Explorer UI Upgrade

## What's new

### Directed arrowheads on edges
Every import edge now has an arrowhead at the target node. Dependency direction
is immediately visible without needing to know which end is source vs. target.

### Zoom-adaptive labels
Node labels now appear based on zoom level:
- **All nodes labelled** when zoomed in (k > 1.4)
- **Symbol-rich nodes** labelled at mid-zoom (k > 0.7, ≥ 8 symbols)
- **Large nodes** (≥ 14 symbols) always labelled, as before

### Coupling metric bars in the detail panel
Ca (fan-in), Ce (fan-out), and I (instability) are now displayed as colour-coded
progress bars instead of plain numbers. Colours: green = stable, amber = mixed,
red = volatile (I ≥ 0.8).

### Instability ring
In the default "folder colour" mode, nodes with I ≥ 0.8 get a subtle red ring
so architectural hotspots are visible without switching colour mode.

### Node pinning
Double-click a node to pin it — the simulation stops moving it and a small pink
dot appears above it. Double-click again to unpin. Double-click on empty canvas
resets the view (same as before).

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| `Esc` | Deselect node, clear search filter |
| `/` or `f` | Focus search input |
| `F` / `Home` | Fit view |
| `d` | Toggle debug overlay |

### Fit button
A ⊞ fit button appears in the toolbar for one-click re-centring.

### Pinch-to-zoom
Touch events are now wired up, so the explorer works on tablets/mobile.

### Edge hover highlight
Edges connected to the hovered node are drawn at 50% opacity (vs. 15% for the
rest), making neighbourhood relationships visible on hover without clicking.

### Richer tooltip
The hover tooltip now shows Ca, Ce, I values and a pinned indicator, rendered
as multi-line HTML.
