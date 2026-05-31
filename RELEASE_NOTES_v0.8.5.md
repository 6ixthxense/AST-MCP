# v0.8.5 — Cyclomatic complexity

A new "deeper analysis" capability: per-function **cyclomatic complexity**, so an
agent (or a CI check) can spot the functions most likely to hide bugs and most
in need of refactoring — without reading the whole file.

## ✨ New analysis

**MCP tool:** `get_complexity` — score every function/method in a file or
directory. For directories it also returns the highest-complexity **hotspots**
across the scan.

**CLI:** `ast-map complexity <path>` (alias `cx`), with `--min N` to show only
functions at or above a threshold, and `--json`.

Complexity = `1 + decision points`, where a decision point is an `if`, `for`,
`while`, `switch`/`case` arm, `catch`/`except`, ternary, or short-circuit
`&&`/`||`. Each function gets a rating:

| Rating | Score |
|---|---|
| `low` | ≤ 5 |
| `moderate` | ≤ 10 |
| `high` | ≤ 20 |
| `very-high` | > 20 |

It works across all 12 languages via a shared decision-point set, and is computed
by line range, so a function's score includes the control flow of any closures
declared inside it.

```text
$ ast-map complexity src --min 10
Cx    Rating       Function                File
68    very-high    buildCallGraph          src/callgraph.ts
37    very-high    collectCalls            src/callgraph.ts
33    very-high    handle                  src/extractors/cpp.ts
```

## 🧪 Tests

Six new assertions in `test/analysis.mjs` (exact scores for a trivial and a
branchy function, ratings, sort order, and `maxComplexity`). All suites green.
The MCP server now exposes **16 tools**; the CLI has **15 commands**.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.5
```

---

**npm:** [universal-ast-mapper@0.8.5](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.5)
