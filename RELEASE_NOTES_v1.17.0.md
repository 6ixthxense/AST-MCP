# v1.17.0 — MCP prompts (recipes, one call away)

AST-MCP has 27 tools and a Cookbook of recipes that chain them. Until now you had
to paste a recipe to run one. v1.17.0 makes those recipes **first-class MCP
prompts** — named, parameterized workflows your client can invoke straight from
its prompt/slash menu.

## ✨ Five prompts

| Prompt | Args | What it does |
|--------|------|--------------|
| `architecture_audit` | `dir?` | God Nodes → cycles → rule violations → module coupling → SDP breaks, then a prioritized summary |
| `safe_refactor` | `file`, `symbol` | blast radius → call graph → minimal context before changing a symbol |
| `dead_code_cleanup` | `dir?` | unused exports, each verified zero-impact before deletion |
| `health_check` | `dir?` | grade A–F → risk map → layer violations, with the 3 files to fix first |
| `onboard_codebase` | `dir?` | languages → structure → core symbols → module map, as a "start here" guide |

Each prompt returns a ready-to-run instruction that references the server's own
tools, with your arguments interpolated:

```
safe_refactor(file="src/auth.ts", symbol="login")
→ "Before refactoring `login` in `src/auth.ts`, gather the impact:
   1. get_change_impact … 2. get_call_graph … 3. pack_context …"
```

## 🧪 Tests
New `test/prompts-smoke.mjs` (12 checks): `prompts/list` returns all five,
`prompts/get` interpolates arguments, rendered prompts reference real tools, and
defaults resolve. Wired into CI. All suites green.

## 🔄 Breaking changes
None — additive. The server now declares the **prompts** capability alongside
tools and resources. **27 MCP tools / 28 CLI commands / 5 MCP prompts.**

## 📦 Install
```bash
npm install -g universal-ast-mapper@1.17.0
```

---
**npm:** [universal-ast-mapper@1.17.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.17.0)
