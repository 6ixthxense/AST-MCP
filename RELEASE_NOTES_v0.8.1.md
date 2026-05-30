# v0.8.1 — Cross-file graph wiring for Kotlin & C/C++

The follow-up promised in v0.8.0: the new systems/mobile languages now trace
**cross-file edges**, not just local symbols. Kotlin and C/C++ join Java, C#,
Rust, and Go in the symbol graph, import resolver, and call graph.

## ✨ Cross-language resolution

| Language | Mechanism | What now resolves |
|---|---|---|
| **Kotlin** | FQCN index (mirrors Java) | `import com.example.Foo` → declaring `.kt` file; wildcard `import com.example.*` → all files in the package; constructor/factory calls resolve across packages |
| **C / C++** | `#include "..."` filesystem walk | local `#include "foo.h"` → in-project header, plus automatic header→impl pairing (`foo.h` ↔ `foo.c`/`.cpp`/`.cc`/`.cxx`). System headers (`<stdio.h>`, `<vector>`, …) stay external |

`buildCrossLangIndex` gained `kotlinFqcn` + `kotlinPackages` maps; `resolveCrossLangTarget`
now dispatches `kotlin`, `c`, and `cpp`; `buildSymbolGraph`, `resolveFileImports`,
and `buildCallGraph` all include the three new languages in their cross-lang sets.

## 🐛 Fixes

- **Parse-cache rel-path leak (correctness).** The in-process parse cache is keyed
  by `<absPath>|<detail>` and stored the whole `SkeletonFile`, including its `.file`
  field — which is set from the *first* caller's `relPath`. When the same absolute
  file was parsed under a different root (a different rel path), the cache returned a
  skeleton with a stale `.file`, poisoning the cross-lang index (it produced doubled
  paths like `multi/kotlin/src/multi/kotlin/src/...`). The cache now overrides `.file`
  per call, so the same file can be safely resolved under multiple roots.
- **Kotlin call graph.** Kotlin's `function_declaration` exposes its name as a
  `simple_identifier` child rather than a `name` field, so `get_call_graph` couldn't
  locate functions; and Kotlin `call_expression` has no `function` field, so calls
  (e.g. `Inventory(...)`) weren't captured. Both are now handled, so Kotlin call
  graphs resolve callees across packages.

## 🧪 Tests

All four suites green, including new Kotlin and C/C++ assertions in
`resolver-smoke`, `graph-smoke`, and `callgraph-smoke`.

## 🧭 Still scoped for later

Swift cross-file wiring remains local-only (symbol extraction + imports only).
Ruby still blocked on the unstable `tree-sitter-wasms@0.1.13` grammar.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.1
```

---

**npm:** [universal-ast-mapper@0.8.1](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.1)
