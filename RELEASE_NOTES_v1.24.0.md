# universal-ast-mapper v1.24.0 — TS path-alias resolution

## ✨ What's new

`@/components/Button` finally resolves. Bare imports are now matched against
**`compilerOptions.paths`** from the **nearest** `tsconfig.json` / `jsconfig.json`
above the importing file:

- **Nearest-config lookup** — monorepo-safe: a sub-package's `jsconfig.json`
  overrides the repo root's `tsconfig.json`. Configs are cached per process.
- **`extends` chains** — relative `extends` followed (child `paths` replace the
  parent's, exactly like TypeScript).
- **TS matching semantics** — longest-prefix wins, single-`*` substitution,
  exact (star-less) keys, `baseUrl` honored, then the usual extension /
  `index.*` / `.js→.ts` probing.
- **String-aware JSONC parser** — comments and trailing commas are stripped
  with a character walk, never regex. (Found the hard way: in a stock Next.js
  config, regex stripping pairs the `/*` inside `"@/*"` with the `*/` inside
  `"**/*.ts"` and silently corrupts the file.)

Wired everywhere imports are resolved: `resolve_imports`, `build_symbol_graph`
(graph edges), `get_call_graph` (callee origin + reverse `calledBy`) — which
means dead-code, cycles, impact, coupling, SDP, and the report/explorer all
see through aliases now.

## 📊 Real-world effect
On a production Next.js app (186 files) that uses `@/*` everywhere:

| metric | before | after |
|--------|--------|-------|
| import graph edges | 31 | **324** |
| dead exports | 210 | **153** |
| top god node | `useLocale` ×6 | `prisma` ×39 |

## 🔧 API
New module `tsconfig` (`aliasCandidates`, `clearAliasCaches`);
`resolveAliasedImport` exported from the resolver. All additive.

## 🧪 Tests
New `test/tsalias-smoke.mjs` (15 checks): pattern matching, extends chains,
nearest-config override, JSONC + `**/*` glob regression, `resolve_imports`
enrichment, and graph-edge wiring. All suites green.

## 🔄 Breaking changes
None — additive. **28 MCP tools / 30 CLI commands / 5 MCP prompts / 16 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.24.0
```

---
**npm:** [universal-ast-mapper@1.24.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.24.0)
