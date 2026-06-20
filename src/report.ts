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
import type { HistoryEntry } from "./history.js";

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

/* ─── HTML dashboard ────────────────────────────────────────────────────────── */

const GRADE_COLOR: Record<string, string> = {
  A: "#1d9e75", B: "#22c55e", C: "#ba7517", D: "#d85a30", F: "#e24b4a",
};

const GRADE_BG: Record<string, string> = {
  A: "#dcfce7", B: "#dcfce7", C: "#fef9c3", D: "#ffedd5", F: "#fee2e2",
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

function scoreRing(score: number, grade: string): string {
  const gc = GRADE_COLOR[grade] ?? "#888";
  const r = 42, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return `<div class="score-ring-wrap">
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r="${r}" fill="none" stroke="currentColor" stroke-width="9" opacity=".1"/>
      <circle cx="55" cy="55" r="${r}" fill="none" stroke="${gc}" stroke-width="9"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 55 55)"
        style="transition:stroke-dasharray 1s ease"/>
      <text x="55" y="50" text-anchor="middle" font-size="28" font-weight="700" fill="${gc}" font-family="system-ui,sans-serif">${grade}</text>
      <text x="55" y="66" text-anchor="middle" font-size="12" fill="currentColor" opacity=".6" font-family="system-ui,sans-serif">${score}/100</text>
    </svg>
  </div>`;
}

function statCard(label: string, value: string | number, accent?: string, sub?: string): string {
  const accent_attr = accent ? ` style="color:${accent}"` : "";
  const sub_html = sub ? `<div class="sl-sub">${sub}</div>` : "";
  return `<div class="stat"><div class="sv"${accent_attr}>${value}</div><div class="sl">${label}</div>${sub_html}</div>`;
}

function bar(label: string, value: number, max: number, color: string, right: string, title?: string): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const titleAttr = title ? ` title="${esc(title)}"` : "";
  return `<div class="row"${titleAttr}><div class="rl">${esc(label)}</div><div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div><div class="rr">${right}</div></div>`;
}

function collapsibleCard(id: string, title: string, content: string, icon: string, open = true): string {
  return `<div class="card" id="card-${id}">
    <div class="card-header" onclick="toggleCard('${id}')">
      <span class="card-icon">${icon}</span>
      <h2>${title}</h2>
      <span class="card-arrow" id="arr-${id}">${open ? "▾" : "▸"}</span>
    </div>
    <div class="card-body" id="body-${id}" style="${open ? "" : "display:none"}">
      ${content}
    </div>
  </div>`;
}

