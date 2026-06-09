import type { SymbolGraph, GraphSymbolNode } from "./graph.js";

export interface CouplingMetric {
  file: string;
  /** Afferent coupling (Ca): distinct files that depend on this file (fan-in). */
  afferent: number;
  /** Efferent coupling (Ce): distinct files this file depends on (fan-out). */
  efferent: number;
  /** Instability I = Ce / (Ca + Ce) — 0 = stable (depended-on), 1 = unstable (depends-out). */
  instability: number;
}

/**
 * Compute Robert C. Martin's coupling metrics per file from the symbol graph's
 * file-level import edges: afferent (fan-in), efferent (fan-out), and instability.
 */
export function computeCoupling(graph: SymbolGraph): CouplingMetric[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Set<string>>(); // file -> set of files it imports
  const inc = new Map<string, Set<string>>(); // file -> set of files that import it
  const files = new Set<string>();
  for (const n of graph.nodes) if (n.nodeType === "file") files.add(n.id);

  for (const e of graph.edges) {
    if (e.edgeType !== "imports") continue;
    const to = nodeMap.get(e.to);
    const toFile = to ? (to.nodeType === "file" ? to.id : (to as GraphSymbolNode).file) : null;
    const fromFile = e.from;
    if (!toFile || fromFile === toFile) continue;
    files.add(fromFile); files.add(toFile);
    (out.get(fromFile) ?? out.set(fromFile, new Set()).get(fromFile)!).add(toFile);
    (inc.get(toFile) ?? inc.set(toFile, new Set()).get(toFile)!).add(fromFile);
  }

  const metrics: CouplingMetric[] = [];
  for (const f of files) {
    const ce = out.get(f)?.size ?? 0;
    const ca = inc.get(f)?.size ?? 0;
    const instability = ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 100) / 100;
    metrics.push({ file: f, afferent: ca, efferent: ce, instability });
  }
  // Sort by total coupling desc (most-connected first).
  return metrics.sort((a, b) => (b.afferent + b.efferent) - (a.afferent + a.efferent) || a.file.localeCompare(b.file));
}
