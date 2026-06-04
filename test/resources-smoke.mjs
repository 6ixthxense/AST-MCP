// Integration test: drive the MCP server's resource endpoints over stdio.
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

console.log("MCP resources — integration test");
rpc(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
await waitFor(1);
rpc(child, { jsonrpc: "2.0", method: "notifications/initialized" });

rpc(child, { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
const list = await waitFor(2);
const uris = (list.result?.resources ?? []).map((r) => r.uri);
check("resources/list returns entries", uris.length > 5);
check("includes ast://languages", uris.includes("ast://languages"));
check("includes ast://graph", uris.includes("ast://graph"));
check("lists per-file skeleton resources", uris.some((u) => u.startsWith("ast://skeleton/src/")));

rpc(child, { jsonrpc: "2.0", id: 3, method: "resources/templates/list", params: {} });
const tpl = await waitFor(3);
check("skeleton template exposed", (tpl.result?.resourceTemplates ?? []).some((t) => t.uriTemplate === "ast://skeleton/{+path}"));

rpc(child, { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ast://languages" } });
const lang = await waitFor(4);
check("read ast://languages returns JSON", JSON.parse(lang.result.contents[0].text).languages?.length > 0);

rpc(child, { jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "ast://skeleton/src/types.ts" } });
const skel = await waitFor(5);
const parsed = JSON.parse(skel.result.contents[0].text);
check("read skeleton template resolves the file", parsed.language === "typescript" && parsed.file === "src/types.ts");

child.kill();
console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"}`);
process.exit(failures === 0 ? 0 : 1);
