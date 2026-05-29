# v0.7.0 — Universal Language Coverage

Big release: **3 new languages, every analysis tool wired for all 8**, and a clean cross-language resolver pattern that makes adding more cheap.

> Combines the v0.6.0 work (Rust / Java / C#) with the v0.7.0 work (Go full resolution + C# reverse `calledBy`) into one shipping version.

## ✨ New languages

| Language | Symbols | Imports | Graph edges | `resolve_imports` | Call graph | Reverse `calledBy` |
|---|---|---|---|---|---|---|
| **Rust** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Java** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **C#** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

…and **Go** is now first-class everywhere, not just symbol-level:

| Language | Before v0.7.0 | After v0.7.0 |
|---|---|---|
| Go imports → graph edges | skipped | resolved via `go.mod` |
| Go `resolve_imports` enrichment | external only | in-project files surfaced |
| Go reverse `calledBy` | import-statement match only | + call-site scan |

## 🧠 The architectural change — `crosslang.ts`

The original resolver only understood `./` style relative paths. Three of the new languages don't use relative paths at all:

- **Rust** uses crate-relative module walks (`crate::foo::Bar`, `super::baz`).
- **Java** uses fully-qualified class names (`com.example.Inventory`).
- **C#** uses namespace imports that don't name the type (`using App.Models;`).

The new `src/crosslang.ts` exposes one function that handles all four cross-lang languages (Rust/Java/C#/Go):

```ts
resolveCrossLangTarget(imp, skel, fromAbs, root, index)
  → { kind: "symbol", file, symbol }
  | { kind: "file", files: string[] }
  | null
```

Every consumer (`graph.ts` second pass, `resolver.ts` enrichment, `callgraph.ts` callee origin + reverse lookup) dispatches by language and calls this same function. A project-wide index (Java FQCN map, C# namespace map, C# types-by-fqn map) is built lazily on first cross-lang resolve and cached for the server's lifetime.

**Adding a new language is now:**
1. Write `src/extractors/<lang>.ts` (symbols + imports + optional directives).
2. Add one entry to `src/registry.ts`.
3. If the language doesn't use relative paths, add a branch to `resolveCrossLangTarget`.

That's it. No changes to graph, call graph, resolver, or any MCP tool.

## 🔍 Reverse `calledBy` via call-site scanning

C# `using App.Models;` and Go `import "x/y/z"` both make symbols visible *without naming them*. Symbol-level import matching can't find callers. v0.7.0 adds a call-site scanning pass for these two languages: every candidate file is parsed and its call expressions checked against the target function name. C#'s `Inventory.Increment` is now correctly found in `Service.cs` even though `Service.cs` only `using`s the namespace.

## 🧪 Test harness

Four end-to-end test suites, **80+ assertions across all 8 languages**, all green:

- `npm run smoke` — symbol extraction for every language
- `node test/graph-smoke.mjs` — cross-language `imports` edges
- `node test/resolver-smoke.mjs` — `resolveFileImports` enrichment
- `node test/callgraph-smoke.mjs` — cross-language call graph (forward + reverse)

Multi-file fixtures live in `test/fixtures/multi/{java,csharp,rust,go}/` — a tiny Cargo project, a mini Java cross-package import, a C# `using`-based namespace setup, and a Go module.

## 🔄 Breaking changes

None. All v0.5.x tool schemas are unchanged. Existing TS/JS/Python/Go projects parse identically to before.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.7.0
```

## 🙏 Thanks

Two refactors in this release made everything else easy:
- Tree-sitter WASM grammars give us 100+ languages "for free" — adding a language is now an integration task, not a parsing task.
- The lazy per-root `CrossLangIndex` cache means we pay the project-scan cost once per server lifetime, regardless of how many tools fan out from a single AI-agent question.

---

**Full changelog:** [`c0412e4...f162b96`](https://github.com/6ixthxense/AST-MCP/compare/c0412e4...f162b96)
**npm:** [universal-ast-mapper@0.7.0](https://www.npmjs.com/package/universal-ast-mapper/v/0.7.0)
