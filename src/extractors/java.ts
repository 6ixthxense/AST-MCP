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
  if (/\b(private|protected)\b/.test(m)) return "private";
  return "public";
}

function exported(node: TSNode): boolean {
  return /\bpublic\b/.test(modifiersText(node));
}

/* ─── directives (package declaration) ────────────────────────────────────── */

export function extractDirectivesJava(root: TSNode, _source: string): string[] {
  for (const child of namedChildren(root)) {
    if (child.type !== "package_declaration") continue;
    const id = childOfType(child, "scoped_identifier") ?? childOfType(child, "identifier");
    if (id) return [`package:${id.text}`];
  }
  return [];
}

/* ─── import extraction ───────────────────────────────────────────────────── */

export function extractImportsJava(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type !== "import_declaration") continue;
    const isStatic = /\bstatic\b/.test(child.text);
    const isWildcard = /\.\s*\*/.test(child.text);
    const pathNode = childOfType(child, "scoped_identifier") ?? childOfType(child, "identifier");
    const from = pathNode ? pathNode.text : child.text.replace(/^import\s+|;\s*$/g, "").trim();
    if (isWildcard) {
      out.push({ symbol: "*", from, isNamespaceImport: true, isTypeOnly: !isStatic });
    } else {
      const symbol = from.split(".").pop() ?? from;
      out.push({ symbol, from, isTypeOnly: !isStatic });
    }
  }
  return out;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractJava(root: TSNode, _source: string): SymbolNode[] {
  return collect(namedChildren(root));
}

function collect(nodes: TSNode[]): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of nodes) {
    const res = handle(n);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

function handle(node: TSNode): SymbolNode | SymbolNode[] | null {
  switch (node.type) {
    case "class_declaration":
    case "record_declaration": {
      const body = node.childForFieldName("body");
      return makeSymbol({
        name: nameOf(node) ?? "(class)",
        kind: "class",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body)) : [],
      });
    }
    case "interface_declaration": {
      const body = node.childForFieldName("body");
      return makeSymbol({
        name: nameOf(node) ?? "(interface)",
        kind: "interface",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body)) : [],
      });
    }
    case "enum_declaration": {
      const body = node.childForFieldName("body");
      return makeSymbol({
        name: nameOf(node) ?? "(enum)",
        kind: "enum",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body).filter((c) => c.type !== "enum_constant")) : [],
      });
    }
    case "method_declaration":
    case "constructor_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(method)",
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
      });
    case "field_declaration":
      return fieldDeclarators(node);
    default:
      return null;
  }
}

function fieldDeclarators(node: TSNode): SymbolNode[] {
  const m = modifiersText(node);
  const kind: SymbolKind = /\bstatic\b/.test(m) && /\bfinal\b/.test(m) ? "const" : "field";
  const out: SymbolNode[] = [];
  for (const decl of namedChildren(node)) {
    if (decl.type !== "variable_declarator") continue;
    const name = nameOf(decl);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind,
        node: decl,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
        visibility: vis(node),
        exported: exported(node),
      }),
    );
  }
  return out;
}
