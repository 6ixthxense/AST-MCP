# v1.12.0 — Git-aware analysis

Adds a **time / history dimension** the engine never had: what changed, what it
might break, and where the risk is concentrated.

## ✨ `ast-map diff` + `get_diff`

Compare the working tree to a git ref (default `HEAD`):

```bash
ast-map diff HEAD           # what changed vs the last commit
ast-map diff v1.11.0        # what changed since a release
```

Returns, per changed file, the symbols **added / removed / modified**, flags
potentially **breaking changes** (removed exports, signature-changed exports),
and computes the **blast radius** — files that depend on the breaking symbols.
Untracked new files count as additions.

```text
Diff since HEAD  (3 files · +15 ~0 -0)
  src/gitdiff.ts [added]
    + isGitRepo (exported)
    + computeDiff (exported)
  ⚠ Breaking changes (2)
    foo  signature changed  src/a.ts
  1 file(s) impacted: src/b.ts
```

## ✨ `ast-map risk` + `get_risk_map`

Rank files by **refactor risk = git churn × max complexity** — the files that
are both changed often and complex (the best refactor/test targets):

```text
Risk   churn×cx   File
483    7 × 69     src/callgraph.ts
168    6 × 28     src/extractors/typescript.ts
```

## 🤖 MCP

Two new tools — `get_diff` and `get_risk_map` — so an agent can review a PR's
impact or find risk hotspots in one call. The server now exposes **23 tools**.

## 🧪 Tests

Seven new assertions in `test/analysis.mjs` (an isolated temp git repo: added /
removed / signature-changed symbols, breaking detection, blast radius, and the
risk map). All suites green.

## 🔄 Breaking changes

None. Both commands require a git repo; outside one they report a clear message.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.12.0
```
