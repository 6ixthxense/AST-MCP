import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol, pythonVisibility } from "./common.js";

export function extractPython(root: TSNode, _source: string): SymbolNode[] {
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
  if (node.type === "decorated_definition") {
    const inner = innerDefinition(node);
    if (!inner) return null;
    const sym = handle(inner, insideClass);
    if (sym) {
      const decs = namedChildren(node)
        .filter((c) => c.type === "decorator")
        .map((d) => d.text.replace(/^@\s*/, "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 0);
      if (decs.length > 0) sym.decorators = decs;
    }
    return sym;
  }

  if (node.type === "class_definition") {
    const name = nameOf(node) ?? "(class)";
    const body = node.childForFieldName("body");
    const children = body ? collect(namedChildren(body), true) : [];
    return makeSymbol({
      name,
      kind: "class",
      node,
      rawKind: node.type,
      visibility: pythonVisibility(name),
      exported: pythonVisibility(name) === "public",
      doc: body ? docstring(body) : null,
      children,
    });
  }

  if (node.type === "function_definition") {
    const name = nameOf(node) ?? "(function)";
    const body = node.childForFieldName("body");
    return makeSymbol({
      name,
      kind: insideClass ? "method" : "function",
      node,
      rawKind: node.type,
      signature: headerSignature(node, body),
      visibility: pythonVisibility(name),
      exported: pythonVisibility(name) === "public",
      doc: body ? docstring(body) : null,
    });
  }

  return null;
}

function innerDefinition(decorated: TSNode): TSNode | null {
  const byField = decorated.childForFieldName("definition");
  if (byField) return byField;
  for (const c of namedChildren(decorated)) {
    if (c.type === "function_definition" || c.type === "class_definition") return c;
  }
  return null;
}

// ─── Import extraction ────────────────────────────────────────────────────────

export function extractImportsPython(root: TSNode, _source: string): ImportRef[] {
  const imports: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type === "import_statement") parseSimpleImport(child, imports);
    else if (child.type === "import_from_statement") parseFromImport(child, imports);
  }
  return imports;
}

function parseSimpleImport(node: TSNode, out: ImportRef[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === "dotted_name" || c.type === "identifier") {
      out.push({ symbol: c.text, from: c.text });
    } else if (c.type === "aliased_import") {
      const nameNode = c.childForFieldName("name");
      const aliasNode = c.childForFieldName("alias");
      if (nameNode) {
        const imp: ImportRef = { symbol: nameNode.text, from: nameNode.text };
        if (aliasNode) imp.alias = aliasNode.text;
        out.push(imp);
      }
    }
  }
}

/**
 * Convert Python import path to a JS-style relative path.
 * ".models" → "./models", "..utils" → "../utils", "os" → "os" (external).
 */
function pythonFromPath(raw: string): string {
  const m = raw.match(/^(\.+)(.*)/);
  if (!m) return raw; // absolute/external import
  const dotCount = m[1].length;
  const rest = m[2]; // module name after the dots, e.g. "models" or ""
  const upDirs = dotCount === 1 ? "." : Array(dotCount - 1).fill("..").join("/");
  return rest ? `${upDirs}/${rest.replace(/\./g, "/")}` : upDirs;
}

function parseFromImport(node: TSNode, out: ImportRef[]): void {
  const moduleNode = node.childForFieldName("module_name");
  const from = moduleNode ? pythonFromPath(moduleNode.text) : ".";

  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c || c === moduleNode) continue;

    if (c.type === "wildcard_import") {
      out.push({ symbol: "*", from, isNamespaceImport: true });
    } else if (c.type === "relative_import" || c.type === "dotted_name") {
      // skip — these are part of the module path, not the imported names
    } else if (c.type === "identifier") {
      out.push({ symbol: c.text, from });
    } else if (c.type === "aliased_import") {
      const nameNode = c.childForFieldName("name");
      const aliasNode = c.childForFieldName("alias");
      if (nameNode) {
        const imp: ImportRef = { symbol: nameNode.text, from };
        if (aliasNode) imp.alias = aliasNode.text;
        out.push(imp);
      }
    }
  }
}

/** Extract a leading triple-quoted docstring from a `block`. */
function docstring(body: TSNode): string | null {
  const first = body.namedChild(0);
  if (!first || first.type !== "expression_statement") return null;
  const str = first.namedChild(0);
  if (!str || str.type !== "string") return null;
  return str.text.replace(/^[rbuRBU]*("""|'''|"|')/, "").replace(/("""|'''|"|')$/, "").trim().slice(0, 500);
}
