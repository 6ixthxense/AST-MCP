import path from "node:path";
import type { SkeletonFile, SymbolNode } from "./types.js";
import type { SymbolGraph, GraphFileNode, GraphSymbolNode } from "./graph.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DiagramType = "class" | "deps" | "modules";

export interface DiagramResult {
  type: DiagramType;
  mermaid: string;
  title: string;
  nodeCount: number;
  edgeCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Replace non-word characters with underscore for Mermaid identifiers. */
function sanitizeName(name: string): string {
  return name.replace(/\W/g, "_");
}

/** Replace path separators, dots, and dashes with underscore for Mermaid node IDs. */
function sanitizeId(filePath: string): string {
  return filePath.replace(/[/.\-]/g, "_");
}

// ─── Class Diagram ────────────────────────────────────────────────────────────

/**
 * Class diagram from skeletons — shows classes, interfaces, enums and their
 * relationships.
 */
export function buildClassDiagram(skeletons: SkeletonFile[]): DiagramResult {
  const lines: string[] = ["classDiagram"];

  // Collect all class/interface/enum symbols from all files.
  interface ClassEntry {
    name: string;
    sanitized: string;
    kind: "class" | "interface" | "enum";
    node: SymbolNode;
  }
  const entries: ClassEntry[] = [];

  for (const skel of skeletons) {
    for (const sym of skel.symbols) {
      if (sym.kind === "class" || sym.kind === "interface" || sym.kind === "enum") {
        entries.push({
          name: sym.name,
          sanitized: sanitizeName(sym.name),
          kind: sym.kind as "class" | "interface" | "enum",
          node: sym,
        });
      }
    }
  }

  // Enforce the 40-class limit.
  const MAX_CLASSES = 40;
  const truncated = entries.length > MAX_CLASSES;
  const visible = truncated ? entries.slice(0, MAX_CLASSES) : entries;
  const visibleNames = new Set(visible.map((e) => e.name));

  let edgeCount = 0;

  // Emit class/interface/enum blocks.
  for (const entry of visible) {
    const { sanitized, kind, node } = entry;

    if (kind === "interface") {
      lines.push(`  class ${sanitized} {`);
      lines.push(`    <<interface>>`);
      for (const child of node.children) {
        if (child.kind === "method" || child.kind === "function") {
          const prefix = child.visibility === "private" ? "-" : "+";
          lines.push(`    ${prefix}${sanitizeName(child.name)}()`);
        }
      }
      lines.push(`  }`);
    } else if (kind === "enum") {
      lines.push(`  class ${sanitized} {`);
      lines.push(`    <<enumeration>>`);
      for (const child of node.children) {
        lines.push(`    ${sanitizeName(child.name)}`);
      }
      lines.push(`  }`);
    } else {
      // class
      lines.push(`  class ${sanitized} {`);
      for (const child of node.children) {
        const prefix = child.visibility === "private" ? "-" : "+";
        if (child.kind === "method" || child.kind === "function") {
          lines.push(`    ${prefix}${sanitizeName(child.name)}()`);
        } else if (child.kind === "field") {
          // Try to extract type from signature
          let fieldType = "";
          if (child.signature) {
            // Signature format: "fieldName: TypeName" or "fieldName?: TypeName"
            const match = child.signature.match(/:\s*(.+)$/);
            if (match) fieldType = sanitizeName(match[1].trim().split(/\s/)[0]) + " ";
          }
          lines.push(`    ${prefix}${fieldType}${sanitizeName(child.name)}`);
        }
      }
      lines.push(`  }`);
    }
  }

  // Emit "uses" edges from imports.
  for (const skel of skeletons) {
    if (!skel.imports) continue;
    // Find the class/interface names in this file.
    const fileClasses = skel.symbols
      .filter((s) => s.kind === "class" || s.kind === "interface" || s.kind === "enum")
      .map((s) => s.name);

    for (const fileClass of fileClasses) {
      if (!visibleNames.has(fileClass)) continue;
      const from = sanitizeName(fileClass);

      for (const imp of skel.imports) {
        if (imp.symbol && imp.symbol !== "*" && visibleNames.has(imp.symbol)) {
          const to = sanitizeName(imp.symbol);
          if (from !== to) {
            lines.push(`  ${from} --> ${to} : uses`);
            edgeCount++;
          }
        }
      }
    }
  }

  if (truncated) {
    lines.push(`  %% ... and ${entries.length - MAX_CLASSES} more`);
  }

  return {
    type: "class",
    mermaid: lines.join("\n"),
    title: "Class Diagram",
    nodeCount: visible.length,
    edgeCount,
  };
}

// ─── Deps Diagram ─────────────────────────────────────────────────────────────

/**
 * File dependency diagram from symbol graph.
 */
export function buildDepsDiagram(graph: SymbolGraph, maxNodes = 50): DiagramResult {
  const lines: string[] = ["graph TD"];

  // Collect file nodes only.
  const fileNodes = graph.nodes.filter(
    (n): n is GraphFileNode => n.nodeType === "file",
  );

  const truncated = fileNodes.length > maxNodes;
  const visibleFiles = new Set(
    (truncated ? fileNodes.slice(0, maxNodes) : fileNodes).map((n) => n.id),
  );

  // Emit node labels.
  for (const n of fileNodes) {
    if (!visibleFiles.has(n.id)) continue;
    const nodeId = sanitizeId(n.id);
    const label = path.basename(n.id, path.extname(n.id));
    lines.push(`  ${nodeId}["${label}"]`);
    lines.push(`  click ${nodeId} callback "${n.id}"`);
  }

  // Collect import edges between visible file nodes.
  // Build a map: symbolNodeId → file it belongs to.
  const symbolToFile = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.nodeType === "symbol") {
      const sym = n as GraphSymbolNode;
      symbolToFile.set(sym.id, sym.file);
    }
  }

  // Deduplicate file-level edges.
  const emittedEdges = new Set<string>();
  let edgeCount = 0;

  for (const edge of graph.edges) {
    if (edge.edgeType !== "imports") continue;

    const fromFile = edge.from;
    // `to` may be a symbol node ID or a file node ID.
    const toFile = symbolToFile.get(edge.to) ?? edge.to;

    if (fromFile === toFile) continue;
    if (!visibleFiles.has(fromFile) || !visibleFiles.has(toFile)) continue;

    const key = `${fromFile}→${toFile}`;
    if (emittedEdges.has(key)) continue;
    emittedEdges.add(key);

    const fromId = sanitizeId(fromFile);
    const toId = sanitizeId(toFile);
    lines.push(`  ${fromId} --> ${toId}`);
    edgeCount++;
  }

  if (truncated) {
    lines.push(`  %% ... ${fileNodes.length - maxNodes} more nodes not shown`);
  }

  return {
    type: "deps",
    mermaid: lines.join("\n"),
    title: "File Dependency Diagram",
    nodeCount: visibleFiles.size,
    edgeCount,
  };
}

