import path from "node:path";
import type { SkeletonFile } from "./types.js";
import type { SymbolGraph, GraphSymbolNode } from "./graph.js";
import { resolveImportPath } from "./resolver.js";

// ─── Dead Code Detection ──────────────────────────────────────────────────────

export interface DeadExport {
  file: string;
  symbol: string;
  kind: string;
  nodeId: string;
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
      dead.push({ file: sym.file, symbol: sym.symbol, kind: sym.kind, nodeId: sym.id });
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
 */
export function findCircularDeps(skeletons: SkeletonFile[], root: string): CircularDep[] {
  // Build file-level adjacency list
  const adj = new Map<string, string[]>();
  for (const skel of skeletons) {
    const deps: string[] = [];
    adj.set(skel.file, deps);
    if (!skel.imports) continue;
    const fromAbs = path.resolve(root, skel.file);
    for (const imp of skel.imports) {
      if (!imp.from.startsWith(".") || imp.isSideEffect) continue;
      const resolvedAbs = resolveImportPath(imp.from, fromAbs);
      if (!resolvedAbs) continue;
      const resolvedRel = path.relative(root, resolvedAbs).split(path.sep).join("/");
      // Only include files that are part of the scanned set
      if (adj.has(resolvedRel)) deps.push(resolvedRel);
    }
  }

  const color = new Map<string, DfsColor>();
  for (const f of adj.keys()) color.set(f, "white");

  const cycles: CircularDep[] = [];
  const cycleKeys = new Set<string>();

  function dfs(node: string, stack: string[]): void {
    color.set(node, "gray");
    stack.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      if (color.get(neighbor) === "gray") {
        // Back edge — extract cycle from stack
        const start = stack.indexOf(neighbor);
        const raw = stack.slice(start);
        const canonical = rotateCycle(raw);
        const key = canonical.join("→");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push({ cycle: [...canonical, canonical[0]], length: canonical.length });
        }
      } else if (color.get(neighbor) === "white") {
        dfs(neighbor, stack);
      }
    }

    stack.pop();
    color.set(node, "black");
  }

  for (const f of adj.keys()) {
    if (color.get(f) === "white") dfs(f, []);
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
