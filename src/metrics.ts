import type { SymbolGraph, GraphSymbolNode } from "./graph.js";

// ─── Coupling metrics over the file-level import graph ───────────────────────
// Robert C. Martin's Ca/Ce/instability at file level (computeCoupling),
// aggregated to directories (computeModuleCoupling), and the Stable
// Dependencies Principle check that reads the file-level numbers
// (findLayerViolations). All three walk the same edges — hence one file.

/**
 * Visit every `imports` edge as a (fromFile, toFile) pair, resolving symbol
 * targets back to their file and dropping self-imports. Not deduplicated:
 * importing three symbols from one file yields three calls, which is what
 * module edge weights count.
 */
function eachImportEdge(graph: SymbolGraph, fn: (fromFile: string, toFile: string) => void): void {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    if (e.edgeType !== "imports") continue;
    const to = nodeMap.get(e.to);
    const toFile = to ? (to.nodeType === "file" ? to.id : (to as GraphSymbolNode).file) : null;
    if (!toFile || e.from === toFile) continue;
    fn(e.from, toFile);
  }
}

/** I = Ce / (Ca + Ce), rounded to 2dp. 0 = stable (depended-on), 1 = unstable. */
function instabilityOf(ca: number, ce: number): number {
  return ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 100) / 100;
}

/** Add `value` to the set stored at `key`, creating the set on first use. */
function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  (map.get(key) ?? map.set(key, new Set()).get(key)!).add(value);
}

/** Most-connected first, ties broken by name so output is stable. */
function byCoupling<T extends { afferent: number; efferent: number }>(name: (x: T) => string) {
  return (a: T, b: T) =>
    (b.afferent + b.efferent) - (a.afferent + a.efferent) || name(a).localeCompare(name(b));
}

// ─── Per-file coupling ────────────────────────────────────────────────────────

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
  const out = new Map<string, Set<string>>(); // file -> files it imports
  const inc = new Map<string, Set<string>>(); // file -> files that import it
  const files = new Set<string>();
  for (const n of graph.nodes) if (n.nodeType === "file") files.add(n.id);

  eachImportEdge(graph, (from, to) => {
    files.add(from); files.add(to);
    addTo(out, from, to);
    addTo(inc, to, from);
  });

  return [...files]
    .map((file) => {
      const ce = out.get(file)?.size ?? 0;
      const ca = inc.get(file)?.size ?? 0;
      return { file, afferent: ca, efferent: ce, instability: instabilityOf(ca, ce) };
    })
    .sort(byCoupling((m) => m.file));
}

// ─── Stable Dependencies Principle ────────────────────────────────────────────

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
  const seen = new Set<string>();
  const violations: LayerViolation[] = [];

  eachImportEdge(graph, (from, to) => {
    const fi = inst.get(from);
    const ti = inst.get(to);
    if (fi === undefined || ti === undefined) return;
    const severity = Math.round((ti - fi) * 100) / 100;
    if (severity <= minGap) return; // only "uphill" dependencies (stable -> volatile)
    const key = from + " " + to;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ from, to, fromInstability: fi, toInstability: ti, severity });
  });

  return violations.sort((a, b) => b.severity - a.severity || a.from.localeCompare(b.from));
}

// ─── Per-directory (module) coupling ──────────────────────────────────────────

export interface ModuleMetric {
  /** Directory (module) path relative to root; "." for root-level files. */
  module: string;
  /** Number of source files in the module. */
  files: number;
  /** Afferent coupling (Ca): distinct modules that depend on this one. */
  afferent: number;
  /** Efferent coupling (Ce): distinct modules this one depends on. */
  efferent: number;
  /** Instability I = Ce / (Ca + Ce). */
  instability: number;
}

export interface ModuleEdge {
  from: string;
  to: string;
  /** Number of file-level imports crossing from `from` into `to`. */
  weight: number;
}

export interface ModuleCoupling {
  modules: ModuleMetric[];
  edges: ModuleEdge[];
}

function moduleOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i < 0 ? "." : file.slice(0, i);
}

/**
 * Aggregate the file-level import graph up to the directory/module level: per-module
 * afferent/efferent coupling and instability, plus the weighted inter-module edges.
 * Intra-module imports (files importing siblings in the same directory) are ignored —
 * only dependencies that cross a module boundary count.
 */
export function computeModuleCoupling(graph: SymbolGraph): ModuleCoupling {
  const fileSets = new Map<string, Set<string>>(); // module -> its files
  for (const n of graph.nodes) {
    if (n.nodeType === "file") addTo(fileSets, moduleOf(n.id), n.id);
  }

  const outMods = new Map<string, Set<string>>(); // module -> modules it imports
  const inMods = new Map<string, Set<string>>(); // module -> modules importing it
  const edgeWeight = new Map<string, number>(); // "from to" -> count

  eachImportEdge(graph, (fromFile, toFile) => {
    const fromMod = moduleOf(fromFile);
    const toMod = moduleOf(toFile);
    if (fromMod === toMod) return; // intra-module — not counted
    if (!fileSets.has(fromMod)) fileSets.set(fromMod, new Set());
    if (!fileSets.has(toMod)) fileSets.set(toMod, new Set());
    addTo(outMods, fromMod, toMod);
    addTo(inMods, toMod, fromMod);
    const key = fromMod + " " + toMod;
    edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
  });

  const modules: ModuleMetric[] = [...fileSets.entries()]
    .map(([module, files]) => {
      const ce = outMods.get(module)?.size ?? 0;
      const ca = inMods.get(module)?.size ?? 0;
      return { module, files: files.size, afferent: ca, efferent: ce, instability: instabilityOf(ca, ce) };
    })
    .sort(byCoupling((m) => m.module));

  const edges: ModuleEdge[] = [...edgeWeight.entries()]
    .map(([k, weight]) => { const [from, to] = k.split(" "); return { from, to, weight }; })
    .sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from));

  return { modules, edges };
}
