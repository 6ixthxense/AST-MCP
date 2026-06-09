// Integration test: drive the MCP server's prompt endpoints over stdio.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
let failures = 0;
const check = (label, cond) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); failures++; }
};

function rpc(child, msg) { child.stdin.write(JSON.stringify(msg) + "\n"); }

const child = spawn("node", [path.join(root, "dist/index.js")], {
  env: { ...process.env, AST_MAP_ROOT: root },
  stdio: ["pipe", "pipe", "ignore"],
});

const responses = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id != null) responses.set(m.id, m); } catch {}
  }
});

const waitFor = (id, ms = 10000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (responses.has(id)) { clearInterval(iv); res(responses.get(id)); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error("timeout id=" + id)); }
  }, 25);
});

console.log("MCP prompts — integration test");
rpc(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
await waitFor(1);
rpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });

rpc(child, { jsonrpc: "2.0", id: 2, method: "prompts/list", params: {} });
const list = await waitFor(2);
const prompts = list.result?.prompts ?? [];
const names = prompts.map((p) => p.name);
check("prompts/list returns 5 recipes", prompts.length === 5);
for (const n of ["architecture_audit", "safe_refactor", "dead_code_cleanup", "health_check", "onboard_codebase"]) {
  check(`includes ${n}`, names.includes(n));
}
const refactor = prompts.find((p) => p.name === "safe_refactor");
check("safe_refactor declares file + symbol args", (refactor?.arguments ?? []).map((a) => a.name).sort().join(",") === "file,symbol");

rpc(child, { jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "safe_refactor", arguments: { file: "src/auth.ts", symbol: "login" } } });
const got = await waitFor(3);
const text = got.result?.messages?.[0]?.content?.text ?? "";
check("prompts/get interpolates the file argument", text.includes("src/auth.ts"));
check("prompts/get interpolates the symbol argument", text.includes("login"));
check("rendered prompt references a real tool", text.includes("get_change_impact"));

rpc(child, { jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "architecture_audit", arguments: {} } });
const audit = await waitFor(4);
check("architecture_audit defaults dir to src", (audit.result?.messages?.[0]?.content?.text ?? "").includes("`src`"));

child.kill();
console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
