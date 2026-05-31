import type { SymbolGraph, GraphSymbolNode } from "./graph.js";

// ─── Dead Code Detection ──────────────────────────────────────────────────────

/**
 * "High" confidence = functions / classes / consts that are unlikely to be
 * used purely as type annotations.
 * "Low" confidence = interfaces / types / enums — these are often imported
 * implicitly through the TypeScript type system without an explicit import
 * statement, so they may appear "dead" even when they're actively used.
 */
const HIGH_CONFIDENCE_KINDS = new Set(["function", "class", "const", "var", "method"]);

export interface DeadExport {
  file: string;
  symbol: string;
  kind: string;
  nodeId: string;
  /** high → very likely unused.  low → may be used as a type annotation only. */
  confidence: "high" | "low";
}

/**
 * Return exported symbols that have no incoming "imports" edges within the
 * scanned directory — i.e. nothing inside the scan root depends on them.
 */
export function findDeadExports(graph: SymbolGraph): DeadExport[] {
  const importedIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.edgeType === "imports") importedIds.add(edge.to);
  }

  const dead: DeadExport[] = [];
  for (const node of graph.nodes) {
    if (node.nodeType !== "symbol") continue;
    const sym = node as GraphSymbolNode;
    if (sym.exported && !importedIds.has(sym.id)) {
      dead.push({
        file: sym.file,
        symbol: sym.symbol,
        kind: sym.kind,
        nodeId: sym.id,
        confidence: HIGH_CONFIDENCE_KINDS.has(sym.kind) ? "high" : "low",
      });
    }
  }
  return dead;
}

// ─── Circular Dependency Detection ───────────────────────────────────────────

export interface CircularDep {
  /** File paths forming the cycle; last element == first element to close the loop. */
  cycle: string[];
  length: number;
}

type DfsColor = "white" | "gray" | "black";

/**
 * Detect circular import dependencies among the scanned files using DFS.
 * Each reported cycle is canonicalised (rotated to start at the
 * lexicographically smallest node) to avoid duplicates.
 *
 * Re-uses the graph's already-resolved import edges — no path re-resolution needed.
 */
export function findCircularDeps(graph: SymbolGraph): CircularDep[] {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  // Build deduplicated file-level adjacency from the graph's "imports" edges
  const adjSets = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (node.nodeType === "file") adjSets.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    if (edge.edgeType !== "imports") continue;
    const toNode = nodeMap.get(edge.to);
    if (!toNode) continue;
    const toFile = toNode.nodeType === "file" ? toNode.id : (toNode as GraphSymbolNode).file;
    if (edge.from !== toFile) adjSets.get(edge.from)?.add(toFile);
  }
  const adj = new Map<string, string[]>();
  for (const [k, v] of adjSets) adj.set(k, [...v]);

  const color = new Map<string, DfsColor>();
  for (const f of adj.keys()) color.set(f, "white");

  const cycles: CircularDep[] = [];
  const cycleKeys = new Set<string>();

  // Iterative DFS — avoids call-stack overflow on large codebases (1000+ file chains).
  // Each stack frame tracks the current node and the next neighbor index to visit.
  type Frame = { node: string; nextIdx: number };

  for (const startNode of adj.keys()) {
    if (color.get(startNode) !== "white") continue;

    const stack: Frame[] = [{ node: startNode, nextIdx: 0 }];
    const path: string[] = [startNode];
    color.set(startNode, "gray");

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.node) ?? [];

      if (frame.nextIdx >= neighbors.length) {
        stack.pop();
        path.pop();
        color.set(frame.node, "black");
        continue;
      }

      const neighbor = neighbors[frame.nextIdx++];
      const nc = color.get(neighbor);

      if (nc === "gray") {
        const start = path.indexOf(neighbor);
        const raw = path.slice(start);
        const canonical = rotateCycle(raw);
        const key = canonical.join("→");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push({ cycle: [...canonical, canonical[0]], length: canonical.length });
        }
      } else if (nc === "white") {
        color.set(neighbor, "gray");
        path.push(neighbor);
        stack.push({ node: neighbor, nextIdx: 0 });
      }
    }
  }

  return cycles;
}

