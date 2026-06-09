# v1.18.0 — Vue & Svelte single-file components

AST-MCP mapped 12 languages. v1.18.0 adds **Vue (`.vue`) and Svelte (`.svelte`)
single-file components** — bringing the component layer of a frontend app into the
same skeletons and dependency graph as everything else.

## ✨ How it works

An SFC isn't a tree-sitter grammar we ship. Instead the `<script>` / `<script setup>`
block is lifted out and parsed with the existing TS/JS extractor (TypeScript when
`lang="ts"`, JavaScript otherwise). The trick that keeps it honest: everything
outside the script is **blank-padded** — each non-newline character replaced with a
space — so the script keeps its exact byte offset, line, and column. Every extracted
symbol range still points at the right spot in the original `.vue` / `.svelte` file.

```bash
ast-map skeleton Counter.vue        # interface Props, function increment, …
ast-map graph .                     # Counter.vue → helpers.ts::formatLabel
```

- Component **symbols** (functions, interfaces, consts) and **imports** are extracted.
- **Cross-file graph edges** wire a component into plain `.ts` modules and into other
  components; the resolver now resolves `.vue` / `.svelte` import targets.
- `list_supported_languages` now reports `vue` and `svelte` — **14 languages** total.

## 🧪 Tests
8 new assertions (127 total) with Vue + Svelte fixtures: language detection, script
symbol extraction, import capture from `<script setup>`, and cross-file import edges
into a shared module. All suites green (incl. the 5 stdio smoke suites).

## 🔄 Breaking changes
None — additive. New `.vue` / `.svelte` extensions and `vue` / `svelte` languages.
**27 MCP tools / 28 CLI commands / 5 MCP prompts / 14 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.18.0
```

---
**npm:** [universal-ast-mapper@1.18.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.18.0)
