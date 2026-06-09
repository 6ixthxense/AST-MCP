// End-to-end smoke test: parse each fixture, assert expected symbols, write HTML.
// Run after `npm run build`:  node test/smoke.mjs
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSkeleton } from "../dist/skeleton.js";
import { resolveOptions } from "../dist/config.js";
import { renderHtml } from "../dist/html.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

// collect all symbol names (recursively) into a flat set
function names(symbols, acc = new Set()) {
  for (const s of symbols) {
    acc.add(`${s.kind}:${s.name}`);
    names(s.children, acc);
  }
  return acc;
}

async function run(rel, expectKinds) {
  const abs = path.join(fixtures, rel);
  const opts = resolveOptions({ detail: "full" });
  const skel = await buildSkeleton(abs, rel, opts);
  fs.writeFileSync(path.join(outDir, path.basename(rel) + ".json"), JSON.stringify(skel, null, 2));
  fs.writeFileSync(path.join(outDir, path.basename(rel) + ".html"), renderHtml(skel));
  console.log(`\n${rel}  (${skel.language}, ${skel.symbolCount} symbols)`);
  const have = names(skel.symbols);
  for (const exp of expectKinds) check(exp, have.has(exp));
  return skel;
}

console.log("Universal AST Mapper — smoke test");

const ts = await run("sample.ts", [
  "class:UserService",
  "method:getUser",
  "method:evict",
  "interface:Repository",
  "method:find",
  "function:helper",
  "function:multiply",
  "function:double",
  "const:DEFAULT_TIMEOUT",
  "class:BaseRepo",
  "type:ID",
  "enum:Color",
]);
// visibility checks
const userService = ts.symbols.find((s) => s.name === "UserService");
check("UserService is exported", userService?.exported === true);
const evict = userService?.children.find((c) => c.name === "evict");
check("evict is private", evict?.visibility === "private");
const timeout = ts.symbols.find((s) => s.name === "DEFAULT_TIMEOUT");
check("DEFAULT_TIMEOUT is exported const", timeout?.exported === true && timeout?.kind === "const");
const dbl = ts.symbols.find((s) => s.name === "double");
check("double is exported", dbl?.exported === true);
const multiply = ts.symbols.find((s) => s.name === "multiply");
check("multiply is NOT exported", multiply?.exported === false);

// Barrel / re-export: export { X } from './foo' should appear as imports
const barrel = await run("barrel.ts", []);
check("barrel has imports", (barrel.imports?.length ?? 0) > 0);
check("barrel imports UserService", barrel.imports?.some(i => i.symbol === "UserService") ?? false);
check("barrel imports DEFAULT_TIMEOUT (aliased)", barrel.imports?.some(i => i.symbol === "DEFAULT_TIMEOUT") ?? false);
check("barrel has namespace re-export (*)", barrel.imports?.some(i => i.symbol === "*") ?? false);

await run("sample.py", [
  "class:InventoryService",
  "method:__init__",
  "method:reserve",
  "method:_private_helper",
  "function:top_level",
  "function:decorated",
]);

const go = await run("services/inventory.go", [
  "struct:InventoryService",
  "field:db",
  "interface:Reader",
  "method:Read",
  "type:SKU",
  "const:MaxItems",
  "method:ReserveStock",
  "method:release",
  "function:NewInventoryService",
]);
const reserve = go.symbols.find((s) => s.name === "ReserveStock");
check("ReserveStock is exported (public)", reserve?.exported === true && reserve?.visibility === "public");
const release = go.symbols.find((s) => s.name === "release");
check("release is private", release?.visibility === "private");

// ─── Rust ────────────────────────────────────────────────────────────────────
const rust = await run("sample.rs", [
  "struct:Inventory",
  "field:db",
  "field:count",
  "interface:Reader",
  "method:read",
  "enum:Color",
  "method:Inventory::reserve",
  "method:Inventory::private_helper",
  "function:top_level",
  "const:MAX",
  "type:Id",
]);
const rustInv = rust.symbols.find((s) => s.name === "Inventory");
check("Rust: Inventory is pub (exported)", rustInv?.exported === true);
const rustDb = rustInv?.children.find((c) => c.name === "db");
check("Rust: db field is private (no pub)", rustDb?.visibility === "private");
const rustCount = rustInv?.children.find((c) => c.name === "count");
check("Rust: count field is pub", rustCount?.visibility === "public");
const rustReserve = rust.symbols.find((s) => s.name === "Inventory::reserve");
check("Rust: impl method Inventory::reserve is pub", rustReserve?.exported === true);
const rustPriv = rust.symbols.find((s) => s.name === "Inventory::private_helper");
check("Rust: private_helper is private", rustPriv?.visibility === "private");
check("Rust: use imports captured", (rust.imports?.length ?? 0) >= 2);
check("Rust: imports HashMap", rust.imports?.some((i) => i.symbol === "HashMap") ?? false);

