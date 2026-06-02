# v1.1.0 — Monorepo support

The first post-1.0 feature, and the long-planned one: AST-MCP now understands
**monorepos**. Point it at a workspace root and it discovers the packages and how
they depend on each other.

## ✨ `analyze_workspace`

**MCP tool:** `analyze_workspace` — discover packages + internal dependency graph.
**CLI:** `ast-map workspace [dir]` (alias `ws`), `--json` supported.

Detects packages from:

- **npm / yarn** `workspaces` (array or `{ packages: [...] }`)
- **pnpm** `pnpm-workspace.yaml`
- **lerna** `lerna.json`

Glob patterns (`packages/*`, `apps/**`) are expanded to the package directories.
For each package it reports the name, directory, and **workspace-internal
dependencies** (deps whose name is another package in the same monorepo — across
`dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`;
external deps like `lodash` are ignored). It also detects **circular package
dependencies**.

```text
$ ast-map workspace .
Workspace — .  (npm, 3 package(s))
  Package     Dir           Internal deps
  @demo/a     packages/a    → @demo/b
  @demo/b     packages/b    (no internal deps)
  @demo/c     packages/c    → @demo/a, @demo/b
  3 internal edge(s)
```

This is the foundation of the monorepo line; file-level cross-package import
resolution and a unified multi-root symbol graph build on top of it.

## 🧪 Tests

Nine new assertions in `test/analysis.mjs` (discovery across all dep types,
external-dep exclusion, edge count, acyclic check, and synthetic cycle
detection). All suites green. The MCP server now exposes **19 tools**; the CLI
has **18 commands**.

## 🔄 Breaking changes

None — additive, per the 1.x stability guarantee.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.1.0
```

---

**npm:** [universal-ast-mapper@1.1.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.1.0)
