# v0.8.2 — Swift cross-file wiring

Completes the v0.8.x arc: every language that shipped in v0.8.0 (C, C++, Kotlin,
Swift) now traces **cross-file edges**, not just local symbols. Swift was the
last one still local-only — this release wires it in.

## ✨ Swift module resolution

| Mechanism | What resolves |
|---|---|
| **Module index** (`Sources/<Module>/` directory, else parent dir) | `import <Module>` → all `.swift` files in that in-project module, wired into `build_symbol_graph` and `resolve_imports` |

Swift has no per-file `package` declaration, so the module is derived from the
file's path by SwiftPM convention: the segment right after `Sources/`, falling
back to the immediate parent directory for flat layouts. `import Inventory`
from one module now draws an edge to the `Inventory` module's files. System
modules (`Foundation`, `UIKit`, `SwiftUI`, …) have no in-project directory and
correctly stay **external**.

Like Go/C#/C/C++, Swift module imports are **file-level** (the import doesn't
name an individual symbol), so call-graph callee origin and reverse `calledBy`
remain limited for Swift — graph and resolver edges are the deliverable here.

## 🧪 Tests

New Swift assertions in `resolver-smoke` (module import resolves, `Foundation`
stays external) and `graph-smoke` (Service → Inventory module edge). All four
suites green.

## 🧭 Still scoped for later

Ruby (blocked on the unstable `tree-sitter-wasms@0.1.13` grammar) and TSX
component-prop extraction remain on the v0.8.x / backlog list.

## 🔄 Breaking changes

None.

## 📦 Install

```bash
npm install -g universal-ast-mapper@0.8.2
```

---

**npm:** [universal-ast-mapper@0.8.2](https://www.npmjs.com/package/universal-ast-mapper/v/0.8.2)
