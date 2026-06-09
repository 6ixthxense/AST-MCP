import type { SymbolGraph, GraphSymbolNode } from "./graph.js";
import { computeCoupling } from "./coupling.js";

export interface LayerViolation {
  /** The more-stable file that wrongly depends outward. */
  from: string;
  /** The less-stable file it depends on. */
  to: string;
  /** Instability of `from` (lower = more stable). */
  fromInstability: number;
  /** Instability of `to` (higher = more volatile). */
  toInstability: number;
  /** Severity = toInstability - fromInstability (how far "uphill" the dependency points). */
  severity: number;
}

/**
 * Detect violations of Robert C. Martin's Stable Dependencies Principle (SDP):
 * a module should depend only on modules at least as stable as itself. A "stable"
 * file (low instability) that imports a "volatile" file (high instability) is a
 * violation — volatile code changes often and will keep dragging the stable code
 * with it. Severity is the instability gap the dependency crosses.
 */
export function findLayerViolations(graph: SymbolGraph, minGap = 0): LayerViolation[] {
  const inst = new Map(computeCoupling(graph).map((m) => [m.file, m.instability]));
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const violations: LayerViolation[] = [];

  for (const e of graph.edges) {
    if (e.edgeType !== "imports") continue;
    const to = nodeMap.get(e.to);
    const toFile = to ? (to.nodeType === "file" ? to.id : (to as GraphSymbolNode).file) : null;
    const fromFile = e.from;
    if (!toFile || fromFile === toFile) continue;
    const fi = inst.get(fromFile);
    const ti = inst.get(toFile);
    if (fi === undefined || ti === undefined) continue;
    const severity = Math.round((ti - fi) * 100) / 100;
    if (severity <= minGap) continue; // only "uphill" dependencies (stable -> volatile)
    const key = fromFile + " " + toFile;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push({ from: fromFile, to: toFile, fromInstability: fi, toInstability: ti, severity });
  }
  return violations.sort((a, b) => b.severity - a.severity || a.from.localeCompare(b.from));
}
