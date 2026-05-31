# v0.8.6 — Unused parameter detection

Find dead weight in function signatures: **named functions and methods that
declare a parameter they never use**. Useful for spotting leftover args after a
refactor and tightening interfaces.

## ✨ New analysis

**MCP tool:** `find_unused_params` — scan a file or directory.
**CLI:** `ast-map unused-params <path>` (alias `unused`), `--json` supported.

Built to keep **false positives near zero**:

- only **named** functions/methods are checked — anonymous callbacks (event
  handlers, `map`/`reduce` indices) are skipped, since an unused param there is
  usually required by the caller's signature;
- `_`-prefixed params (and `_`, `this`, `self`) are treated as intentionally
  unused;
- destructured / rest / splat bindings are skipped rather than guessed;
- object **shorthand** (`return { id, label }`) is correctly counted as a use —
  this was the one subtle trap, and it's handled.

Dogfooding the tool on AST-MCP's own `src/` reports **zero** unused params after
the shorthand handling — exactly what you want from a low-noise linter.

## 🧪 Tests

Five new assertions in `test/analysis.mjs` (a genuinely unused param is flagged,
used params and `_`-prefixed params are not, and object-shorthand counts as a
use). `analysis.mjs` is green at 41/41.
The MCP server now exposes **17 tools**; the CLI has **16 commands**.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.6
```

---

**npm:** [universal-ast-mapper@0.8.6](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.6)
