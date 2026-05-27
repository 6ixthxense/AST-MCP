# AST-MCP — Universal Code Skeleton & Dependency Graph Server

An MCP (Model Context Protocol) server that turns source code into structured, machine-readable skeletons and **symbol-level dependency graphs** — so AI agents can reason about large codebases without reading every file.

Built on [tree-sitter](https://tree-sitter.github.io/) (WASM grammars). Zero regex guessing — real AST parsing.

**Supported:** TypeScript / TSX / JavaScript (ESM, CJS), Python, Go.

---

## What it does

| Capability | Tool |
|---|---|
| Parse file → normalized JSON skeleton | `get_skeleton_json` / `generate_skeleton` |
| Extract every import statement (symbol + path) | Built into every skeleton automatically |
| Resolve imports → target symbol + signature | `resolve_imports` |
| Build symbol-level dependency graph | `build_symbol_graph` |
| Extract exact source lines of any symbol | `get_symbol_context` |
| Validate Next.js App Router architecture | `validate_architecture` |

---

## Install & Build

Requires Node.js 18+.

```bash
npm install
npm run build
```

---

## Connect to Claude Desktop

Edit your Claude Desktop config:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ast-mapper": {
      "command": "node",
      "args": ["C:\\path\\to\\AST-MCP\\dist\\index.js"],
      "env": {
        "AST_MAP_ROOT": "C:\\path\\to\\the\\project\\you\\want\\to\\analyze"
      }
    }
  }
}
```

> **`AST_MAP_ROOT`** is the security boundary — the server can only read files inside this directory.

---

## Tools

### `list_supported_languages`
Lists supported languages and file extensions.

---

### `get_skeleton_json`
Parse a single file, return JSON only. Fast path when the AI needs structure to reason about.

```json
{
  "schemaVersion": "1.1",
  "file": "src/lib/auth.ts",
  "language": "typescript",
  "imports": [
    { "symbol": "prisma", "from": "./prisma", "isDefault": true },
    { "symbol": "NextResponse", "from": "next/server" }
  ],
  "symbols": [
    { "name": "validateSession", "kind": "function", "exported": true,
      "range": { "startLine": 12, "endLine": 34 } }
  ]
}
```

---

### `generate_skeleton`
Map a file **or directory**. Returns compact JSON + writes self-contained HTML views.

Options: `detail` (`outline`|`full`), `emitHtml`, `combineHtml` (single `index.html` with sidebar), `outputDir`.

---

### `resolve_imports` ⬅ Step 2: The Resolver
For a source file, resolve each import to its target file and look up the actual symbol.
Returns **Reference Objects** with resolved path, kind, signature, and parameter list.

```json
{
  "file": "src/app/login/page.tsx",
  "importCount": 5,
  "resolved": [
    {
      "symbol": "validateSession",
      "from": "../../lib/auth",
      "resolvedRel": "src/lib/auth.ts",
      "kind": "function",
      "signature": "async function validateSession(token: string): Promise<Session>",
      "params": "(token: string)",
      "found": true,
      "importKind": "relative"
    }
  ]
}
```

Only relative imports (`./*`, `../*`) are resolved — external packages are flagged as `importKind: "external"`.

---

### `build_symbol_graph` ⬅ Step 3: The Graph
Scan a directory and build a two-layer dependency graph.

**Node types:**
- `"file"` — one per source file (`id = "src/lib/auth.ts"`)
- `"symbol"` — one per function/class/type (`id = "src/lib/auth.ts::validateSession"`, nested: `"src/lib/auth.ts::MyClass.render"`)

**Edge types:**
- `"contains"` — structural: file → symbol, parent-symbol → child-symbol
- `"imports"` — cross-file: importing-file → imported-symbol-node

```json
{
  "stats": { "fileCount": 42, "symbolNodeCount": 380, "edgeCount": 712 },
  "nodes": [
    { "id": "src/lib/auth.ts", "nodeType": "file", "language": "typescript", "symbolCount": 4 },
    { "id": "src/lib/auth.ts::validateSession", "nodeType": "symbol", "kind": "function", "exported": true }
  ],
  "edges": [
    { "from": "src/lib/auth.ts", "to": "src/lib/auth.ts::validateSession", "edgeType": "contains" },
    { "from": "src/app/api/login/route.ts", "to": "src/lib/auth.ts::validateSession", "edgeType": "imports" }
  ]
}
```

Use `outputFile` to write the graph JSON to disk for large projects.

---

### `get_symbol_context`
Extract the exact source lines of a named symbol. Token-efficient: 300-line file → ~40 lines of relevant code. Use `includeRelated: true` to also pull related types referenced in the signature.

---

### `validate_architecture`
Scan for Next.js App Router violations:
- `client-server-boundary` — `"use client"` files importing server-only modules
- `api-missing-try-catch` — API route handlers with no try/catch

---

## Power Prompts

Copy these into any AI agent that has AST-MCP connected.

---

### 🔍 Full Architecture Audit
*Use when inheriting a new project — find technical debt, God Nodes, and Client/Server leaks.*

```
เป้าหมาย: ออดิทสถาปัตยกรรมและหาจุดอ่อนของโปรเจกต์ Next.js ผ่าน AST และ Knowledge Graph

กรุณาทำงานตามลำดับขั้นตอนต่อไปนี้อย่างเคร่งครัด:

1. [สแกนโครงสร้าง]: รัน tool `build_symbol_graph` เพื่อสแกนโฟลเดอร์ "[PATH ของโฟลเดอร์ src]"
2. [สร้างแผนที่]: นำผลลัพธ์จากข้อ 1 ไปป้อนให้ `graphify` เพื่อขึ้นโครงสร้าง Network Graph
3. [วิเคราะห์จุดตาย]: ตรวจสอบกราฟเพื่อหา 3 ประเด็นนี้:
   - God Nodes: Symbol หรือไฟล์ไหนที่เป็นคอขวด (ถูก Import ไปใช้เยอะที่สุด 5 อันดับแรก)
   - Anti-patterns: มีหน้า UI ตัวไหนที่ Fetch โดยไม่ใช้ Cache หรือมี Circular Dependency หรือไม่
   - Client/Server Leak: มี Client Component ตัวไหนเผลอ Import ของฝั่ง Server โดยตรงหรือไม่
4. [ผ่าตัดโค้ด]: เลือกปัญหาที่ส่งผลกระทบสูงสุดจากข้อ 3 มา 1 จุด แล้วรัน `get_symbol_context`
   เพื่อดึงซอร์สโค้ดเฉพาะฟังก์ชัน/คอมโพเนนต์นั้นออกมา พร้อมเสนอแนวทาง Refactor
```

---

### 🔪 Surgical Impact Analysis
*Use before refactoring shared code — find every caller before breaking the contract.*

```
เป้าหมาย: วิเคราะห์ผลกระทบ (Impact Analysis) ก่อนทำการ Refactor โค้ดข้ามไฟล์

กรุณาทำงานตามลำดับขั้นตอนต่อไปนี้อย่างเคร่งครัด:

1. [สแกนโครงสร้าง]: รัน tool `build_symbol_graph` สแกนโฟลเดอร์ "[PATH ของโฟลเดอร์ src]"
2. [สร้างแผนที่]: โหลดข้อมูลกราฟที่ได้เข้า `graphify`
3. [ตามรอยเป้าหมาย]: ใน Graphify หา Symbol Node ที่ชื่อว่า "[ชื่อฟังก์ชัน/Component เป้าหมาย]"
   แล้วไล่ตามเส้นทาง (Edge) กลับไปดูว่า มีไฟล์หรือ Component ต้นทางตัวไหนบ้างที่เรียกใช้งาน
   Symbol นี้อยู่ ลิสต์รายชื่อมาให้ทั้งหมด
4. [เตรียม Refactor]: ฉันต้องการเปลี่ยนการทำงานของเป้าหมายนี้โดย [สิ่งที่จะเปลี่ยน]
   ให้คุณรัน `get_symbol_context` เพื่อดึงโค้ดของเป้าหมาย และโค้ดของ 1 ไฟล์ต้นทางที่เรียกใช้มันออกมา
   เพื่อเป็นตัวอย่างในการ Refactor ให้สอดคล้องกัน
```

> **Pro Tip:** เปลี่ยนข้อความในวงเล็บ `[...]` เป็น path หรือชื่อฟังก์ชันของโปรเจกต์ก่อนกด Enter ทุกครั้ง

---

## Schema

### `ImportRef`
```typescript
interface ImportRef {
  symbol: string             // imported name, or "*" for namespace/side-effect
  from: string               // module specifier as written in source
  alias?: string             // local alias: import { Foo as Bar } → "Bar"
  isTypeOnly?: boolean       // import type { ... }
  isNamespaceImport?: boolean // import * as Foo
  isDefault?: boolean        // import Foo from ...
  isSideEffect?: boolean     // import "module"
}
```

### `SkeletonFile` (v1.1)
```typescript
interface SkeletonFile {
  schemaVersion: "1.1"
  file: string               // relative path, forward-slashed
  language: string
  generatedAt: string        // ISO timestamp
  parser: { engine: "tree-sitter"; grammar: string }
  symbolCount: number
  directives?: string[]      // e.g. ["use client"]
  imports?: ImportRef[]      // all import statements in this file
  symbols: SymbolNode[]
}
```

---

## Project Layout

```
src/
├── index.ts          — MCP server + tool registrations
├── types.ts          — SkeletonFile, SymbolNode, ImportRef
├── config.ts         — SkeletonOptions, resolveOptions()
├── registry.ts       — Language detection + extractor registry
├── parser.ts         — tree-sitter WASM init + node helpers
├── skeleton.ts       — buildSkeleton(), collectSourceFiles()
├── resolver.ts       — resolveImportPath(), resolveFileImports()
├── graph.ts          — buildSymbolGraph(), GraphNode, GraphEdge
├── analysis.ts       — findSymbol(), architecture validation helpers
├── html.ts           — renderHtml(), renderCombinedHtml()
└── extractors/
    ├── common.ts     — makeSymbol(), lineRange(), toOutline()
    ├── typescript.ts — extractTypeScript(), extractImportsTS()
    ├── python.ts     — extractPython(), extractImportsPython()
    └── go.ts         — extractGo(), extractImportsGo()
```

## Adding a Language

1. Pick a grammar from `tree-sitter-wasms` (~36 bundled).
2. Write `src/extractors/<lang>.ts` exporting `extract()` and `extractImports()`.
3. Register in `src/registry.ts`.

No changes to the core pipeline.
