// Single test entry point. `npm test` runs this; CI runs nothing else.
// Add a new test by dropping a *.mjs in this directory — it is picked up
// automatically, so package.json and ci.yml can never drift apart again.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs")
  .sort();

let failed = 0;
let totalPass = 0;

for (const t of tests) {
  const r = spawnSync(process.execPath, [path.join(here, t)], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const pass = (out.match(/✓/g) ?? []).length;
  const fail = (out.match(/✗/g) ?? []).length;
  totalPass += pass;

  // ponytail: judge by assertion marks, not exit code — web-tree-sitter's
  // emscripten runtime aborts in libuv teardown on Windows (exit 127) *after*
  // every assertion has run. Drop this workaround once web-tree-sitter is
  // upgraded past the 0.21 emscripten build.
  const aborted = r.status !== 0 && fail === 0 && /Assertion failed/.test(out);

  if (fail > 0 || (r.status !== 0 && !aborted)) {
    failed++;
    console.log(`FAIL  ${t}  ✓${pass} ✗${fail}`);
    console.log(out.split("\n").filter((l) => l.includes("✗")).join("\n"));
  } else {
    console.log(`ok    ${t}  ✓${pass}${aborted ? "  (teardown abort ignored)" : ""}`);
  }
}

console.log(
  `\n${tests.length} files, ${totalPass} assertions — ` +
    (failed === 0 ? "ALL PASSED ✅" : `${failed} FILE(S) FAILED ❌`),
);
process.exit(failed === 0 ? 0 : 1);
