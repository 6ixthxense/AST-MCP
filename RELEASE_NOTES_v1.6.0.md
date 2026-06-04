# v1.6.0 — MCP resource endpoints

Until now AST-MCP only spoke in **tools** (the agent calls a function, gets a
result). v1.6.0 adds **resources** — addressable, browseable views of the
codebase that an MCP client can list and read directly, the way you'd browse
files in a sidebar.

## ✨ Browseable resources

| URI | What it returns |
|---|---|
| `ast://languages` | supported languages + file extensions |
| `ast://skeleton/{path}` | the normalized skeleton (symbols, imports, ranges) for one source file |
| `ast://graph` | the whole-root symbol dependency graph |

- **`ast://skeleton/{path}`** is a templated resource: `resources/list` enumerates
  **every source file under the root** as its own resource, so a client can show
  the whole project as a list and read any file's structure on demand — no tool
  call, no arguments.
- **`ast://graph`** inlines the full symbol graph, guarded by file count (very
  large repos get a pointer to `build_symbol_graph` on a subdirectory instead).
- Path resolution is sandboxed to `AST_MAP_ROOT`, same as the tools.

Why it matters: resources are **discoverable and cacheable** by MCP clients —
they show up in the client's resource browser, can be attached to a prompt by
the user, and don't burn a tool round-trip just to look at one file's shape.

## 🧪 Tests

New `test/resources-smoke.mjs` — a stdio integration test that boots the server
and exercises `resources/list`, `resources/templates/list`, and `resources/read`
for both a static and a templated resource (7 checks). Wired into CI. All suites
green.

## 🔄 Breaking changes

None — purely additive; the 19 tools are unchanged.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.6.0
```

---

**npm:** [universal-ast-mapper@1.6.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.6.0)
