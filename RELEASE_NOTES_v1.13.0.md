# v1.13.0 — Context-pack

The token-efficiency play, made explicit. Instead of an agent reading whole
files to work on one symbol, ask for the **minimal context pack**.

## ✨ `pack_context` / `ast-map pack`

```bash
ast-map pack src/auth.ts login
```

For a target symbol it returns:

- **primary** — the symbol's own source (exact line range),
- **dependencies** — the **signatures** of what it imports/uses (you rarely need
  the whole dependency file, just the shape),
- **dependents** — the files that depend on the symbol,
- a **token estimate** of the pack.

```text
Context Pack — src/auth.ts::login  (~56 tokens)
  Primary  lines 8-12
  Depends on:
    src/utils.ts
      function hashPassword(plain: string): string
  Depended on by:
    src/router.ts
```

A focused, bounded starting context for "understand / change X" — a fraction of
the tokens of reading the files involved.

## 🤖 MCP

New `pack_context` tool (server now **24 tools**) so an agent can open a task with
one call and a tight context budget.

## 🧪 Tests

Five new assertions in `test/analysis.mjs` (primary range, dependency signatures,
dependents, small token estimate). All suites green.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.13.0
```
