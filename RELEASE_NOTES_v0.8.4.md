# v0.8.4 — Duplicate symbol detection

A new analysis that surfaces **name collisions**: symbols exported under the
same name from more than one file. These are usually accidental — copy-paste,
parallel implementations, or a refactor that left two versions behind — and they
make a codebase harder to navigate and easier to mis-import.

## ✨ New analysis

**MCP tool:** `find_duplicate_symbols` — scan a directory, return every exported
name declared in 2+ files, each with the list of files and kinds that declare it.

**CLI:** `ast-map duplicates <dir>` (alias `dupes`), `--json` supported.

```jsonc
{
  "duplicateCount": 1,
  "duplicates": [
    {
      "symbol": "validate",
      "count": 2,
      "locations": [
        { "file": "src/auth/a.ts", "kind": "function" },
        { "file": "src/legacy/b.ts", "kind": "function" }
      ]
    }
  ]
}
```

Only **exported** symbols are considered, and a name must appear in at least two
**distinct files** to count. Results are sorted by collision count, then name.
The MCP server now exposes **15 tools**; the CLI has **14 commands**.

## 🧪 Tests

Five new assertions in `test/analysis.mjs` (duplicate across two files,
cross-kind collisions, and that unique names are excluded). All suites green.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.4
```

---

**npm:** [universal-ast-mapper@0.8.4](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.4)
