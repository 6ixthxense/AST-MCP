import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol, startsUpper } from "./common.js";

// ─── Import extraction ────────────────────────────────────────────────────────

export function extractImportsGo(root: TSNode, _source: string): ImportRef[] {
  const imports: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type === "import_declaration") parseGoImportDecl(child, imports);
  }
  return imports;
}

function parseGoImportDecl(node: TSNode, out: ImportRef[]): void {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (!c) continue;
    if (c.type === "import_spec") parseGoImportSpec(c, out);
    else if (c.type === "import_spec_list") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const spec = c.namedChild(j);
        if (spec && spec.type === "import_spec") parseGoImportSpec(spec, out);
      }
    }
  }
}

function parseGoImportSpec(spec: TSNode, out: ImportRef[]): void {
  const pathNode = spec.childForFieldName("path");
  const nameNode = spec.childForFieldName("name");
  if (!pathNode) return;

  const from = pathNode.text.replace(/^['"`]|['"`]$/g, "");
  const pkgName = from.split("/").pop() ?? from;

  if (!nameNode) {
    out.push({ symbol: pkgName, from });
  } else if (nameNode.text === ".") {
    out.push({ symbol: ".", from, isNamespaceImport: true });
  } else if (nameNode.text === "_") {
    out.push({ symbol: "_", from, isSideEffect: true });
  } else {
    out.push({ symbol: pkgName, from, alias: nameNode.text });
  }
}

// ─── Symbol extraction ────────────────────────────────────────────────────────

export function extractGo(root: TSNode, _source: string): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const n of namedChildren(root)) {
    const res = handle(n);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

function handle(node: TSNode): SymbolNode | SymbolNode[] | null {
  switch (node.type) {
    case "function_declaration": {
      const name = nameOf(node) ?? "(func)";
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: startsUpper(name) ? "public" : "private",
        exported: startsUpper(name),
        doc: leadingComment(node),
      });
    }

    case "method_declaration": {
      const name = nameOf(node) ?? "(method)";
      return makeSymbol({
        name,
        kind: "method",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: startsUpper(name) ? "public" : "private",
        exported: startsUpper(name),
        doc: leadingComment(node),
      });
    }

    case "type_declaration": {
      const out: SymbolNode[] = [];
      for (const spec of namedChildren(node)) {
        if (spec.type === "type_spec" || spec.type === "type_alias") {
          const sym = fromTypeSpec(spec, node);
          if (sym) out.push(sym);
        }
      }
      return out;
    }

    case "const_declaration":
      return fromValueSpecs(node, "const");

    case "var_declaration":
      return fromValueSpecs(node, "var");

    default:
      return null;
  }
}

function fromTypeSpec(spec: TSNode, declNode: TSNode): SymbolNode | null {
  const name = nameOf(spec);
  if (!name) return null;
  const typeNode = spec.childForFieldName("type");
  const exported = startsUpper(name);
  const visibility = exported ? "public" : "private";
  const doc = leadingComment(declNode);

  if (typeNode && typeNode.type === "struct_type") {
    return makeSymbol({
      name,
      kind: "struct",
      node: spec,
      rawKind: spec.type,
      visibility,
      exported,
      doc,
      children: structFields(typeNode),
    });
  }

  if (typeNode && typeNode.type === "interface_type") {
    return makeSymbol({
      name,
      kind: "interface",
      node: spec,
      rawKind: spec.type,
      visibility,
      exported,
      doc,
      children: interfaceMethods(typeNode),
    });
  }

  return makeSymbol({
    name,
    kind: "type",
    node: spec,
    rawKind: spec.type,
    signature: headerSignature(spec, null),
    visibility,
    exported,
    doc,
  });
}

function structFields(structType: TSNode): SymbolNode[] {
  const list = namedChildren(structType).find((c) => c.type === "field_declaration_list");
  if (!list) return [];
  const out: SymbolNode[] = [];
  for (const field of namedChildren(list)) {
    if (field.type !== "field_declaration") continue;
    const name = nameOf(field);
    if (!name) continue; // skip embedded fields
    out.push(
      makeSymbol({
        name,
        kind: "field",
        node: field,
        rawKind: field.type,
        signature: field.text.replace(/\s+/g, " ").trim(),
        visibility: startsUpper(name) ? "public" : "private",
        exported: startsUpper(name),
      }),
    );
  }
  return out;
}

function interfaceMethods(interfaceType: TSNode): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const m of namedChildren(interfaceType)) {
    if (m.type !== "method_spec" && m.type !== "method_elem") continue;
    const name = nameOf(m);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind: "method",
        node: m,
        rawKind: m.type,
        signature: headerSignature(m, null),
        visibility: startsUpper(name) ? "public" : "private",
        exported: startsUpper(name),
      }),
    );
  }
  return out;
}

function fromValueSpecs(node: TSNode, kind: "const" | "var"): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const spec of namedChildren(node)) {
    if (spec.type !== "const_spec" && spec.type !== "var_spec") continue;
    const name = nameOf(spec);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind,
        node: spec,
        rawKind: spec.type,
        signature: spec.text.replace(/\s+/g, " ").trim(),
        visibility: startsUpper(name) ? "public" : "private",
        exported: startsUpper(name),
      }),
    );
  }
  return out;
}
