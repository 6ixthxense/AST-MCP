# v1.16.0 — Module coupling (directory-level)

Per-file coupling (v1.14.0) is precise but noisy on a big repo. v1.16.0 zooms out:
the same metrics aggregated to the **directory/module level**, plus the edges
between modules.

## ✨ `get_module_coupling` / `ast-map modules`

Every file's directory is its module. Imports that stay inside a directory are
ignored; only dependencies that cross a module boundary count. You get per-module
**Ca / Ce / instability** and the **weighted inter-module edges**:

```bash
ast-map modules src
#  Files  Ca  Ce  I      Module
#  27     1   1   0.50   src
#  11     1   1   0.50   src/extractors
#  Inter-module dependencies:
#    src/extractors → src (75)
#    src → src/extractors (26)
```

This is the architectural bird's-eye view: which directories are load-bearing,
which are volatile, and how heavily they lean on each other.

## 🧪 Tests
5 new assertions (119 total): a three-module `ui → api → core` gradient with the
expected stability ordering (core I=0, api I=0.5, ui I=1) and that intra-module
edges are excluded. All suites green.

## 🔄 Breaking changes
None — additive. **27 MCP tools / 28 CLI commands.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.16.0
```

---
**npm:** [universal-ast-mapper@1.16.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.16.0)
