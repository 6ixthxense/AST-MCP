# v0.8.3 — TSX/React component props

Skeletons now understand React components: a component symbol carries the
**props it accepts**, so an agent can see a component's API without reading the
file or chasing the props type across the module.

## ✨ Component prop extraction

For `.tsx`/`.ts`/`.jsx` files, a symbol is treated as a React component when its
name is **PascalCase** and it either **returns JSX** or is typed as
`React.FC<P>` / `FC<P>` / `FunctionComponent<P>`. Such symbols gain:

| Field | Meaning |
|---|---|
| `propsType` | the named props type, e.g. `ButtonProps` (omitted for inline object types) |
| `props[]` | the prop fields: `{ name, type?, optional? }` |

Props are resolved from:

- a **named props type** (`function Button(p: ButtonProps)` or
  `const Card: React.FC<CardProps> = …`) looked up against same-file
  `interface` / `type` declarations, or
- an **inline object type** (`function Inline({ a }: { a: string; b?: number })`).

Optional props (`disabled?: boolean`) are flagged `optional: true`, and the
declared type text is preserved (e.g. `onClick: () => void`). Non-components
(lowercase helpers, plain functions) are untouched.

```jsonc
// Button({ label, onClick, disabled }: ButtonProps)
{
  "name": "Button", "kind": "function",
  "propsType": "ButtonProps",
  "props": [
    { "name": "label", "type": "string" },
    { "name": "onClick", "type": "() => void" },
    { "name": "disabled", "type": "boolean", "optional": true }
  ]
}
```

## 🐛 Fix

- **Server version.** The MCP server advertised a hardcoded `0.5.3` in its
  handshake. It now reads the real version from `package.json` at runtime, so it
  never drifts from the published version again.

## 🧪 Tests

Nine new TSX assertions in `smoke` covering named-type props, `React.FC` arrows,
inline object types, optional flags, and non-component exclusion. All suites green.

## 🔄 Breaking changes

None — `propsType` and `props` are additive optional fields on `SymbolNode`.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.3
```

---

**npm:** [universal-ast-mapper@0.8.3](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.3)
