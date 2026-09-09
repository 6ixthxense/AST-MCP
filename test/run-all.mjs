// Single test entry point. `npm test` runs this; CI runs nothing else.
// Add a new test by dropping a *.mjs in this directory — it is picked up
// automatically, so package.json and ci.yml can never drift apart again.
//
// Each test file is judged by what it says about itself, not by its exit code:
// web-tree-sitter's emscripten runtime crashes during libuv teardown on Windows
// *after* every assertion has run, sometimes as an `Assertion failed:` line and
// sometimes as a bare V8 stack dump. Drop the exit-code allowance once
// web-tree-sitter is upgraded past the 0.21 emscripten build.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== "run-all.mjs")
  .sort();

/** Every test prints one of these as its last word. No line = it died early. */
const DECLARED_PASS = /ALL PASSED ✅|All [\w /-]+ checks passed\.|Results: \d+ passed, 0 failed/;

let failed = 0;
let totalPass = 0;

for (const t of tests) {
  const r = spawnSync(process.execPath, [path.join(here, t)], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const pass = (out.match(/✓/g) ?? []).length;
  const fail = (out.match(/✗/g) ?? []).length;
  totalPass += pass;

  // A non-zero exit is forgiven only when the file itself reported success:
  // no failed assertions AND its own pass line made it to stdout.
  const crashedAtExit = r.status !== 0 && fail === 0 && DECLARED_PASS.test(out);

  if (fail > 0 || (r.status !== 0 && !crashedAtExit)) {
    failed++;
    console.log(`FAIL  ${t}  ✓${pass} ✗${fail}${r.status !== 0 ? `  exit ${r.status}` : ""}`);
    const detail = out.split("\n").filter((l) => l.includes("✗"));
    console.log(detail.length > 0 ? detail.join("\n") : out.split("\n").slice(-12).join("\n"));
  } else {
    console.log(`ok    ${t}  ✓${pass}${crashedAtExit ? `  (exit ${r.status} after passing — teardown crash)` : ""}`);
  }
}

console.log(
  `\n${tests.length} files, ${totalPass} assertions — ` +
    (failed === 0 ? "ALL PASSED ✅" : `${failed} FILE(S) FAILED ❌`),
);
process.exit(failed === 0 ? 0 : 1);
