// Verify resolveFileImports enriches imports correctly for Rust/Java/C#.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton } from "../dist/skeleton.js";
import { resolveOptions } from "../dist/config.js";
import { resolveFileImports, clearCrossLangIndexCache } from "../dist/resolver.js";
import { clearWorkspaceCache } from "../dist/workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "multi");

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

async function resolveOne(projectRoot, rel) {
  clearCrossLangIndexCache(); // start clean per language for isolation
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const abs = path.join(projectRoot, rel);
  const skel = await buildSkeleton(abs, rel, opts);
  return resolveFileImports(skel, abs, projectRoot);
}

console.log("resolveFileImports — cross-language enrichment");

// ─── Java ────────────────────────────────────────────────────────────────
console.log("\nJava");
{
  const root = path.join(fixtures, "java");
  const refs = await resolveOne(root, "com/example/services/InventoryService.java");
  console.log("    ", JSON.stringify(refs, null, 2).split("\n").map(l => "    " + l).join("\n").trim());
  const inv = refs.find(r => r.symbol === "Inventory");
  check("Inventory import resolved", !!inv);
  check("resolvedRel = Inventory.java", inv?.resolvedRel === "com/example/Inventory.java");
  check("found = true", inv?.found === true);
  check("kind = class", inv?.kind === "class");
  check("importKind = relative (in-project)", inv?.importKind === "relative");
}

// ─── C# ──────────────────────────────────────────────────────────────────
console.log("\nC#");
{
  const root = path.join(fixtures, "csharp");
  const refs = await resolveOne(root, "Service.cs");
  console.log("    ", JSON.stringify(refs, null, 2).split("\n").map(l => "    " + l).join("\n").trim());
  const models = refs.find(r => r.from === "App.Models");
  check("'using App.Models' resolved", !!models);
  check("resolvedRel points at Inventory.cs", models?.resolvedRel === "Inventory.cs");
  check("found = true (namespace-style)", models?.found === true);
  check("importKind = relative", models?.importKind === "relative");
}

// ─── Rust ────────────────────────────────────────────────────────────────
console.log("\nRust");
{
  const root = path.join(fixtures, "rust");
  const refs = await resolveOne(root, "src/service.rs");
  console.log("    ", JSON.stringify(refs, null, 2).split("\n").map(l => "    " + l).join("\n").trim());
  const inv = refs.find(r => r.symbol === "Inventory");
  check("crate::inventory::Inventory resolved", !!inv);
  check("resolvedRel = src/inventory.rs", inv?.resolvedRel === "src/inventory.rs");
  check("found = true", inv?.found === true);
  check("kind = struct", inv?.kind === "struct");
  check("importKind = relative", inv?.importKind === "relative");
}

// ─── External (control: must NOT be marked found) ─────────────────────────
console.log("\nExternal sanity (Rust std::, Java java.util.)");
{
  // Re-resolve service.rs but inspect that no external import claims found
  const refsRust = await resolveOne(path.join(fixtures, "rust"), "src/service.rs");
  // (none — service.rs only uses crate::, so this is informational)
  // Java case: imports java.util.List which isn't in the project
  // Use the existing Sample.java fixture (single file, not multi/).
  const javaRoot = path.join(here, "fixtures");
  const refsJava = await resolveOne(javaRoot, "Sample.java");
  const ext = refsJava.find(r => r.from === "java.util.List");
  check("Java java.util.List flagged external", ext?.importKind === "external" && ext?.found === false);
}

