import path from "node:path";
import { collectSourceFiles } from "./skeleton.js";
import { buildSkeletonsBulk } from "./pool.js";
import { resolveOptions } from "./config.js";
import { buildSymbolGraph } from "./graph.js";
import { findDeadExports, findCircularDeps, getTopSymbols } from "./graph-analysis.js";
import type { FunctionComplexity } from "./complexity.js";
import { findLayerViolations, type LayerViolation } from "./layers.js";
import { computeModuleCoupling, type ModuleMetric } from "./modulecoupling.js";
import type { SkeletonFile } from "./types.js";
import { mapTestCoverage, isTestFile, isFixtureFile, type UntestedSource } from "./testmap.js";

export interface ReportData {
  project: string;
  generatedAt: string;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  languages: { lang: string; files: number }[];
  score: number;
  grade: string;
  dead: { count: number; items: { file: string; symbol: string; kind: string }[] };
  cycles: { count: number; items: string[][] };
  godNodes: { symbol: string; file: string; importCount: number }[];
  complexity: { average: number; max: number; hotspots: (FunctionComplexity & { file: string })[] };
  layerViolations: { count: number; items: LayerViolation[] };
  modules: ModuleMetric[];
  testCoverage: {
    testFiles: number;
    sourceFiles: number;
    testedSources: number;
    /** testedSources / sourceFiles (0–1). */
    coverageRatio: number;
    untestedCount: number;
    /** Top untested sources, ranked by risk (fan-in, then symbols). */
    untested: UntestedSource[];
    /** True when test files were pulled in from the project root (scan dir had none). */
    rootFallback: boolean;
  };
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export async function buildReport(absDir: string, root: string): Promise<ReportData> {
  const opts = resolveOptions({ detail: "outline", emitHtml: false });
  const files = collectSourceFiles(absDir, opts);
  const skeletons: SkeletonFile[] = [];
  const langCount = new Map<string, number>();
  let symbolCount = 0;
  const hotspots: (FunctionComplexity & { file: string })[] = [];
  let cxSum = 0, cxN = 0, cxMax = 0;

  const items = files.map((file) => ({
    abs: file,
    rel: path.relative(root, file).split(path.sep).join("/"),
  }));
  const built = await buildSkeletonsBulk(items, opts, true);
  for (let i = 0; i < built.length; i++) {
    const r = built[i];
    if (!r) continue; // skip unparsable
    const rel = items[i].rel;
    skeletons.push(r.skel);
    symbolCount += r.skel.symbolCount;
    langCount.set(r.skel.language, (langCount.get(r.skel.language) ?? 0) + 1);
    if (r.complexity) {
      for (const f of r.complexity.functions) {
        hotspots.push({ ...f, file: rel });
        cxSum += f.complexity; cxN++; cxMax = Math.max(cxMax, f.complexity);
      }
    }
  }

  const graph = buildSymbolGraph(skeletons, root);
  const dead = findDeadExports(graph).filter((d) => d.confidence === "high");
  const cycles = findCircularDeps(graph);
  const god = getTopSymbols(graph, 8);
  const layerViolations = findLayerViolations(graph);
  const modules = computeModuleCoupling(graph).modules;

  // Test coverage. If the scanned dir has no test files (common when reporting
  // on src/ only), pull test files in from the project root so the map can
  // still pair them with the scanned sources.
  let covGraph = graph;
  let rootFallback = false;
  if (!skeletons.some((s) => isTestFile(s.file)) && path.resolve(absDir) !== path.resolve(root)) {
    const have = new Set(items.map((i) => i.abs));
    const testItems = collectSourceFiles(root, opts)
      .filter((f) => !have.has(f))
      .map((f) => ({ abs: f, rel: path.relative(root, f).split(path.sep).join("/") }))
      .filter((i) => isTestFile(i.rel) && !isFixtureFile(i.rel));
    if (testItems.length > 0) {
      const builtTests = await buildSkeletonsBulk(testItems, opts);
      const testSkels = builtTests.filter((r) => r !== null).map((r) => r!.skel);
      if (testSkels.length > 0) {
        covGraph = buildSymbolGraph([...skeletons, ...testSkels], root);
        rootFallback = true;
      }
    }
  }
  const cov = mapTestCoverage(covGraph);

  hotspots.sort((a, b) => b.complexity - a.complexity);
  const veryHigh = hotspots.filter((f) => f.complexity > 20).length;
  const high = hotspots.filter((f) => f.complexity > 10 && f.complexity <= 20).length;

  // Health score: start at 100, subtract weighted penalties.
  let score = 100;
  score -= Math.min(20, dead.length * 1.5);
  score -= Math.min(22, cycles.length * 6);
  score -= Math.min(28, veryHigh * 4 + high * 1);
  score -= Math.min(12, god.filter((g) => g.importCount >= 8).length * 4);
  score -= Math.min(10, layerViolations.length);
  score -= Math.min(8, Math.round((1 - cov.coverageRatio) * 8)); // structural test coverage
  score = Math.max(0, Math.round(score));

  const languages = [...langCount.entries()]
    .map(([lang, f]) => ({ lang, files: f }))
    .sort((a, b) => b.files - a.files);

  return {
    project: absDir.split(/[\\/]/).filter(Boolean).pop() || "project",
    generatedAt: new Date().toISOString(),
    fileCount: skeletons.length,
    symbolCount,
    edgeCount: graph.edges.filter((e) => e.edgeType === "imports").length,
    languages,
    score,
    grade: gradeFor(score),
    dead: { count: dead.length, items: dead.slice(0, 25).map((d) => ({ file: d.file, symbol: d.symbol, kind: d.kind })) },
    cycles: { count: cycles.length, items: cycles.slice(0, 12).map((c) => c.cycle) },
    godNodes: god.map((g) => ({ symbol: g.symbol, file: g.file, importCount: g.importCount })),
    complexity: { average: cxN ? Math.round((cxSum / cxN) * 10) / 10 : 0, max: cxMax, hotspots: hotspots.slice(0, 12) },
    layerViolations: { count: layerViolations.length, items: layerViolations.slice(0, 12) },
    modules: modules.slice(0, 10),
    testCoverage: {
      testFiles: cov.testFiles,
      sourceFiles: cov.sourceFiles,
      testedSources: cov.testedSources,
      coverageRatio: cov.coverageRatio,
      untestedCount: cov.untestedSources,
      untested: cov.untested.slice(0, 12),
      rootFallback,
    },
  };
}

/* ─── Premium HTML dashboard ───────────────────────────────────────────────── */

const GRADE_COLOR: Record<string, string> = {
  A: "#1d9e75", B: "#1d9e75", C: "#ba7517", D: "#d85a30", F: "#e24b4a",
};

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ratingColor(r: string): string {
  return r === "very-high" ? "#e24b4a" : r === "high" ? "#d85a30" : r === "moderate" ? "#ba7517" : "#1d9e75";
}

function instColor(i: number): string {
  return i >= 0.8 ? "#e24b4a" : i <= 0.2 ? "#1d9e75" : "#ba7517";
}

function statCard(label: string, value: string | number, accent?: string): string {
  return `<div class="stat"><div class="sv"${accent ? ` style="color:${accent}"` : ""}>${value}</div><div class="sl">${label}</div></div>`;
}

function bar(label: string, value: number, max: number, color: string, right: string): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="row"><div class="rl">${esc(label)}</div><div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div><div class="rr">${right}</div></div>`;
}

export function buildReportHtml(d: ReportData): string {
  const gc = GRADE_COLOR[d.grade] ?? "#888";
  const maxLang = d.languages[0]?.files ?? 1;
  const langs = d.languages.map((l) => bar(l.lang, l.files, maxLang, "#534ab7", `${l.files}`)).join("");
  const maxCx = d.complexity.hotspots[0]?.complexity ?? 1;
  const hotspots = d.complexity.hotspots.length
    ? d.complexity.hotspots.map((h) =>
        bar(`${h.name}  ·  ${h.file}`, h.complexity, maxCx, ratingColor(h.rating), `<b>${h.complexity}</b>`)).join("")
    : `<div class="empty">No functions found.</div>`;
  const god = d.godNodes.length
    ? d.godNodes.map((g) => `<div class="li"><span class="mono">${esc(g.symbol)}</span><span class="dim">${esc(g.file)}</span><span class="pill">${g.importCount} importers</span></div>`).join("")
    : `<div class="empty">None.</div>`;
  const dead = d.dead.count
    ? d.dead.items.map((x) => `<div class="li"><span class="kbadge">${esc(x.kind)}</span><span class="mono">${esc(x.symbol)}</span><span class="dim">${esc(x.file)}</span></div>`).join("")
      + (d.dead.count > d.dead.items.length ? `<div class="more">+${d.dead.count - d.dead.items.length} more…</div>` : "")
    : `<div class="ok">✓ No high-confidence dead exports</div>`;
  const cycles = d.cycles.count
    ? d.cycles.items.map((c) => `<div class="li"><span class="mono">${esc(c.join("  →  "))}</span></div>`).join("")
    : `<div class="ok">✓ No circular dependencies</div>`;
  const modules = d.modules.length
    ? d.modules.map((m) => bar(`${m.module}  ·  ${m.files} file(s)`, m.instability, 1, instColor(m.instability), `Ca ${m.afferent} · Ce ${m.efferent} · <b>I ${m.instability.toFixed(2)}</b>`)).join("")
    : `<div class="empty">No cross-module imports.</div>`;
  const covPct = Math.round(d.testCoverage.coverageRatio * 100);
  const covC = d.testCoverage.coverageRatio >= 0.7 ? "#1d9e75" : d.testCoverage.coverageRatio >= 0.4 ? "#ba7517" : "#e24b4a";
  const covHead = d.testCoverage.testFiles > 0
    ? bar(
        `${d.testCoverage.testedSources}/${d.testCoverage.sourceFiles} sources tested · ${d.testCoverage.testFiles} test file(s)${d.testCoverage.rootFallback ? " (from project root)" : ""}`,
        covPct, 100, covC, `<b>${covPct}%</b>`)
    : "";
  const covList = d.testCoverage.testFiles === 0
    ? `<div class="empty">No test files found in the scanned directory or project root.</div>`
    : d.testCoverage.untested.length === 0
      ? `<div class="ok">✓ Every source file has at least one test</div>`
      : d.testCoverage.untested.map((u) =>
          `<div class="li"><span class="mono">${esc(u.file)}</span><span class="dim">${u.symbols} symbol(s)</span><span class="pill">Ca ${u.afferent}</span></div>`).join("")
        + (d.testCoverage.untestedCount > d.testCoverage.untested.length ? `<div class="more">+${d.testCoverage.untestedCount - d.testCoverage.untested.length} more…</div>` : "");
  const sdp = d.layerViolations.count
    ? d.layerViolations.items.map((v) => `<div class="li"><span class="mono">${esc(v.from)}</span><span class="dim">→ ${esc(v.to)}</span><span class="pill" style="color:${instColor(0.9)}">+${v.severity.toFixed(2)}</span></div>`).join("")
      + (d.layerViolations.count > d.layerViolations.items.length ? `<div class="more">+${d.layerViolations.count - d.layerViolations.items.length} more…</div>` : "")
    : `<div class="ok">✓ No stability inversions (SDP)</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.project)} — code health</title><style>
