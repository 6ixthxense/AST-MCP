# universal-ast-mapper v1.25.0 — Semantic symbol search

## ✨ What's new

### `semantic_search` (MCP) / `ast-map find` (CLI)
Find symbols by **meaning**, not exact name — for when you know what the code
*does* but not what it's called:

```bash
ast-map find "remove expired cache entries" src/
#  1.000  clearAliasCaches           (delete≈clear, cach)
#  0.730  clearDiskCache             (delete≈clear, cach~cache)

ast-map find "find unused exported code" src/
#  1.000  findDeadExports            (find, unused≈dead, export)
```

**No embeddings, no network, no model downloads.** Pure lexical semantics:

- **Identifier tokenization** — camelCase / PascalCase / snake_case / kebab-case,
  digit and acronym boundaries: `getHTTPServerByID` → `get http server by id`.
- **Programming thesaurus** — 60 tight synonym groups: `fetch≈get≈load≈retrieve`,
  `remove≈delete≈clear`, `unused≈dead≈orphan`, `auth≈login≈session`, and more.
- **Light stemming + fuzzy matching** — `users` matches `user`, typos and
  near-tokens caught at edit distance ≤ 1.
- **BM25-style ranking** — corpus IDF (rare tokens weigh more), field weighting
  (symbol name > doc comment > signature > file path), match-type weighting
  (direct > synonym > fuzzy), full-coverage bonus, and length normalization so
  focused names (`login`) outrank composites (`handleLogin`).

Every result carries a normalized `score` (0–1) and `matchedTerms` that explain
*why* it matched (`unused≈dead` = synonym hit, `cach~cache` = fuzzy hit).

**Options:** `limit` (default 20) · `kind` filter · `exportedOnly`.

## 🔧 Internals
- New module `src/semantic.ts` (`semanticSearch`, `splitIdentifier`, `stem`).
- Scans with `detail: "full"` so doc comments and signatures join the corpus;
  uses the persistent parse cache, so warm runs skip parsing entirely.
- Tests: +8 checks in `test/analysis.mjs` — **139 total, all green**.

## 📦 Surface
**29 MCP tools / 31 CLI commands / 5 MCP prompts.** Additive only — no breaking
changes.