// ─── Java ────────────────────────────────────────────────────────────────────
const java = await run("Sample.java", [
  "class:InventoryService",
  "field:db",
  "const:MAX",
  "method:reserve",
  "method:helper",
  "interface:Reader",
  "method:read",
  "method:close",
  "enum:Color",
]);
const javaInv = java.symbols.find((s) => s.name === "InventoryService");
check("Java: InventoryService is public (exported)", javaInv?.exported === true);
const javaDb = javaInv?.children.find((c) => c.name === "db");
check("Java: db field is private", javaDb?.visibility === "private");
const javaMax = javaInv?.children.find((c) => c.name === "MAX");
check("Java: MAX is const (static final)", javaMax?.kind === "const");
const javaHelper = javaInv?.children.find((c) => c.name === "helper");
check("Java: helper method is private", javaHelper?.visibility === "private");
const javaReader = java.symbols.find((s) => s.name === "Reader");
check("Java: package-private Reader is NOT exported", javaReader?.exported === false);
check("Java: imports captured", (java.imports?.length ?? 0) >= 2);
check("Java: imports java.util.List", java.imports?.some((i) => i.from === "java.util.List") ?? false);

// ─── C# ──────────────────────────────────────────────────────────────────────
const cs = await run("Sample.cs", [
  "class:InventoryService",
  "field:db",
  "field:Count",
  "method:Reserve",
  "method:Helper",
  "interface:IReader",
  "method:Read",
  "enum:Color",
  "struct:Point",
  "field:X",
]);
const csInv = cs.symbols.find((s) => s.name === "InventoryService");
check("C#: InventoryService is public (exported)", csInv?.exported === true);
const csDb = csInv?.children.find((c) => c.name === "db");
check("C#: db field is private (no modifier)", csDb?.visibility === "private");
const csCount = csInv?.children.find((c) => c.name === "Count");
check("C#: Count property surfaced as public field", csCount?.visibility === "public" && csCount?.kind === "field");
const csHelper = csInv?.children.find((c) => c.name === "Helper");
check("C#: Helper method is private", csHelper?.visibility === "private");
const csPoint = cs.symbols.find((s) => s.name === "Point");
check("C#: namespace recursion surfaced struct Point", csPoint?.kind === "struct");
check("C#: using directives captured", (cs.imports?.length ?? 0) >= 2);
check("C#: imports System", cs.imports?.some((i) => i.from === "System") ?? false);

// ─── C ──────────────────────────────────────────────────────────────────
const c = await run("sample.c", [
  "struct:Inventory",
  "field:name",
  "field:count",
  "function:reserve",
  "function:helper",
  "const:MAX_ITEMS",
  "type:ItemId",
]);
check("C: helper is static -> private", c.symbols.find((s)=>s.name==="helper")?.visibility === "private");
check("C: reserve is public", c.symbols.find((s)=>s.name==="reserve")?.visibility === "public");
check("C: includes captured", (c.imports?.length ?? 0) >= 2);
check("C: imports stdio", c.imports?.some((i)=>i.from === "stdio.h") ?? false);

// ─── C++ ────────────────────────────────────────────────────────────────
const cpp = await run("Sample.cpp", [
  "class:Inventory",
  "field:name",
  "struct:Item",
  "enum:Color",
  "function:compute",
]);
const cppInv = cpp.symbols.find((s)=>s.name==="Inventory");
const cppName = cppInv?.children.find((c)=>c.name==="name");
check("C++: class public field 'name' captured", cppName?.visibility === "public");
const cppHelper = cppInv?.children.find((c)=>c.name==="helper");
check("C++: private 'helper' captured", cppHelper?.visibility === "private");
const cppReserve = cppInv?.children.find((c)=>c.name==="reserve");
check("C++: public method 'reserve' captured", cppReserve?.kind === "method" && cppReserve?.visibility === "public");
check("C++: namespace flattened (compute at top)", cpp.symbols.some((s)=>s.name==="compute"));

// ─── Kotlin ─────────────────────────────────────────────────────────────
const kt = await run("Sample.kt", [
  "class:Inventory",
  "method:reserve",
  "method:helper",
  "class:Constants",
  "field:MAX",
  "function:topLevel",
]);
const ktInv = kt.symbols.find((s)=>s.name==="Inventory");
check("Kotlin: Inventory is exported (default public)", ktInv?.exported === true);
const ktHelper = ktInv?.children.find((c)=>c.name==="helper");
check("Kotlin: private helper", ktHelper?.visibility === "private");
check("Kotlin: package directive captured", kt.directives?.includes("package:com.example") === true);
check("Kotlin: imports captured", (kt.imports?.length ?? 0) >= 2);

