# Universal AST Mapper — MCP Server Blueprint (ฉบับเกลา v2)

> เอกสารนี้เป็น Blueprint ที่ปรับปรุงจากร่างแรก โดยคงแนวคิดหลักที่ดีอยู่แล้วไว้
> (สถาปัตยกรรม 4 โมดูล, Dual Output, Token Compression, Factory Pattern)
> และแก้ไขจุดอ่อนสำคัญ 1 จุดที่กระทบทั้งแผน คือ **กลยุทธ์ของ Parser Engine**

---

## 0. สรุปการเปลี่ยนแปลงสำคัญจากร่างแรก (Executive Summary)

| ประเด็น | ร่างแรก | ฉบับเกลานี้ | เหตุผล |
|---|---|---|---|
| **Parser หลัก** | Regex ก่อน → Tree-sitter ใน Phase 4 | **Tree-sitter ตั้งแต่ Phase 1** | Regex อ่าน nested scope / generics / comment / string ที่มี `{ }` ไม่ได้แม่น ทำให้ output เชื่อถือไม่ได้ และต้องรื้อทิ้งทั้งหมดใน Phase 4 อยู่ดี |
| **คำเรียก output** | "AST" | **"Code Skeleton / Symbol Map"** | สิ่งที่เราต้องการจริงคือ "โครงกระดูก" (class/func/struct + ตำแหน่ง + การซ้อน) ไม่ใช่ AST เต็มทุก node |
| **การเพิ่มภาษา** | เขียนชุด Regex ใหม่ทุกภาษา | **เพิ่มไฟล์ grammar + query (.scm)** | กลายเป็นงาน "config" แทน "เขียน logic ใหม่" — ขยายภาษาได้เร็วและพังยาก |
| **ไฟล์ HTML** | เซฟข้างไฟล์ต้นฉบับ | **เซฟใน output dir ที่กำหนดได้ + แนะนำ gitignore** | กันไฟล์ขยะรกใน repo และ git diff เพี้ยน |
| **"ไฟล์เด้งขึ้นมาเอง"** | สื่อว่าระบบเปิดไฟล์ให้อัตโนมัติ | **คืน path กลับไปให้ AI แล้วให้ AI ส่งลิงก์ให้ผู้ใช้** | MCP server สั่งเปิดไฟล์บนเดสก์ท็อปแบบข้ามแพลตฟอร์มไม่ได้เชื่อถือได้ |

**หัวใจของการเกลา:** เราไม่ได้ทิ้งไอเดียเดิม แต่ย้าย "ของแข็ง" (Tree-sitter) มาไว้เป็นรากฐานตั้งแต่ต้น แทนที่จะสร้างรากฐานด้วยของที่รู้อยู่แล้วว่าจะต้องทุบทิ้ง

---

## 1. ทำไมต้องเลิกใช้ Regex เป็นแกนหลัก

Regex เหมาะกับการ "จับ pattern บรรทัดเดียว" แต่ภาษาโปรแกรมเป็นโครงสร้างซ้อนชั้น (recursive) ซึ่ง Regex จัดการไม่ได้โดยธรรมชาติ ตัวอย่างเคสที่ Regex มักพลาด:

- **Nested scope:** ฟังก์ชันซ้อนในฟังก์ชัน, method ใน class ใน module — Regex บอก "ใครอยู่ใต้ใคร" ไม่ได้แม่น
- **Multi-line declaration:** signature ที่ขึ้นบรรทัดใหม่, generics ยาวๆ เช่น `func Map[T any, R any](...)`
- **False positive:** คำว่า `class` / `func` ที่อยู่ใน comment, ใน string literal, หรือใน template string
- **Braces ใน string:** `const x = "if (a) { b }"` ทำให้การนับวงเล็บเพี้ยน

**ทางออก: Tree-sitter** — เป็น parser generator ที่ GitHub, Neovim ใช้สำหรับ code navigation จริง

- รองรับ ~100+ ภาษา ผ่าน **API เดียวกัน** (ตรงสเปก "Universal" ของเราเป๊ะ)
- **Error-tolerant:** โค้ดพังบางส่วนก็ยัง parse ส่วนที่เหลือได้ (สำคัญมากตอนโค้ดกำลังเขียนค้าง)
- มี **Query API (`.scm` files)** สำหรับ "ดึงเฉพาะ node ที่ต้องการ" (class, func, struct) โดยไม่ต้องเดิน tree เอง
- เร็วระดับ incremental parsing

> **หมายเหตุ:** Regex ยังมีที่ยืนเล็กๆ ในฐานะ *fallback ขั้นสุดท้าย* สำหรับไฟล์ที่ยังไม่มี grammar เท่านั้น (เช่นดึงแค่ comment header) — ไม่ใช่แกนหลัก

