import path from "node:path";
import type { SkeletonFile, SymbolNode, ImportRef } from "./types.js";
import { resolveImportPath, resolveAliasedImport } from "./resolver.js";
import { resolveWorkspaceImportCached } from "./workspace.js";
import {
  buildCrossLangIndex,
  resolveCrossLangTarget,
  type CrossLangIndex,
} from "./crosslang.js";

// ─── Node types ───────────────────────────────────────────────────────────────

export interface GraphFileNode {
  id: string;
  nodeType: "file";
  language: string;
  symbolCount: number;
}

export interface GraphSymbolNode {
  id: string;
  nodeType: "symbol";
  file: string;
  symbol: string;
  kind: string;
  exported: boolean;
  range: { startLine: number; endLine: number };
  signature?: string | null;
}

export type GraphNode = GraphFileNode | GraphSymbolNode;

export interface GraphEdge {
  from: string;
  to: string;
  edgeType: "contains" | "imports";
}

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

// Returns true for path-based import languages (TS/JS/Python/Go).
function isPathBasedLanguage(language: string): boolean {
  return (
    language === "typescript" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "python" ||
    language === "vue" ||
    language === "svelte"
  );
}

// Wire one TS/JS/Python-style relative import.
function wirePathImport(
  skel: SkeletonFile,
  imp: ImportRef,
  fromFileAbs: string,
  root: string,
  exportedSymbolMap: Map<string, Map<string, string>>,
  edges: GraphEdge[],
): void {
  if (imp.isSideEffect) return;
  // Relative import → path resolve; bare specifier → monorepo workspace package.
  const resolvedAbs = imp.from.startsWith(".")
    ? resolveImportPath(imp.from, fromFileAbs)
    : resolveAliasedImport(imp.from, fromFileAbs) ?? resolveWorkspaceImportCached(imp.from, root);
  if (!resolvedAbs) return;
  const resolvedRel = path.relative(root, resolvedAbs).split(path.sep).join("/");

  if (imp.isNamespaceImport || imp.symbol === "*") {
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

// Wire one cross-language import (Java/C#/Rust) using the project-wide index.
function wireCrossLangImport(
  skel: SkeletonFile,
  imp: ImportRef,
  fromFileAbs: string,
  root: string,
  index: CrossLangIndex,
  exportedSymbolMap: Map<string, Map<string, string>>,
  edges: GraphEdge[],
): void {
  if (imp.isSideEffect) return;
  const target = resolveCrossLangTarget(imp, skel, fromFileAbs, root, index);
  if (!target) return;

  if (target.kind === "file") {
    for (const f of target.files) {
      if (exportedSymbolMap.has(f) && f !== skel.file) {
        edges.push({ from: skel.file, to: f, edgeType: "imports" });
      }
    }
    return;
  }

  // target.kind === "symbol"
  const fileExports = exportedSymbolMap.get(target.file);
  const targetNodeId = fileExports?.get(target.symbol);
  if (targetNodeId) {
    edges.push({ from: skel.file, to: targetNodeId, edgeType: "imports" });
  } else if (exportedSymbolMap.has(target.file) && target.file !== skel.file) {
    // Symbol not found in the resolved file — fall back to a file-level edge so
    // the graph still reflects the cross-file dependency.
    edges.push({ from: skel.file, to: target.file, edgeType: "imports" });
  }
}

// ─── Public builder ──────────────────────────────────────────────────────────

export function buildSymbolGraph(skeletons: SkeletonFile[], root: string): SymbolGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const exportedSymbolMap = new Map<string, Map<string, string>>();

  // First pass: build file and symbol nodes.
  for (const skel of skeletons) {
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

      // Index exported (and visible-by-convention) top-level symbols so that
      // imports can find them. Languages like Java/C# may have visible types
      // without an explicit "exported" flag — fall back to indexing all
      // top-level symbols for those languages.
      if (sym.exported) fileExports.set(sym.name, nodeId);
      else if (skel.language === "java" || skel.language === "csharp") {
        fileExports.set(sym.name, nodeId);
      }

      if (sym.children.length > 0) {
        const childNodes: GraphSymbolNode[] = [];
        const childEdges: GraphEdge[] = [];
        collectSymbolNodes(sym.children, nodeId, skel.file, childNodes, childEdges);
        nodes.push(...childNodes);
        edges.push(...childEdges);
      }
    }
  }

  // Build cross-language indexes once (Java FQCN, C# namespaces).
  const crossIndex = buildCrossLangIndex(skeletons);

  // Second pass: wire import edges, dispatched by language.
  for (const skel of skeletons) {
    if (!skel.imports || skel.imports.length === 0) continue;
    const fromFileAbs = path.resolve(root, skel.file);
    const pathBased = isPathBasedLanguage(skel.language);

    for (const imp of skel.imports) {
      if (pathBased) {
        wirePathImport(skel, imp, fromFileAbs, root, exportedSymbolMap, edges);
      } else if (
        skel.language === "java" ||
        skel.language === "csharp" ||
        skel.language === "rust" ||
        skel.language === "go" ||
        skel.language === "kotlin" ||
        skel.language === "c" ||
        skel.language === "cpp" ||
        skel.language === "swift"
      ) {
        wireCrossLangImport(skel, imp, fromFileAbs, root, crossIndex, exportedSymbolMap, edges);
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
