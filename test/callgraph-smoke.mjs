// Verify buildCallGraph cross-language call resolution for Rust/Java/C#.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton } from "../dist/skeleton.js";
import { resolveOptions } from "../dist/config.js";
import { buildCallGraph } from "../dist/callgraph.js";
import { clearCrossLangIndexCache } from "../dist/resolver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "multi");

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

async function buildSkels(root, rels) {
  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const skels = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    skels.push(await buildSkeleton(abs, rel, opts));
  }
  return skels;
}

console.log("Cross-language call graph — integration test");

// ─── Java ────────────────────────────────────────────────────────────────
console.log("\nJava (constructor call via import)");
{
  clearCrossLangIndexCache();
  const root = path.join(fixtures, "java");
  const skels = await buildSkels(root, [
    "com/example/Inventory.java",
    "com/example/services/InventoryService.java",
  ]);
  const cg = await buildCallGraph(
    path.join(root, "com/example/services/InventoryService.java"),
    "reserve",
    root,
    skels,
  );
  console.log("    calls:", JSON.stringify(cg?.calls));
  console.log("    calledBy:", JSON.stringify(cg?.calledBy));
  check("reserve() found", !!cg);
  const newInv = cg?.calls.find(c => c.callee === "new Inventory");
  check("captured `new Inventory` call", !!newInv);
  check("resolved to com/example/Inventory.java",
    newInv?.calleeFileRel === "com/example/Inventory.java");
  check("calledBy is empty (nobody imports reserve)", cg?.calledBy.length === 0);
}

// ─── Rust ────────────────────────────────────────────────────────────────
console.log("\nRust (scoped path call Inventory::new)");
{
  clearCrossLangIndexCache();
  const root = path.join(fixtures, "rust");
  const skels = await buildSkels(root, [
    "src/inventory.rs",
    "src/service.rs",
  ]);
  const cg = await buildCallGraph(
    path.join(root, "src/service.rs"),
    "make",
    root,
    skels,
  );
  console.log("    calls:", JSON.stringify(cg?.calls));
  console.log("    calledBy:", JSON.stringify(cg?.calledBy));
  check("make() found", !!cg);
  const invNew = cg?.calls.find(c => c.callee === "Inventory::new");
  check("captured `Inventory::new` call", !!invNew);
  check("resolved to src/inventory.rs",
    invNew?.calleeFileRel === "src/inventory.rs");

  // calledBy reverse: who imports `new` from inventory.rs? Nobody imports a fn named "new" directly.
  // But who imports `Inventory`? service.rs. Let's test calledBy on Inventory itself:
  const cgInv = await buildCallGraph(
    path.join(root, "src/inventory.rs"),
    "new",
    root,
    skels,
  );
  console.log("    Inventory::new calledBy:", JSON.stringify(cgInv?.calledBy));
  // service.rs imports `Inventory` (not `new`), so calledBy for `new` should be []
  check("Inventory::new calledBy is [] (nobody imports `new`)", cgInv?.calledBy.length === 0);
}

// ─── C# ──────────────────────────────────────────────────────────────────
console.log("\nC# (new + using namespace — limitation note)");
{
  clearCrossLangIndexCache();
  const root = path.join(fixtures, "csharp");
  const skels = await buildSkels(root, ["Inventory.cs", "Service.cs"]);
  const cg = await buildCallGraph(
    path.join(root, "Service.cs"),
    "Make",
    root,
    skels,
  );
  console.log("    calls:", JSON.stringify(cg?.calls));
  console.log("    calledBy:", JSON.stringify(cg?.calledBy));
  check("Make() found", !!cg);
  const newInv = cg?.calls.find(c => c.callee === "new Inventory");
  check("captured `new Inventory` call (callee parsed)", !!newInv);
  // C# `using App.Models;` only names the namespace, not "Inventory".
  // Without an extra namespace->type lookup, calleeFileRel won't resolve.
  check("resolved to Inventory.cs (via using App.Models)",
    newInv?.calleeFileRel === "Inventory.cs");
}

// ─── Go (forward + reverse calledBy via call-site scan) ───────────────────
console.log("\nGo (call resolution + reverse calledBy via call-site scan)");
{
  clearCrossLangIndexCache();
  const root = path.join(fixtures, "go");
  const skels = await buildSkels(root, [
    "inventory/inventory.go",
    "service/service.go",
  ]);

  // Forward: Run() calls inventory.New() and inv.Increment()
  const cgRun = await buildCallGraph(
    path.join(root, "service/service.go"),
    "Run",
    root,
    skels,
  );
  console.log("    Run calls:", JSON.stringify(cgRun?.calls));
  check("Run() found", !!cgRun);
  const newCall = cgRun?.calls.find(c => c.callee === "inventory.New");
  check("captured `inventory.New` call", !!newCall);
  // Go cross-lang target is file-level; first file in package picked OR
  // a smarter pick. Either way the calleeFileRel should point into the package.
  check("inventory.New resolved into inventory package",
    !!newCall?.calleeFileRel &&
    newCall.calleeFileRel.startsWith("inventory/"));

  // Reverse: who calls Increment? Service.Run does.
  const cgInc = await buildCallGraph(
    path.join(root, "inventory/inventory.go"),
    "Increment",
    root,
    skels,
  );
  console.log("    Increment calledBy:", JSON.stringify(cgInc?.calledBy));
  check("Increment() found", !!cgInc);
  check("Increment calledBy includes service/service.go (via call-site scan)",
    cgInc?.calledBy.some(c => c.file === "service/service.go") ?? false);
}

// ─── C# reverse calledBy via call-site scan ───────────────────────────────
console.log("\nC# reverse calledBy (call-site scan via `using`)");
{
  clearCrossLangIndexCache();
  const root = path.join(fixtures, "csharp");
  const skels = await buildSkels(root, ["Inventory.cs", "Service.cs"]);
  const cg = await buildCallGraph(
    path.join(root, "Inventory.cs"),
    "Increment",
    root,
    skels,
  );
  console.log("    Increment calledBy:", JSON.stringify(cg?.calledBy));
  check("Increment() found in Inventory.cs", !!cg);
  check("calledBy includes Service.cs (deep scan)",
    cg?.calledBy.some(c => c.file === "Service.cs") ?? false);
}

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