---

## 2. สถาปัตยกรรมระบบ (System Architecture)

ยังคงโครง 4 โมดูลของร่างแรกไว้ (ดีอยู่แล้ว) แต่เปลี่ยนไส้ในของ Parser Engine

```
┌─────────────────────────────────────────────────────────────┐
│  1. Transport Layer (MCP / JSON-RPC 2.0 over stdio)          │
│     ใช้ @modelcontextprotocol/sdk จัดการ handshake/protocol    │
└───────────────┬─────────────────────────────────────────────┘
                │ tool call: generate_skeleton(path, opts)
┌───────────────▼─────────────────────────────────────────────┐
│  2. Controller / Router                                      │
│     - resolve path, ตรวจ security (อยู่ใน allowed root ไหม)    │
│     - อ่านนามสกุล → เลือก Language Adapter ผ่าน Registry        │
│     - จัดการ fallback เมื่อไม่รู้จักนามสกุล                       │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│  3. Parser Engine (Core)                                     │
│     - Tree-sitter loader (โหลด grammar .wasm ตามภาษา)          │
│     - รัน Query (.scm) ดึง symbol nodes                        │
│     - Normalizer: แปลงเป็น Standard Skeleton JSON (schema กลาง) │
└───────────────┬─────────────────────────────────────────────┘
                │ Standard Skeleton JSON
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐  ┌──────────────────────────────────┐
│ 4a. Data      │  │ 4b. HTML Renderer                │
│ Formatter     │  │  - สวม JSON เข้า template (Tailwind)│
│ (JSON ย่อ →AI) │  │  - collapsible tree, self-contained│
│               │  │  - เซฟไฟล์ → คืน path กลับไปให้ AI    │
└───────────────┘  └──────────────────────────────────┘
```

**Language Registry (หัวใจการขยายภาษา):** map `นามสกุล → { grammar, queryFile, kindMap }`
การเพิ่มภาษาใหม่ = เพิ่ม 1 entry + 1 ไฟล์ query + ตาราง mapping kind ไม่ต้องแตะ core เลย (นี่คือ Factory/Strategy pattern ที่ร่างแรกตั้งใจไว้ แต่ทำได้สะอาดกว่ามากเมื่อ logic อยู่ใน query file ไม่ใช่ใน regex)

---

## 3. Standard Skeleton JSON (Schema กลาง)

นี่คือ "ภาษากลาง" ที่ทุก parser ต้องคืนออกมาให้หน้าตาเหมือนกัน ไม่ว่าต้นทางจะเป็นภาษาอะไร — AI จะได้เห็น vocabulary ชุดเดียว

```jsonc
{
  "schemaVersion": "1.0",
  "file": "services/inventory.go",
  "language": "go",
  "generatedAt": "2026-05-27T10:00:00Z",
  "parser": { "engine": "tree-sitter", "grammar": "go@0.21.0" },
  "symbolCount": 12,
  "symbols": [
    {
      "name": "InventoryService",
      "kind": "struct",          // normalized enum (ดูด้านล่าง)
      "signature": null,
      "visibility": "public",    // public | private (จากตัวพิมพ์ใหญ่/_underscore ตามภาษา)
      "range": { "startLine": 14, "endLine": 22 },
      "doc": "Handles stock-level operations",  // leading comment/docstring (optional)
      "children": [              // ⭐ ใช้ tree (children) ไม่ใช่ scope แบบ string
        {
          "name": "ReserveStock",
          "kind": "method",
          "signature": "(ctx context.Context, sku string, qty int) error",
          "visibility": "public",
          "range": { "startLine": 30, "endLine": 48 },
          "children": []
        }
      ]
    }
  ]
}
```

**ทำไมใช้ `children` (tree) แทน `scope` (string):** การซ้อนชั้นคือหัวใจของ "โครงสร้าง" ถ้าเก็บเป็น tree ตรงๆ ทั้ง HTML (collapsible) และ AI จะเข้าใจลำดับชั้นทันที โดยไม่ต้อง reconstruct จาก string

**Normalized `kind` enum** (แปลงศัพท์แต่ละภาษาให้เป็นชุดเดียว):

| kind กลาง | TS/JS | Python | Go |
|---|---|---|---|
| `class` | `class` | `class` | — |
| `struct` | — | — | `struct` |
| `interface` | `interface` | (Protocol) | `interface` |
| `function` | `function` / arrow | `def` (top-level) | `func` |
| `method` | method ใน class | `def` ใน class | method (มี receiver) |
| `type` | `type` / `enum` | `TypeAlias` | `type` |
| `const` / `var` | `const`/`let` | module-level assign | `const`/`var` |

