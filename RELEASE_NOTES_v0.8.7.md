# v0.8.7 — Python decorators in the call graph

Decorators are how a lot of Python frameworks wire code together — FastAPI/Flask
routes (`@router.get(...)`), Click commands, `@staticmethod`/`@property`,
caching. They're invisible in a plain call graph because they aren't calls in
the function body. This release surfaces them.

## ✨ Decorator capture

Function, method, and class symbols now carry a **`decorators`** field — the
decorator expressions in source order, without the leading `@`:

```python
@router.get("/items/{id}")
async def get_item(id):
    return fetch(id)
```

```jsonc
// get_skeleton_json / get_call_graph for get_item
{
  "function": "get_item",
  "decorators": ["router.get(\"/items/{id}\")"],
  "calls": [ { "callee": "fetch", "line": 3 } ]
}
```

- Surfaced in **skeletons** (both `outline` and `full` detail) and in
  **`get_call_graph`**, so you can trace `@router.get(...)` → handler.
- **Stacked decorators** are captured in order
  (`@staticmethod` + `@functools.lru_cache` → `["staticmethod", "functools.lru_cache"]`).

This release is Python-focused (TS/JS decorators use a different AST shape and
are planned for a later release).

## 🧪 Tests

Four new assertions in `callgraph-smoke` (route decorator captured, body call
still captured, stacked decorators). All suites green.

## 🔄 Breaking changes

None — `decorators` is an additive optional field.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.7
```

---

**npm:** [universal-ast-mapper@0.8.7](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.7)
