// Smoke test for the root security boundary (roots.ts). Run after build:
//   node test/roots-smoke.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parseRootsFromEnv, resolvePathInRoots } from "../dist/roots.js";

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}

const a = fs.mkdtempSync(path.join(os.tmpdir(), "roots-a-"));
const b = fs.mkdtempSync(path.join(os.tmpdir(), "roots-b-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "roots-x-"));
fs.writeFileSync(path.join(a, "f.ts"), "export const x = 1;\n");
fs.writeFileSync(path.join(b, "g.ts"), "export const y = 2;\n");
fs.writeFileSync(path.join(outside, "h.ts"), "export const z = 3;\n");

console.log("parseRootsFromEnv:");
const single = parseRootsFromEnv({ AST_MAP_ROOT: a });
check("single root parsed", single.roots.length === 1 && single.roots[0] === path.resolve(a));
check("locked by default", single.unlocked === false);

const multi = parseRootsFromEnv({ AST_MAP_ROOT: [a, b].join(path.delimiter) });
check("multi-root parsed", multi.roots.length === 2);

const un = parseRootsFromEnv({ AST_MAP_ROOT: a, AST_MAP_UNLOCKED: "1" });
check("unlocked flag parsed", un.unlocked === true);

console.log("resolvePathInRoots:");
// relative path inside primary root
let r = resolvePathInRoots("f.ts", single);
check("relative resolves in primary", r.abs === path.join(path.resolve(a), "f.ts") && r.root === path.resolve(a));

// "." → root itself, rel = basename
r = resolvePathInRoots(".", single);
check("'.' resolves to root", r.abs === path.resolve(a) && r.rel === path.basename(a));

// escape attempts rejected when locked
check("../ escape rejected", throws(() => resolvePathInRoots("../etc/passwd", single)));
check("absolute outside rejected", throws(() => resolvePathInRoots(path.join(outside, "h.ts"), single)));

// second root allowed in multi-root mode
r = resolvePathInRoots(path.join(b, "g.ts"), multi);
check("second root allowed", r.root === path.resolve(b) && r.rel === "g.ts");
check("outside both roots rejected", throws(() => resolvePathInRoots(path.join(outside, "h.ts"), multi)));

// unlocked: any existing absolute path allowed
r = resolvePathInRoots(path.join(outside, "h.ts"), un);
check("unlocked allows outside file", r.abs === path.join(outside, "h.ts") && r.root === outside);
r = resolvePathInRoots(outside, un);
check("unlocked allows outside dir (root = itself)", r.root === outside);
check("unlocked still rejects nonexistent", throws(() => resolvePathInRoots(path.join(outside, "nope.ts"), un)));

fs.rmSync(a, { recursive: true, force: true });
fs.rmSync(b, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nAll roots checks passed.");
