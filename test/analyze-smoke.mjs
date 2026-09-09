// The `analyze` tool folded twelve v1.x tools behind one `kind` enum. This drives
// the real MCP server over stdio and asserts every kind still routes to its
// analysis and returns that analysis' own payload shape.
// Run after `npm run build`:  node test/analyze-smoke.mjs
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = "test/fixtures/graph";

let failures = 0;
function check(label, cond, detail = "") {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); failures++; }
}

/** Send a batch of JSON-RPC messages to the server and collect the responses. */
function rpc(messages, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, "dist", "index.js")], {
      cwd: ROOT,
      env: { ...process.env, AST_MAP_ROOT: ROOT },
    });
    let out = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("server timed out")); }, timeoutMs);
    p.stdout.on("data", (c) => { out += c; });
    p.on("error", reject);
    p.stdin.write(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
    // The server has no "done" signal; give it the batch then read until quiet.
    const settle = setInterval(() => {
      const got = out.trim().split("\n").filter((l) => l.startsWith("{")).length;
      if (got >= messages.filter((m) => m.id).length) {
        clearInterval(settle); clearTimeout(timer); p.kill();
        resolve(out.trim().split("\n").flatMap((l) => {
          try { return [JSON.parse(l)]; } catch { return []; }
        }));
      }
    }, 200);
  });
}

const handshake = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "analyze-smoke", version: "1" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

// Every kind, with the field that proves the right analysis ran.
const KINDS = [
  ["dead", (j) => typeof j.deadExportCount === "number" && Array.isArray(j.deadExports)],
  ["cycles", (j) => typeof j.cycleCount === "number" && Array.isArray(j.cycles)],
  ["duplicates", (j) => typeof j.duplicateCount === "number"],
  ["top", (j) => Array.isArray(j.topSymbols)],
  ["coupling", (j) => Array.isArray(j.files) && j.files.every((f) => "instability" in f)],
  ["modules", (j) => Array.isArray(j.modules) && Array.isArray(j.edges)],
  ["layers", (j) => Array.isArray(j.violations)],
  ["tests", (j) => typeof j.coverageRatio === "number"],
  ["complexity", (j) => Array.isArray(j.hotspots)],
  ["unused-params", (j) => typeof j.unusedParamCount === "number"],
  ["workspace", (j) => typeof j.packageCount === "number"],
];

console.log("analyze — tool surface");
{
  const [, listed] = await rpc([...handshake, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
  const names = listed.result.tools.map((t) => t.name);
  check("analyze is registered", names.includes("analyze"));
  check("the twelve v1.x tools are gone",
    !names.some((n) => ["find_dead_code", "find_circular_deps", "get_coupling", "get_top_symbols",
      "get_module_coupling", "get_layer_violations", "get_test_coverage", "get_complexity",
      "find_unused_params", "get_risk_map", "analyze_workspace", "find_duplicate_symbols"].includes(n)),
    names.join(", "));
  const analyze = listed.result.tools.find((t) => t.name === "analyze");
  const enumVals = analyze.inputSchema.properties.kind.enum;
  check("kind enum lists all 12 analyses", enumVals.length === 12, `got ${enumVals.length}`);
  check("every tested kind is in the enum", KINDS.every(([k]) => enumVals.includes(k)));
}

console.log("\nanalyze — every kind routes");
{
  const calls = KINDS.map(([kind], i) => ({
    jsonrpc: "2.0", id: 100 + i, method: "tools/call",
    params: { name: "analyze", arguments: { kind, path: FIXTURES } },
  }));
  const res = await rpc([...handshake, ...calls]);
  KINDS.forEach(([kind, shape], i) => {
    const r = res.find((x) => x.id === 100 + i);
    if (!r) return check(`kind="${kind}"`, false, "no response");
    if (r.result?.isError) return check(`kind="${kind}"`, false, r.result.content[0].text.slice(0, 80));
    let j;
    try { j = JSON.parse(r.result.content[0].text); } catch { return check(`kind="${kind}"`, false, "non-JSON payload"); }
    check(`kind="${kind}" returns its own payload`, shape(j), JSON.stringify(j).slice(0, 90));
  });
}

console.log("\nanalyze — guards");
{
  const res = await rpc([...handshake,
    { jsonrpc: "2.0", id: 200, method: "tools/call", params: { name: "analyze", arguments: { kind: "complexity", path: "src/metrics.ts" } } },
    { jsonrpc: "2.0", id: 201, method: "tools/call", params: { name: "analyze", arguments: { kind: "dead", path: "src/metrics.ts" } } },
    { jsonrpc: "2.0", id: 202, method: "tools/call", params: { name: "analyze", arguments: { kind: "top", path: FIXTURES, limit: 2 } } },
  ]);
  const file = res.find((x) => x.id === 200);
  check("complexity accepts a single file",
    !file.result.isError && Array.isArray(JSON.parse(file.result.content[0].text).functions));

  const dirOnly = res.find((x) => x.id === 201);
  check("dead rejects a file with a directory-required message",
    dirOnly.result.isError === true && /requires a directory/.test(dirOnly.result.content[0].text),
    dirOnly.result.content?.[0]?.text?.slice(0, 80));

  const limited = res.find((x) => x.id === 202);
  check("top honours limit",
    JSON.parse(limited.result.content[0].text).topSymbols.length <= 2);

  // untestedOnly trims the lists, not the headline numbers: dropping reachRatio
  // would leave callers only the figure that reads too low.
  const [trimmed] = (await rpc([...handshake,
    { jsonrpc: "2.0", id: 203, method: "tools/call", params: { name: "analyze", arguments: { kind: "tests", path: ".", untestedOnly: true } } },
  ])).filter((x) => x.id === 203);
  const t = JSON.parse(trimmed.result.content[0].text);
  check("untestedOnly keeps both coverage ratios",
    typeof t.coverageRatio === "number" && typeof t.reachRatio === "number" && t.reachRatio >= t.coverageRatio,
    JSON.stringify({ coverageRatio: t.coverageRatio, reachRatio: t.reachRatio }));
  check("untestedOnly still trims the lists", t.links === undefined && t.reached === undefined);
}

console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
