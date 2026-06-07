# v1.8.0 — Explorer detail sidebar

The graph explorer (`ast-map explore`) gets a **detail side panel**. Click any
file node and a sidebar slides in with everything about that file:

- **language** and **symbol count**
- the file's **symbols** (kind + name)
- **Imports** — the files this file depends on
- **Imported by** — the files that depend on this file

Every file in the Imports / Imported-by lists is **clickable** — click to select
and centre that file, so you can walk the dependency chain hop by hop. The graph
auto-fits the remaining space when the panel is open; close it (× or double-click
the canvas) to go back to full width.

Still a single self-contained HTML file with zero dependencies.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.8.0
```
