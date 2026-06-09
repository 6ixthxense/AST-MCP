// Smoke test for the quality gate (check.ts). Run after `npm run build`:
//   node test/check-smoke.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runQualityGate, metricsFromReport, BASELINE_FILENAME } from "../dist/check.js";
import { buildReport } from "../dist/report.js";

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
}

// Sandbox project: clean module + a gnarly one we can regress later.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ast-map-check-"));
const srcDir = path.join(root, "src");
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, "a.ts"),
  'import { b } from "./b.js";\nexport function useB() { return b(); }\nuseB();\n');
fs.writeFileSync(path.join(srcDir, "b.ts"),
  "export function b() { return 1; }\n");

console.log("metrics:");
const report = await buildReport(srcDir, root);
const m = metricsFromReport(report);
check("metricsFromReport carries counts", m.fileCount === 2 && typeof m.score === "number");

console.log("quality gate:");
// 1. No baseline, no thresholds → passes
let r = await runQualityGate(srcDir, root, {});
check("passes with no baseline/thresholds", r.passed && r.baseline === null);
check("default baseline path", r.baselinePath.endsWith(BASELINE_FILENAME));

// 2. Threshold violation
r = await runQualityGate(srcDir, root, { thresholds: { minScore: 101 } });
check("minScore threshold fails", !r.passed && r.failures[0].kind === "threshold");
check("threshold failure names metric", r.failures[0].metric === "score");

// 3. Write baseline → re-run passes
r = await runQualityGate(srcDir, root, { updateBaseline: true });
check("updateBaseline writes the file", fs.existsSync(r.baselinePath) && r.baselineUpdated);
r = await runQualityGate(srcDir, root, {});
check("clean re-run vs baseline passes", r.passed && r.baseline !== null);

// 4. Introduce a regression (cycle + dead export) → ratchet fails
fs.writeFileSync(path.join(srcDir, "a.ts"),
  'import { b } from "./b.js";\nexport function useB() { return b(); }\nexport function dead() { return 2; }\nuseB();\n');
fs.writeFileSync(path.join(srcDir, "b.ts"),
  'import { useB } from "./a.js";\nexport function b() { return useB ? 1 : 2; }\n');
r = await runQualityGate(srcDir, root, {});
check("regression fails the gate", !r.passed);
check("failure kinds are regressions", r.failures.every((f) => f.kind === "regression"));
check("cycle regression detected", r.failures.some((f) => f.metric === "cycles"));

// 5. Re-anchor baseline → passes again
r = await runQualityGate(srcDir, root, { updateBaseline: true });
r = await runQualityGate(srcDir, root, {});
check("re-anchored baseline passes", r.passed);

// 6. Custom baseline path
const custom = path.join(root, "custom-base.json");
r = await runQualityGate(srcDir, root, { baselinePath: custom, updateBaseline: true });
check("custom baseline path respected", fs.existsSync(custom));

fs.rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll quality-gate checks passed.");
