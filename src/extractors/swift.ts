import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef, SymbolKind } from "../types.js";
import { makeSymbol } from "./common.js";

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function childOfType(node: TSNode, type: string): TSNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

function modifiersText(node: TSNode): string {
  const m = childOfType(node, "modifiers");
  return m ? m.text : "";
}

function vis(node: TSNode): "public" | "private" {
  const m = modifiersText(node);
  if (/\b(private|fileprivate)\b/.test(m)) return "private";
  return "public"; // treat internal/public/open as public
}

function exported(node: TSNode): boolean {
  const m = modifiersText(node);
  return /\b(public|open)\b/.test(m) || !/\b(private|fileprivate|internal)\b/.test(m);
}

/** Swift uses class_declaration for `class`, `struct`, `enum`, `actor`, `extension`. */
function classDeclKind(node: TSNode): SymbolKind {
  const head = node.text.slice(0, 80);
  if (/\bstruct\b/.test(head)) return "struct";
  if (/\benum\b/.test(head)) return "enum";
  const body = childOfType(node, "enum_class_body");
  if (body) return "enum";
  return "class";
}

/* ─── imports ─────────────────────────────────────────────────────────────── */

export function extractImportsSwift(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const c of namedChildren(root)) {
    if (c.type !== "import_declaration") continue;
    const id = childOfType(c, "identifier");
    const text = id ? id.text : c.text.replace(/^import\s+/, "").trim();
    out.push({ symbol: text.split(".").pop() ?? text, from: text });
  }
  return out;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractSwift(root: TSNode, _source: string): SymbolNode[] {
  return collect(namedChildren(root), false);
}

function collect(nodes: TSNode[], insideClass: boolean): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of nodes) {
    const res = handle(n, insideClass);
    if (res) out.push(res);
  }
  return out;
}

function handle(node: TSNode, insideClass: boolean): SymbolNode | null {
  switch (node.type) {
    case "class_declaration": {
      const name = nameOf(node);
      if (!name) return null;
      const kind = classDeclKind(node);
      const body = childOfType(node, "class_body") ?? childOfType(node, "enum_class_body");
      return makeSymbol({
        name,
        kind,
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body), true) : [],
      });
    }

    case "protocol_declaration": {
      const name = nameOf(node);
      if (!name) return null;
      const body = childOfType(node, "protocol_body");
      const kids: SymbolNode[] = [];
      if (body) {
        for (const m of namedChildren(body)) {
          if (m.type === "protocol_function_declaration") {
            const n = nameOf(m);
            if (n) {
              kids.push(
                makeSymbol({
                  name: n,
                  kind: "method",
                  node: m,
                  rawKind: m.type,
                  signature: headerSignature(m, null),
                  visibility: "public",
                  exported: true,
                }),
              );
            }
          }
        }
      }
      return makeSymbol({
        name,
        kind: "interface",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: kids,
      });
    }

    case "function_declaration": {
      const name = nameOf(node);
      if (!name) return null;
      const body = childOfType(node, "function_body");
      return makeSymbol({
        name,
        kind: insideClass ? "method" : "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
      });
    }

    case "init_declaration": {
      return makeSymbol({
        name: "init",
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, childOfType(node, "function_body")),
        visibility: vis(node),
        exported: exported(node),
      });
    }

    case "property_declaration": {
      // name is `pattern` field; the pattern contains simple_identifier
      const pat = node.childForFieldName("name");
      let name: string | null = null;
      if (pat) {
        const id = pat.type === "simple_identifier" ? pat : findFirstNamed(pat, "simple_identifier");
        name = id ? id.text : null;
      }
      if (!name) return null;
      const isLet = /\blet\b/.test(node.text.slice(0, 30));
      return makeSymbol({
        name,
        kind: insideClass ? "field" : (isLet ? "const" : "var"),
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").trim(),
        visibility: vis(node),
        exported: exported(node),
      });
    }

    case "enum_entry": {
      const name = nameOf(node);
      if (!name) return null;
      return makeSymbol({
        name,
        kind: "field",
        node,
        rawKind: node.type,
      });
    }

    default:
      return null;
  }
}

function findFirstNamed(node: TSNode, type: string): TSNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === type) return c;
    const deep = findFirstNamed(c, type);
    if (deep) return deep;
  }
  return null;
}


