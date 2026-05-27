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

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