// ─── Modules Diagram ──────────────────────────────────────────────────────────

/**
 * Module/directory-level dependency diagram (collapsed by top-level directory).
 */
export function buildModulesDiagram(graph: SymbolGraph): DiagramResult {
  const MAX_MODULES = 20;
  const lines: string[] = ["graph LR"];

  // Map each file to its top-level module (first directory component).
  function fileToModule(fileId: string): string {
    const parts = fileId.split("/");
    // If the file is at the root level (no directory), use "." as the module.
    if (parts.length <= 1) return ".";
    // Use up to 2 path components for meaningful grouping when first segment is short
    // (e.g. "src/auth" for "src/auth/user.ts").
    return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
  }

  // Build symbol-to-file lookup.
  const symbolToFile = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.nodeType === "symbol") {
      const sym = n as GraphSymbolNode;
      symbolToFile.set(sym.id, sym.file);
    }
  }

  // Count inter-module edges.
  const moduleEdgeCounts = new Map<string, number>();
  const moduleSet = new Set<string>();

  for (const n of graph.nodes) {
    if (n.nodeType === "file") {
      moduleSet.add(fileToModule(n.id));
    }
  }

  for (const edge of graph.edges) {
    if (edge.edgeType !== "imports") continue;

    const fromFile = edge.from;
    const toFile = symbolToFile.get(edge.to) ?? edge.to;

    if (fromFile === toFile) continue;

    const fromModule = fileToModule(fromFile);
    const toModule = fileToModule(toFile);
    if (fromModule === toModule) continue;

    const key = `${fromModule}→${toModule}`;
    moduleEdgeCounts.set(key, (moduleEdgeCounts.get(key) ?? 0) + 1);
  }

  // Determine which modules are actually referenced by edges, then sort by
  // occurrence to pick the most connected ones if we need to truncate.
  const moduleOccurrences = new Map<string, number>();
  for (const [key, count] of moduleEdgeCounts) {
    const [from, to] = key.split("→");
    moduleOccurrences.set(from, (moduleOccurrences.get(from) ?? 0) + count);
    moduleOccurrences.set(to, (moduleOccurrences.get(to) ?? 0) + count);
  }

  // Include all modules from the file set, sorted by occurrence descending.
  const allModules = [...moduleSet].sort((a, b) => {
    return (moduleOccurrences.get(b) ?? 0) - (moduleOccurrences.get(a) ?? 0);
  });

  const truncated = allModules.length > MAX_MODULES;
  const visibleModules = new Set(
    truncated ? allModules.slice(0, MAX_MODULES) : allModules,
  );

  // Emit module nodes.
  for (const mod of visibleModules) {
    const nodeId = sanitizeName(mod);
    lines.push(`  ${nodeId}["${mod}"]`);
  }

  // Emit weighted edges between visible modules.
  let edgeCount = 0;
  for (const [key, count] of moduleEdgeCounts) {
    const [fromModule, toModule] = key.split("→");
    if (!visibleModules.has(fromModule) || !visibleModules.has(toModule)) continue;
    const fromId = sanitizeName(fromModule);
    const toId = sanitizeName(toModule);
    lines.push(`  ${fromId} -->|${count}| ${toId}`);
    edgeCount++;
  }

  if (truncated) {
    lines.push(`  %% ... ${allModules.length - MAX_MODULES} more modules not shown`);
  }

  return {
    type: "modules",
    mermaid: lines.join("\n"),
    title: "Module Dependency Diagram",
    nodeCount: visibleModules.size,
    edgeCount,
  };
}
