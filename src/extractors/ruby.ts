import type { TSNode } from "../parser.js";
import { namedChildren, nameOf, headerSignature, leadingComment } from "../parser.js";
import type { SymbolNode, ImportRef } from "../types.js";
import { makeSymbol } from "./common.js";

// ─── Ruby extractor (tree-sitter-ruby) ────────────────────────────────────────
// Tracks `private` / `protected` visibility sections inside class bodies.

export function extractRuby(root: TSNode, _source: string): SymbolNode[] {
  return collect(namedChildren(root), false);
}

function collect(nodes: TSNode[], insideClass: boolean): SymbolNode[] {
  const out: SymbolNode[] = [];
  let visibility: "public" | "private" = "public";

  for (const n of nodes) {
    // Bare `private` / `protected` / `public` switches the section.
    if (n.type === "identifier") {
      if (n.text === "private" || n.text === "protected") visibility = "private";
      else if (n.text === "public") visibility = "public";
      continue;
    }
    const sym = handle(n, insideClass, visibility);
    if (sym) out.push(sym);
  }
  return out;
}

function bodyOf(node: TSNode): TSNode | null {
  const byField = node.childForFieldName("body");
  if (byField) return byField;
  for (const c of namedChildren(node)) {
    if (c.type === "body_statement") return c;
  }
  return null;
}

function handle(
  node: TSNode,
  insideClass: boolean,
  visibility: "public" | "private",
): SymbolNode | null {
  switch (node.type) {
    case "class": {
      const body = bodyOf(node);
      return makeSymbol({
        name: nameOf(node) ?? "(class)",
        kind: "class",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body), true) : [],
      });
    }
    case "module": {
      const body = bodyOf(node);
      return makeSymbol({
        name: nameOf(node) ?? "(module)",
        kind: "namespace",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        doc: leadingComment(node),
        children: body ? collect(namedChildren(body), true) : [],
      });
    }
    case "method": {
      const body = bodyOf(node);
      const name = nameOf(node) ?? "(method)";
      return makeSymbol({
        name,
        kind: insideClass ? "method" : "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility,
        exported: visibility === "public",
        doc: leadingComment(node),
      });
    }
    case "singleton_method": {
      const body = bodyOf(node);
      const name = nameOf(node) ?? "(method)";
      return makeSymbol({
        name: `self.${name}`,
        kind: insideClass ? "method" : "function",
        node,
        rawKind: node.type,
        signature: headerSignature(node, body),
        visibility,
        exported: visibility === "public",
        doc: leadingComment(node),
      });
    }
    case "assignment": {
      // Top-level / class-level CONSTANT = ...
      const left = namedChildren(node)[0];
      if (left?.type === "constant") {
        return makeSymbol({
          name: left.text,
          kind: "const",
          node,
          rawKind: node.type,
        });
      }
      return null;
    }
    default:
      return null;
  }
}

// ─── Import extraction ────────────────────────────────────────────────────────
// `require 'x'` (external) and `require_relative './x'` (relative).

export function extractImportsRuby(root: TSNode, _source: string): ImportRef[] {
  const imports: ImportRef[] = [];
  for (const n of namedChildren(root)) collectRequire(n, imports, 0);
  return imports;
}

function collectRequire(node: TSNode, out: ImportRef[], depth: number): void {
  if (depth > 3) return;
  if (node.type === "call") {
    const fn = namedChildren(node)[0];
    if (fn?.type === "identifier" && (fn.text === "require" || fn.text === "require_relative")) {
      const args = node.childForFieldName("arguments") ?? findArgs(node);
      const str = args ? firstString(args) : null;
      if (str) {
        const from = fn.text === "require_relative" && !str.startsWith(".") ? `./${str}` : str;
        out.push({ symbol: "*", from, isSideEffect: true });
      }
      return;
    }
  }
  for (const c of namedChildren(node)) collectRequire(c, out, depth + 1);
}

function findArgs(node: TSNode): TSNode | null {
  for (const c of namedChildren(node)) if (c.type === "argument_list") return c;
  return null;
}

function firstString(args: TSNode): string | null {
  for (const c of namedChildren(args)) {
    if (c.type === "string") {
      return c.text.replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}
