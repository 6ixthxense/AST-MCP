import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol } from "./common.js";

/**
 * Extract "use client" / "use server" directives from the top of a TS/TSX/JS file.
 * Directives are string-literal expression statements that appear before any other code.
 */
export function extractDirectivesTS(root: TSNode, _source: string): string[] {
  const directives: string[] = [];
  for (const child of namedChildren(root)) {
    if (child.type !== "expression_statement") break;
    const expr = child.namedChild(0);
    if (!expr || expr.type !== "string") break;
    const val = expr.text.replace(/^['"`]|['"`]$/g, "");
    if (val === "use client" || val === "use server") {
      directives.push(val);
    } else {
      break;
    }
  }
  return directives;
}

/**
 * Extractor shared by TypeScript, TSX and JavaScript.
 * TS-only node types (interface/type/enum) simply never appear in JS sources.
 */
export function extractTypeScript(root: TSNode, _source: string): SymbolNode[] {
  return collect(namedChildren(root), false);
}

function collect(nodes: TSNode[], exported: boolean): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of nodes) {
    const res = handle(n, exported);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

function handle(node: TSNode, exported: boolean): SymbolNode | SymbolNode[] | null {
  switch (node.type) {
    case "export_statement":
      // `export <decl>` / `export default <decl>` — mark the inner declarations exported.
      return collect(namedChildren(node), true);

    case "class_declaration":
    case "abstract_class_declaration": {
      const name = nameOf(node) ?? "(anonymous class)";
      const body = node.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false) : [];
      return makeSymbol({
        name,
        kind: "class",
        node,
        rawKind: node.type,
        exported,
        doc: leadingComment(node),
        children,
      });
    }

    case "interface_declaration": {
      const name = nameOf(node) ?? "(anonymous interface)";
      const body = node.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false) : [];
      return makeSymbol({
        name,
        kind: "interface",
        node,
        rawKind: node.type,
        exported,
        doc: leadingComment(node),
        children,
      });
    }

    case "function_declaration":
    case "generator_function_declaration": {
      const name = nameOf(node) ?? "(anonymous function)";
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        exported,
        doc: leadingComment(node),
      });
    }

    case "type_alias_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(type)",
        kind: "type",
        node,
        rawKind: node.type,
        signature: headerSignature(node, null),
        exported,
        doc: leadingComment(node),
      });

    case "enum_declaration":
      return makeSymbol({
        name: nameOf(node) ?? "(enum)",
        kind: "enum",
        node,
        rawKind: node.type,
        exported,
        doc: leadingComment(node),
      });

    case "lexical_declaration":
    case "variable_declaration":
      return fromVariableDeclaration(node, exported);

    case "method_definition":
    case "method_signature":
    case "abstract_method_signature": {
      const name = nameOf(node) ?? "(method)";
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility: memberVisibility(node),
        doc: leadingComment(node),
      });
    }

    case "public_field_definition":
    case "field_definition": {
      // Only surface fields that hold an arrow/function (i.e. behave like methods).
      const value = node.childForFieldName("value");
      if (value && (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")) {
        const name = nameOf(node) ?? "(method)";
        const body = value.childForFieldName("body");
        return makeSymbol({
          name,
          kind: "method",
          node,
          rawKind: node.type,
          signature: headerSignature(node, body),
          visibility: memberVisibility(node),
          doc: leadingComment(node),
        });
      }
      return null;
    }

    default:
      return null;
  }
}

function fromVariableDeclaration(node: TSNode, exported: boolean): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const decl of namedChildren(node)) {
    if (decl.type !== "variable_declarator") continue;
    const value = decl.childForFieldName("value");
    const name = nameOf(decl);
    if (!name) continue;

    if (value && (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")) {
      const body = value.childForFieldName("body");
      out.push(makeSymbol({
        name,
        kind: "function",
        node: decl,
        rawKind: `${node.type}>arrow`,
        signature: headerSignature(value, body),
        exported,
        doc: leadingComment(node),
      }));
    } else if (value && (value.type === "class_expression" || value.type === "class")) {
      // const MyClass = class { ... }
      const body = value.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false) : [];
      out.push(makeSymbol({
        name,
        kind: "class",
        node: decl,
        rawKind: `${node.type}>class`,
        exported,
        doc: leadingComment(node),
        children,
      }));
    } else if (exported && value) {
      // export const FOO = <any non-function value> — track for dead code detection
      out.push(makeSymbol({
        name,
        kind: "const",
        node: decl,
        rawKind: `${node.type}>const`,
        signature: decl.text.replace(/\s+/g, " ").trim().slice(0, 120),
        exported: true,
        doc: leadingComment(node),
      }));
    }
  }
  return out;
}

