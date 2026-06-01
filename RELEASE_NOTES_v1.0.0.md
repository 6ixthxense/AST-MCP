# v1.0.0 — Stable release 🎉

AST-MCP is **1.0**. The public surface — MCP tool names and schemas, and the
`ast-map` CLI — is now locked for the `1.x` line, and the engine spans 12
languages with a full skeleton + dependency-graph + deep-analysis toolkit.

## 🔒 Stable API guarantee

For the `1.x` line:

- **MCP tools** — names and input schemas are stable. New tools and new
  *optional* inputs may be added; nothing existing is removed or renamed.
- **CLI** — commands and flags are stable; additions are allowed.
- **Skeleton JSON** — evolves additively; new *optional* fields (e.g. `props`,
  `decorators`) may appear without a major bump.

Not public: the internal `src/` module layout and the generated HTML markup.

## 🤖 GitHub Action — architecture gate in CI

A bundled composite action (`action.yml`) runs `ast-map validate` as a pull-request
gate:

```yaml
- uses: 6ixthxense/AST-MCP@v1.0.0
  with:
    path: src
    max-lines: "400"
    max-imports: "20"
    max-exports: "15"
```

A project CI workflow (`.github/workflows/ci.yml`) builds and runs all five test
suites on every push/PR.

## 📊 What 1.0 ships

**12 languages** — TypeScript · TSX · JavaScript · Python · Go · Rust · Java ·
C# · C · C++ · Kotlin · Swift, with cross-file graph + resolver wiring.

**18 MCP tools / 17 CLI commands**, including the deep-analysis suite built up
across the 0.8.x–0.9.0 line:

- **complexity** — cyclomatic complexity per function (ratings + hotspots)
- **duplicate symbols** — same exported name in 2+ files
- **unused params** — never-referenced parameters (low false-positive)
- **Python decorators** — `@router.get(...)` → handler, in skeleton + call graph
- **type flow** — trace a named type through params / returns / variables / fields

…on top of the originals: skeletons, symbol graph, file deps, dead code,
circular deps, change impact, call graph, symbol search, top symbols, and
architecture validation.

## 🧭 Deferred beyond 1.0

- **Ruby** — blocked on a broken `tree-sitter-ruby.wasm` (ABI mismatch with
  `web-tree-sitter@0.20.8`); waiting on an upstream grammar fix.
- **VS Code extension** and **browser graph UI** — separate front-end projects,
  tracked for the post-1.0 roadmap.
- **TS/JS decorators** and **monorepo cross-package resolution** — planned.

## 🔄 Breaking changes

None vs 0.9.0. 1.0.0 is a stability milestone, not a rewrite.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.0.0
```

---

**npm:** [universal-ast-mapper@1.0.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.0.0)
