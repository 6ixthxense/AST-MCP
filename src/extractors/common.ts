import type { TSNode } from "../parser.js";
import type { SymbolNode, SymbolKind } from "../types.js";

export function lineRange(node: TSNode) {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** True if the identifier begins with an uppercase letter (Go export rule). */
export function startsUpper(name: string): boolean {
  const c = name[0];
  return !!c && c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Python convention: a single leading underscore (but not dunder) means private. */
export function pythonVisibility(name: string): "public" | "private" {
  if (name.startsWith("__") && name.endsWith("__")) return "public"; // dunder
  return name.startsWith("_") ? "private" : "public";
}

export interface SymbolInit {
  name: string;
  kind: SymbolKind;
  node: TSNode;
  rawKind?: string;
  signature?: string | null;
  visibility?: "public" | "private";
  exported?: boolean;
  doc?: string | null;
  children?: SymbolNode[];
}

export function makeSymbol(init: SymbolInit): SymbolNode {
  const sym: SymbolNode = {
    name: init.name,
    kind: init.kind,
    visibility: init.visibility ?? "public",
    range: lineRange(init.node),
    children: init.children ?? [],
  };
  if (init.rawKind !== undefined) sym.rawKind = init.rawKind;
  if (init.signature !== undefined) sym.signature = init.signature;
  if (init.exported !== undefined) sym.exported = init.exported;
  if (init.doc !== undefined) sym.doc = init.doc;
  return sym;
}

/** Count a symbol tree, including nested children. */
export function countSymbols(symbols: SymbolNode[]): number {
  let n = 0;
  for (const s of symbols) n += 1 + countSymbols(s.children);
  return n;
}

/** Strip signature/doc/rawKind for the compact "outline" detail level. */
export function toOutline(symbols: SymbolNode[]): SymbolNode[] {
  return symbols.map((s) => {
    const out: SymbolNode = {
      name: s.name,
      kind: s.kind,
      visibility: s.visibility,
      range: s.range,
      children: toOutline(s.children),
    };
    if (s.exported !== undefined) out.exported = s.exported;
    return out;
  });
}