export function buildReportHtml(d: ReportData, history: HistoryEntry[] = []): string {
  const gc = GRADE_COLOR[d.grade] ?? "#888";
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const scoreDelta = prev ? d.score - prev.score : null;
  const deltaBadge = scoreDelta === null ? ""
    : scoreDelta > 0 ? `<span class="delta up">↑ +${scoreDelta}</span>`
    : scoreDelta < 0 ? `<span class="delta dn">↓ ${scoreDelta}</span>`
    : `<span class="delta neu">→ 0</span>`;
  const maxLang = d.languages[0]?.files ?? 1;
  const langs = d.languages.map((l) => bar(l.lang, l.files, maxLang, "#534ab7", `${l.files}`)).join("");
  const maxCx = d.complexity.hotspots[0]?.complexity ?? 1;
  const hotspots = d.complexity.hotspots.length
    ? d.complexity.hotspots.map((h) =>
        bar(`${h.name}  ·  ${h.file}`, h.complexity, maxCx, ratingColor(h.rating), `<b>${h.complexity}</b>`,
          `${h.name} in ${h.file} — complexity ${h.complexity}`)).join("")
    : `<div class="empty">No functions found.</div>`;
  const god = d.godNodes.length
    ? d.godNodes.map((g) => `<div class="li">
        <span class="kbadge">god</span>
        <span class="mono">${esc(g.symbol)}</span>
        <span class="dim">${esc(g.file)}</span>
        <span class="pill pill-warn">${g.importCount} importers</span>
      </div>`).join("")
    : `<div class="ok">✓ No dominant god nodes</div>`;
  const dead = d.dead.count
    ? d.dead.items.map((x) => `<div class="li">
        <span class="kbadge">${esc(x.kind)}</span>
        <span class="mono">${esc(x.symbol)}</span>
        <span class="dim">${esc(x.file)}</span>
      </div>`).join("")
      + (d.dead.count > d.dead.items.length ? `<div class="more">+${d.dead.count - d.dead.items.length} more…</div>` : "")
    : `<div class="ok">✓ No high-confidence dead exports</div>`;
  const cycles = d.cycles.count
    ? d.cycles.items.map((c) => `<div class="li cycle-li">
        <span class="cycle-arrow">↻</span>
        <span class="mono cycle-chain">${esc(c.join(" → "))}</span>
      </div>`).join("")
    : `<div class="ok">✓ No circular dependencies</div>`;
  const modules = d.modules.length
    ? d.modules.map((m) => bar(
        `${m.module}  ·  ${m.files} file(s)`, m.instability, 1, instColor(m.instability),
        `Ca ${m.afferent} · Ce ${m.efferent} · <b>I ${m.instability.toFixed(2)}</b>`)).join("")
    : `<div class="empty">No cross-module imports.</div>`;
  const covPct = Math.round(d.testCoverage.coverageRatio * 100);
  const covC = d.testCoverage.coverageRatio >= 0.7 ? "#1d9e75" : d.testCoverage.coverageRatio >= 0.4 ? "#ba7517" : "#e24b4a";

  const covRing = d.testCoverage.testFiles > 0 ? (() => {
    const r = 28, circ = 2 * Math.PI * r;
    const dash = (covPct / 100) * circ;
    return `<div class="cov-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="${r}" fill="none" stroke="currentColor" stroke-width="7" opacity=".12"/>
        <circle cx="36" cy="36" r="${r}" fill="none" stroke="${covC}" stroke-width="7"
          stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 36 36)"/>
        <text x="36" y="40" text-anchor="middle" font-size="14" font-weight="700" fill="${covC}" font-family="system-ui,sans-serif">${covPct}%</text>
      </svg>
    </div>`;
  })() : "";

  const covSummary = d.testCoverage.testFiles > 0
    ? `<div class="cov-summary">
        ${covRing}
        <div class="cov-text">
          <div class="cov-pct" style="color:${covC}">${covPct}% covered</div>
          <div class="cov-detail">${d.testCoverage.testedSources}/${d.testCoverage.sourceFiles} source files tested &middot; ${d.testCoverage.testFiles} test file(s)${d.testCoverage.rootFallback ? " (from project root)" : ""}</div>
        </div>
      </div>` : "";
  const covList = d.testCoverage.testFiles === 0
    ? `<div class="empty">No test files found in the scanned directory or project root.</div>`
    : d.testCoverage.untested.length === 0
      ? `<div class="ok">✓ Every source file has at least one test</div>`
      : `<div class="untested-header">Untested files (by risk)</div>`
        + d.testCoverage.untested.map((u) =>
          `<div class="li"><span class="mono">${esc(u.file)}</span><span class="dim">${u.symbols} symbol(s)</span><span class="pill">Ca ${u.afferent}</span></div>`).join("")
        + (d.testCoverage.untestedCount > d.testCoverage.untested.length
          ? `<div class="more">+${d.testCoverage.untestedCount - d.testCoverage.untested.length} more untested…</div>` : "");
  const sdp = d.layerViolations.count
    ? d.layerViolations.items.map((v) => `<div class="li">
        <span class="mono">${esc(v.from)}</span>
        <span class="dim">→ ${esc(v.to)}</span>
        <span class="pill pill-err">+${v.severity.toFixed(2)}</span>
      </div>`).join("")
      + (d.layerViolations.count > d.layerViolations.items.length
        ? `<div class="more">+${d.layerViolations.count - d.layerViolations.items.length} more…</div>` : "")
    : `<div class="ok">✓ No stability inversions (SDP)</div>`;

  const issues = [
    d.cycles.count > 0 ? `<div class="issue-row issue-err">🔴 ${d.cycles.count} circular ${d.cycles.count === 1 ? "dependency" : "dependencies"} detected</div>` : "",
    d.dead.count > 5 ? `<div class="issue-row issue-warn">🟠 ${d.dead.count} dead exports (potential dead code)</div>` : "",
    d.complexity.max > 20 ? `<div class="issue-row issue-warn">🟠 Max complexity ${d.complexity.max} — consider refactoring</div>` : "",
    d.testCoverage.testFiles === 0 ? `<div class="issue-row issue-warn">🟡 No test files found</div>` :
      covPct < 40 ? `<div class="issue-row issue-warn">🟡 Low test coverage (${covPct}%)</div>` : "",
    d.layerViolations.count > 5 ? `<div class="issue-row issue-info">🔵 ${d.layerViolations.count} layer violations (SDP)</div>` : "",
  ].filter(Boolean).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.project)} — Code Health</title>