// ─── Go ────────────────────────────────────────────────────────────────
console.log("\nGo");
{
  const root = path.join(fixtures, "go");
  const refs = await resolveOne(root, "service/service.go");
  console.log("    ", JSON.stringify(refs, null, 2).split("\n").map(l => "    " + l).join("\n").trim());
  const inv = refs.find(r => r.from === "example.com/demo/inventory");
  check("inventory import resolved", !!inv);
  check("resolvedRel points at inventory/inventory.go",
    inv?.resolvedRel === "inventory/inventory.go");
  check("found = true", inv?.found === true);
  check("importKind = relative (in-project)", inv?.importKind === "relative");

  // stdlib check: nothing imported from stdlib in service.go, but verify the
  // Go resolver doesn't mis-flag external packages. Use inventory.go which
  // has no imports — should be empty.
  const refs2 = await resolveOne(root, "inventory/inventory.go");
  check("Go file with no imports yields empty refs", refs2.length === 0);
}

// ─── Kotlin ─────────────────────────────────────────────────────────────
console.log("\nKotlin");
{
  const root = path.join(fixtures, "kotlin", "src");
  const refs = await resolveOne(root, "com/example/services/InventoryService.kt");
  console.log("    ", JSON.stringify(refs));
  const inv = refs.find(r => r.symbol === "Inventory");
  check("Kotlin: Inventory import resolved", !!inv);
  check("Kotlin: resolvedRel = Inventory.kt", inv?.resolvedRel === "com/example/Inventory.kt");
  check("Kotlin: found = true", inv?.found === true);
  check("Kotlin: kind = class", inv?.kind === "class");
  check("Kotlin: importKind = relative (in-project)", inv?.importKind === "relative");
}

// ─── C++ ────────────────────────────────────────────────────────────────
console.log("\nC++");
{
  const root = path.join(fixtures, "cpp");
  const refs = await resolveOne(root, "service.cpp");
  console.log("    ", JSON.stringify(refs));
  const inv = refs.find(r => r.from === "inventory.h");
  check("C++: #include resolved", !!inv);
  check("C++: resolvedRel = inventory.h", inv?.resolvedRel === "inventory.h");
  check("C++: found = true", inv?.found === true);
  check("C++: importKind = relative (in-project)", inv?.importKind === "relative");
}

// ─── Swift ──────────────────────────────────────────────────────────────
console.log("\nSwift");
{
  const root = path.join(fixtures, "swift");
  const refs = await resolveOne(root, "Sources/Service/InventoryService.swift");
  console.log("    ", JSON.stringify(refs));
  const inv = refs.find(r => r.from === "Inventory");
  check("Swift: import Inventory resolved", !!inv);
  check("Swift: resolvedRel = Sources/Inventory/Inventory.swift",
    inv?.resolvedRel === "Sources/Inventory/Inventory.swift");
  check("Swift: found = true", inv?.found === true);
  check("Swift: importKind = relative (in-project module)", inv?.importKind === "relative");

  // System module stays external.
  const refsInv = await resolveOne(root, "Sources/Inventory/Inventory.swift");
  const fnd = refsInv.find(r => r.from === "Foundation");
  check("Swift: import Foundation flagged external",
    fnd?.importKind === "external" && fnd?.found === false);
}

// ─── Monorepo cross-package ─────────────────────────────────────────────
console.log("\nMonorepo (cross-package import → file)");
{
  clearWorkspaceCache();
  const root = path.join(fixtures, "..", "monorepo");
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const rel = "packages/a/src/index.ts";
  const skel = await buildSkeleton(path.join(root, rel), rel, opts);
  const refs = await resolveFileImports(skel, path.join(root, rel), root);
  console.log("    ", JSON.stringify(refs.map(r => ({ from: r.from, to: r.resolvedRel, kind: r.importKind }))));
  const b = refs.find(r => r.from === "@demo/b");
  const helpers = refs.find(r => r.from === "@demo/b/helpers");
  check("@demo/b resolves to packages/b/src/index.ts", b?.resolvedRel === "packages/b/src/index.ts");
  check("@demo/b found + in-project (relative)", b?.found === true && b?.importKind === "relative");
  check("subpath @demo/b/helpers → packages/b/src/helpers.ts", helpers?.resolvedRel === "packages/b/src/helpers.ts");
}

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
