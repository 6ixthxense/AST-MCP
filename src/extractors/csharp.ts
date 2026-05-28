import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
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
  let s = "";
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === "modifier") s += c.text + " ";
  }
  return s;
}

function vis(node: TSNode): "public" | "private" {
  return /\bpublic\b/.test(modifiersText(node)) ? "public" : "private";
}

function exported(node: TSNode): boolean {
  return /\bpublic\b/.test(modifiersText(node));
}

function bodyLike(node: TSNode): TSNode | null {
  return (
    node.childForFieldName("body") ??
    childOfType(node, "accessor_list") ??
    childOfType(node, "arrow_expression_clause") ??
    childOfType(node, "block")
  );
}

/* ─── directives (namespace declarations) ─────────────────────────────────── */

export function extractDirectivesCSharp(root: TSNode, _source: string): string[] {
  const out: string[] = [];
  const visit = (node: TSNode) => {
    for (const c of namedChildren(node)) {
      if (c.type === "namespace_declaration" || c.type === "file_scoped_namespace_declaration") {
        const name = c.childForFieldName("name");
        if (name) out.push(`namespace:${name.text}`);
        const body = c.childForFieldName("body");
        if (body) visit(body);
      }
    }
  };
  visit(root);
  return out;
}

/* ─── import extraction ───────────────────────────────────────────────────── */

export function extractImportsCSharp(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  walkUsings(root, out);
  return out;
}

function walkUsings(node: TSNode, out: ImportRef[]): void {
  for (const child of namedChildren(node)) {
    if (child.type === "using_directive") {
      const isStatic = /\bstatic\b/.test(child.text);
      const alias = childOfType(child, "name_equals");
      const pathNode = childOfType(child, "qualified_name") ?? childOfType(child, "identifier");
      const from = pathNode ? pathNode.text : child.text.replace(/^using\s+|;\s*$/g, "").trim();
      const symbol = from.split(".").pop() ?? from;
      const ref: ImportRef = { symbol, from, isNamespaceImport: !isStatic && !alias };
      if (alias) {
        const aliasId = childOfType(alias, "identifier");
        if (aliasId) ref.alias = aliasId.text;
      }
      out.push(ref);
    } else if (
      child.type === "namespace_declaration" ||
      child.type === "file_scoped_namespace_declaration"
    ) {
      const body = child.childForFieldName("body");
      if (body) walkUsings(body, out);
    }
  }
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractCSharp(root: TSNode, _source: string): SymbolNode[] {
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
    case "namespace_declaration":
    case "file_scoped_namespace_declaration": {
      const body = node.childForFieldName("body");
      return body ? collect(namedChildren(body)) : null;
    }
    case "class_declaration":
    case "record_declaration":
    case "record_struct_declaration": {
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
    case "struct_declaration": {
      const body = node.childForFieldName("body");
      return makeSymbol({
        name: nameOf(node) ?? "(struct)",
        kind: "struct",
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
    case "enum_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(enum)",
        kind: "enum",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
      });
    case "method_declaration":
    case "constructor_declaration":
    case "destructor_declaration":
    case "operator_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(method)",
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, bodyLike(node)),
        visibility: vis(node),
        exported: exported(node),
        doc: leadingComment(node),
      });
    case "property_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(property)",
        kind: "field",
        node,
        rawKind: node.type,
        signature: headerSignature(node, bodyLike(node)),
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
  const kind = /\bconst\b/.test(m) || (/\bstatic\b/.test(m) && /\breadonly\b/.test(m)) ? "const" : "field";
  const decl = childOfType(node, "variable_declaration");
  if (!decl) return [];
  const out: SymbolNode[] = [];
  for (const d of namedChildren(decl)) {
    if (d.type !== "variable_declarator") continue;
    const id = childOfType(d, "identifier") ?? d.namedChild(0);
    if (!id) continue;
    out.push(
      makeSymbol({
        name: id.text,
        kind,
        node: d,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
        visibility: vis(node),
        exported: exported(node),
      }),
    );
  }
  return out;
}