> เก็บค่าดิบของภาษาไว้ใน field `rawKind` เผื่อ debug ได้ แต่ field หลักที่ AI/HTML ใช้คือ `kind` ที่ normalize แล้ว

---

## 4. Tool Surface (MCP Tools ที่จะเปิดให้ AI เรียก)

| Tool | หน้าที่ | หมายเหตุ |
|---|---|---|
| `generate_skeleton` | input = path (ไฟล์ **หรือ** โฟลเดอร์/glob) → คืน JSON ย่อ + เซฟ HTML | tool หลัก |
| `get_skeleton_json` | คืนเฉพาะ JSON ไม่เซฟ HTML | สำหรับเคสที่ AI ต้องการแค่ข้อมูล ประหยัด IO |
| `list_supported_languages` | คืนรายชื่อภาษา + นามสกุลที่รองรับ | ให้ AI เช็คก่อนเรียก |

**Options ที่ควรมีใน `generate_skeleton`:**

- `detail`: `"outline"` (แค่ name+kind+range — ดีฟอลต์ ประหยัด token) หรือ `"full"` (+signature +doc)
- `emitHtml`: `true|false` — ปิดได้เมื่อไม่ต้องการไฟล์
- `outputDir`: ที่เก็บ HTML (ดีฟอลต์ `.ast-map/` ที่ root ของโปรเจกต์)
- `ignore`: glob ที่ข้าม (ดีฟอลต์ข้าม `node_modules`, `vendor`, `.git`, `dist`)

**รองรับโฟลเดอร์/หลายไฟล์:** workflow จริงของคุณ ("ไล่ระบบส่วน Inventory") มักครอบหลายไฟล์ ดังนั้น input ควรรับทั้งไฟล์เดี่ยวและโฟลเดอร์ตั้งแต่แรก

---

## 5. Dual Output — ปรับให้ใช้จริงได้

**4a. JSON สำหรับ AI (ประหยัด token):**
- ดีฟอลต์ `detail: "outline"` ตัด field ที่ไม่จำเป็นออก, ไม่มี whitespace
- คืนพร้อม `htmlPath` ที่เซฟไว้ เพื่อให้ AI ส่งลิงก์ต่อให้ผู้ใช้

**4b. HTML สำหรับมนุษย์:**
- ไฟล์ **self-contained** ไฟล์เดียว (inline CSS/JS, Tailwind ผ่าน CDN หรือ inline) เปิดที่ไหนก็ได้
- **Collapsible tree** (expand/collapse) ตามไอเดียร่างแรก
- **ตำแหน่งเก็บ:** ดีฟอลต์ `.ast-map/<relative-path>-skeleton.html` ที่ root โปรเจกต์ + แนะนำให้ใส่ `.ast-map/` ใน `.gitignore`
  - ใช้ relative path ในชื่อไฟล์ กัน `inventory.go` ใน 2 โฟลเดอร์ชนกัน
- **เรื่อง "เด้งขึ้นมาเอง":** server **ไม่** บังคับเปิดไฟล์เอง (ข้ามแพลตฟอร์มไม่ชัวร์) แต่จะ **คืน path กลับไปให้ Claude** แล้ว Claude แปะลิงก์ให้คุณคลิกเปิดเอง — ผลลัพธ์ที่คุณเห็นจะเหมือนเดิม (มีลิงก์ HTML โผล่พร้อมคำอธิบาย) แต่กลไกเชื่อถือได้กว่า

---

## 6. แผนการพัฒนาใหม่ (Revised Roadmap)

### 🔵 Phase 0 — Decisions & Scaffolding (ตัดสินใจ + วางโครง)
- เลือก stack: **Node + TypeScript + `web-tree-sitter` (WASM)** + `@modelcontextprotocol/sdk`
  *(เหตุผล: รันไทม์เดียวครอบทุกภาษาเป้าหมาย, WASM ไม่ต้อง build native, MCP SDK ฝั่ง TS โตเต็มที่ — ทางเลือกสำรองคือ Python + `tree-sitter` + python MCP SDK)*
- ล็อก **Skeleton JSON schema v1** (หัวข้อ 3) + เขียน type definitions
- ตั้ง repo, lint, test runner, โครง MCP handshake (initialize / listTools / callTool)

