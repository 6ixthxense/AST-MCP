# v1.9.0 — Watch mode

A live feedback loop for your codebase's structure.

## ✨ `ast-map watch`

```bash
ast-map watch src
ast-map watch . -o graph.html
```

Watches a directory and, on every source-file change (debounced, coalesced),
recomputes the dependency analysis and prints a one-line status:

```text
Watching src/  (Ctrl+C to stop)
5:53:54 AM  31 files · 2 dead · 1 cycle(s)  initial
5:53:56 AM  32 files · 3 dead · 1 cycle(s)  (resolver.ts changed)
```

It reacts only to known source extensions and ignores `node_modules` / `dist` /
`.git` / `.ast-map`. With `-o file.html` it also **regenerates the interactive
explorer** on each change, so you can keep the graph open and refresh to see the
latest structure.

## 🧹 Explorer cleanup

The debug readout added while chasing the fit bug is now **hidden by default** —
press `d` to toggle it if you ever need W/H/zoom/bbox.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.9.0
```