// ─── Import extraction ────────────────────────────────────────────────────────

export function extractImportsTS(root: TSNode, _source: string): ImportRef[] {
  const imports: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type === "import_statement") parseImportStatement(child, imports);
    // Re-exports: `export { X } from './foo'` or `export * from './foo'`
    else if (child.type === "export_statement") parseReExportStatement(child, imports);
  }
  return imports;
}

function parseReExportStatement(node: TSNode, out: ImportRef[]): void {
  const source = extractModulePath(node.text);
  if (!source) return; // no `from` clause — local re-export, not an import

  const isTypeOnly = /^export\s+type\b/.test(node.text);

  // export * from './foo'  or  export * as Foo from './foo'
  if (/^export\s+\*/.test(node.text)) {
    out.push({ symbol: "*", from: source, isNamespaceImport: true });
    return;
  }

  // export { X, Y as Z } from './foo'
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c || c.type !== "export_clause") continue;
    for (let j = 0; j < c.namedChildCount; j++) {
      const spec = c.namedChild(j);
      if (!spec || spec.type !== "export_specifier") continue;
      const nameNode = spec.childForFieldName("name");
      const aliasNode = spec.childForFieldName("alias");
      if (nameNode) {
        const imp: ImportRef = { symbol: nameNode.text, from: source };
        if (aliasNode) imp.alias = aliasNode.text;
        if (isTypeOnly) imp.isTypeOnly = true;
        out.push(imp);
      }
    }
  }
}

function parseImportStatement(node: TSNode, out: ImportRef[]): void {
  const isTypeOnly = /^import\s+type\b/.test(node.text);
  const from = extractModulePath(node.text);
  if (!from) return;

  let clauseNode: TSNode | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === "import_clause") { clauseNode = c; break; }
  }

  if (!clauseNode) {
    out.push({ symbol: "*", from, isSideEffect: true });
    return;
  }

  for (let i = 0; i < clauseNode.namedChildCount; i++) {
    const c = clauseNode.namedChild(i);
    if (!c) continue;

    if (c.type === "identifier") {
      const imp: ImportRef = { symbol: c.text, from, isDefault: true };
      if (isTypeOnly) imp.isTypeOnly = true;
      out.push(imp);
    } else if (c.type === "namespace_import") {
      const id = c.namedChild(0);
      if (id) {
        const imp: ImportRef = { symbol: id.text, from, isNamespaceImport: true };
        if (isTypeOnly) imp.isTypeOnly = true;
        out.push(imp);
      }
    } else if (c.type === "named_imports") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const spec = c.namedChild(j);
        if (!spec || spec.type !== "import_specifier") continue;
        const nameNode = spec.childForFieldName("name");
        const aliasNode = spec.childForFieldName("alias");
        if (nameNode) {
          const imp: ImportRef = { symbol: nameNode.text, from };
          if (aliasNode) imp.alias = aliasNode.text;
          if (isTypeOnly) imp.isTypeOnly = true;
          out.push(imp);
        }
      }
    }
  }
}

function extractModulePath(importText: string): string | null {
  const m = importText.match(/from\s+['"`]([^'"`\n]+)['"`]/);
  if (m) return m[1];
  const m2 = importText.match(/^import\s+(?:type\s+)?['"`]([^'"`\n]+)['"`]/);
  return m2 ? m2[1] : null;
}

// ─── Member visibility ────────────────────────────────────────────────────────

function memberVisibility(node: TSNode): "public" | "private" {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === "accessibility_modifier") {
      return c.text === "private" || c.text === "protected" ? "private" : "public";
    }
  }
  // `#name` ES private fields/methods
  const name = node.childForFieldName("name");
  if (name && name.type === "private_property_identifier") return "private";
  return "public";
}
