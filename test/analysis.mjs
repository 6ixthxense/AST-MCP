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
const { findDeadExports, findCircularDeps, getChangeImpact, getFileDeps } =
  await import("../dist/graph-analysis.js");
const { searchSymbols } = await import("../dist/search.js");
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
