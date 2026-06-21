import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { buildSkeleton, collectSourceFiles } from "./skeleton.js";
import { resolveOptions, loadProjectConfig } from "./config.js";
import { buildSymbolGraph } from "./graph.js";
import { findDeadExports, findCircularDeps, getTopSymbols } from "./graph-analysis.js";
import { buildReport } from "./report.js";
import { loadHistory } from "./history.js";
import { detectSmells } from "./smells.js";
import { scanFileForSecurityIssues } from "./security.js";
import { buildSkeletonsBulk } from "./pool.js";
import type { SkeletonFile } from "./types.js";
import { webAppHtml } from "./webapp.js";
import { computeFileComplexity } from "./complexity.js";
import { findDuplicateSymbols, getChangeImpact, getFileDeps } from "./graph-analysis.js";
import { findSimilar } from "./similar.js";
import { checkArchRules, loadArchRules } from "./arch-rules.js";
import { buildClassDiagram, buildDepsDiagram, buildModulesDiagram } from "./diagram.js";
import { buildDocOutput, renderMarkdown } from "./docgen.js";
import { buildExplainResult } from "./explain.js";
import { searchSymbols } from "./search.js";

export interface ServeOptions {
  port?: number;
  root: string;
  scanDir?: string;
  open?: boolean;
  /** Enable fs.watch and push SSE events to connected clients. */
  watch?: boolean;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startServe(opts: ServeOptions): Promise<http.Server> {
  const root = opts.root;
  const scanDir = opts.scanDir ?? root;
  const port = opts.port ?? 7337;

  // SSE client registry
  const sseClients = new Set<http.ServerResponse>();
  function broadcastChange() {
    for (const client of sseClients) {
      try { client.write("event: change\ndata: {}\n\n"); } catch { sseClients.delete(client); }
    }
  }

  // fs.watch for live reload
  if (opts.watch) {
    try {
      fs.watch(scanDir, { recursive: true }, (_event, filename) => {
        if (!filename || filename.includes(".ast-map")) return;
        cache = null;
        broadcastChange();
      });
    } catch { /* watch not supported on all platforms */ }
  }

  let cache: { skeletons: SkeletonFile[]; ts: number } | null = null;
  const CACHE_TTL = 5000;

  async function getSkeletons(): Promise<SkeletonFile[]> {
    if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.skeletons;
    const skOpts = resolveOptions({ detail: "outline", emitHtml: false });
    const files = collectSourceFiles(scanDir, skOpts);
    const items = files.map((f) => ({
      abs: f,
      rel: path.relative(root, f).split(path.sep).join("/"),
    }));
    const built = await buildSkeletonsBulk(items, skOpts);
    const skeletons = built.filter(Boolean).map((r) => r!.skel);
    cache = { skeletons, ts: Date.now() };
    return skeletons;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    try {
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(webAppHtml(port));
        return;
      }

      if (pathname === "/api/report") {
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        const history = loadHistory(root);
        const report = await buildReport(scanDir, root);
        const smellsAll: ReturnType<typeof detectSmells> = [];
        const securityAll: ReturnType<typeof scanFileForSecurityIssues> = [];
        for (const skel of skeletons) {
          const fileAbs = path.resolve(root, skel.file);
          try {
            const src = fs.readFileSync(fileAbs, "utf8");
            smellsAll.push(...detectSmells(skel, src.split("\n").length));
            securityAll.push(...scanFileForSecurityIssues(src, skel.file));
          } catch { /* skip */ }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...report, smells: smellsAll, security: securityAll, history }, null, 2));
        return;
      }

