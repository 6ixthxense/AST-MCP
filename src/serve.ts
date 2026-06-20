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

export interface ServeOptions {
  port?: number;
  root: string;
  scanDir?: string;
  open?: boolean;
}

export async function startServe(opts: ServeOptions): Promise<http.Server> {
  const root = opts.root;
  const scanDir = opts.scanDir ?? root;
  const port = opts.port ?? 7337;

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
