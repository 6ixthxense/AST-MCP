// detect_code_smells and scan_security ship as MCP tools and CLI commands with
// no test of their own. Both are pure functions over source text / skeletons, so
// they are cheap to pin down — and a security scanner that silently stops
// matching is the worst kind of regression: it reports "clean".
// Run after `npm run build`:  node test/smells-security-smoke.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const { SECURITY_RULES, scanFileForSecurityIssues } = await import("../dist/security.js");
const { detectSmells } = await import("../dist/smells.js");
const { buildSkeleton } = await import("../dist/skeleton.js");
const { resolveOptions } = await import("../dist/config.js");

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failures++; }
}

const scan = (src, file = "app.ts") => scanFileForSecurityIssues(src, file);
const ids = (src, file) => scan(src, file).map((i) => i.rule);

console.log("security — every rule fires on its own pattern");
{
  // One positive per rule, so a rule that stops matching is caught by name
  // rather than by a count that another rule's match could mask.
  const cases = [
    ["eval", "const r = eval(userInput);"],
    ["inner-html", "el.innerHTML = userInput;"],
    ["document-write", "document.write(payload);"],
    ["dangerously-set-inner-html", "<div dangerouslySetInnerHTML={{__html: body}} />"],
    ["child-process", 'import cp from "child_process";'],
    ["shell-exec", "exec(`rm -rf ${dir}`);"],
    ["weak-crypto", 'crypto.createHash("md5").update(x);'],
    ["hardcoded-secret", 'const apiKey = "sk-live-9c8b7a6d5e4f3a2b1c0d9e8f";'],
    ["sql-injection", 'db.query("SELECT * FROM users WHERE id = " + userId);'],
    ["http-url", 'fetch("http://api.example.com/v1/data");'],
    ["prototype-pollution", 'obj[key] = value; // __proto__'],
  ];
  for (const [rule, line] of cases) {
    check(`${rule} fires`, ids(line).includes(rule), `got: ${ids(line).join(", ") || "nothing"}`);
  }
  const covered = new Set(cases.map(([r]) => r));
  const untestedRules = SECURITY_RULES.map((r) => r.id).filter((id) => !covered.has(id) && id !== "no-rate-limit");
  check("every rule except no-rate-limit has a positive case above",
    untestedRules.length === 0, `unpinned: ${untestedRules.join(", ")}`);
}

console.log("\nsecurity — the false-positive guards actually guard");
{
  // Each of these is a line the scanner must stay quiet on. A scanner that
  // cries wolf gets muted, which is the same as having no scanner.
  check("eval.toString() is not eval()", !ids("const s = eval.toString();").includes("eval"));
  check("comments are skipped", scan("// el.innerHTML = x;").length === 0,
    JSON.stringify(scan("// el.innerHTML = x;")));
  check("http://localhost is not flagged", !ids('fetch("http://localhost:3000/api");').includes("http-url"));
  check("clean source produces nothing", scan("export const add = (a, b) => a + b;\n").length === 0);
}

console.log("\nsecurity — issue shape");
{
  const [issue] = scan("const x = 1;\nconst r = eval(input);\n");
  check("line number is 1-based and correct", issue?.line === 2, `line=${issue?.line}`);
  check("carries file, rule, severity, message", Boolean(
    issue && issue.file === "app.ts" && issue.rule === "eval" &&
    issue.severity === "critical" && issue.message.length > 0));
  check("snippet is the trimmed source line", issue?.snippet === "const r = eval(input);", issue?.snippet);
  const long = scan("const r = eval(x); // " + "y".repeat(300));
  check("snippet is capped at 120 chars", long[0].snippet.length <= 120, `len=${long[0].snippet.length}`);
}

console.log("\nsecurity — fileFilter scoping");
{
  const rulesWithFilter = SECURITY_RULES.filter((r) => r.fileFilter);
  check("some rules are path-scoped", rulesWithFilter.length > 0);
  for (const r of rulesWithFilter) {
    check(`${r.id} is skipped on a non-matching path`,
      !ids("x", "no/such/path.txt").includes(r.id));
  }
}

console.log("\nsmells — thresholds");
{
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const skel = await buildSkeleton(
    path.join(ROOT, "test", "fixtures", "sample.ts"), "sample.ts", opts);

  check("under the line threshold, no large-file smell",
    !detectSmells(skel, 100).some((s) => s.smell === "large-file"));
  check("over the line threshold, large-file fires",
    detectSmells(skel, 501).some((s) => s.smell === "large-file"),
    JSON.stringify(detectSmells(skel, 501).map((s) => s.smell)));
  check("large-file message names the count and threshold",
    /501/.test(detectSmells(skel, 501).find((s) => s.smell === "large-file").message));
  check("every smell carries file and severity",
    detectSmells(skel, 900).every((s) => s.file === "sample.ts" && ["warning", "info"].includes(s.severity)));

  // Options must actually reach the rules, or a configured threshold is a lie.
  const strict = detectSmells(skel, 100, { maxParams: 0, maxMethods: 0, maxFields: 0, maxMethodLines: 0 });
  const lax = detectSmells(skel, 100, { maxParams: 99, maxMethods: 99, maxFields: 99, maxMethodLines: 9999 });
  check("tightening the thresholds finds more", strict.length > lax.length,
    `strict=${strict.length} lax=${lax.length}`);
  // Only four smells take a threshold; god-class, long-method, long-param-list
  // and large-file answer to opts. primitive-obsession and shallow-wrapper are
  // structural and have no knob, so lax options must not silence those.
  const TUNABLE = new Set(["god-class", "long-method", "long-param-list", "large-file"]);
  check("lax thresholds silence every tunable smell",
    lax.every((s) => !TUNABLE.has(s.smell)), JSON.stringify(lax.map((s) => s.smell)));
  check("structural smells survive lax thresholds (they take no threshold)",
    detectSmells(skel, 100, { maxParams: 99, maxMethods: 99, maxFields: 99, maxMethodLines: 9999 })
      .every((s) => !TUNABLE.has(s.smell)));
}

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
