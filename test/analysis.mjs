/**
 * Integration tests for graph-analysis functions.
 * Run: node test/analysis.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GRAPH_DIR = path.join(__dirname, "fixtures", "graph");
const SFC_DIR = path.join(__dirname, "fixtures", "sfc");

// ─── Bootstrap tree-sitter (same as smoke.mjs) ──────────────────────────────

process.chdir(ROOT);

const { buildSkeleton, collectSourceFiles } = await import("../dist/skeleton.js");
const { buildSymbolGraph } = await import("../dist/graph.js");
const { findDeadExports, findCircularDeps, getChangeImpact, getFileDeps, findDuplicateSymbols } =
  await import("../dist/graph-analysis.js");
const { searchSymbols } = await import("../dist/search.js");
const { computeFileComplexity } = await import("../dist/complexity.js");
const { findUnusedParams } = await import("../dist/unused-params.js");
const { traceTypeInFile } = await import("../dist/typeflow.js");
const { discoverWorkspace, findPackageCycles } = await import("../dist/workspace.js");
const { buildExplorerHtml } = await import("../dist/explorer.js");
const { readSourceMap } = await import("../dist/sourcemap.js");
const { buildReport, buildReportHtml } = await import("../dist/report.js");
const { computeDiff, computeRisk, isGitRepo } = await import("../dist/gitdiff.js");
const { packContext } = await import("../dist/contextpack.js");
const { computeCoupling } = await import("../dist/coupling.js");
const { findLayerViolations } = await import("../dist/layers.js");
const { computeModuleCoupling } = await import("../dist/modulecoupling.js");
const { resolveOptions } = await import("../dist/config.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function buildGraph(dir) {
  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const files = collectSourceFiles(dir, opts);
  const skeletons = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    skeletons.push(await buildSkeleton(file, rel, opts));
  }
  return buildSymbolGraph(skeletons, ROOT);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\n=== Dead Code Detection ===");
{
  const graph = await buildGraph(GRAPH_DIR);
  const dead = findDeadExports(graph);
  const deadNames = dead.map((d) => d.symbol);
  const deadFiles = dead.map((d) => d.file);

  check("neverUsed is dead", deadNames.includes("neverUsed"), `got: ${deadNames.join(", ")}`);
  check(
    "neverUsed is high confidence",
    dead.some((d) => d.symbol === "neverUsed" && d.confidence === "high"),
  );
  check("login is NOT dead (imported by router)", !deadNames.includes("login"), `dead: ${deadNames}`);
  check("hashPassword is NOT dead (imported by auth)", !deadNames.includes("hashPassword"), `dead: ${deadNames}`);
  check("dead exports come from utils.ts", deadFiles.some((f) => f.includes("utils")));
}

console.log("\n=== Circular Dependency Detection ===");
{
  const graph = await buildGraph(GRAPH_DIR);
  const cycles = findCircularDeps(graph);
  const allFiles = cycles.flatMap((c) => c.cycle);

  check("at least one cycle detected", cycles.length >= 1, `got ${cycles.length} cycles`);
  check(
    "cycle involves cycle-a.ts",
    allFiles.some((f) => f.includes("cycle-a")),
    `files in cycles: ${allFiles.join(", ")}`,
  );
  check(
    "cycle involves cycle-b.ts",
    allFiles.some((f) => f.includes("cycle-b")),
  );
  check(
    "cycle involves cycle-c.ts",
    allFiles.some((f) => f.includes("cycle-c")),
  );
  check(
    "cycle closes on itself (first == last)",
    cycles.some((c) => c.cycle[0] === c.cycle[c.cycle.length - 1]),
  );
  check(
    "utils.ts is NOT in a cycle",
    !allFiles.some((f) => f.includes("utils")),
    `unexpected files: ${allFiles}`,
  );
}

console.log("\n=== Change Impact ===");
{
  const graph = await buildGraph(GRAPH_DIR);

  // login is imported by router.ts
  const loginId = graph.nodes.find(
    (n) => n.nodeType === "symbol" && n.symbol === "login",
  )?.id;
  check("login node found in graph", !!loginId, "login node missing");

  if (loginId) {
    const impact = getChangeImpact(graph, loginId);
    check("impact result is non-null", impact !== null);

    if (impact) {
      const allImpactFiles = [
        ...impact.direct.map((n) => n.file),
        ...impact.transitive.map((n) => n.file),
      ];
      check(
        "router.ts is in impact set",
        allImpactFiles.some((f) => f.includes("router")),
        `impact files: ${allImpactFiles.join(", ")}`,
      );
      check("totalFiles >= 1", impact.totalFiles >= 1);
    }
  }

  // neverUsed has no importers → totalFiles = 0
  const neverUsedId = graph.nodes.find(
    (n) => n.nodeType === "symbol" && n.symbol === "neverUsed",
  )?.id;
  if (neverUsedId) {
    const impact = getChangeImpact(graph, neverUsedId);
    check(
      "neverUsed has zero impact files",
      impact !== null && impact.totalFiles === 0,
      `totalFiles=${impact?.totalFiles}`,
    );
  }
}

console.log("\n=== File Dependencies ===");
{
  const graph = await buildGraph(GRAPH_DIR);
  const utilsId = graph.nodes.find(
    (n) => n.nodeType === "file" && n.id.includes("utils"),
  )?.id;
  check("utils.ts file node found", !!utilsId);

  if (utilsId) {
    const deps = getFileDeps(graph, utilsId);
    check("getFileDeps returns non-null for utils.ts", deps !== null);
    if (deps) {
      const importers = deps.importedBy.map((d) => d.file);
      check(
        "auth.ts imports utils.ts",
        importers.some((f) => f.includes("auth")),
        `importers: ${importers.join(", ")}`,
      );
    }
  }

  const authId = graph.nodes.find(
    (n) => n.nodeType === "file" && n.id.includes("auth") && !n.id.includes("cycle"),
  )?.id;
  if (authId) {
    const deps = getFileDeps(graph, authId);
    if (deps) {
      const imported = deps.imports.map((d) => d.file);
      check(
        "auth.ts imports utils.ts (outgoing)",
        imported.some((f) => f.includes("utils")),
        `auth imports: ${imported.join(", ")}`,
      );
    }
  }
}

console.log("\n=== Symbol Search ===");
{
  const matches = await searchSymbols(GRAPH_DIR, "login", ROOT, { matchType: "exact" });
  const names = matches.map((m) => m.symbol);
  check("exact search 'login' finds login", names.includes("login"), `got: ${names}`);
  check("exact search 'login' does NOT find logout", !names.includes("logout"));

  const contains = await searchSymbols(GRAPH_DIR, "log", ROOT, { matchType: "contains" });
  const cNames = contains.map((m) => m.symbol);
  check("contains 'log' finds login", cNames.some((n) => n === "login"));
  check("contains 'log' finds logout", cNames.some((n) => n === "logout"));

  const exported = await searchSymbols(GRAPH_DIR, "do", ROOT, {
    matchType: "contains",
    exportedOnly: true,
  });
  check(
    "exportedOnly finds doA, doB, doC",
    ["doA", "doB", "doC"].every((n) => exported.some((m) => m.symbol === n)),
    `got: ${exported.map((m) => m.symbol).join(", ")}`,
  );
}

// ─── Duplicate Symbols ────────────────────────────────────────────────────────
{
  console.log("\n=== Duplicate Symbols ===");
  const dir = path.join(__dirname, "fixtures", "dupes");
  const graph = await buildGraph(dir);
  const dups = findDuplicateSymbols(graph);
  const validate = dups.find((d) => d.symbol === "validate");
  const helper = dups.find((d) => d.symbol === "helper");
  check("validate flagged as duplicate", !!validate);
  check("validate exported from 2 files", validate?.count === 2);
  check("validate locations include a.ts and b.ts",
    ["test/fixtures/dupes/a.ts", "test/fixtures/dupes/b.ts"].every((f) => validate?.locations.some((l) => l.file === f)));
  check("helper flagged as duplicate (const in 2 files)", helper?.count === 2);
  check("uniqueA is NOT a duplicate", !dups.some((d) => d.symbol === "uniqueA"));
}

// ─── Complexity ───────────────────────────────────────────────────────────────
{
  console.log("\n=== Cyclomatic Complexity ===");
  const file = path.join(__dirname, "fixtures", "complexity.ts");
  const fc = await computeFileComplexity(file, "complexity.ts");
  const simple = fc.functions.find((f) => f.name === "simple");
  const branchy = fc.functions.find((f) => f.name === "branchy");
  check("simple has complexity 1", simple?.complexity === 1, `got ${simple?.complexity}`);
  check("simple rated low", simple?.rating === "low");
  check("branchy has complexity 6 (if + && + for + if + ternary)", branchy?.complexity === 6, `got ${branchy?.complexity}`);
  check("branchy rated moderate", branchy?.rating === "moderate");
  check("functions sorted desc by complexity", fc.functions[0].name === "branchy");
  check("maxComplexity = 6", fc.maxComplexity === 6, `got ${fc.maxComplexity}`);
}

// ─── Unused Parameters ────────────────────────────────────────────────────────
{
  console.log("\n=== Unused Parameters ===");
  const file = path.join(__dirname, "fixtures", "unused-params.ts");
  const res = await findUnusedParams(file, "unused-params.ts");
  const greet = res.functions.find((f) => f.function === "greet");
  check("greet flags salutation as unused", greet?.unused.includes("salutation") ?? false);
  check("greet does NOT flag used params name/title",
    !greet?.unused.includes("name") && !greet?.unused.includes("title"));
  check("_-prefixed param not flagged (ignored)",
    !res.functions.some((f) => f.function === "ignored"));
  check("shorthand { id, label } counts as usage (shorthandUser clean)",
    !res.functions.some((f) => f.function === "shorthandUser"));
  check("only greet has unused params", res.functions.length === 1);
}

// ─── Type-flow tracing ────────────────────────────────────────────────────────
{
  console.log("\n=== Type-flow Tracing ===");
  const file = path.join(__dirname, "fixtures", "typeflow.ts");
  const refs = await traceTypeInFile(file, "typeflow.ts", "Inventory");
  const has = (role, symbol) => refs.some((r) => r.role === role && r.symbol === symbol);
  check("Inventory traced as return of make()", has("return", "make"));
  check("Inventory traced as param of use()", refs.some((r) => r.role === "param" && r.symbol === "use" && r.detail === "inv"));
  check("Inventory traced as typed variable store", has("variable", "store"));
  check("Inventory traced as field item", has("field", "item"));
  check("4 total Inventory refs", refs.length === 4, `got ${refs.length}`);
  const numRefs = await traceTypeInFile(file, "typeflow.ts", "number");
  check("primitive types (number) are not traced as named types", numRefs.length === 0);
}

// ─── Monorepo Workspace ───────────────────────────────────────────────────────
{
  console.log("\n=== Monorepo Workspace ===");
  const dir = path.join(__dirname, "fixtures", "monorepo");
  const info = discoverWorkspace(dir);
  const byName = Object.fromEntries(info.packages.map((p) => [p.name, p]));
  check("workspace tool detected (npm)", info.tool === "npm");
  check("3 packages discovered", info.packages.length === 3);
  check("@demo/a found at packages/a", byName["@demo/a"]?.dir === "packages/a");
  check("@demo/a depends on @demo/b (internal)", byName["@demo/a"]?.internalDeps.includes("@demo/b"));
  check("@demo/c depends on @demo/a and @demo/b (incl devDep)",
    ["@demo/a", "@demo/b"].every((d) => byName["@demo/c"]?.internalDeps.includes(d)));
  check("external dep lodash not counted as internal",
    !byName["@demo/a"]?.internalDeps.includes("lodash"));
  check("3 internal edges", info.edges.length === 3);
  check("fixture monorepo is acyclic", findPackageCycles(info).length === 0);

  // synthetic cyclic graph: a -> b -> a
  const cyc = findPackageCycles({
    root: dir, tool: "npm", edges: [],
    packages: [
      { name: "a", dir: "a", internalDeps: ["b"], allDeps: ["b"] },
      { name: "b", dir: "b", internalDeps: ["a"], allDeps: ["a"] },
    ],
  });
  check("package cycle a<->b detected", cyc.length === 1 && cyc[0].length === 3);
}

// ─── TS Decorators ────────────────────────────────────────────────────────────
{
  console.log("\n=== TS/JS Decorators ===");
  const { resolveOptions: ro } = await import("../dist/config.js");
  const { buildSkeleton: bs } = await import("../dist/skeleton.js");
  const file = path.join(__dirname, "fixtures", "ts-decorators.ts");
  const skel = await bs(file, "ts-decorators.ts", ro({ detail: "full", emitHtml: false }));
  const flat = [];
  (function walk(syms){ for (const s of syms){ flat.push(s); walk(s.children); } })(skel.symbols);
  const cls = flat.find((s) => s.name === "AppComponent");
  const m = flat.find((s) => s.name === "getItem");
  const plain = flat.find((s) => s.name === "fetch");
  check("class decorator @Component captured", cls?.decorators?.some((d) => d.startsWith("Component(")) ?? false);
  check("method decorator @Get captured", m?.decorators?.some((d) => d.startsWith("Get(")) ?? false);
  check("undecorated method has no decorators", !plain?.decorators);
}

// ─── Dynamic Imports ──────────────────────────────────────────────────────────
{
  console.log("\n=== Dynamic Imports ===");
  const { resolveOptions: ro2 } = await import("../dist/config.js");
  const { buildSkeleton: bs2 } = await import("../dist/skeleton.js");
  const file = path.join(__dirname, "fixtures", "dynamic-imports.ts");
  const skel = await bs2(file, "dynamic-imports.ts", ro2({ detail: "full", emitHtml: false }));
  const dyn = (skel.imports ?? []).filter((i) => i.isDynamic);
  const froms = dyn.map((i) => i.from).sort();
  check("static import is not flagged dynamic",
    (skel.imports ?? []).some((i) => i.from === "./static" && !i.isDynamic));
  check("import('./dynamic') captured as dynamic", froms.includes("./dynamic"));
  check("nested import('./lazy-route') captured", froms.includes("./lazy-route"));
  check("require('./common') captured as dynamic", froms.includes("./common"));
  check("require('lodash') captured as dynamic", froms.includes("lodash"));
  check("4 dynamic imports total", dyn.length === 4, `got ${dyn.length}`);
}

// ─── Ambient .d.ts declarations ───────────────────────────────────────────────
{
  console.log("\n=== Ambient .d.ts ===");
  const { resolveOptions: ro3 } = await import("../dist/config.js");
  const { buildSkeleton: bs3 } = await import("../dist/skeleton.js");
  const file = path.join(__dirname, "fixtures", "ambient.d.ts");
  const skel = await bs3(file, "ambient.d.ts", ro3({ detail: "full", emitHtml: false }));
  const flat = [];
  (function walk(syms){ for (const s of syms){ flat.push(s); walk(s.children); } })(skel.symbols);
  const find = (k, n) => flat.find((s) => s.kind === k && s.name === n);
  check("declare module surfaced as namespace", !!find("namespace", "my-lib"));
  check("nested declared function (doThing) surfaced", !!find("function", "doThing"));
  check("declare function globalHelper surfaced", !!find("function", "globalHelper"));
  check("declare const CONFIG surfaced (no initializer)", !!find("const", "CONFIG"));
  check("declare namespace MyNS surfaced", !!find("namespace", "MyNS"));
  check("export declare class Service surfaced", !!find("class", "Service"));
  check("Service.run method surfaced", !!find("method", "run"));
  check("non-empty .d.ts no longer yields 0 symbols", skel.symbolCount >= 8, `got ${skel.symbolCount}`);
}

// ─── Graph Explorer (Web UI) ──────────────────────────────────────────────────
{
  console.log("\n=== Graph Explorer ===");
  const graph = await buildGraph(GRAPH_DIR);
  const html = buildExplorerHtml(graph, GRAPH_DIR);
  check("explorer html is non-trivial", html.length > 1000);
  check("self-contained (no external script src)", !/src=["']https?:/.test(html));
  check("has a canvas element", html.includes("<canvas"));
  const m = html.match(/var DATA=(\{[\s\S]*?\});<\/script>/);
  check("embeds graph DATA", !!m);
  const data = m ? JSON.parse(m[1]) : { nodes: [], links: [] };
  check("explorer nodes match graph files", data.nodes.length === graph.stats.fileCount);
  check("explorer has dependency links", data.links.length > 0);

  // Coupling overlay (v1.26.0)
  check("nodes carry coupling fields (ca/ce/inst)", data.nodes.every((n) => "ca" in n && "ce" in n && "inst" in n));
  const utils = data.nodes.find((n) => n.id.endsWith("utils.ts"));
  check(
    "utils.ts is stable (Ca>0, I=0 — pure dependency target)",
    utils && utils.ca > 0 && utils.ce === 0 && utils.inst === 0,
    utils ? `ca=${utils.ca} ce=${utils.ce} inst=${utils.inst}` : "utils.ts not found",
  );
  const router = data.nodes.find((n) => n.id.endsWith("router.ts"));
  check(
    "router.ts is volatile (Ce>0, Ca=0, I=1)",
    router && router.ce > 0 && router.ca === 0 && router.inst === 1,
    router ? `ca=${router.ca} ce=${router.ce} inst=${router.inst}` : "router.ts not found",
  );
  check("has color-mode toggle (folder vs coupling)", html.includes('id="mode"') && html.includes("color: coupling"));
  check("has instability legend + color scale", html.includes('id="leg"') && html.includes("instColor"));
}

// ─── Source Maps ──────────────────────────────────────────────────────────────
{
  console.log("\n=== Source Maps ===");
  const dir = path.join(__dirname, "fixtures", "sourcemap");
  const inline = readSourceMap(path.join(dir, "inline.js"), "inline.js");
  const ext = readSourceMap(path.join(dir, "external.js"), "external.js");
  check("inline data-URI map parsed", inline?.mapKind === "inline");
  check("inline sources extracted", (inline?.sources || []).includes("../src/a.ts") && inline.sources.includes("../src/b.ts"));
  check("inline reports embedded content", inline?.hasContent === true);
  check("external .map parsed", ext?.mapKind === "external");
  check("external sourceRoot applied (src/widget.ts)", (ext?.sources || []).includes("src/widget.ts"));
  check("file with no map -> null", readSourceMap(path.join(__dirname, "fixtures", "sample.ts"), "sample.ts") === null);
}

// ─── Codebase Report ──────────────────────────────────────────────────────────
{
  console.log("\n=== Codebase Report ===");
  const data = await buildReport(GRAPH_DIR, GRAPH_DIR);
  check("report has a grade A-F", /^[A-F]$/.test(data.grade));
  check("score in 0..100", data.score >= 0 && data.score <= 100);
  check("counts files", data.fileCount > 0);
  check("language breakdown present", data.languages.length > 0 && data.languages[0].lang === "typescript");
  check("detects the cycle fixture", data.cycles.count >= 1);
  check("complexity hotspots sorted desc", data.complexity.hotspots.length === 0 || data.complexity.hotspots.every((h, i, a) => i === 0 || a[i-1].complexity >= h.complexity));
  check("report includes layer-violation data", data.layerViolations && typeof data.layerViolations.count === "number");
  check("report includes module coupling data", Array.isArray(data.modules));
  const html = buildReportHtml(data);
  check("report html self-contained", html.length > 1000 && !/src=["']https?:/.test(html));
  check("report html shows the grade badge", html.includes(">" + data.grade + "<"));
  check("report html renders the module coupling card", html.includes("Module coupling"));
  check("report html renders the SDP card", html.includes("Layer violations"));

  // Test-coverage card (v1.28.0)
  check("report includes test-coverage data", data.testCoverage && typeof data.testCoverage.coverageRatio === "number");
  check("report html renders the test-coverage card + stat tile", (html.match(/Test coverage/g) || []).length >= 2);

  // Root fallback: report on src/ only — tests live under the root's tests/ dir.
  const TM = path.join(__dirname, "fixtures", "testmap");
  const tmReport = await buildReport(path.join(TM, "src"), TM);
  check(
    "root fallback pulls test files for a src-only report",
    tmReport.testCoverage.rootFallback === true && tmReport.testCoverage.testFiles === 3,
    `fallback=${tmReport.testCoverage.rootFallback} tests=${tmReport.testCoverage.testFiles}`,
  );
  check("src-only report coverage = 2/4", tmReport.testCoverage.coverageRatio === 0.5, `ratio=${tmReport.testCoverage.coverageRatio}`);
  check(
    "untested in report ranked by fan-in (core.ts first)",
    tmReport.testCoverage.untested[0]?.file === "src/core.ts",
    JSON.stringify(tmReport.testCoverage.untested),
  );
  const tmHtml = buildReportHtml(tmReport);
  check("coverage card notes root fallback", tmHtml.includes("(from project root)"));
}

// ─── Git Diff & Risk ──────────────────────────────────────────────────────────
{
  console.log("\n=== Git Diff & Risk ===");
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const fsm = await import("node:fs");
  const tmp = path.join(os.tmpdir(), "astgit-" + Date.now());
  const g = (args) => execFileSync("git", args, { cwd: tmp, stdio: "pipe" });
  let ok = true;
  try {
    fsm.mkdirSync(path.join(tmp, "src"), { recursive: true });
    g(["init", "-q"]); g(["config", "user.email", "t@t"]); g(["config", "user.name", "t"]);
    fsm.writeFileSync(path.join(tmp, "src/a.ts"), "export function foo(x){return x;}\nexport function gone(){return 0;}\n");
    fsm.writeFileSync(path.join(tmp, "src/b.ts"), 'import {foo} from "./a";\nexport function useFoo(){return foo(1);}\n');
    g(["add", "-A"]); g(["commit", "-qm", "init"]);
    fsm.writeFileSync(path.join(tmp, "src/a.ts"), "export function foo(x,y){return x+y;}\nexport function added(){return 9;}\n");

    check("isGitRepo detects a repo", isGitRepo(tmp));
    const d = await computeDiff(tmp, tmp, "HEAD");
    const af = d.files.find((f) => f.file === "src/a.ts");
    check("foo flagged modified (signature change)", af?.modified.some((x) => x.symbol === "foo") ?? false);
    check("gone flagged removed", af?.removed.some((x) => x.symbol === "gone") ?? false);
    check("added flagged added", af?.added.some((x) => x.symbol === "added") ?? false);
    check("breaking = removed export + sig change (2)", d.breaking.length === 2);
    check("b.ts impacted by breaking foo", d.impactedFiles.includes("src/b.ts"));

    g(["add", "-A"]); g(["commit", "-qm", "change"]);
    const risk = await computeRisk(tmp, tmp);
    check("risk map has churn-weighted files", risk.length >= 1 && risk[0].churn >= 1 && risk[0].risk > 0);
  } catch (e) {
    ok = false; check("git diff/risk smoke (git available)", false, e.message);
  } finally {
    try { fsm.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ─── Context Pack ─────────────────────────────────────────────────────────────
{
  console.log("\n=== Context Pack ===");
  const dir = GRAPH_DIR;
  const pack = await packContext(path.join(dir, "auth.ts"), "auth.ts", dir, "login", dir);
  check("primary is the login symbol range", pack.primary.symbol === "login" && pack.primary.source.includes("function login"));
  check("dependency on utils.ts captured", pack.dependencies.some((d) => d.file === "utils.ts"));
  check("dependency signatures included", pack.dependencies.some((d) => d.symbols.some((x) => x.name === "hashPassword" && x.signature)));
  check("dependents include router.ts", pack.dependents.some((d) => d.file === "router.ts"));
  check("token estimate is small (minimal pack)", pack.tokenEstimate > 0 && pack.tokenEstimate < 400);
}

// ─── Coupling metrics ─────────────────────────────────────────────────────────
{
  console.log("\n=== Coupling Metrics ===");
  const graph = await buildGraph(GRAPH_DIR);
  const m = computeCoupling(graph);
  const by = Object.fromEntries(m.map((x) => [x.file.split("/").pop(), x]));
  check("utils.ts is stable (I=0, fan-in only)", by["utils.ts"]?.instability === 0 && by["utils.ts"]?.afferent >= 1);
  check("router.ts is unstable (I=1, fan-out only)", by["router.ts"]?.instability === 1 && by["router.ts"]?.afferent === 0);
  check("auth.ts is in the middle (I=0.5)", by["auth.ts"]?.instability === 0.5);
  check("instability within [0,1]", m.every((x) => x.instability >= 0 && x.instability <= 1));
}

// ─── Layer violations (Stable Dependencies Principle) ─────────────────────────
{
  console.log("\n=== Layer Violations (SDP) ===");
  // Clean fixture: stable utils is imported by less-stable files (correct direction).
  const clean = findLayerViolations(await buildGraph(GRAPH_DIR));
  check("clean graph fixture has no SDP violations", clean.length === 0);
  // Synthetic graph: stable S (Ca=3,Ce=1 -> I=0.25) imports volatile V (Ca=1,Ce=2 -> I=0.67).
  const g = {
    nodes: ["s","v","x1","x2","x3","y1","y2"].map((id) => ({ id: id + ".ts", nodeType: "file" })),
    edges: [
      ["x1","s"],["x2","s"],["x3","s"],["s","v"],["v","y1"],["v","y2"],
    ].map(([f, t]) => ({ from: f + ".ts", to: t + ".ts", edgeType: "imports" })),
  };
  const v = findLayerViolations(g);
  check("synthetic graph reports exactly one SDP violation", v.length === 1);
  check("violation is the stable->volatile edge s.ts -> v.ts", v[0]?.from === "s.ts" && v[0]?.to === "v.ts");
  check("severity = toInstability - fromInstability (~0.42)", Math.abs(v[0]?.severity - 0.42) < 0.01);
  check("from is more stable than to", v[0]?.fromInstability < v[0]?.toInstability);
}

// ─── Module coupling ──────────────────────────────────────────────────────────
{
  console.log("\n=== Module Coupling ===");
  // Three modules: ui -> api -> core (a clean stability gradient).
  const g = {
    nodes: ["ui/a","api/b","core/c"].map((id) => ({ id: id + ".ts", nodeType: "file" })),
    edges: [["ui/a","api/b"],["api/b","core/c"]].map(([f, t]) => ({ from: f + ".ts", to: t + ".ts", edgeType: "imports" })),
  };
  const mc = computeModuleCoupling(g);
  const by = Object.fromEntries(mc.modules.map((m) => [m.module, m]));
  check("core module is stable (I=0)", by["core"]?.instability === 0 && by["core"]?.afferent === 1);
  check("api module is in the middle (I=0.5)", by["api"]?.instability === 0.5);
  check("ui module is unstable (I=1)", by["ui"]?.instability === 1 && by["ui"]?.afferent === 0);
  check("two inter-module edges, intra-module ignored", mc.edges.length === 2);
  check("edge ui -> api exists", mc.edges.some((e) => e.from === "ui" && e.to === "api"));
}

// ─── Vue / Svelte single-file components ──────────────────────────────────────
{
  console.log("\n=== Vue / Svelte SFC ===");
  const opts = resolveOptions({ detail: "full", emitHtml: false });
  const vue = await buildSkeleton(path.join(SFC_DIR, "Counter.vue"), "Counter.vue", opts);
  check("Vue SFC detected as language 'vue'", vue.language === "vue");
  check("Vue script symbols extracted (interface + function)", vue.symbols.some((s) => s.name === "Props") && vue.symbols.some((s) => s.name === "increment"));
  check("Vue imports captured from <script setup>", (vue.imports ?? []).some((i) => i.symbol === "formatLabel" && i.from === "./helpers"));
  const sv = await buildSkeleton(path.join(SFC_DIR, "Widget.svelte"), "Widget.svelte", opts);
  check("Svelte SFC detected as language 'svelte'", sv.language === "svelte");
  check("Svelte script symbols extracted", sv.symbols.some((s) => s.name === "toggle"));
  check("Svelte imports captured", (sv.imports ?? []).some((i) => i.from === "./helpers"));
  // Cross-file graph edges from SFCs into a plain .ts module.
  const g = await buildGraph(SFC_DIR);
  const imp = g.edges.filter((e) => e.edgeType === "imports").map((e) => e.from + "->" + e.to);
  check("Vue component wires an import edge to helpers.ts", imp.some((e) => e.includes("Counter.vue->") && e.includes("helpers.ts")));
  check("Svelte component wires an import edge to helpers.ts", imp.some((e) => e.includes("Widget.svelte->") && e.includes("helpers.ts")));
}

// ─── Semantic search ──────────────────────────────────────────────────────────
{
  console.log("\n=== Semantic Search ===");
  const { semanticSearch, splitIdentifier, stem } = await import("../dist/semantic.js");

  check(
    "splitIdentifier: camelCase + acronym + digits",
    JSON.stringify(splitIdentifier("getHTTPServerByID")) === JSON.stringify(["get", "http", "server", "by", "id"]) &&
      JSON.stringify(splitIdentifier("parse_config-v2")) === JSON.stringify(["parse", "config", "v", "2"]),
  );
  check("stem folds plurals", stem("users") === "user" && stem("entries") === "entry");

  const auth = await semanticSearch(GRAPH_DIR, "authenticate user", ROOT, { limit: 10 });
  check(
    "synonym query 'authenticate user' ranks login first",
    auth.length > 0 && auth[0].symbol === "login",
    `got: ${auth.map((m) => m.symbol).join(", ")}`,
  );
  check(
    "matches expose matchedTerms + normalized score",
    auth.length > 0 && auth[0].score === 1 && auth[0].matchedTerms.length > 0,
  );
  check(
    "scores are sorted descending",
    auth.every((m, i) => i === 0 || auth[i - 1].score >= m.score),
  );

  const direct = await semanticSearch(GRAPH_DIR, "logout", ROOT, { limit: 5 });
  check("direct query 'logout' finds logout on top", direct.length > 0 && direct[0].symbol === "logout");

  const kinds = await semanticSearch(GRAPH_DIR, "session", ROOT, { kind: "interface" });
  check(
    "kind filter returns only interfaces",
    kinds.length > 0 && kinds.every((m) => m.kind === "interface") && kinds.some((m) => m.symbol === "Session"),
    `got: ${kinds.map((m) => `${m.symbol}:${m.kind}`).join(", ")}`,
  );

  const none = await semanticSearch(GRAPH_DIR, "the of and", ROOT);
  check("stopword-only query returns no matches", none.length === 0);
}

// ─── Test-coverage mapping ────────────────────────────────────────────────────
{
  console.log("\n=== Test-Coverage Mapping ===");
  const { mapTestCoverage, isTestFile, testNameTarget, isFixtureFile } = await import("../dist/testmap.js");

  check(
    "isTestFile: suffix + dir + go conventions",
    isTestFile("src/auth.test.ts") && isTestFile("test/foo.mjs") && isTestFile("pkg/auth_test.go") && !isTestFile("src/auth.ts"),
  );
  check(
    "testNameTarget: ts/py/java conventions",
    testNameTarget("a/auth.test.ts") === "auth" &&
      testNameTarget("t/test_utils.py") === "utils" &&
      testNameTarget("x/AuthTest.java") === "Auth" &&
      testNameTarget("test/smoke.mjs") === null,
  );
  check("isFixtureFile detects fixtures dirs", isFixtureFile("tests/fixtures/data.ts") && !isFixtureFile("tests/data.ts"));

  const TM_DIR = path.join(__dirname, "fixtures", "testmap");
  const tmOpts = resolveOptions({ detail: "outline", emitHtml: false });
  const tmSkels = [];
  for (const f of collectSourceFiles(TM_DIR, tmOpts)) {
    const rel = path.relative(TM_DIR, f).split(path.sep).join("/");
    tmSkels.push(await buildSkeleton(f, rel, tmOpts));
  }
  const map = mapTestCoverage(buildSymbolGraph(tmSkels, TM_DIR));

  check(
    "counts: 3 tests / 4 sources / 1 fixture",
    map.testFiles === 3 && map.sourceFiles === 4 && map.fixtureFiles === 1,
    `tests=${map.testFiles} sources=${map.sourceFiles} fixtures=${map.fixtureFiles}`,
  );
  check(
    "import link: mylib.test.ts → mylib.ts",
    map.links.some((l) => l.test === "tests/mylib.test.ts" && l.source === "src/mylib.ts" && l.via === "import"),
    JSON.stringify(map.links),
  );
  check(
    "name link: util.spec.ts → util.ts (no import needed)",
    map.links.some((l) => l.test === "tests/util.spec.ts" && l.source === "src/util.ts" && l.via === "name"),
  );
  check("coverage ratio 2/4 = 0.5", map.coverageRatio === 0.5, `ratio=${map.coverageRatio}`);
  check(
    "untested ranked by fan-in: core.ts (Ca=2) before orphanmod.ts",
    map.untested.length === 2 && map.untested[0].file === "src/core.ts" && map.untested[0].afferent === 2 &&
      map.untested[1].file === "src/orphanmod.ts",
    JSON.stringify(map.untested),
  );
  check("orphan test detected (e2e-flow)", map.orphanTests.length === 1 && map.orphanTests[0] === "tests/e2e-flow.test.ts");
}

// ─── Test Generation ─────────────────────────────────────────────────────────
{
  console.log("\n=== Test Generation ===");
  const { generateTestFile, detectTestFramework, resolveTestPath } = await import("../dist/testgen.js");

  // Framework detection from project root (which has no jest/vitest → node)
  const fw = detectTestFramework(ROOT);
  check("detectTestFramework returns a valid framework", ["vitest","jest","mocha","node"].includes(fw));

  // resolveTestPath
  check("resolveTestPath ts → *.test.ts", resolveTestPath("/p/src/utils.ts", "typescript").endsWith("utils.test.ts"));
  check("resolveTestPath js → *.test.js", resolveTestPath("/p/src/utils.js", "javascript").endsWith("utils.test.js"));
  check("resolveTestPath py → test_*.py", resolveTestPath("/p/utils.py", "python").endsWith("test_utils.py"));
  check("resolveTestPath go → *_test.go", resolveTestPath("/p/utils.go", "go").endsWith("utils_test.go"));
  check("resolveTestPath java → *Test.java", resolveTestPath("/p/Utils.java", "java").endsWith("UtilsTest.java"));

  // Build a full skeleton for sample.ts
  const SAMPLE_TS = path.join(__dirname, "fixtures", "sample.ts");
  const skelOpts = resolveOptions({ detail: "full", emitHtml: false });
  const skel = await buildSkeleton(SAMPLE_TS, "sample.ts", skelOpts);

  // node:test framework
  const nodeResult = generateTestFile(skel, SAMPLE_TS, { framework: "node" });
  check("testgen: node:test imports node:test", nodeResult.content.includes("node:test"));
  check("testgen: node:test imports assert", nodeResult.content.includes("node:assert"));
  check("testgen: imports source module", nodeResult.content.includes("from './sample'"));
  check("testgen: class UserService gets describe block", nodeResult.content.includes("describe('UserService'"));
  check("testgen: async method getUser gets async it", nodeResult.content.includes("async () => {") && nodeResult.content.includes("getUser"));
  check("testgen: function helper gets describe block", nodeResult.content.includes("describe('helper'"));
  check("testgen: exported const double gets describe block", nodeResult.content.includes("describe('double'"));
  check("testgen: type-only interface exported separately", nodeResult.content.includes("import type {") && nodeResult.content.includes("Repository"));
  check("testgen: testCount > 0", nodeResult.testCount > 0);

  // vitest framework
  const vitestResult = generateTestFile(skel, SAMPLE_TS, { framework: "vitest" });
  check("testgen vitest: imports from vitest", vitestResult.content.includes("from 'vitest'"));
  check("testgen vitest: expect().toBeDefined used", vitestResult.content.includes("toBeDefined"));

  // jest framework
  const jestResult = generateTestFile(skel, SAMPLE_TS, { framework: "jest" });
  check("testgen jest: imports from @jest/globals", jestResult.content.includes("@jest/globals"));

  // exported-only filter (default): multiply is not exported → should not appear
  check("testgen: non-exported multiply not included", !nodeResult.content.includes("describe('multiply'"));
  // with --all: multiply appears
  const allResult = generateTestFile(skel, SAMPLE_TS, { framework: "node", exportedOnly: false });
  check("testgen --all: non-exported multiply included", allResult.content.includes("multiply"));

  // Python
  const SAMPLE_PY = path.join(__dirname, "fixtures", "sample.py");
  const skelPy = await buildSkeleton(SAMPLE_PY, "sample.py", skelOpts);
  const pyResult = generateTestFile(skelPy, SAMPLE_PY, { framework: "pytest" });
  check("testgen python: imports pytest", pyResult.content.includes("import pytest"));
  check("testgen python: test_ prefix for functions", pyResult.content.includes("def test_"));
  check("testgen python: Test class for classes", pyResult.content.includes("class TestInventoryService"));
  check("testgen python: testCount > 0", pyResult.testCount > 0);

  // Go
  const SAMPLE_GO = path.join(__dirname, "fixtures", "services", "inventory.go");
  const skelGo = await buildSkeleton(SAMPLE_GO, "services/inventory.go", skelOpts);
  const goResult = generateTestFile(skelGo, SAMPLE_GO, { framework: "gotest" });
  check("testgen go: imports testing package", goResult.content.includes(`"testing"`));
  check("testgen go: func Test prefix", goResult.content.includes("func Test"));
}

// ─── Code Smells ─────────────────────────────────────────────────────────────
{
  console.log("\n=== Code Smells ===");
  const { detectSmells } = await import("../dist/smells.js");

  // Build a full skeleton for sample.ts (has UserService class with methods)
  const SAMPLE_TS = path.join(__dirname, "fixtures", "sample.ts");
  const skOpts = resolveOptions({ detail: "full", emitHtml: false });
  const skel = await buildSkeleton(SAMPLE_TS, "sample.ts", skOpts);
  const src = (await import("node:fs")).readFileSync(SAMPLE_TS, "utf8");
  const lineCount = src.split("\n").length;

  // No smells on small clean sample file
  const smells = detectSmells(skel, lineCount);
  check("detectSmells returns array", Array.isArray(smells));
  check("small clean file has no god-class", !smells.some(s => s.smell === "god-class"));
  check("small file has no large-file", !smells.some(s => s.smell === "large-file"));

  // Synthetic skeleton: god class (11 public methods)
  const godClassSkel = {
    ...skel,
    file: "god.ts",
    symbols: [{
      name: "GodClass", kind: "class", visibility: "public", exported: true,
      range: { startLine: 1, endLine: 200 }, children: Array.from({ length: 11 }, (_, i) => ({
        name: `method${i}`, kind: "method", visibility: "public", exported: false,
        range: { startLine: i * 10 + 2, endLine: i * 10 + 8 }, children: [], signature: `method${i}(): void`
      }))
    }]
  };
  const godSmells = detectSmells(godClassSkel, 200);
  check("god class detected (>10 methods)", godSmells.some(s => s.smell === "god-class" && s.symbol === "GodClass"));

  // Long method
  const longMethodSkel = { ...skel, file: "long.ts", symbols: [{
    name: "bigFn", kind: "function", visibility: "public", exported: true,
    range: { startLine: 1, endLine: 80 }, children: [], signature: "bigFn(x: string): void"
  }]};
  const longSmells = detectSmells(longMethodSkel, 80);
  check("long-method detected (>60 lines)", longSmells.some(s => s.smell === "long-method" && s.symbol === "bigFn"));

  // Long param list
  const longParamSkel = { ...skel, file: "params.ts", symbols: [{
    name: "tooManyParams", kind: "function", visibility: "public", exported: true,
    range: { startLine: 1, endLine: 5 }, children: [],
    signature: "tooManyParams(a: string, b: string, c: number, d: boolean, e: string): void"
  }]};
  const paramSmells = detectSmells(longParamSkel, 5);
  check("long-param-list detected (>4 params)", paramSmells.some(s => s.smell === "long-param-list" && s.symbol === "tooManyParams"));

  // Large file
  const largeFileSmells = detectSmells(skel, 600);
  check("large-file detected when lineCount > 500", largeFileSmells.some(s => s.smell === "large-file"));

  // SmellResult shape
  const gs = godSmells.find(s => s.smell === "god-class");
  check("smell result has required fields", gs && typeof gs.file === "string" && typeof gs.message === "string" && typeof gs.severity === "string");
}

// ─── Security Scanning ────────────────────────────────────────────────────────
{
  console.log("\n=== Security Scanning ===");
  const { scanFileForSecurityIssues, SECURITY_RULES } = await import("../dist/security.js");

  check("SECURITY_RULES is a non-empty array", Array.isArray(SECURITY_RULES) && SECURITY_RULES.length > 0);

  const evalCode = `const result = eval(userInput);\nconst x = 1;`;
  const evalIssues = scanFileForSecurityIssues(evalCode, "test.ts");
  check("eval() flagged as critical", evalIssues.some(i => i.rule === "eval" && i.severity === "critical"));
  check("eval issue has line number", evalIssues.some(i => i.rule === "eval" && i.line === 1));

  const innerHtmlCode = `el.innerHTML = userContent;\nfoo += 1;`;
  const innerHtmlIssues = scanFileForSecurityIssues(innerHtmlCode, "test.js");
  check("innerHTML assignment flagged as high", innerHtmlIssues.some(i => i.rule === "inner-html" && i.severity === "high"));

  const weakCryptoCode = `const hash = crypto.createHash('md5').update(data).digest('hex');`;
  const weakCryptoIssues = scanFileForSecurityIssues(weakCryptoCode, "test.ts");
  check("weak-crypto md5 flagged", weakCryptoIssues.some(i => i.rule === "weak-crypto"));

  const hardcodedSecretCode = `const password = "SuperSecret123";`;
  const secretIssues = scanFileForSecurityIssues(hardcodedSecretCode, "config.ts");
  check("hardcoded-secret flagged", secretIssues.some(i => i.rule === "hardcoded-secret" && i.severity === "high"));

  // False positive guard: comment lines should be skipped
  const commentedEval = `// eval(foo)\n// const x = eval(bar);`;
  const commentIssues = scanFileForSecurityIssues(commentedEval, "test.ts");
  check("commented-out eval not flagged", !commentIssues.some(i => i.rule === "eval"));

  // http-url detection (non-localhost)
  const httpCode = `const url = "http://api.example.com/data";`;
  const httpIssues = scanFileForSecurityIssues(httpCode, "service.ts");
  check("http:// url flagged as low", httpIssues.some(i => i.rule === "http-url"));

  // localhost excluded from http-url
  const localhostCode = `const devUrl = "http://localhost:3000/api";`;
  const localhostIssues = scanFileForSecurityIssues(localhostCode, "dev.ts");
  check("http://localhost not flagged", !localhostIssues.some(i => i.rule === "http-url"));

  // Issue shape
  const issue = evalIssues.find(i => i.rule === "eval");
  check("issue has all required fields", issue && typeof issue.file === "string" && typeof issue.snippet === "string" && typeof issue.line === "number");
}

// ─── Mermaid Diagrams ─────────────────────────────────────────────────────────
{
  console.log("\n=== Mermaid Diagrams ===");
  const { buildClassDiagram, buildDepsDiagram, buildModulesDiagram } = await import("../dist/diagram.js");

  const GRAPH_DIR = path.join(__dirname, "fixtures", "graph");
  const dOpts = resolveOptions({ detail: "outline", emitHtml: false });
  const dSkels = [];
  for (const f of collectSourceFiles(GRAPH_DIR, dOpts)) {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    dSkels.push(await buildSkeleton(f, rel, dOpts));
  }
  const dGraph = buildSymbolGraph(dSkels, ROOT);

  // Class diagram
  const SAMPLE_TS = path.join(__dirname, "fixtures", "sample.ts");
  const skelOpts = resolveOptions({ detail: "outline", emitHtml: false });
  const sampleSkel = await buildSkeleton(SAMPLE_TS, "sample.ts", skelOpts);
  const classDiag = buildClassDiagram([sampleSkel]);
  check("class diagram type is 'class'", classDiag.type === "class");
  check("class diagram starts with classDiagram", classDiag.mermaid.startsWith("classDiagram"));
  check("class diagram includes UserService", classDiag.mermaid.includes("UserService"));
  check("class diagram nodeCount > 0", classDiag.nodeCount > 0);

  // Deps diagram
  const depsDiag = buildDepsDiagram(dGraph);
  check("deps diagram type is 'deps'", depsDiag.type === "deps");
  check("deps diagram starts with graph TD", depsDiag.mermaid.startsWith("graph TD"));
  check("deps diagram nodeCount > 0", depsDiag.nodeCount > 0);
  check("deps diagram edgeCount > 0", depsDiag.edgeCount > 0);

  // Modules diagram
  const modDiag = buildModulesDiagram(dGraph);
  check("modules diagram type is 'modules'", modDiag.type === "modules");
  check("modules diagram starts with graph LR", modDiag.mermaid.startsWith("graph LR"));

  // DiagramResult shape
  check("diagram result has mermaid string", typeof classDiag.mermaid === "string" && classDiag.mermaid.length > 0);
  check("diagram result has title", typeof classDiag.title === "string");
}

// ─── Fix Suggestions ─────────────────────────────────────────────────────────
{
  console.log("\n=== Fix Suggestions ===");
  const { buildFixSuggestions } = await import("../dist/fix.js");
  const { findDeadExports } = await import("../dist/graph-analysis.js");
  const { detectSmells } = await import("../dist/smells.js");
  const { scanFileForSecurityIssues } = await import("../dist/security.js");

  // Empty input → no suggestions
  const empty = buildFixSuggestions({});
  check("empty opts returns empty array", Array.isArray(empty) && empty.length === 0);

  // Dead export → remove-dead-export suggestion
  const dead = [{ file: "src/utils.ts", symbol: "unusedFn", kind: "function", confidence: "high" }];
  const fixesDead = buildFixSuggestions({ dead });
  check("dead export generates remove-dead-export fix", fixesDead.some(f => f.kind === "remove-dead-export"));
  check("dead export fix has priority 2", fixesDead.find(f => f.kind === "remove-dead-export")?.priority === 2);
  check("dead export fix has before/after", fixesDead.find(f => f.kind === "remove-dead-export")?.before?.includes("export"));

  // God class smell → split-class suggestion
  const smells = [{ file: "src/big.ts", smell: "god-class", symbol: "BigClass", severity: "warning", message: "BigClass has 12 methods", line: 1 }];
  const fixesSmell = buildFixSuggestions({ smells });
  check("god-class generates split-class fix", fixesSmell.some(f => f.kind === "split-class"));

  // Security eval → remove-eval suggestion
  const security = [{ file: "src/eval.ts", rule: "eval", severity: "critical", message: "eval() detected", line: 5, snippet: "eval(x)" }];
  const fixesSec = buildFixSuggestions({ security });
  check("eval security issue generates remove-eval fix", fixesSec.some(f => f.kind === "remove-eval" && f.priority === 1));

  // Priority filtering
  const all = buildFixSuggestions({ dead, smells, security });
  check("combined suggestions have varying priorities", all.some(f => f.priority === 1) && all.some(f => f.priority === 2));

  // FixSuggestion shape
  const fix = all[0];
  check("fix suggestion has required fields", fix && typeof fix.kind === "string" && typeof fix.file === "string" && typeof fix.description === "string");
}

// ─── AI Testgen (unit, no API call) ──────────────────────────────────────────
{
  console.log("\n=== AI Testgen (module shape) ===");
  const { tryAiEnhanceTests } = await import("../dist/ai-testgen.js");

  // tryAiEnhanceTests should fall back gracefully when no API key is set
  const fakeResult = {
    sourceFile: "src/utils.ts",
    testFilePath: "src/utils.test.ts",
    framework: "vitest",
    content: "describe('add', () => { it('should ...', () => { /* TODO */ }) })",
    testCount: 1,
  };

  const env = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const fallback = await tryAiEnhanceTests(fakeResult, "export function add(a, b) { return a + b; }", "typescript", {});
  check("tryAiEnhanceTests returns an object", typeof fallback === "object" && fallback !== null);
  check("fallback has aiEnhanced=false when no key", fallback.aiEnhanced === false);
  check("fallback preserves original content", fallback.content === fakeResult.content);
  check("fallback has error field", typeof fallback.error === "string" && fallback.error.length > 0);
  check("fallback has testCount", fallback.testCount === 1);
  check("fallback has sourceFile", fallback.sourceFile === "src/utils.ts");
  check("fallback has framework", fallback.framework === "vitest");

  if (env !== undefined) process.env.ANTHROPIC_API_KEY = env;

  // Verify the module exports the right shape
  check("tryAiEnhanceTests is a function", typeof tryAiEnhanceTests === "function");

  const { aiEnhanceTests } = await import("../dist/ai-testgen.js");
  check("aiEnhanceTests is a function", typeof aiEnhanceTests === "function");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
