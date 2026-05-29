import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol } from "./common.js";

/* ─── helpers (shared with C extractor in spirit but kept local) ──────────── */

function childOfType(node: TSNode, type: string): TSNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return c;
  }
  return null;
}

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
    case "reference_declarator":
      return nameFromDeclarator(node.childForFieldName("declarator") ?? node.namedChild(0));
    case "function_declarator":
    case "init_declarator":
      return nameFromDeclarator(node.childForFieldName("declarator"));
    case "qualified_identifier": {
      // Foo::bar — use "bar" as the leaf name
      const last = node.childForFieldName("name");
      return last ? last.text : node.text;
    }
    case "operator_name":
    case "destructor_name":
      return node.text;
    default:
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c && (c.type === "identifier" || c.type === "field_identifier" || c.type === "type_identifier")) return c.text;
      }
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

function hasStaticStorage(node: TSNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === "storage_class_specifier" && c.text === "static") return true;
  }
  return false;
}

/* ─── imports (#include) ──────────────────────────────────────────────────── */

export function extractImportsCpp(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  const visit = (n: TSNode) => {
    for (const c of namedChildren(n)) {
      if (c.type === "preproc_include") {
        const p = childOfType(c, "system_lib_string") ?? childOfType(c, "string_literal");
        if (p) {
          const raw = p.text.replace(/^[<"]|[>"]$/g, "");
          const base = raw.split("/").pop() ?? raw;
          out.push({ symbol: base.replace(/\.[hH](pp|xx|h)?$/, ""), from: raw });
        }
      } else if (c.type === "namespace_definition" || c.type === "linkage_specification") {
        const body = c.childForFieldName("body");
        if (body) visit(body);
      }
    }
  };
  visit(root);
  return out;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractCpp(root: TSNode, _source: string): SymbolNode[] {
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
    case "namespace_definition":
    case "linkage_specification": {
      // Recurse into body, flattening namespace contents to top level.
      const body = node.childForFieldName("body");
      return body ? collect(namedChildren(body)) : null;
    }

    case "class_specifier": {
      const name = nameOf(node);
      if (!name) return null;
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "class",
        node,
        rawKind: node.type,
        doc: leadingComment(node),
        children: body ? classMembers(body, "private") : [],
      });
    }

    case "struct_specifier": {
      const name = nameOf(node);
      if (!name) return null;
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "struct",
        node,
        rawKind: node.type,
        doc: leadingComment(node),
        children: body ? classMembers(body, "public") : [],
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
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: hasStaticStorage(node) ? "private" : "public",
        exported: !hasStaticStorage(node),
        doc: leadingComment(node),
      });
    }

    case "template_declaration": {
      // The actual declaration is buried; recurse to find it.
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (!c) continue;
        if (
          c.type === "class_specifier" ||
          c.type === "struct_specifier" ||
          c.type === "function_definition" ||
          c.type === "declaration"
        ) {
          const res = handle(c);
          if (res) return res;
        }
      }
      return null;
    }

    case "alias_declaration":
    case "type_definition": {
      const decl = node.childForFieldName("declarator");
      const name = nameOf(node) ?? nameFromDeclarator(decl);
      if (!name) return null;
      return makeSymbol({
        name,
        kind: "type",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
      });
    }

    case "declaration": {
      const decl = node.childForFieldName("declarator");
      const name = nameFromDeclarator(decl);
      if (!name) return null;
      if (decl && containsFunctionDeclarator(decl)) return null; // prototype
      return makeSymbol({
        name,
        kind: "var",
        node,
        rawKind: node.type,
        signature: node.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
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
      });
    }

    default:
      return null;
  }
}

/** Walk class/struct body, tracking the current access_specifier (default given). */
function classMembers(body: TSNode, defaultAccess: "public" | "private"): SymbolNode[] {
  let current: "public" | "private" = defaultAccess;
  const out: SymbolNode[] = [];
  for (let i = 0; i < body.childCount; i++) {
    const c = body.child(i);
    if (!c) continue;
    if (c.type === "access_specifier") {
      current = /\bpublic\b/.test(c.text) ? "public" : "private";
      continue;
    }
    if (!c.isNamed) continue;
    if (c.type === "field_declaration") {
      const dec = c.childForFieldName("declarator");
      const name = nameFromDeclarator(dec);
      if (!name) continue;
      const isFunc = dec && containsFunctionDeclarator(dec);
      out.push(
        makeSymbol({
          name,
          kind: isFunc ? "method" : "field",
          node: c,
          rawKind: c.type,
          signature: c.text.replace(/\s+/g, " ").replace(/;$/, "").trim(),
          visibility: current,
        }),
      );
    } else if (c.type === "function_definition") {
      const dec = c.childForFieldName("declarator");
      const name = nameFromDeclarator(dec);
      if (!name) continue;
      out.push(
        makeSymbol({
          name,
          kind: "method",
          node: c,
          rawKind: c.type,
          signature: headerSignature(c, c.childForFieldName("body")),
          visibility: current,
        }),
      );
    }
  }
  return out;
}