<style>
:root{
  --bg:#f6f8fa;--card:#fff;--bd:#e2e8f0;--tx:#0f172a;--dim:#64748b;
  --soft:#f1f5f9;--accent:#6366f1;
  --shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
}
@media(prefers-color-scheme:dark){
  :root{--bg:#0d1117;--card:#161b22;--bd:#21262d;--tx:#e6edf3;--dim:#7d8590;--soft:#1c2128;}
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--tx);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;font-size:13px;}
.wrap{max-width:1000px;margin:0 auto;padding:28px 20px 60px;}

/* ── Topbar ── */
.topbar{background:var(--card);border-bottom:1px solid var(--bd);padding:0 20px;height:50px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:10;box-shadow:var(--shadow);}
.topbar-title{font-weight:700;font-size:13px;color:var(--accent);}
.topbar-sep{width:1px;height:18px;background:var(--bd);}
.topbar-meta{font-size:12px;color:var(--dim);flex:1;}
.topbar-grade{font-weight:700;font-size:13px;padding:3px 10px;border-radius:999px;}
.btn{font:12px system-ui,sans-serif;cursor:pointer;border:1px solid var(--bd);background:transparent;color:inherit;border-radius:7px;padding:4px 11px;transition:background .12s;}
.btn:hover{background:var(--soft);}

/* ── Hero ── */
.hero{display:flex;align-items:center;gap:20px;margin:24px 0 22px;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:20px 24px;box-shadow:var(--shadow);}
.hero-right{flex:1;min-width:0;}
.score-ring-wrap svg{display:block;}
.h1{font-size:22px;font-weight:700;margin-bottom:4px;}
.sub{color:var(--dim);font-size:12px;}
.issues{margin-top:12px;display:flex;flex-direction:column;gap:4px;}
.issue-row{font-size:12px;padding:5px 10px;border-radius:8px;}
.issue-err{background:#fee2e2;color:#991b1b;}
.issue-warn{background:#fef9c3;color:#854d0e;}
.issue-info{background:#dbeafe;color:#1e40af;}
@media(prefers-color-scheme:dark){
  .issue-err{background:#450a0a;color:#fca5a5;}
  .issue-warn{background:#422006;color:#fde68a;}
  .issue-info{background:#0c1e40;color:#93c5fd;}
}

/* ── Stat grid ── */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:20px;}
.stat{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:13px 15px;box-shadow:var(--shadow);transition:transform .12s,box-shadow .12s;}
.stat:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1);}
.sv{font-size:22px;font-weight:700;line-height:1.2;}
.sl{font-size:11px;color:var(--dim);margin-top:3px;}
.sl-sub{font-size:10px;color:var(--dim);margin-top:2px;opacity:.7;}

/* ── Cards ── */
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;margin-bottom:14px;box-shadow:var(--shadow);overflow:hidden;}
.card-header{display:flex;align-items:center;gap:8px;padding:14px 18px;cursor:pointer;user-select:none;transition:background .1s;}
.card-header:hover{background:var(--soft);}
.card-icon{font-size:15px;flex-shrink:0;}
.card-header h2{font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--dim);flex:1;margin:0;}
.card-arrow{color:var(--dim);font-size:12px;transition:transform .15s;}
.card-body{padding:6px 18px 16px;border-top:1px solid var(--bd);}

/* ── Bars ── */
.row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:12px;}
.rl{flex:0 0 42%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx);}
.track{flex:1;height:7px;background:var(--soft);border-radius:4px;overflow:hidden;}
.fill{height:100%;border-radius:4px;transition:width .5s ease;}
.rr{flex:0 0 auto;color:var(--dim);min-width:40px;text-align:right;font-size:11px;}

