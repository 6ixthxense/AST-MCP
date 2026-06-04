import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef, PropInfo } from "../types.js";
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
type TypeIndex = Map<string, PropInfo[]>;

export function extractTypeScript(root: TSNode, _source: string): SymbolNode[] {
  const typeIndex = buildTypeIndex(root);
  return collect(namedChildren(root), false, typeIndex);
}

function collect(nodes: TSNode[], exported: boolean, typeIndex: TypeIndex): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of nodes) {
    const res = handle(n, exported, typeIndex);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

function handle(node: TSNode, exported: boolean, typeIndex: TypeIndex): SymbolNode | SymbolNode[] | null {
  switch (node.type) {
    case "export_statement":
      // `export <decl>` / `export default <decl>` — mark the inner declarations exported.
      return collect(namedChildren(node), true, typeIndex);

    case "class_declaration":
    case "abstract_class_declaration": {
      const name = nameOf(node) ?? "(anonymous class)";
      const body = node.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false, typeIndex) : [];
      const clsSym = makeSymbol({
        name,
        kind: "class",
        node,
        rawKind: node.type,
        exported,
        doc: leadingComment(node),
        children,
      });
      attachDecorators(clsSym, node);
      return clsSym;
    }

    case "interface_declaration": {
      const name = nameOf(node) ?? "(anonymous interface)";
      const body = node.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false, typeIndex) : [];
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
      const fnSym = makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        exported,
        doc: leadingComment(node),
      });
      attachComponentInfo(fnSym, node, null, name, typeIndex);
      return fnSym;
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
      return fromVariableDeclaration(node, exported, typeIndex);

    case "method_definition":
    case "method_signature":
    case "abstract_method_signature": {
      const name = nameOf(node) ?? "(method)";
      const body = node.childForFieldName("body");
      const mSym = makeSymbol({
        name,
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility: memberVisibility(node),
        doc: leadingComment(node),
      });
      attachDecorators(mSym, node);
      return mSym;
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

    case "ambient_declaration":
      // `.d.ts` / `declare ...` — surface the declared API as exported.
      return collect(namedChildren(node), true, typeIndex);

    case "function_signature": {
      const name = nameOf(node) ?? "(function)";
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;\s*$/, "").trim(),
        exported,
        doc: leadingComment(node),
      });
    }

    case "module":            // declare module "name" { ... }
    case "internal_module": { // namespace Name { ... }
      const nameNode = node.childForFieldName("name");
      const rawName = nameNode ? nameNode.text : "(namespace)";
      const name = rawName.replace(/^['"`]|['"`]$/g, "");
      const body = node.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false, typeIndex) : [];
      return makeSymbol({
        name,
        kind: "namespace",
        node,
        rawKind: node.type,
        exported,
        doc: leadingComment(node),
        children,
      });
    }

    default:
      return null;
  }
}

