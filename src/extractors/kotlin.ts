import type { TSNode } from "../parser.js";
import { namedChildren, headerSignature, leadingComment } from "../parser.js";
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

function firstChildOfTypes(node: TSNode, types: Set<string>): TSNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && types.has(c.type)) return c;
  }
  return null;
}

const TYPE_NAME_NODES = new Set(["type_identifier", "simple_identifier"]);
const SIMPLE_NAME_NODES = new Set(["simple_identifier"]);

function modifiersText(node: TSNode): string {
  const m = childOfType(node, "modifiers");
  return m ? m.text : "";
}

function vis(node: TSNode): "public" | "private" {
  const m = modifiersText(node);
  if (/\b(private|protected|internal)\b/.test(m)) return "private";
  return "public"; // Kotlin default is public
}

function exported(node: TSNode): boolean {
  const m = modifiersText(node);
  if (/\b(private|protected|internal)\b/.test(m)) return false;
  return true;
}

function classKind(node: TSNode): SymbolKind {
  const m = modifiersText(node);
  if (/\bdata\b/.test(node.text.slice(0, 80))) return "class";
  if (/\benum\b/.test(node.text.slice(0, 80))) return "enum";
  return "class";
}

/* ─── imports + package ───────────────────────────────────────────────────── */

export function extractDirectivesKotlin(root: TSNode, _source: string): string[] {
  for (const c of namedChildren(root)) {
    if (c.type === "package_header") {
      const id = childOfType(c, "identifier");
      if (id) return [`package:${id.text}`];
    }
  }
  return [];
}

export function extractImportsKotlin(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  const list = childOfType(root, "import_list");
  if (!list) return out;
  for (const h of namedChildren(list)) {
    if (h.type !== "import_header") continue;
    const id = childOfType(h, "identifier");
    if (!id) continue;
    const isWildcard = /\.\*\s*$/.test(h.text);
    const from = id.text;
    const sym = isWildcard ? "*" : (from.split(".").pop() ?? from);
    out.push({ symbol: sym, from, isNamespaceImport: isWildcard });
  }
  return out;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractKotlin(root: TSNode, _source: string): SymbolNode[] {
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
      const nameNode = firstChildOfTypes(node, TYPE_NAME_NODES);
      if (!nameNode) return null;
      const body = childOfType(node, "class_body") ?? childOfType(node, "enum_class_body");
      return makeSymbol({
        name: nameNode.text,
        kind: classKind(node),
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body), true) : [],
      });
    }

    case "object_declaration": {
      const nameNode = firstChildOfTypes(node, TYPE_NAME_NODES);
      if (!nameNode) return null;
      const body = childOfType(node, "class_body");
      return makeSymbol({
        name: nameNode.text,
        kind: "class",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body), true) : [],
      });
    }

    case "function_declaration": {
      const nameNode = firstChildOfTypes(node, SIMPLE_NAME_NODES);
      if (!nameNode) return null;
      const body = childOfType(node, "function_body");
      return makeSymbol({
        name: nameNode.text,
        kind: insideClass ? "method" : "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
      });
    }

    case "property_declaration": {
      // variable_declaration → simple_identifier
      const vd = childOfType(node, "variable_declaration");
      const nameNode = vd ? firstChildOfTypes(vd, SIMPLE_NAME_NODES) : firstChildOfTypes(node, SIMPLE_NAME_NODES);
      if (!nameNode) return null;
      const m = modifiersText(node);
      const kind: SymbolKind = insideClass ? "field" : (/\bconst\b/.test(m) ? "const" : "var");
      return makeSymbol({
        name: nameNode.text,
        kind,
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").trim(),
        visibility: vis(node),
        exported: exported(node),
      });
    }

    default:
      return null;
  }
}


