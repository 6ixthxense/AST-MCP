# v1.2.0 — File-level cross-package resolution

v1.1.0 discovered the packages in a monorepo. v1.2.0 follows the imports *between*
them down to the actual file: a bare import of a workspace package now resolves
to real source, so the dependency graph spans package boundaries.

## ✨ Cross-package imports resolve to files

When the project is a monorepo (workspace detected via v1.1.0), a bare specifier
that names a workspace package is resolved to that package's **source file**:

- `import { x } from "@org/utils"` → `packages/utils/src/index.ts`
- `import { y } from "@org/utils/helpers"` → `packages/utils/src/helpers.ts`

Resolution prefers real **source** over built output: it follows
`source` / `module` / `types` / `main` / `exports` hints and conventional
`src/index.*` roots, and rewrites a declared `.js` entry to its `.ts` sibling
when present. Subpaths resolve against the package's source root (the entry
file's directory), then the package dir.

This flows into the existing tools automatically:

- **`resolve_imports`** marks `@org/utils` as **in-project** (`importKind: "relative"`,
  `found: true`) with the resolved file, instead of "external".
- **`build_symbol_graph`** draws **cross-package edges** — the symbol graph now
  spans the whole monorepo, so `get_change_impact`, `find_dead_code`,
  `find_circular_deps`, and `get_top_symbols` all see across package boundaries.

External packages (`lodash`, etc.) are untouched — they stay external.

## 🧪 Tests

New assertions in `resolver-smoke` (exact + subpath resolution, in-project flag)
and `graph-smoke` (cross-package symbol edges). All suites green.

## 🔄 Breaking changes

None — additive. Non-monorepo projects are unaffected (workspace discovery finds
no packages and resolution is a no-op).

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.2.0
```

---

**npm:** [universal-ast-mapper@1.2.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.2.0)
