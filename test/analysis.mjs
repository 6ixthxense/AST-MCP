/**
 * Integration tests for graph-analysis functions.
 * Run: node test/analysis.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GRAPH_DIR = path.join(__dirname, "fixtures", "graph");

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
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