function rotateCycle(nodes: string[]): string[] {
  const minIdx = nodes.reduce((best, n, i) => (n < nodes[best] ? i : best), 0);
  return [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
}

// ─── Change Impact Analysis ───────────────────────────────────────────────────

export interface ImpactNode {
  nodeId: string;
  file: string;
  symbol?: string;
}

export interface ChangeImpact {
  targetNodeId: string;
  direct: ImpactNode[];
  transitive: ImpactNode[];
  /** Unique file count across direct + transitive dependents. */
  totalFiles: number;
}

/**
 * Compute the blast radius of changing a symbol: traverse the import graph in
 * reverse to find every file/symbol that directly or transitively depends on
 * the given node ID.
 *
 * Returns null if the target node ID is not found in the graph.
 */
export function getChangeImpact(graph: SymbolGraph, targetNodeId: string): ChangeImpact | null {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodeMap.has(targetNodeId)) return null;

  // Reverse adjacency: target → [nodes that import it]
  const reverseAdj = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.edgeType === "imports") {
      if (!reverseAdj.has(edge.to)) reverseAdj.set(edge.to, new Set());
      reverseAdj.get(edge.to)!.add(edge.from);
    }
  }

  const visited = new Set<string>([targetNodeId]);
  const directSet = new Set<string>();

  for (const dep of reverseAdj.get(targetNodeId) ?? []) {
    if (!visited.has(dep)) { visited.add(dep); directSet.add(dep); }
  }

  const transitiveSet = new Set<string>();
  const queue = [...directSet];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dep of reverseAdj.get(current) ?? []) {
      if (!visited.has(dep)) {
        visited.add(dep);
        transitiveSet.add(dep);
        queue.push(dep);
      }
    }
  }

  function toImpactNode(id: string): ImpactNode {
    const n = nodeMap.get(id);
    if (!n) return { nodeId: id, file: id };
    if (n.nodeType === "file") return { nodeId: id, file: n.id };
    const sym = n as GraphSymbolNode;
    return { nodeId: id, file: sym.file, symbol: sym.symbol };
  }

  const direct = [...directSet].map(toImpactNode);
  const transitive = [...transitiveSet].map(toImpactNode);
  const allFiles = new Set([...direct.map((e) => e.file), ...transitive.map((e) => e.file)]);

  return { targetNodeId, direct, transitive, totalFiles: allFiles.size };
}

// ─── File Dependencies ────────────────────────────────────────────────────────

export interface FileDep {
  file: string;
  /** Specific symbols imported from / by this file. */
  symbols: string[];
}

export interface FileDepResult {
  file: string;
  /** Files this file imports from (outgoing). */
  imports: FileDep[];
  /** Files that import from this file (incoming). */
  importedBy: FileDep[];
}

/**
 * Show the import relationships for a single file:
 *   - `imports`    — what this file pulls in (outgoing edges)
 *   - `importedBy` — who depends on this file (incoming edges)
 *
 * Returns null if the file node is not in the graph.
 */
