# v1.7.0 — Web UI graph explorer

AST-MCP has always produced a dependency graph as JSON. v1.7.0 makes it
**visual**: `ast-map explore` turns any directory into a self-contained,
interactive HTML graph you can open in a browser — no build step, no server, no
external scripts.

## ✨ `ast-map explore`

```bash
ast-map explore src
# → wrote src/ast-explorer.html
ast-map explore packages -o graph.html
```

Open the file in any browser. It renders a **force-directed file dependency
graph**:

- **nodes** = source files, sized by symbol count, coloured by top-level folder
- **edges** = import relationships between files
- **drag** nodes to rearrange, **scroll** to zoom, **drag the canvas** to pan
- **click** a file to highlight its dependencies and dependents
- **filter** files by name with the search box
- hover for the full path, symbol count, and language

It's a single HTML file (~14 KB for this repo) with the graph data embedded and a
tiny vanilla-JS canvas force simulation inline — **zero dependencies**, works
offline, safe to commit or share.

## 🧪 Tests

Six new assertions in `test/analysis.mjs` (self-contained output, embedded graph
data, node/link counts match the symbol graph). All suites green.

## 🔄 Breaking changes

None — new `explore` command; everything else unchanged.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.7.0
```

---

**npm:** [universal-ast-mapper@1.7.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.7.0)