// ─── Swift ──────────────────────────────────────────────────────────────
const sw = await run("Sample.swift", [
  "class:Inventory",
  "method:init",
  "method:reserve",
  "method:helper",
  "interface:Reader",
  "method:read",
  "struct:Point",
  "field:x",
  "function:topLevel",
  "const:MAX",
]);
const swInv = sw.symbols.find((s)=>s.name==="Inventory");
const swHelper = swInv?.children.find((c)=>c.name==="helper");
check("Swift: private helper", swHelper?.visibility === "private");
check("Swift: struct Point detected", sw.symbols.some((s)=>s.name==="Point" && s.kind === "struct"));
check("Swift: protocol Reader -> interface", sw.symbols.some((s)=>s.name==="Reader" && s.kind === "interface"));
check("Swift: imports Foundation", sw.imports?.some((i)=>i.from === "Foundation") ?? false);

// ─── PHP ──────────────────────────────────────────────────────────────────
const php = await run("Sample.php", [
  "namespace:App\\Service",
  "interface:Greeter",
  "class:Loggable",
  "class:UserService",
  "method:__construct",
  "method:greet",
  "method:helper",
  "enum:Status",
  "function:topLevel",
  "const:GLOBAL_C",
]);
const phpSvc = php.symbols.find((s) => s.name === "UserService");
check("PHP: protected helper -> private", phpSvc?.children.find((c) => c.name === "helper")?.visibility === "private");
check("PHP: private const MAX", phpSvc?.children.find((c) => c.name === "MAX")?.visibility === "private");
check("PHP: trait Loggable -> class", php.symbols.some((s) => s.name === "Loggable" && s.kind === "class"));
check("PHP: use User import", php.imports?.some((i) => i.symbol === "User" && i.from === "App\\Models\\User") ?? false);
check("PHP: grouped use Str", php.imports?.some((i) => i.symbol === "Str" && i.from === "App\\Util\\Str") ?? false);
check("PHP: require_once side-effect", php.imports?.some((i) => i.isSideEffect && i.from === "legacy.php") ?? false);

// ─── Ruby ─────────────────────────────────────────────────────────────────
const rb = await run("sample.rb", [
  "namespace:Billing",
  "class:Invoice",
  "method:initialize",
  "method:self.from_json",
  "method:validate!",
  "method:self.module_method",
  "function:top_level",
  "const:MAX_RETRIES",
]);
const rbInvoice = rb.symbols.find((s) => s.name === "Billing")?.children.find((c) => c.name === "Invoice");
check("Ruby: validate! is private (section)", rbInvoice?.children.find((c) => c.name === "validate!")?.visibility === "private");
check("Ruby: initialize is public", rbInvoice?.children.find((c) => c.name === "initialize")?.visibility === "public");
check("Ruby: require json", rb.imports?.some((i) => i.from === "json") ?? false);
check("Ruby: require_relative ./helper", rb.imports?.some((i) => i.from === "./helper") ?? false);

// ─── TSX component props ──────────────────────────────────────────────────
const tsx = await run("Component.tsx", []);
const tBtn = tsx.symbols.find((s) => s.name === "Button");
const tCard = tsx.symbols.find((s) => s.name === "Card");
const tInline = tsx.symbols.find((s) => s.name === "Inline");
const tPlain = tsx.symbols.find((s) => s.name === "Plain");
check("TSX: Button propsType = ButtonProps", tBtn?.propsType === "ButtonProps");
check("TSX: Button props has label:string", tBtn?.props?.some((p) => p.name === "label" && p.type === "string") ?? false);
check("TSX: Button props onClick type captured", tBtn?.props?.some((p) => p.name === "onClick" && /=>/.test(p.type ?? "")) ?? false);
check("TSX: Button disabled is optional", tBtn?.props?.find((p) => p.name === "disabled")?.optional === true);
check("TSX: Card (React.FC) propsType = CardProps", tCard?.propsType === "CardProps");
check("TSX: Card props resolved from type alias", tCard?.props?.some((p) => p.name === "title") ?? false);
check("TSX: Inline component inline-object props (no propsType)", !tInline?.propsType && (tInline?.props?.some((p) => p.name === "a") ?? false));
check("TSX: Inline b is optional", tInline?.props?.find((p) => p.name === "b")?.optional === true);
check("TSX: Plain (non-component) has no props", !tPlain?.props && !tPlain?.propsType);

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