export function getFileDeps(graph: SymbolGraph, fileId: string): FileDepResult | null {
  if (!graph.nodes.some((n) => n.id === fileId && n.nodeType === "file")) return null;

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // fileId → set of imported symbol names
  const outgoing = new Map<string, Set<string>>();
  // fileId → set of symbols they import from us
  const incoming = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (edge.edgeType !== "imports") continue;

    const toNode = nodeMap.get(edge.to);
    if (!toNode) continue;
    const toFile = toNode.nodeType === "file"
      ? toNode.id
      : (toNode as GraphSymbolNode).file;
    const symbolName = toNode.nodeType === "symbol"
      ? (toNode as GraphSymbolNode).symbol
      : null;

    if (edge.from === fileId && toFile !== fileId) {
      if (!outgoing.has(toFile)) outgoing.set(toFile, new Set());
      if (symbolName) outgoing.get(toFile)!.add(symbolName);
    }

    if (toFile === fileId && edge.from !== fileId) {
      if (!incoming.has(edge.from)) incoming.set(edge.from, new Set());
      if (symbolName) incoming.get(edge.from)!.add(symbolName);
    }
  }

  return {
    file: fileId,
    imports: [...outgoing.entries()].map(([file, syms]) => ({ file, symbols: [...syms].sort() })),
    importedBy: [...incoming.entries()].map(([file, syms]) => ({ file, symbols: [...syms].sort() })),
  };
}

// ─── Top Imported Symbols (God Node Detector) ────────────────────────────────

export interface TopSymbol {
  nodeId: string;
  file: string;
  symbol: string;
  kind: string;
  /** Number of distinct files that import this symbol. */
  importCount: number;
  importedByFiles: string[];
}

/**
 * Return the most-imported symbols in the graph, sorted descending by
 * the number of distinct files that depend on them. These are "God Nodes" —
 * high-risk symbols where a breaking change has maximum blast radius.
 */
export function getTopSymbols(graph: SymbolGraph, limit = 10): TopSymbol[] {
  // nodeId → set of importing file IDs
  const importers = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (edge.edgeType !== "imports") continue;
    if (!importers.has(edge.to)) importers.set(edge.to, new Set());
    importers.get(edge.to)!.add(edge.from);
  }

  const results: TopSymbol[] = [];
  for (const node of graph.nodes) {
    if (node.nodeType !== "symbol") continue;
    const sym = node as GraphSymbolNode;
    const fileImporters = importers.get(sym.id);
    if (!fileImporters || fileImporters.size === 0) continue;
    results.push({
      nodeId: sym.id,
      file: sym.file,
      symbol: sym.symbol,
      kind: sym.kind,
      importCount: fileImporters.size,
      importedByFiles: [...fileImporters].sort(),
    });
  }

  return results.sort((a, b) => b.importCount - a.importCount).slice(0, limit);
}

// ─── Duplicate Symbol Detection ──────────────────────────────────────────────

export interface DuplicateLocation {
  file: string;
  kind: string;
  nodeId: string;
}

export interface DuplicateSymbol {
  symbol: string;
  /** Number of distinct files that export a symbol with this name. */
  count: number;
  locations: DuplicateLocation[];
}

/**
 * Find symbol names that are exported from more than one file. These are often
 * accidental collisions (copy-paste, parallel implementations) that make a
 * codebase harder to navigate and can cause the wrong import to be auto-suggested.
 *
 * Only exported symbols are considered, and a name must appear in at least two
 * distinct files to count as a duplicate.
 */
export function findDuplicateSymbols(graph: SymbolGraph): DuplicateSymbol[] {
  const byName = new Map<string, GraphSymbolNode[]>();
  for (const node of graph.nodes) {
    if (node.nodeType !== "symbol") continue;
    const sym = node as GraphSymbolNode;
    if (!sym.exported) continue;
    const arr = byName.get(sym.symbol) ?? [];
    arr.push(sym);
    byName.set(sym.symbol, arr);
  }

  const out: DuplicateSymbol[] = [];
  for (const [name, syms] of byName) {
    // Collapse to one location per file (a file may declare the name once).
    const perFile = new Map<string, GraphSymbolNode>();
    for (const s of syms) if (!perFile.has(s.file)) perFile.set(s.file, s);
    if (perFile.size < 2) continue;

    const locations = [...perFile.values()]
      .map((s) => ({ file: s.file, kind: s.kind, nodeId: s.id }))
      .sort((a, b) => a.file.localeCompare(b.file));
    out.push({ symbol: name, count: perFile.size, locations });
  }

  return out.sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
}
