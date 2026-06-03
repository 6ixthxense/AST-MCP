# v1.3.0 — TS/JS decorators

v0.8.7 captured Python decorators; this release brings the same to
**TypeScript/JavaScript**, so framework wiring in Angular, NestJS, TypeORM, and
friends is visible in the skeleton and call graph.

## ✨ Decorator capture for TS/JS

Class and method symbols now carry a **`decorators`** field — the decorator
expressions in source order, without the leading `@`:

```ts
@Component({ selector: "app" })
export class AppComponent {
  @Get("/items/:id")
  async getItem(id: string) { … }
}
```

```jsonc
// AppComponent → decorators: ["Component({ selector: \"app\" })"]
// getItem      → decorators: ["Get(\"/items/:id\")"]
```

- Handles both attachment shapes — decorators as **preceding siblings** (classes,
  methods) and as **leading children**.
- Surfaced in **skeletons** (outline + full) and **`get_call_graph`** (the call
  graph already reads `decorators`, so a NestJS route handler shows its
  `@Get(...)` automatically).

Decorated plain *properties* (`@Input() name`) aren't surfaced yet — those fields
aren't skeleton symbols today; class- and method-level decorators (the framework
wiring that matters most) are covered.

## 🧪 Tests

Three new assertions in `test/analysis.mjs` (class decorator, method decorator,
and undecorated method has none). All five suites green (incl. full `smoke`).

## 🔄 Breaking changes

None — additive `decorators` field, per the 1.x stability guarantee.

## 📦 Install

```bash
npm install -g universal-ast-mapper@1.3.0
```

---

**npm:** [universal-ast-mapper@1.3.0](https://www.npmjs.com/package/universal-ast-mapper/v/1.3.0)
