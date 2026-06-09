# universal-ast-mapper v1.22.0 — PHP & Ruby support

## ✨ What's new

### PHP (`.php`)
Full extractor: **classes** (incl. abstract), **interfaces**, **traits**,
**enums** (with cases), **methods** (visibility from `public/protected/private`
modifiers), class **constants** and **properties**, top-level **functions**,
namespaces (braced and statement form). Imports: `use App\Models\User;`,
**grouped** `use App\Util\{Str, Arr};` (expanded with the group base), aliases
(`use X as Y`), and `require`/`include` (`*_once` variants) as side-effect
imports.

### Ruby (`.rb`, `.rake`)
Full extractor: **classes**, **modules** (→ `namespace`), **methods**,
**`self.` singleton methods**, top-level functions, `CONSTANT = ...`
assignments. Visibility tracks Ruby's **section style** — everything after a
bare `private`/`protected` is marked private until the next `public`.
Imports: `require 'json'` (external) and `require_relative './helper'`
(normalized to a relative path for graph resolution).

### Runtime: web-tree-sitter 0.20.8 → 0.21.0
The Ruby grammar in `tree-sitter-wasms@0.1.13` crashes on 0.20.8 (its external
scanner needs runtime functions the old WASM host didn't provide). Upgrading to
**0.21.0** fixes Ruby with no API changes; all existing grammars and the full
test matrix were re-verified (smoke, analysis ×131, graph, resolver, callgraph,
cache, check — all green).

## 🧪 Tests
Two new fixtures (`Sample.php`, `sample.rb`) with **30 new smoke assertions**
covering symbol kinds, PHP visibility modifiers, Ruby visibility sections,
grouped `use` imports, and require/require_relative.

## 🔄 Breaking changes
None — additive. **28 MCP tools / 30 CLI commands / 5 MCP prompts / 16 languages.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.22.0
```

---
**npm:** [universal-ast-mapper@1.22.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.22.0)
