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

/** Recursively unwrap a declarator chain to get the identifier text. */
function nameFromDeclarator(node: TSNode | null): string | null {
  if (!node) return null;
  switch (node.type) {
    case "identifier":
    case "field_identifier":
    case "type_identifier":
      return node.text;
    case "pointer_declarator":
    case "array_declarator":
    case "parenthesized_declarator":
      return nameFromDeclarator(node.childForFieldName("declarator"));
    case "function_declarator": {
      const d = node.childForFieldName("declarator");
      return nameFromDeclarator(d);
    }
    case "init_declarator":
      return nameFromDeclarator(node.childForFieldName("declarator"));
    default:
      // best-effort: find first identifier-like child
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c && (c.type === "identifier" || c.type === "field_identifier" || c.type === "type_identifier")) return c.text;
      }
      return null;
  }
}

function hasStaticStorage(node: TSNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === "storage_class_specifier" && c.text === "static") return true;
  }
  return false;
}

/* ─── imports (#include) ──────────────────────────────────────────────────── */

export function extractImportsC(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type !== "preproc_include") continue;
    const pathNode = childOfType(child, "system_lib_string") ?? childOfType(child, "string_literal");
    if (!pathNode) continue;
    const raw = pathNode.text.replace(/^[<"]|[>"]$/g, "");
    const base = raw.split("/").pop() ?? raw;
    const sym = base.replace(/\.[hH]$|\.hpp$|\.hxx$|\.hh$/, "");
    out.push({ symbol: sym, from: raw });
  }
  return out;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractC(root: TSNode, _source: string): SymbolNode[] {
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
    case "struct_specifier":
    case "union_specifier": {
      const name = nameOf(node);
      if (!name) return null;
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "struct",
        node,
        rawKind: node.type,
        doc: leadingComment(node),
        children: body ? structFields(body) : [],
      });
    }

    case "enum_specifier": {
      const name = nameOf(node);
      if (!name) return null;
      return makeSymbol({
        name,
        kind: "enum",
        node,
        rawKind: node.type,
        doc: leadingComment(node),
      });
    }

    case "function_definition": {
      const decl = node.childForFieldName("declarator");
      const name = nameFromDeclarator(decl);
      if (!name) return null;
      const isStatic = hasStaticStorage(node);
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: isStatic ? "private" : "public",
        exported: !isStatic,
        doc: leadingComment(node),
      });
    }

    case "declaration": {
      // top-level variable/function declarations (prototypes, externs, etc.)
      const decl = node.childForFieldName("declarator");
      const name = nameFromDeclarator(decl);
      if (!name) return null;
      // skip function prototypes — focus on real defs (function_definition)
      if (decl && containsFunctionDeclarator(decl)) return null;
      return makeSymbol({
        name,
        kind: "var",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
        visibility: hasStaticStorage(node) ? "private" : "public",
        exported: !hasStaticStorage(node),
      });
    }

    case "preproc_def":
    case "preproc_function_def": {
      const name = nameOf(node);
      if (!name) return null;
      return makeSymbol({
        name,
        kind: "const",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").trim(),
      });
    }

    case "type_definition": {
      // typedef — name is in the declarator (last identifier)
      const decl = node.childForFieldName("declarator");
      const name = nameFromDeclarator(decl);
      if (!name) return null;
      return makeSymbol({
        name,
        kind: "type",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
      });
    }

    default:
      return null;
  }
}

function containsFunctionDeclarator(node: TSNode): boolean {
  if (node.type === "function_declarator") return true;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && containsFunctionDeclarator(c)) return true;
  }
  return false;
}

function structFields(body: TSNode): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const field of namedChildren(body)) {
    if (field.type !== "field_declaration") continue;
    const decl = field.childForFieldName("declarator");
    const name = nameFromDeclarator(decl);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind: "field",
        node: field,
        rawKind: field.type,
        signature: field.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
      }),
    );
  }
  return out;
}
