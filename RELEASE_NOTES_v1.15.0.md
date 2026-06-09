# v1.15.0 — Layer-violation detection (Stable Dependencies Principle)

v1.14.0 measured each file's instability. v1.15.0 uses it to catch a specific
design smell: **stable code that depends on volatile code**.

## ✨ `get_layer_violations` / `ast-map layers`

Robert C. Martin's **Stable Dependencies Principle**: a module should depend only
on modules at least as stable as itself. When a *stable* file (low instability,
lots of things depend on it) imports a *volatile* file (high instability, it
depends on lots of things), the dependency points "uphill" — and every time the
volatile file churns, it drags the stable file with it.

```bash
ast-map layers src
#  0.24  src/skeleton.ts (I=0.36) → src/registry.ts (I=0.60)
#  0.22  src/graph.ts    (I=0.33) → src/resolver.ts (I=0.55)
```

Severity = the instability gap the dependency crosses. `-g 0.3` shows only the
worst inversions; `--json` for machine output. A clean codebase prints
`✓ No SDP violations`.

## 🧪 Tests
5 new assertions (114 total): the clean graph fixture yields no violations, and a
synthetic stable→volatile graph yields exactly one with the right severity and
direction. All suites green.

## 🔄 Breaking changes
None — additive. **26 MCP tools / 27 CLI commands.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.15.0
```

---
**npm:** [universal-ast-mapper@1.15.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.15.0)