function fromVariableDeclaration(node: TSNode, exported: boolean, typeIndex: TypeIndex): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const decl of namedChildren(node)) {
    if (decl.type !== "variable_declarator") continue;
    const value = decl.childForFieldName("value");
    const name = nameOf(decl);
    if (!name) continue;

    if (value && (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")) {
      const body = value.childForFieldName("body");
      const arrowSym = makeSymbol({
        name,
        kind: "function",
        node: decl,
        rawKind: `${node.type}>arrow`,
        signature: headerSignature(value, body),
        exported,
        doc: leadingComment(node),
      });
      attachComponentInfo(arrowSym, value, decl, name, typeIndex);
      out.push(arrowSym);
    } else if (value && (value.type === "class_expression" || value.type === "class")) {
      // const MyClass = class { ... }
      const body = value.childForFieldName("body");
      const children = body ? collect(namedChildren(body), false, typeIndex) : [];
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
    } else if (exported && !value && decl.childForFieldName("type")) {
      // Ambient `declare const X: T` — no initializer, but part of the typed API.
      out.push(makeSymbol({
        name,
        kind: "const",
        node: decl,
        rawKind: `${node.type}>declare`,
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
  collectDynamicImports(root, imports);
  return imports;
}

/** First string-literal argument of a call's `arguments` node, or null. */
function firstStringArg(args: TSNode): string | null {
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (a && a.type === "string") {
      for (let j = 0; j < a.namedChildCount; j++) {
        const frag = a.namedChild(j);
        if (frag && frag.type === "string_fragment") return frag.text;
      }
      return a.text.replace(/^['"`]|['"`]$/g, "");
    }
  }
  return null;
}

/**
 * Walk the whole tree for dynamic `import("...")` and CommonJS `require("...")`
 * calls (they can appear anywhere, not just at the top level). Only string-literal
 * specifiers are captured; computed requires are skipped.
 */
function collectDynamicImports(node: TSNode, out: ImportRef[]): void {
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    const args = node.childForFieldName("arguments");
    if (fn && args) {
      const isImport = fn.type === "import";
      const isRequire = fn.type === "identifier" && fn.text === "require";
      if (isImport || isRequire) {
        const spec = firstStringArg(args);
        if (spec !== null) {
          out.push({ symbol: "*", from: spec, isNamespaceImport: true, isDynamic: true });
        }
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) collectDynamicImports(c, out);
  }
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

// ─── React/TSX component prop extraction ──────────────────────────────────────

const JSX_NODES = new Set(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]);

function firstNamed(node: TSNode): TSNode | null {
  return node.namedChildCount > 0 ? node.namedChild(0) : null;
}

/**
 * Index every top-level (and exported) interface / object-type alias by name,
 * mapping it to its prop fields. Used to resolve a component's named props type
 * (e.g. `ButtonProps`) back to its individual props.
 */
function buildTypeIndex(root: TSNode): TypeIndex {
  const idx: TypeIndex = new Map();
  const visit = (nodes: TSNode[]): void => {
    for (const n of nodes) {
      if (n.type === "export_statement") { visit(namedChildren(n)); continue; }
      if (n.type === "interface_declaration") {
        const name = nameOf(n);
        const body = n.childForFieldName("body");
        if (name && body) idx.set(name, propsFromMembers(body));
      } else if (n.type === "type_alias_declaration") {
        const name = nameOf(n);
        const val = n.childForFieldName("value");
        if (name && val && val.type === "object_type") idx.set(name, propsFromMembers(val));
      }
    }
  };
  visit(namedChildren(root));
  return idx;
}

/** Read `property_signature` members out of an interface_body / object_type. */
function propsFromMembers(container: TSNode): PropInfo[] {
  const props: PropInfo[] = [];
  for (const m of namedChildren(container)) {
    if (m.type !== "property_signature") continue;
    const nameNode = m.childForFieldName("name");
    if (!nameNode) continue;
    const info: PropInfo = { name: nameNode.text };
    const typeAnn = m.childForFieldName("type");
    const typeNode = typeAnn ? firstNamed(typeAnn) : null;
    if (typeNode) info.type = typeNode.text.replace(/\s+/g, " ").trim();
    const colon = m.text.indexOf(":");
    const head = colon >= 0 ? m.text.slice(0, colon) : m.text;
    if (head.includes("?")) info.optional = true;
    props.push(info);
  }
  return props;
}

/** Walk a function body looking for any JSX node (marks it a React component). */
function returnsJSX(node: TSNode | null): boolean {
  if (!node) return false;
  let found = false;
  const walk = (n: TSNode): void => {
    if (found) return;
    if (JSX_NODES.has(n.type)) { found = true; return; }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return found;
}

/**
 * If `typeNode` is `FC<P>` / `React.FC<P>` / `FunctionComponent<P>` (or the
 * React-qualified form), return the first type argument node (the props type).
 */
function fcTypeArgument(typeNode: TSNode | null): TSNode | null {
  if (!typeNode || typeNode.type !== "generic_type") return null;
  const base = typeNode.childForFieldName("name");
  const baseText = base ? base.text : "";
  if (!/(^|\.)(FC|FunctionComponent)$/.test(baseText)) return null;
  for (let i = 0; i < typeNode.namedChildCount; i++) {
    const c = typeNode.namedChild(i);
    if (c && c.type === "type_arguments") return firstNamed(c);
  }
  return null;
}

/**
 * Detect a React component (PascalCase + returns JSX, or typed as FC) and
 * attach its props. `funcNode` is the function/arrow; `declNode` is the
 * variable_declarator when the component is `const X: React.FC<P> = ...`.
 */
function attachComponentInfo(
  sym: SymbolNode,
  funcNode: TSNode,
  declNode: TSNode | null,
  name: string,
  idx: TypeIndex,
): void {
  if (!/^[A-Z]/.test(name)) return; // components are PascalCase

  let propsTypeNode: TSNode | null = null;
  let fc = false;
  if (declNode) {
    const ta = declNode.childForFieldName("type");
    const arg = ta ? fcTypeArgument(firstNamed(ta)) : null;
    if (arg) { propsTypeNode = arg; fc = true; }
  }

  if (!fc && !returnsJSX(funcNode.childForFieldName("body"))) return; // not a component

  if (!propsTypeNode) {
    const params = funcNode.childForFieldName("parameters");
    const first = params ? firstNamed(params) : null; // required/optional_parameter
    const ta = first ? first.childForFieldName("type") : null;
    if (ta) propsTypeNode = firstNamed(ta);
  }
  if (!propsTypeNode) return; // component, but untyped props — nothing to extract

  if (propsTypeNode.type === "object_type") {
    sym.props = propsFromMembers(propsTypeNode);
    return;
  }
  const typeName = propsTypeNode.text.replace(/\s+/g, " ").trim();
  sym.propsType = typeName;
  const resolved = idx.get(typeName);
  if (resolved) sym.props = resolved;
}

// ─── TS/JS decorators ─────────────────────────────────────────────────────────

/** Strip the leading `@` and collapse whitespace from a decorator node. */
function decoratorText(node: TSNode): string {
  return node.text.replace(/^@\s*/, "").replace(/\s+/g, " ").trim();
}

/**
 * Attach decorators to a class/method symbol. TS decorators appear either as
 * preceding sibling `decorator` nodes (classes, methods) or as leading child
 * decorators (some grammars) — collect both.
 */
function attachDecorators(sym: SymbolNode, node: TSNode): void {
  const decs: string[] = [];
  // leading child decorators
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === "decorator") decs.push(decoratorText(c));
    else if (c && c.type !== "decorator") break;
  }
  // preceding sibling decorators (most common for classes/methods)
  let prev = node.previousNamedSibling;
  const lead: string[] = [];
  while (prev && prev.type === "decorator") {
    lead.unshift(decoratorText(prev));
    prev = prev.previousNamedSibling;
  }
  const all = [...lead, ...decs].filter((t) => t.length > 0);
  if (all.length > 0) sym.decorators = all;
}
