# v0.9.0 — Scoped type-flow tracing (deeper-analysis suite complete)

The last analysis capability on the road to 1.0: **follow a type through the
code**. Given a type name, see everywhere it flows — into functions as
parameters, out of them as return types, and where it's held in typed variables
and class fields.

## ✨ `trace_type`

**MCP tool:** `trace_type` — scan a directory for a named type.
**CLI:** `ast-map trace-type <type> [dir]` (alias `flow`), `--json` supported.

It captures four roles:

| Role | Example |
|---|---|
| `return` | `function make(): Inventory` |
| `param` | `function use(inv: Inventory)` |
| `variable` | `const store: Inventory = …` |
| `field` | `class Svc { item: Inventory }` |

It's **AST-based, not full type inference** — it tracks where a type is *named*
in a signature, which is exactly what you want for "where does `Inventory` flow?"
without the cost and fragility of whole-program inference. Named types
(`type_identifier`) are traced; primitives like `number` are intentionally
skipped to keep the signal clean. Designed around TS/Python, but return/param
types resolve in any language that annotates them (it already lights up Rust and
Swift fixtures).

## 🎯 Deeper-analysis suite is now complete

`trace_type` joins the analysis tools shipped across the 0.8.x line:

dead code · circular deps · change impact · **complexity** · **duplicate
symbols** · **unused params** · **Python decorators** · **type flow**

The MCP server now exposes **18 tools**.

## 🧪 Tests

Six new assertions in `test/analysis.mjs` (each of the four roles, total count,
and primitive-type exclusion). All suites green.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.9.0
```

---

**npm:** [universal-ast-mapper@0.9.0](https://www.npmjs.com/package/universal-ast-mapper/v/0.9.0)
