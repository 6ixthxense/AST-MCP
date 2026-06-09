# v1.14.0 — Coupling metrics (Ca / Ce / instability)

AST-MCP already maps *what depends on what*. v1.14.0 quantifies it with Robert C.
Martin's classic coupling metrics, per file, straight from the import graph.

## ✨ `get_coupling` / `ast-map coupling`

- **Afferent coupling (Ca)** — fan-in: how many files depend on this one.
- **Efferent coupling (Ce)** — fan-out: how many files this one depends on.
- **Instability** `I = Ce / (Ca + Ce)` — 0 = stable (load-bearing, break carefully), 1 = unstable (volatile, changes freely).

```bash
ast-map coupling src -n 6
#  Ca   Ce   I      File
#  27   0    0.00   src/types.ts     ← load-bearing core
#  0    21   1.00   src/cli.ts       ← volatile entrypoint
#  8    12   0.60   src/registry.ts
```

A stable core (`types.ts`, I=0) that everything imports and a volatile shell
(`cli.ts`/`index.ts`, I=1) is exactly the shape you want — the metric makes it
visible and lets you catch the inversions (stable code that depends on volatile code).

## 🧪 Tests
4 new assertions (109 total): stable file (I=0), unstable file (I=1), middle
(I=0.5), and the [0,1] bound. All suites green.

## 🔄 Breaking changes
None — additive. **25 MCP tools / 26 CLI commands.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.14.0
```

---
**npm:** [universal-ast-mapper@1.14.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.14.0)
