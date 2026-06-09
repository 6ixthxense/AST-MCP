import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol } from "./common.js";

// ─── PHP extractor (tree-sitter-php) ──────────────────────────────────────────

export function extractPhp(root: TSNode, _source: string): SymbolNode[] {
  return collect(namedChildren(root));
}

function collect(nodes: TSNode[]): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of nodes) {
    const sym = handle(n);
    if (sym) out.push(sym);
    else if (n.type === "namespace_definition") {
      // `namespace Foo;` (no braces) — siblings follow; emit the namespace marker.
      const name = nameOf(n)?.replace(/\s+/g, "") ?? namespaceName(n);
      if (name) {
        out.push(makeSymbol({ name, kind: "namespace", node: n, rawKind: n.type }));
      }
      const body = n.childForFieldName("body");
      if (body) out[out.length - 1].children = collect(namedChildren(body));
    } else if (n.type === "expression_statement" || n.type === "if_statement") {
      // skip — top-level statements
    }
  }
  return out;
}

function namespaceName(n: TSNode): string | null {
  for (const c of namedChildren(n)) {
    if (c.type === "namespace_name") return c.text.replace(/\s+/g, "");
  }
  return null;
}

function phpVisibility(node: TSNode): "public" | "private" {
  for (const c of namedChildren(node)) {
    if (c.type === "visibility_modifier") {
      const t = c.text;
      if (t === "private" || t === "protected") return "private";
      return "public";
    }
  }
  return "public";
}

function classLike(node: TSNode, kind: "class" | "interface"): SymbolNode {
  const name = nameOf(node) ?? "(class)";
  const body = node.childForFieldName("body") ?? findChild(node, "declaration_list");
  return makeSymbol({
    name,
    kind,
    node,
    rawKind: node.type,
    signature: headerSignature(node, body),
    doc: leadingComment(node),
    children: body ? collect(namedChildren(body)) : [],
  });
}

function findChild(node: TSNode, type: string): TSNode | null {
  for (const c of namedChildren(node)) if (c.type === type) return c;
  return null;
}

function handle(node: TSNode): SymbolNode | null {
  switch (node.type) {
    case "class_declaration":
    case "trait_declaration":
      return classLike(node, "class");
    case "interface_declaration":
      return classLike(node, "interface");
    case "enum_declaration": {
      const body = findChild(node, "enum_declaration_list");
      return makeSymbol({
        name: nameOf(node) ?? "(enum)",
        kind: "enum",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        doc: leadingComment(node),
        children: body
          ? namedChildren(body)
              .filter((c) => c.type === "enum_case")
              .map((c) => makeSymbol({ name: nameOf(c) ?? c.text, kind: "const", node: c, rawKind: c.type }))
          : [],
      });
    }
    case "function_definition": {
      const body = node.childForFieldName("body") ?? findChild(node, "compound_statement");
      return makeSymbol({
        name: nameOf(node) ?? "(function)",
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        doc: leadingComment(node),
      });
    }
    case "method_declaration": {
      const body = node.childForFieldName("body") ?? findChild(node, "compound_statement");
      const vis = phpVisibility(node);
      return makeSymbol({
        name: nameOf(node) ?? "(method)",
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility: vis,
        exported: vis === "public",
        doc: leadingComment(node),
      });
    }
    case "const_declaration": {
      const el = findChild(node, "const_element");
      const name = el ? namedChildren(el)[0]?.text : null;
      if (!name) return null;
      const vis = phpVisibility(node);
      return makeSymbol({
        name,
        kind: "const",
        node,
        rawKind: node.type,
        visibility: vis,
        exported: vis === "public",
      });
    }
    case "property_declaration": {
      const decl = findChild(node, "property_element");
      const name = decl?.text.replace(/\s*=.*$/, "").trim();
      if (!name) return null;
      const vis = phpVisibility(node);
      return makeSymbol({
        name,
        kind: "field",
        node,
        rawKind: node.type,
        visibility: vis,
        exported: vis === "public",
      });
    }
    default:
      return null;
  }
}

// ─── Import extraction ────────────────────────────────────────────────────────
// `use App\Models\User;`, grouped `use App\{A, B};`, and require/include calls.

export function extractImportsPhp(root: TSNode, _source: string): ImportRef[] {
  const imports: ImportRef[] = [];
  walk(root, imports, 0);
  return imports;
}

function walk(node: TSNode, out: ImportRef[], depth: number): void {
  if (depth > 4) return;
  for (const c of namedChildren(node)) {
    if (c.type === "namespace_use_declaration") parseUse(c, out);
    else if (
      c.type === "require_expression" ||
      c.type === "require_once_expression" ||
      c.type === "include_expression" ||
      c.type === "include_once_expression"
    ) {
      const str = findString(c);
      if (str) out.push({ symbol: "*", from: str, isSideEffect: true });
    } else {
      walk(c, out, depth + 1);
    }
  }
}

function findString(node: TSNode): string | null {
  for (const c of namedChildren(node)) {
    if (c.type === "string") return c.text.replace(/^['"]|['"]$/g, "");
    const deep = findString(c);
    if (deep) return deep;
  }
  return null;
}

function parseUse(node: TSNode, out: ImportRef[]): void {
  let groupBase: string | null = null;
  for (const c of namedChildren(node)) {
    if (c.type === "namespace_name") groupBase = c.text.replace(/\s+/g, "");
    else if (c.type === "namespace_use_clause") {
      const qn = c.text.replace(/\s+as\s+.*$/, "").replace(/\s+/g, "");
      const alias = /\s+as\s+(\w+)/.exec(c.text)?.[1];
      const leaf = qn.split("\\").pop() ?? qn;
      const imp: ImportRef = { symbol: leaf, from: qn };
      if (alias) imp.alias = alias;
      out.push(imp);
    } else if (c.type === "namespace_use_group") {
      for (const g of namedChildren(c)) {
        if (g.type !== "namespace_use_group_clause") continue;
        const txt = g.text.replace(/\s+/g, "");
        const leaf = txt.split("\\").pop() ?? txt;
        out.push({ symbol: leaf, from: groupBase ? `${groupBase}\\${txt}` : txt });
      }
    }
  }
}