      if (pathname === "/api/graph") {
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(graph, null, 2));
        return;
      }

      if (pathname === "/api/dead") {
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        const dead = findDeadExports(graph);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(dead, null, 2));
        return;
      }

      if (pathname === "/api/top") {
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        const top = getTopSymbols(graph, 20);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(top, null, 2));
        return;
      }

      if (pathname === "/api/cycles") {
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        const cycles = findCircularDeps(graph);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cycles, null, 2));
        return;
      }

      if (pathname === "/api/history") {
        const history = loadHistory(root);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(history, null, 2));
        return;
      }

      if (pathname === "/api/skeletons") {
        const skeletons = await getSkeletons();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(skeletons, null, 2));
        return;
      }

      if (pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write("event: connected\ndata: {}\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (pathname === "/api/smells") {
        const skeletons = await getSkeletons();
        const all: ReturnType<typeof detectSmells> = [];
        for (const skel of skeletons) {
          const fileAbs = path.resolve(root, skel.file);
          try {
            const src = fs.readFileSync(fileAbs, "utf8");
            all.push(...detectSmells(skel, src.split("\n").length));
          } catch { /* skip */ }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(all, null, 2));
        return;
      }

      if (pathname === "/api/security") {
        const skeletons = await getSkeletons();
        const all: ReturnType<typeof scanFileForSecurityIssues> = [];
        for (const skel of skeletons) {
          const fileAbs = path.resolve(root, skel.file);
          try {
            const src = fs.readFileSync(fileAbs, "utf8");
            all.push(...scanFileForSecurityIssues(src, skel.file));
          } catch { /* skip */ }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(all, null, 2));
        return;
      }

      if (pathname === "/api/run" && req.method === "POST") {
        const body = await readBody(req);
        const { cmd, args = {} } = JSON.parse(body) as { cmd: string; args: Record<string, unknown> };
        const skeletons = await getSkeletons();
        const graph = buildSymbolGraph(skeletons, root);
        let data: unknown;

        switch (cmd) {
          case "dead":
            data = findDeadExports(graph);
            break;
          case "cycles":
            data = findCircularDeps(graph);
            break;
          case "duplicates":
            data = findDuplicateSymbols(graph);
            break;
          case "top":
            data = getTopSymbols(graph, (args.limit as number) ?? 20);
            break;
          case "similar":
            data = findSimilar(skeletons, { minGroupSize: (args.minGroupSize as number) ?? 2 });
            break;
          case "smells": {
            const all: ReturnType<typeof detectSmells> = [];
            for (const skel of skeletons) {
              try {
                const src = fs.readFileSync(path.resolve(root, skel.file), "utf8");
                all.push(...detectSmells(skel, src.split("\n").length));
              } catch { /* skip */ }
            }
            data = all;
            break;
          }
          case "security": {
            const all: ReturnType<typeof scanFileForSecurityIssues> = [];
            for (const skel of skeletons) {
              try {
                const src = fs.readFileSync(path.resolve(root, skel.file), "utf8");
                all.push(...scanFileForSecurityIssues(src, skel.file));
              } catch { /* skip */ }
            }
            data = all;
            break;
          }
          case "complexity": {
            const results = [];
            for (const skel of skeletons) {
              try {
                results.push(await computeFileComplexity(path.resolve(root, skel.file), skel.file));
              } catch { /* skip */ }
            }
            data = results;
            break;
          }
          case "find": {
            if (!args.query) throw new Error("query required");
            data = await searchSymbols(scanDir, args.query as string, root, {
              matchType: (args.matchType as "exact" | "contains" | "regex") ?? "contains",
              kind: args.kind as string | undefined,
            });
            break;
          }
          case "impact": {
            if (!args.symbol) throw new Error("symbol required");
            data = getChangeImpact(graph, args.symbol as string);
            break;
          }
          case "fileDeps": {
            if (!args.file) throw new Error("file required");
            data = getFileDeps(graph, args.file as string);
            break;
          }
          case "explain": {
            if (!args.file || !args.symbol) throw new Error("file and symbol required");
            const skel = skeletons.find(
              (s) => s.file === args.file || s.file.endsWith(args.file as string)
            );
            if (!skel) throw new Error(`File not found: ${args.file}`);
            const nodeId = `${skel.file}::${args.symbol}`;
            const impact = getChangeImpact(graph, nodeId);
            data = buildExplainResult(args.symbol as string, skel, graph, impact, []);
            break;
          }
          case "arch": {
            const cfg = loadProjectConfig(root);
            const rules = loadArchRules(cfg);
            data = checkArchRules(graph, rules);
            break;
          }
          case "diagram": {
            const type = (args.type as string) ?? "deps";
            if (type === "class") data = buildClassDiagram(skeletons);
            else if (type === "modules") data = buildModulesDiagram(graph);
            else data = buildDepsDiagram(graph, (args.maxNodes as number) ?? 50);
            break;
          }
          case "doc": {
            const docOut = buildDocOutput(skeletons, { exportedOnly: (args.exportedOnly as boolean) ?? false });
            data = {
              markdown: renderMarkdown(docOut),
              files: docOut.files.length,
              symbols: docOut.files.reduce((a: number, f) => a + f.symbols.length, 0),
            };
            break;
          }
          default:
            throw new Error(`Unknown command: ${cmd}`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, cmd, data }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