### 🟢 Phase 1 — Core Pipeline E2E (1 ภาษา)
- ต่อ pipeline ครบเส้น: `path → tree-sitter → query → normalize → JSON`
- เริ่มที่ **TypeScript/JavaScript**
- เขียน query file `.scm` แรก + kindMap แรก
- **ทดสอบ E2E:** AI สั่ง → ระบบอ่านไฟล์ `.ts` → คืน Standard JSON
- มี golden-file test (fixture .ts → expected .json)

### 🟡 Phase 2 — HTML Renderer & Dual Output
- เขียน renderer: Standard JSON → HTML self-contained (collapsible, Tailwind)
- ระบบ output dir + naming ตามหัวข้อ 5
- คืน `htmlPath` กลับไปใน tool response
- **ทดสอบควบคู่:** AI ได้ JSON ย่อ + ผู้ใช้ได้ลิงก์ HTML สวยๆ

### 🟠 Phase 3 — Multi-Language Scaling
- ทำ **Language Registry** (extension → adapter) ให้สมบูรณ์ (Factory pattern)
- เพิ่ม **Python** (query: class / def / async def)
- เพิ่ม **Go** (query: struct / interface / func / method)
- **Fallback:** เจอนามสกุลที่ไม่รู้จัก → คืนข้อความ `"unsupported: .xyz"` แบบ structured (ไม่ throw error แดง)
- รองรับ input เป็นโฟลเดอร์/glob (เดินหลายไฟล์ + รวม index)

### 🔴 Phase 4 — Advanced (Optional / Stretch)
> ทำต่อเมื่อ Phase 1–3 ใช้จริงแล้วและเห็นว่าจำเป็น — อย่าเพิ่งลงทุนก่อนเวลา
- **Semantic enrichment:** import graph, cross-file references, "ใครเรียกใคร"
- **Local LLM doc summary (Ollama):** สรุป docstring/comment ย่อใส่ HTML
- **Live Dashboard (Next.js + WebSocket):** แทนการ generate ไฟล์ HTML ดิบ
- *(หมายเหตุ: Tree-sitter ถูกย้ายมา Phase 1 แล้ว ดังนั้น Phase 4 จึงเหลือแต่ของที่เป็น "อนาคตจริงๆ")*

---

## 7. ประเด็นที่ร่างแรกยังไม่ได้พูดถึง (ควรเพิ่มในแผน)

- **Security / File access:** server อ่าน path อะไรก็ได้ → จำกัดให้อ่านได้เฉพาะใน allowed root (workspace) เท่านั้น กัน path traversal
- **Performance:** จำกัดขนาดไฟล์สูงสุด, ข้าม `node_modules`/`vendor`/build artifacts โดยดีฟอลต์
- **Error handling:** parse error → คืน partial result (tree-sitter ทำได้) ไม่ใช่ crash ทั้งคำสั่ง
- **Testing strategy:** golden-file test ต่อภาษา (fixture → expected JSON) เป็นด่านป้องกันหลัก เพราะ parser คือหัวใจ
- **Schema versioning:** ใส่ `schemaVersion` ตั้งแต่แรก เผื่อ schema เปลี่ยนในอนาคต
- **Config file:** `.ast-map.config.json` สำหรับ outputDir / ignore / default detail

---

## 8. Workflow ปลายทาง (เหมือนเดิม แต่กลไกชัดขึ้น)

1. เปิด Claude Desktop: *"ไล่ระบบหลังบ้านส่วน Inventory ให้หน่อย เริ่มจาก `services/inventory.go`"*
2. Claude เรียก `generate_skeleton("services/inventory.go")` แบบเงียบๆ
3. Tool: Controller ตรวจ path → Registry เลือก Go adapter → Tree-sitter parse + query → Normalize → คืน **JSON ย่อ** ให้ Claude **พร้อม `htmlPath`**
4. ระหว่าง Claude อธิบายบั๊กให้ฟัง มันก็แปะ **ลิงก์ `.ast-map/services/inventory.go-skeleton.html`** ให้คุณคลิกเปิดดูโครงสร้างควบคู่ไปด้วย

---

## 9. สรุป (ของร่างแรกที่เก็บไว้ vs ที่เปลี่ยน)

**เก็บไว้ (ดีอยู่แล้ว):** โครง 4 โมดูล · Dual Output · Token compression · Factory pattern · Fallback แทน error · workflow ปลายทาง

**เปลี่ยน (จุดสำคัญ):** Tree-sitter เป็นแกนตั้งแต่ Phase 1 (ไม่ใช่ Phase 4) · เรียก output ว่า Skeleton ไม่ใช่ AST · เก็บโครงเป็น tree (`children`) · HTML ลง output dir ที่ gitignore · ขยายภาษา = เพิ่ม query file ไม่ใช่ regex · เพิ่ม security/testing/perf เข้าแผน
