# v1.10.0 — Source-map support

Trace compiled output back to its origins. Point AST-MCP at a built `dist/`
file and it'll tell you which source files it came from.

## ✨ Read source maps

**MCP tool:** `read_source_map` · **CLI:** `ast-map sourcemap <file>`

```bash
ast-map sourcemap dist/bundle.js
# Source Map — dist/bundle.js  (inline)
#   ← ../src/app.ts
#   ← ../src/util.ts
```

- Handles **inline** maps (`//# sourceMappingURL=data:...base64,...`) and
  **external** `.map` files.
- Honors `sourceRoot`, and reports whether the map embeds `sourcesContent`.
- Sandboxed to `AST_MAP_ROOT` like every other path.

Useful for connecting a stack trace or a built artifact back to the real source,
or confirming what a bundle actually includes.

## 🧪 Tests

Six new assertions in `test/analysis.mjs` (inline + external maps, `sourceRoot`,
embedded content, and no-map → null). All suites green. MCP server now exposes
**20 tools**.

## 🧭 Ruby — still blocked (investigated again)

Re-confirmed: Ruby's tree-sitter grammar uses an external scanner that needs
web-tree-sitter ≥0.22; the bundled wasm, the `@vscode` ruby wasm, and a newer
engine all fail under our pinned 0.20.8, and upgrading the engine would risk all
12 working languages. Deferred until a compatible prebuilt wasm exists.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.10.0
```