/* ── List items ── */
.li{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;border-top:1px solid var(--bd);}
.li:first-child{border-top:none;}
.mono{font-family:ui-monospace,monospace;font-weight:600;font-size:11px;}
.dim{color:var(--dim);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}
.pill{margin-left:auto;background:var(--soft);border-radius:20px;padding:2px 9px;font-size:10px;color:var(--dim);flex-shrink:0;white-space:nowrap;}
.pill-warn{background:#fef9c3;color:#854d0e;}
.pill-err{background:#fee2e2;color:#991b1b;}
@media(prefers-color-scheme:dark){.pill-warn{background:#422006;color:#fde68a;}.pill-err{background:#450a0a;color:#fca5a5;}}
.kbadge{font-size:10px;color:var(--dim);background:var(--soft);border-radius:5px;padding:1px 6px;flex-shrink:0;}
.ok{color:#16a34a;font-size:12px;padding:4px 0;}
.empty{color:var(--dim);font-size:12px;padding:4px 0;}
.more{color:var(--dim);font-size:11px;padding-top:4px;}
.tag{font-size:10px;background:var(--soft);border-radius:5px;padding:1px 6px;color:var(--dim);}

/* ── Two col ── */
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
@media(max-width:740px){.two{grid-template-columns:1fr;}.rl{flex-basis:38%;}}

/* ── Coverage ── */
.cov-summary{display:flex;align-items:center;gap:14px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--bd);}
.cov-ring-wrap svg{display:block;}
.cov-pct{font-size:18px;font-weight:700;}
.cov-detail{font-size:11px;color:var(--dim);margin-top:3px;}
.untested-header{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);margin-bottom:4px;}

/* ── Cycles ── */
.cycle-li{align-items:flex-start;}
.cycle-arrow{color:#e24b4a;font-size:16px;flex-shrink:0;line-height:1.4;}
.cycle-chain{font-size:11px;word-break:break-all;flex:1;}

.delta{font-size:13px;font-weight:600;padding:3px 10px;border-radius:999px;margin-left:8px;}
.delta.up{background:#dcfce7;color:#16a34a;}.delta.dn{background:#fee2e2;color:#dc2626;}.delta.neu{background:var(--soft);color:var(--dim);}
@media(prefers-color-scheme:dark){.delta.up{background:#14532d;color:#4ade80;}.delta.dn{background:#7f1d1d;color:#f87171;}}
.sparkline{display:flex;align-items:flex-end;gap:2px;height:28px;margin-top:8px;}
.spark-bar{width:8px;border-radius:2px 2px 0 0;min-height:2px;transition:opacity .2s;}
.spark-bar:hover{opacity:.75;}

/* ── Footer ── */
.foot{color:var(--dim);font-size:11px;text-align:center;margin-top:20px;padding-top:14px;border-top:1px solid var(--bd);}
.foot a{color:var(--dim);}
</style>
</head>
<body>
<div class="topbar">
  <span class="topbar-title">AST Map</span>
  <div class="topbar-sep"></div>
  <span class="topbar-meta">${esc(d.project)} · Code Health Report · ${esc(d.generatedAt.slice(0, 10))}</span>
  <span class="topbar-grade" style="background:${gc}22;color:${gc};border:1px solid ${gc}44">${d.grade} · ${d.score}/100</span>
  <button class="btn" onclick="window.print()">Print</button>
</div>
<div class="wrap">
<div class="hero">
  ${scoreRing(d.score, d.grade)}
  <div class="hero-right">
    <h1 class="h1">${esc(d.project)}</h1>
    <div class="sub">${d.fileCount} files · ${d.symbolCount} symbols · ${d.languages.length} language(s) · generated ${esc(d.generatedAt.slice(0, 10))}${deltaBadge}</div>
    ${issues ? `<div class="issues">${issues}</div>` : `<div class="issues"><div class="issue-row issue-info">✅ No critical issues detected</div></div>`}
    ${history.length > 1 ? (() => {
     const max = Math.max(...history.map(h => h.score), 1);
     const bars = history.map(h => {
       const pct = Math.round((h.score / max) * 100);
       const gc2 = GRADE_COLOR[h.grade] ?? "#888";
       return `<div class="spark-bar" style="height:${pct}%;background:${gc2}" title="${h.date.slice(0,10)}: ${h.score}/100 (${h.grade})"></div>`;
     }).join("");
     return `<div class="sparkline" title="Score history (last ${history.length} runs)">${bars}</div>`;
   })() : ""}
  </div>
</div>

<div class="grid">
  ${statCard("Files", d.fileCount)}
  ${statCard("Symbols", d.symbolCount)}
  ${statCard("Import edges", d.edgeCount)}
  ${statCard("Avg complexity", d.complexity.average)}
  ${statCard("Max complexity", d.complexity.max, ratingColor(d.complexity.max > 20 ? "very-high" : d.complexity.max > 10 ? "high" : "low"))}
  ${statCard("Dead exports", d.dead.count, d.dead.count > 5 ? "#d85a30" : d.dead.count > 0 ? "#ba7517" : "#1d9e75")}
  ${statCard("Cycles", d.cycles.count, d.cycles.count ? "#e24b4a" : "#1d9e75")}
  ${statCard("SDP violations", d.layerViolations.count, d.layerViolations.count > 5 ? "#d85a30" : d.layerViolations.count > 0 ? "#ba7517" : "#1d9e75")}
  ${statCard("Test coverage", covPct + "%", covC)}
</div>

${collapsibleCard("langs", "Language breakdown", langs || `<div class="empty">No data.</div>`, "🌐")}
${collapsibleCard("cx", "Complexity hotspots", hotspots, "🔥")}

<div class="two">
  ${collapsibleCard("god", "God nodes (most imported)", god, "👑")}
  ${collapsibleCard("cycles", "Circular dependencies", cycles, "🔄")}
</div>

<div class="two">
  ${collapsibleCard("modules", "Module coupling (instability)", modules, "📦")}
  ${collapsibleCard("sdp", "Layer violations (SDP)", sdp, "🏗️")}
</div>

${collapsibleCard("cov", "Test coverage", covSummary + covList, "🧪")}
${collapsibleCard("dead", "Dead exports (high confidence)", dead, "💀", false)}

<div class="foot">Generated by <strong>AST-MCP</strong> · universal-ast-mapper · <a href="https://github.com/6ixthxense/ast-mcp">github</a></div>
</div>
<script>
function toggleCard(id){
  const body=document.getElementById('body-'+id);
  const arr=document.getElementById('arr-'+id);
  if(!body||!arr)return;
  const open=body.style.display!=='none';
  body.style.display=open?'none':'';
  arr.textContent=open?'▸':'▾';
}
</script>
</body>
</html>`;
}