:root{--bg:#fafaf8;--card:#fff;--bd:#e7e5df;--tx:#2b2b28;--dim:#8a8880;--soft:#f1efe9}
@media(prefers-color-scheme:dark){:root{--bg:#161613;--card:#1e1e1b;--bd:#33332e;--tx:#e6e4dd;--dim:#9a988f;--soft:#26261f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:system-ui,-apple-system,sans-serif;line-height:1.5}
.wrap{max-width:980px;margin:0 auto;padding:32px 24px 60px}
.hero{display:flex;align-items:center;gap:24px;margin-bottom:28px}
.badge{width:104px;height:104px;border-radius:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;flex:0 0 auto}
.badge .g{font-size:46px;font-weight:700;line-height:1}.badge .s{font-size:12px;opacity:.9}
.h1{font-size:26px;font-weight:650;margin:0}.sub{color:var(--dim);font-size:13px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;margin-bottom:30px}
.stat{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px 16px}
.sv{font-size:24px;font-weight:650}.sl{font-size:12px;color:var(--dim);margin-top:2px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:18px 20px;margin-bottom:18px}
.card h2{font-size:14px;font-weight:600;margin:0 0 14px;letter-spacing:.02em;text-transform:uppercase;color:var(--dim)}
.row{display:flex;align-items:center;gap:12px;margin:7px 0;font-size:13px}
.rl{flex:0 0 46%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.track{flex:1;height:8px;background:var(--soft);border-radius:5px;overflow:hidden}.fill{height:100%;border-radius:5px}
.rr{flex:0 0 auto;color:var(--dim);min-width:32px;text-align:right}
.li{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px;border-top:1px solid var(--bd)}.li:first-child{border-top:none}
.mono{font-family:ui-monospace,monospace;font-weight:550}.dim{color:var(--dim);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{margin-left:auto;background:var(--soft);border-radius:20px;padding:2px 10px;font-size:11px;color:var(--dim);flex:0 0 auto}
.kbadge{font-size:11px;color:var(--dim);background:var(--soft);border-radius:5px;padding:1px 7px;flex:0 0 auto}
.ok{color:#1d9e75;font-size:13px}.empty{color:var(--dim);font-size:13px}.more{color:var(--dim);font-size:12px;padding-top:6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:720px){.two{grid-template-columns:1fr}.rl{flex-basis:42%}}
.foot{color:var(--dim);font-size:11px;text-align:center;margin-top:24px}
</style></head><body><div class="wrap">
<div class="hero">
  <div class="badge" style="background:${gc}"><div class="g">${d.grade}</div><div class="s">${d.score}/100</div></div>
  <div><h1 class="h1">${esc(d.project)} — code health</h1>
  <div class="sub">${d.fileCount} files · ${d.symbolCount} symbols · ${d.languages.length} language(s) · ${esc(d.generatedAt.slice(0, 10))}</div></div>
</div>
<div class="grid">
  ${statCard("Files", d.fileCount)}
  ${statCard("Symbols", d.symbolCount)}
  ${statCard("Import edges", d.edgeCount)}
  ${statCard("Avg complexity", d.complexity.average)}
  ${statCard("Max complexity", d.complexity.max, ratingColor(d.complexity.max > 20 ? "very-high" : d.complexity.max > 10 ? "high" : "low"))}
  ${statCard("Dead exports", d.dead.count, d.dead.count ? "#d85a30" : "#1d9e75")}
  ${statCard("Cycles", d.cycles.count, d.cycles.count ? "#e24b4a" : "#1d9e75")}
  ${statCard("SDP violations", d.layerViolations.count, d.layerViolations.count ? "#d85a30" : "#1d9e75")}
  ${statCard("Test coverage", covPct + "%", covC)}
</div>
<div class="card"><h2>Language breakdown</h2>${langs}</div>
<div class="card"><h2>Complexity hotspots</h2>${hotspots}</div>
<div class="two">
  <div class="card"><h2>God nodes (most imported)</h2>${god}</div>
  <div class="card"><h2>Circular dependencies</h2>${cycles}</div>
</div>
<div class="two">
  <div class="card"><h2>Module coupling (instability)</h2>${modules}</div>
  <div class="card"><h2>Layer violations (stable → volatile)</h2>${sdp}</div>
</div>
<div class="card"><h2>Test coverage (untested by risk)</h2>${covHead}${covList}</div>
<div class="card"><h2>Dead exports (high confidence)</h2>${dead}</div>
<div class="foot">Generated by AST-MCP · universal-ast-mapper</div>
</div></body></html>`;
}
