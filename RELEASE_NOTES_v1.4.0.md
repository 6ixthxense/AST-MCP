# v1.4.0 — Dynamic import tracking

Static `import` statements were always captured; lazy/conditional loads were not.
v1.4.0 closes that gap: **dynamic `import("...")` and CommonJS `require("...")`**
calls now show up in a file's imports, so code-split routes and runtime-loaded
modules are part of the dependency picture.

## ✨ What's captured

Anywhere in a file (inside functions, arrow bodies, conditionals), a call to:

- `import("./module")` — dynamic ESM import
- `require("./module")` / `require("pkg")` — CommonJS

…is added to the skeleton's `imports` with **`isDynamic: true`**:

```jsonc
{ "symbol": "*", "from": "./lazy-route", "isNamespaceImport": true, "isDynamic": true }
```

Only **string-literal** specifiers are captured (computed `require(expr)` is
skipped — there's nothing static to resolve). Relative dynamic imports flow
through resolution and graphing exactly like static ones, so:

- **`resolve_imports`** resolves `import("./x")` to its file,
- **`build_symbol_graph`** draws an edge for it,
- **`get_change_impact`** / **`find_dead_code`** see lazy-loaded dependencies
  (a module only ever `import()`-ed is no longer mis-reported as dead).

## 🧪 Tests

Six new assertions in `test/analysis.mjs` (dynamic `import()`, nested `import()`,
relative + bare `require()`, and that static imports aren't mis-flagged). All
five suites green.

## 🔄 Breaking changes

None — additive `isDynamic` flag.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.4.0
```

---

**npm:** [universal-ast-mapper@1.4.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.4.0)
