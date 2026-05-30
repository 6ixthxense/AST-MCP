# v0.8.0 — Systems & Mobile Languages

**+4 new languages → 12 total.** C, C++, Kotlin, and Swift land with full symbol extraction and imports parsing.

## ✨ New languages

| Language | Symbols | Imports | Notes |
|---|---|---|---|
| **C** | ✅ | `#include` | `static` → `private` visibility; macros via `#define` → `const` |
| **C++** | ✅ | `#include` | `access_specifier` (`public:`/`private:`/`protected:`) tracked through class bodies; `namespace` recursed and flattened; `struct` defaults to public, `class` defaults to private (correct C++ semantics) |
| **Kotlin** | ✅ | `import` | `package` directive captured; `object` singletons → `class`; wildcard imports detected; default visibility = public (Kotlin convention) |
| **Swift** | ✅ | `import` | `class`/`struct`/`enum` all use the same `class_declaration` node — disambiguated by source-text prefix; `protocol_declaration` → `interface`; `init` constructor → method |

## 🧠 Architectural touch — `insideClass` context

`function_declaration` inside a class body is a *method*, not a *function*. Same for `property_declaration` (`field` not `var`). The new extractors thread an `insideClass: boolean` through their `collect()`/`handle()` calls so kinds normalize consistently with the existing Java/C# extractors. The same flag was applied to Kotlin too — properties of `object Constants { const val MAX = 100 }` now surface as `field:MAX`, matching every other language.

## 🧪 Known limitations

- **Ruby** is *not* shipping in this release. The Ruby grammar bundled in `tree-sitter-wasms@0.1.13` crashes during parse (`Cannot read properties of undefined` inside the WASM runtime) even on minimal samples. Planned for a future release once a stable grammar lands.
- **Graph wiring** for the 4 new languages is local-only — i.e. `build_symbol_graph`, `resolve_imports` enrichment, `get_call_graph` callee resolution, and reverse `calledBy` don't yet trace cross-file edges for C/C++/Kotlin/Swift. The four resolvers (`#include` for C/C++, package for Kotlin, module for Swift) are scoped for v0.8.x.

## 🔄 Breaking changes

None. All existing tool schemas and prior-language behavior are unchanged.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.0
```

## 📊 By the numbers

- **12 languages** (TS/JS/TSX/Python/Go/Rust/Java/C#/C/C++/Kotlin/Swift)
- **80+ assertions** across 4 test suites, all green
- 4 new extractors: 207 + 276 + 169 + 204 lines
- 1 new file: `src/extractors/{c,cpp,kotlin,swift}.ts`
- Zero changes to consumers — the `LanguageEntry` registry pattern absorbed it all

---

**Full changelog:** [`f162b96...HEAD`](https://github.com/6ixthxense/AST-MCP/compare/f162b96...main)
**npm:** [universal-ast-mapper@0.8.0](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.0)
