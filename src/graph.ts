import path from "node:path";
import type { SkeletonFile, SymbolNode } from "./types.js";
import { resolveImportPath } from "./resolver.js";

// ─── Node types ───────────────────────────────────────────────────────────────

export interface GraphFileNode {
  id: string;          // e.g. "src/foo.ts"
  nodeType: "file";
  language: string;
  symbolCount: number;
}

export interface GraphSymbolNode {
  id: string;          // e.g. "src/foo.ts::MyClass" or "src/foo.ts::MyClass.method"
  nodeType: "symbol";
  file: string;        // owning file rel path
  symbol: string;      // short name of this symbol
  kind: string;
  exported: boolean;
  range: { startLine: number; endLine: number };
  signature?: string | null;
}

export type GraphNode = GraphFileNode | GraphSymbolNode;

// ─── Edge type ────────────────────────────────────────────────────────────────

export interface GraphEdge {
  from: string;        // node id
  to: string;          // node id
  /** "contains" = structural parent→child; "imports" = cross-file dependency. */
  edgeType: "contains" | "imports";
}

// ─── Graph ───────────────────────────────────────────────────────────────────

export interface SymbolGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    fileCount: number;
    symbolNodeCount: number;
    edgeCount: number;
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectSymbolNodes(
  symbols: SymbolNode[],
  parentId: string,
  file: string,
  nodes: GraphSymbolNode[],
  edges: GraphEdge[],
): void {
  for (const sym of symbols) {
    // Nested symbols use dot-notation: "src/foo.ts::MyClass.methodName"
    const nodeId = `${parentId}.${sym.name}`;
    nodes.push({
      id: nodeId,
      nodeType: "symbol",
      file,
      symbol: sym.name,
      kind: sym.kind,
      exported: sym.exported ?? false,
      range: sym.range,
      ...(sym.signature ? { signature: sym.signature } : {}),
    });
    edges.push({ from: parentId, to: nodeId, edgeType: "contains" });

    if (sym.children.length > 0) {
      collectSymbolNodes(sym.children, nodeId, file, nodes, edges);
    }
  }
}

// ─── Public builder ──────────────────────────────────────────────────────────

/**
 * Build a symbol-level dependency graph from an array of pre-parsed skeletons.
 *
 * Node IDs:
 *   - File node:   "<relPath>"                       e.g. "src/utils.ts"
 *   - Top symbol:  "<relPath>::<Name>"               e.g. "src/utils.ts::sanitize"
 *   - Nested:      "<relPath>::<Parent>.<Child>"     e.g. "src/utils.ts::MyClass.render"
 *
 * Edge types:
 *   - "contains"  file → symbol (and parent-symbol → child-symbol)
 *   - "imports"   importing-file → imported-symbol-node
 */
export function buildSymbolGraph(skeletons: SkeletonFile[], root: string): SymbolGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // exportedSymbolMap: relFile → (symbolName → nodeId)
  // Used in the second pass to resolve import targets.
  const exportedSymbolMap = new Map<string, Map<string, string>>();

  // ── First pass: build all file + symbol nodes ────────────────────────────
  for (const skel of skeletons) {
    // File node
    nodes.push({
      id: skel.file,
      nodeType: "file",
      language: skel.language,
      symbolCount: skel.symbolCount,
    });

    const fileExports = new Map<string, string>();
    exportedSymbolMap.set(skel.file, fileExports);

    for (const sym of skel.symbols) {
      const nodeId = `${skel.file}::${sym.name}`;
      nodes.push({
        id: nodeId,
        nodeType: "symbol",
        file: skel.file,
        symbol: sym.name,
        kind: sym.kind,
        exported: sym.exported ?? false,
        range: sym.range,
        ...(sym.signature ? { signature: sym.signature } : {}),
      });
      edges.push({ from: skel.file, to: nodeId, edgeType: "contains" });

      if (sym.exported) fileExports.set(sym.name, nodeId);

      // Collect nested symbols
      if (sym.children.length > 0) {
        const childNodes: GraphSymbolNode[] = [];
        const childEdges: GraphEdge[] = [];
        collectSymbolNodes(sym.children, nodeId, skel.file, childNodes, childEdges);
        nodes.push(...childNodes);
        edges.push(...childEdges);
      }
    }
  }

  // ── Second pass: wire import edges ───────────────────────────────────────
  for (const skel of skeletons) {
    if (!skel.imports || skel.imports.length === 0) continue;

    const fromFileAbs = path.resolve(root, skel.file);

    for (const imp of skel.imports) {
      if (!imp.from.startsWith(".")) continue; // skip external packages
      if (imp.isSideEffect) continue;

      const resolvedAbs = resolveImportPath(imp.from, fromFileAbs);
      if (!resolvedAbs) continue;

      const resolvedRel = path.relative(root, resolvedAbs).split(path.sep).join("/");

      if (imp.isNamespaceImport || imp.symbol === "*") {
        // Namespace import — link to the file node itself
        if (exportedSymbolMap.has(resolvedRel)) {
          edges.push({ from: skel.file, to: resolvedRel, edgeType: "imports" });
        }
      } else {
        const fileExports = exportedSymbolMap.get(resolvedRel);
        const targetNodeId = fileExports?.get(imp.symbol);
        if (targetNodeId) {
          edges.push({ from: skel.file, to: targetNodeId, edgeType: "imports" });
        }
      }
    }
  }

  const symbolNodeCount = nodes.filter((n) => n.nodeType === "symbol").length;

  return {
    nodes,
    edges,
    stats: {
      fileCount: skeletons.length,
      symbolNodeCount,
      edgeCount: edges.length,
    },
  };
}
