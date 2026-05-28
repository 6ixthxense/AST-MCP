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

/** Rust: `pub`, `pub(crate)`, ... = public; anything else = module-private. */
function isPub(node: TSNode): boolean {
  const vis = childOfType(node, "visibility_modifier");
  return !!vis && vis.text.startsWith("pub");
}

function vis(node: TSNode): "public" | "private" {
  return isPub(node) ? "public" : "private";
}

/* ─── import extraction ───────────────────────────────────────────────────── */

export function extractImportsRust(root: TSNode, _source: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const child of namedChildren(root)) {
    if (child.type === "use_declaration") {
      const arg = child.namedChild(0);
      if (arg) resolveUse(arg, "", out);
    }
  }
  return out;
}

function resolveUse(node: TSNode, prefix: string, out: ImportRef[]): void {
  switch (node.type) {
    case "identifier":
    case "type_identifier":
      out.push({ symbol: node.text, from: join(prefix, node.text) });
      return;
    case "scoped_identifier": {
      const full = node.text;
      const sym = full.split("::").pop() ?? full;
      out.push({ symbol: sym, from: full });
      return;
    }
    case "use_as_clause": {
      const path = node.namedChild(0);
      const alias = node.namedChild(1);
      const full = path ? path.text : "";
      const sym = full.split("::").pop() ?? full;
      out.push({ symbol: sym, from: full, alias: alias?.text });
      return;
    }
    case "use_wildcard": {
      const path = node.namedChild(0);
      out.push({ symbol: "*", from: path ? path.text : prefix, isNamespaceImport: true });
      return;
    }
    case "scoped_use_list": {
      const base = node.namedChild(0);
      const list = childOfType(node, "use_list");
      const newPrefix = base ? base.text : prefix;
      if (list) {
        for (const item of namedChildren(list)) resolveUse(item, newPrefix, out);
      }
      return;
    }
    case "use_list":
      for (const item of namedChildren(node)) resolveUse(item, prefix, out);
      return;
    default:
      return;
  }
}

function join(prefix: string, name: string): string {
  return prefix ? `${prefix}::${name}` : name;
}

/* ─── symbol extraction ───────────────────────────────────────────────────── */

export function extractRust(root: TSNode, _source: string): SymbolNode[] {
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
    case "struct_item": {
      const name = nameOf(node) ?? "(struct)";
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "struct",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: isPub(node),
        doc: leadingComment(node),
        children: body && body.type === "field_declaration_list" ? structFields(body) : [],
      });
    }

    case "trait_item": {
      const name = nameOf(node) ?? "(trait)";
      const body = node.childForFieldName("body");
      return makeSymbol({
        name,
        kind: "interface",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: isPub(node),
        doc: leadingComment(node),
        children: body ? traitMethods(body) : [],
      });
    }

    case "enum_item":
      return makeSymbol({
        name: nameOf(node) ?? "(enum)",
        kind: "enum",
        node,
        rawKind: node.type,
        visibility: vis(node),
        exported: isPub(node),
        doc: leadingComment(node),
      });

    case "function_item": {
      const name = nameOf(node) ?? "(fn)";
      return makeSymbol({
        name,
        kind: "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("body")),
        visibility: vis(node),
        exported: isPub(node),
        doc: leadingComment(node),
      });
    }

    case "impl_item": {
      // Surface impl methods as `Type::method` so the association is visible.
      const typeNode = node.childForFieldName("type");
      const typeName = typeNode ? typeNode.text : "";
      const body = node.childForFieldName("body");
      const out: SymbolNode[] = [];
      if (body) {
        for (const m of namedChildren(body)) {
          if (m.type !== "function_item") continue;
          const mName = nameOf(m) ?? "(fn)";
          out.push(
            makeSymbol({
              name: typeName ? `${typeName}::${mName}` : mName,
              kind: "method",
              node: m,
              rawKind: m.type,
              signature: headerSignature(m, m.childForFieldName("body")),
              visibility: vis(m),
              exported: isPub(m),
              doc: leadingComment(m),
            }),
          );
        }
      }
      return out;
    }

    case "const_item":
      return makeSymbol({
        name: nameOf(node) ?? "(const)",
        kind: "const",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("value")),
        visibility: vis(node),
        exported: isPub(node),
      });

    case "static_item":
      return makeSymbol({
        name: nameOf(node) ?? "(static)",
        kind: "var",
        node,
        rawKind: node.type,
        signature: headerSignature(node, node.childForFieldName("value")),
        visibility: vis(node),
        exported: isPub(node),
      });

    case "type_item":
      return makeSymbol({
        name: nameOf(node) ?? "(type)",
        kind: "type",
        node,
        rawKind: node.type,
        signature: headerSignature(node, null),
        visibility: vis(node),
        exported: isPub(node),
      });

    case "mod_item": {
      // Flatten module contents to the top level.
      const body = node.childForFieldName("body");
      return body ? collect(namedChildren(body)) : null;
    }

    default:
      return null;
  }
}

function structFields(list: TSNode): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const field of namedChildren(list)) {
    if (field.type !== "field_declaration") continue;
    const name = nameOf(field);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind: "field",
        node: field,
        rawKind: field.type,
        signature: field.text.replace(/\s+/g, " ").trim(),
        visibility: vis(field),
        exported: isPub(field),
      }),
    );
  }
  return out;
}

function traitMethods(body: TSNode): SymbolNode[] {
  const out: SymbolNode[] = [];
  for (const m of namedChildren(body)) {
    if (m.type !== "function_signature_item" && m.type !== "function_item") continue;
    const name = nameOf(m);
    if (!name) continue;
    out.push(
      makeSymbol({
        name,
        kind: "method",
        node: m,
        rawKind: m.type,
        signature: headerSignature(m, m.childForFieldName("body")),
        visibility: "public",
        exported: true,
      }),
    );
  }
  return out;
}
