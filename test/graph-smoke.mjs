// Integration test: verify cross-language graph edges are wired for Java/C#/Rust.
// Run after `npm run build`:  node test/graph-smoke.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton } from "../dist/skeleton.js";
import { resolveOptions } from "../dist/config.js";
import { buildSymbolGraph } from "../dist/graph.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "multi");

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

async function buildGraph(projectRoot, files) {
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const skels = [];
  for (const rel of files) {
    const abs = path.join(projectRoot, rel);
    const skel = await buildSkeleton(abs, rel, opts);
    skels.push(skel);
  }
  return { graph: buildSymbolGraph(skels, projectRoot), skels };
}

console.log("Cross-language graph wiring — integration test");

// ─── Java ────────────────────────────────────────────────────────────────
console.log("\nJava (cross-package import)");
{
  const root = path.join(fixtures, "java");
  const { graph, skels } = await buildGraph(root, [
    "com/example/Inventory.java",
    "com/example/services/InventoryService.java",
  ]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log(`    import edges: ${JSON.stringify(importEdges)}`);
  const invDir = skels.find(s => s.file === "com/example/Inventory.java");
  check("Inventory.java has directive package:com.example",
    invDir?.directives?.includes("package:com.example") === true);
  check("at least one import edge created", importEdges.length > 0);
  check("InventoryService.java -> Inventory.java::Inventory (symbol-level)",
    importEdges.some(e =>
      e.from === "com/example/services/InventoryService.java" &&
      e.to === "com/example/Inventory.java::Inventory"));
}

// ─── C# ──────────────────────────────────────────────────────────────────
console.log("\nC# (using namespace)");
{
  const root = path.join(fixtures, "csharp");
  const { graph, skels } = await buildGraph(root, ["Inventory.cs", "Service.cs"]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log(`    import edges: ${JSON.stringify(importEdges)}`);
  const invSkel = skels.find(s => s.file === "Inventory.cs");
  check("Inventory.cs has directive namespace:App.Models",
    invSkel?.directives?.includes("namespace:App.Models") === true);
  check("at least one import edge created", importEdges.length > 0);
  check("Service.cs -> Inventory.cs (namespace-level edge)",
    importEdges.some(e => e.from === "Service.cs" && e.to === "Inventory.cs"));
}

// ─── Rust ────────────────────────────────────────────────────────────────
console.log("\nRust (crate:: module resolution)");
{
  const root = path.join(fixtures, "rust");
  const { graph } = await buildGraph(root, [
    "src/inventory.rs",
    "src/service.rs",
  ]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log(`    import edges: ${JSON.stringify(importEdges)}`);
  check("at least one import edge created", importEdges.length > 0);
  check("service.rs -> inventory.rs::Inventory (crate:: resolved)",
    importEdges.some(e =>
      e.from === "src/service.rs" &&
      e.to === "src/inventory.rs::Inventory"));
}

// ─── Go ────────────────────────────────────────────────────────────────
console.log("\nGo (module path + package directory)");
{
  const root = path.join(fixtures, "go");
  const { graph } = await buildGraph(root, [
    "inventory/inventory.go",
    "service/service.go",
  ]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log(`    import edges: ${JSON.stringify(importEdges)}`);
  check("Go: at least one import edge", importEdges.length > 0);
  check("Go: service.go -> inventory/inventory.go (file-level edge)",
    importEdges.some(e =>
      e.from === "service/service.go" &&
      e.to === "inventory/inventory.go"));
}

// ─── Kotlin ─────────────────────────────────────────────────────────────
console.log("\nKotlin (cross-package FQCN)");
{
  const root = path.join(fixtures, "kotlin", "src");
  const { graph, skels } = await buildGraph(root, [
    "com/example/Inventory.kt",
    "com/example/services/InventoryService.kt",
  ]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log("    import edges:", JSON.stringify(importEdges));
  const invDir = skels.find(s => s.file === "com/example/Inventory.kt");
  check("Kotlin: package directive captured", invDir?.directives?.includes("package:com.example") === true);
  check("Kotlin: at least one import edge", importEdges.length > 0);
  check("Kotlin: InventoryService.kt -> Inventory.kt::Inventory (symbol-level)",
    importEdges.some(e =>
      e.from === "com/example/services/InventoryService.kt" &&
      e.to === "com/example/Inventory.kt::Inventory"));
}

// ─── C++ (#include header→impl pairing) ────────────────────────────────
console.log("\nC++ (#include with header→impl pairing)");
{
  const root = path.join(fixtures, "cpp");
  const { graph } = await buildGraph(root, [
    "inventory.h",
    "inventory.cpp",
    "service.cpp",
  ]);
  const importEdges = graph.edges.filter(e => e.edgeType === "imports");
  console.log("    import edges:", JSON.stringify(importEdges));
  check("C++: at least one import edge", importEdges.length > 0);
  check("C++: service.cpp -> inventory.h", importEdges.some(e => e.from === "service.cpp" && e.to === "inventory.h"));
  check("C++: service.cpp -> inventory.cpp (header→impl pairing)",
    importEdges.some(e => e.from === "service.cpp" && e.to === "inventory.cpp"));
}

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
