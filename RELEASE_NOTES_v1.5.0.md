# v1.5.0 — `.d.ts` & ambient declarations

Type-definition files were a blind spot: a `.d.ts` full of `declare`d API
produced **zero symbols**. v1.5.0 parses ambient declarations, so the typed
surface of a library — or your own `declare module` augmentations — shows up in
the skeleton.

## ✨ What's now extracted

- `declare function foo(): T` → **function**
- `declare const X: T` (no initializer) → **const**
- `declare class Service { … }` / `export declare class …` → **class** (+ its methods)
- `declare module "my-lib" { … }` → **namespace** (string-named), with its exports nested inside
- `declare namespace Foo { … }` and plain `namespace Foo { … }` → **namespace**, with children nested

All declared members surface as **exported** (they are the public typed API), and
nested declarations are attached as children of their module/namespace.

```text
namespace:my-lib
  function:doThing
  const:VERSION
function:globalHelper
const:CONFIG
namespace:MyNS
  function:inner
class:Service
  method:run
```

A new **`namespace`** symbol kind is added to the schema (additive). As a bonus,
regular (non-ambient) `namespace Foo { … }` blocks in `.ts` files are now
extracted too.

## 🧪 Tests

Eight new assertions in `test/analysis.mjs` (module → namespace, nested function,
ambient function/const, `declare namespace`, `export declare class` + method, and
that a non-empty `.d.ts` no longer yields 0 symbols). All five suites green.

## 🔄 Breaking changes

None — additive: a new optional `namespace` kind, plus symbols where there were
none before.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.5.0
```

---

**npm:** [universal-ast-mapper@1.5.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.5.0)
