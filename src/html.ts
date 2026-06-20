import type { SkeletonFile, SymbolNode, SymbolKind } from "./types.js";

const KIND_COLORS: Record<SymbolKind, string> = {
  class: "#7c3aed",
  interface: "#0ea5e9",
  struct: "#0d9488",
  function: "#2563eb",
  method: "#4f46e5",
  type: "#db2777",
  enum: "#ea580c",
  const: "#65a30d",
  var: "#ca8a04",
  field: "#64748b",
  namespace: "#9333ea",
};

const LANG_COLOR: Record<string, string> = {
  typescript: "#3178c6", javascript: "#f7df1e", python: "#3572a5",
  go: "#00acd7", rust: "#dea584", java: "#b07219", "c++": "#f34b7d",
  c: "#555555", csharp: "#239120", kotlin: "#a97bff", swift: "#f05138",
  tsx: "#3178c6", jsx: "#f7df1e",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function badge(kind: SymbolKind): string {
  const color = KIND_COLORS[kind] ?? "#64748b";
  return `<span class="badge" style="background:${color}1a;color:${color};border:1px solid ${color}44;" data-kind="${kind}">${kind}</span>`;
}

function langDot(lang: string): string {
  const color = LANG_COLOR[lang] ?? "#94a3b8";
  return `<span class="lang-dot" style="background:${color}" title="${esc(lang)}"></span>`;
}

function renderSymbol(sym: SymbolNode, depth = 0): string {
  const vis = sym.visibility === "private"
    ? `<span class="vis priv" title="private">pvt</span>` : "";
  const exported = sym.exported
    ? `<span class="vis exp" title="exported">exp</span>` : "";
  const sig = sym.signature
    ? `<code class="sig" title="${esc(sym.signature)}">${esc(sym.signature)}</code>` : "";
  const lines = `<span class="lines">L${sym.range.startLine}–${sym.range.endLine}</span>`;
  const doc = sym.doc ? `<div class="doc">${esc(sym.doc)}</div>` : "";
  const copyBtn = `<button class="copy-btn" title="Copy name" onclick="event.stopPropagation();copyText('${esc(sym.name)}',this)">⎘</button>`;

  const head = `${badge(sym.kind)}<span class="name">${esc(sym.name)}</span>${exported}${vis}${sig}${lines}${copyBtn}`;

  if (sym.children.length > 0) {
    const kids = sym.children.map((c) => renderSymbol(c, depth + 1)).join("");
    return `<details open class="node" data-kind="${sym.kind}"><summary>${head}</summary>${doc}<div class="children">${kids}</div></details>`;
  }
  return `<div class="node leaf" data-kind="${sym.kind}">${head}${doc}</div>`;
}

function collectAllKinds(symbols: SymbolNode[]): Map<SymbolKind, number> {
  const counts = new Map<SymbolKind, number>();
  const walk = (syms: SymbolNode[]) => {
    for (const s of syms) {
      counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
      if (s.children.length) walk(s.children);
    }
  };
  walk(symbols);
  return counts;
}

function collectSymbolNames(symbols: SymbolNode[]): string[] {
  const names: string[] = [];
  for (const sym of symbols) {
    names.push(sym.name);
    if (sym.children.length > 0) names.push(...collectSymbolNames(sym.children));
  }
  return names;
}

function renderFileSection(skel: SkeletonFile, index: number): string {
  const body = skel.symbols.length > 0
    ? skel.symbols.map((s) => renderSymbol(s)).join("")
    : `<p class="empty">No top-level symbols found.</p>`;
  const lc = LANG_COLOR[skel.language] ?? "#94a3b8";
  return `<section id="file-${index}" class="file-section">
<div class="file-header" onclick="toggleSection(${index})">
  <span class="toggle-icon" id="tog-${index}">▾</span>
  <span class="fs-path">${esc(skel.file)}</span>
  <span class="fs-lang" style="background:${lc}22;color:${lc};border:1px solid ${lc}44">${esc(skel.language)}</span>
  <span class="fs-count">${skel.symbolCount} symbols</span>
</div>
<div class="fs-body" id="fsbody-${index}"><div class="tree">${body}</div></div>
</section>`;
}

export function renderCombinedHtml(skeletons: SkeletonFile[]): string {
  const sections = skeletons.map((s, i) => renderFileSection(s, i)).join("\n");
  const totalSymbols = skeletons.reduce((n, s) => n + s.symbolCount, 0);
  const generatedAt = new Date().toISOString();

  // Count all kinds globally
  const allKindCounts = new Map<SymbolKind, number>();
  for (const skel of skeletons) {
    const kc = collectAllKinds(skel.symbols);
    for (const [k, v] of kc) allKindCounts.set(k, (allKindCounts.get(k) ?? 0) + v);
  }
  const sortedKinds = [...allKindCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Language distribution
  const langCounts = new Map<string, number>();
  for (const skel of skeletons) langCounts.set(skel.language, (langCounts.get(skel.language) ?? 0) + 1);
  const sortedLangs = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);

  const kindPills = sortedKinds.map(([k]) => {
    const color = KIND_COLORS[k] ?? "#64748b";
    return `<button class="kind-pill" data-kind="${k}" onclick="toggleKind('${k}',this)" style="--kc:${color}">${k}</button>`;
  }).join("");

  const fileData = JSON.stringify(
    skeletons.map((s, i) => ({
      id: i,
      file: s.file,
      lang: s.language,
      n: s.symbolCount,
      syms: collectSymbolNames(s.symbols).join(" "),
    })),
  );

  const kindData = JSON.stringify(Object.fromEntries(allKindCounts));
  const langData = JSON.stringify(sortedLangs);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AST Map — ${skeletons.length} files · ${totalSymbols} symbols</title>
<style>
:root{
  color-scheme:light dark;
  --bg:#f6f8fa;--bg2:#fff;--fg:#0f172a;--fg2:#64748b;--bdr:#e2e8f0;
  --hover:#f1f5f9;--sb-bg:#fff;--sb-w:272px;--accent:#6366f1;
  --accent2:#8b5cf6;--topbar-h:52px;--filter-h:40px;
  --shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:#0d1117;--bg2:#161b22;--fg:#e6edf3;--fg2:#7d8590;--bdr:#21262d;
    --hover:#1c2128;--sb-bg:#13181f;
    --shadow:0 1px 3px rgba(0,0,0,.3),0 1px 2px rgba(0,0,0,.2);
  }
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;height:100vh;overflow:hidden;}

/* ── Topbar ──────────────────────────────────────────────── */
.topbar{
  display:flex;align-items:center;gap:10px;padding:0 16px;
  height:var(--topbar-h);background:var(--bg2);
  border-bottom:1px solid var(--bdr);flex-shrink:0;z-index:10;
  box-shadow:var(--shadow);
}
.topbar-logo{display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;color:var(--accent);flex-shrink:0;}
.topbar-logo svg{opacity:.85;}
.topbar-sep{width:1px;height:20px;background:var(--bdr);flex-shrink:0;}
.topbar-meta{font-size:12px;color:var(--fg2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.topbar-actions{display:flex;gap:6px;flex-shrink:0;}
.btn{font:inherit;cursor:pointer;border:1px solid var(--bdr);background:transparent;color:inherit;border-radius:7px;padding:4px 11px;font-size:12px;transition:background .12s,border-color .12s;}
.btn:hover{background:var(--hover);border-color:color-mix(in srgb,var(--accent) 30%,var(--bdr));}
.btn-accent{background:var(--accent);color:#fff;border-color:var(--accent);}
.btn-accent:hover{background:var(--accent2);border-color:var(--accent2);}

/* ── Filter bar ──────────────────────────────────────────── */
.filter-bar{
  display:flex;align-items:center;gap:6px;padding:0 12px;
  height:var(--filter-h);background:var(--bg2);
  border-bottom:1px solid var(--bdr);flex-shrink:0;overflow-x:auto;
  scrollbar-width:none;
}
.filter-bar::-webkit-scrollbar{display:none;}
.filter-label{font-size:11px;color:var(--fg2);flex-shrink:0;font-weight:500;text-transform:uppercase;letter-spacing:.04em;}
.kind-pill{
  font:11px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;
  border:1px solid var(--kc,var(--bdr));
  background:color-mix(in srgb,var(--kc,var(--bdr)) 8%,transparent);
  color:var(--kc,var(--fg2));border-radius:999px;
  padding:3px 10px;white-space:nowrap;transition:all .12s;flex-shrink:0;
}
.kind-pill:hover{background:color-mix(in srgb,var(--kc,var(--bdr)) 18%,transparent);}
.kind-pill.active{background:var(--kc,var(--fg2));color:#fff;border-color:var(--kc,var(--fg2));}
.filter-div{width:1px;height:16px;background:var(--bdr);flex-shrink:0;margin:0 2px;}

/* ── Layout ──────────────────────────────────────────────── */
.layout{display:flex;flex:1;min-height:0;}

/* ── Sidebar ─────────────────────────────────────────────── */
.sidebar{
  width:var(--sb-w);flex-shrink:0;background:var(--sb-bg);
  border-right:1px solid var(--bdr);
  display:flex;flex-direction:column;overflow:hidden;
}
.search-wrap{padding:8px 10px;border-bottom:1px solid var(--bdr);position:relative;}
.search-icon{position:absolute;left:18px;top:50%;transform:translateY(-50%);opacity:.4;pointer-events:none;font-size:12px;}
#search{
  width:100%;font:inherit;font-size:12px;padding:5px 8px 5px 26px;
  border:1px solid var(--bdr);border-radius:8px;
  background:var(--bg);color:var(--fg);outline:none;
  transition:border-color .15s;
}
#search:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 20%,transparent);}
.search-hint{font-size:10px;color:var(--fg2);text-align:right;padding:2px 2px 0;opacity:.7;}

/* Sidebar stats */
.sb-section{border-bottom:1px solid var(--bdr);padding:8px 10px;}
.sb-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--fg2);margin-bottom:6px;}
.sb-stat-row{display:flex;align-items:center;gap:6px;margin:3px 0;}
.sb-stat-bar{flex:1;height:4px;background:var(--bdr);border-radius:2px;overflow:hidden;}
.sb-stat-fill{height:100%;border-radius:2px;}
.sb-stat-label{font-size:11px;color:var(--fg2);min-width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-stat-num{font-size:11px;color:var(--fg2);min-width:24px;text-align:right;flex-shrink:0;}
.lang-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;}

/* Nav tree */
.nav-tree{flex:1;overflow-y:auto;padding:6px 4px;scrollbar-width:thin;scrollbar-color:var(--bdr) transparent;}
.dir-node{margin:1px 0;}
.dir-node>summary{
  list-style:none;cursor:pointer;padding:3px 7px;border-radius:6px;
  font-size:12px;font-weight:600;color:var(--fg2);
  display:flex;align-items:center;gap:5px;user-select:none;
}
.dir-node>summary::-webkit-details-marker{display:none;}
.dir-node>summary::before{content:"\\25B8";font-size:9px;opacity:.5;transition:transform .12s;flex-shrink:0;}
.dir-node[open]>summary::before{transform:rotate(90deg);}
.dir-node>summary:hover{background:var(--hover);}
.dir-children{padding-left:12px;}
a.file-link{
  display:flex;align-items:center;padding:3px 7px;border-radius:6px;
  text-decoration:none;color:var(--fg);font-size:12px;cursor:pointer;gap:5px;
  transition:background .1s;
}
a.file-link:hover{background:var(--hover);}
a.file-link.active{background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);}
.fname{font-family:ui-monospace,monospace;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.fmeta{font-size:10px;color:var(--fg2);flex-shrink:0;}

/* ── Main panel ──────────────────────────────────────────── */
.main-panel{flex:1;overflow-y:auto;padding:14px 16px;scrollbar-width:thin;scrollbar-color:var(--bdr) transparent;}

/* File sections */
.file-section{border:1px solid var(--bdr);border-radius:12px;margin-bottom:12px;background:var(--bg2);overflow:hidden;box-shadow:var(--shadow);}
.file-header{
  display:flex;align-items:center;gap:8px;padding:10px 14px;
  cursor:pointer;user-select:none;
  border-bottom:1px solid transparent;transition:background .1s;
}
.file-header:hover{background:var(--hover);}
.file-section.open .file-header{border-bottom-color:var(--bdr);}
.toggle-icon{font-size:11px;opacity:.5;transition:transform .15s;flex-shrink:0;color:var(--fg2);}
.file-section:not(.open) .toggle-icon{transform:rotate(-90deg);}
.fs-path{font-family:ui-monospace,monospace;font-weight:700;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fs-lang{font-size:10px;font-weight:600;padding:2px 7px;border-radius:999px;flex-shrink:0;}
.fs-count{font-size:11px;color:var(--fg2);flex-shrink:0;}
.fs-body{padding:8px 12px 12px;}
.file-section:not(.open) .fs-body{display:none;}

/* Symbol tree */
.tree{display:flex;flex-direction:column;gap:3px;}
details.node{border:1px solid var(--bdr);border-radius:9px;padding:1px 3px;transition:border-color .12s;}
details.node[open]{border-color:color-mix(in srgb,var(--accent) 25%,var(--bdr));}
summary{list-style:none;cursor:pointer;padding:5px 7px;border-radius:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
summary::-webkit-details-marker{display:none;}
summary::before{content:"\\25B8";opacity:.4;transition:transform .15s;font-size:10px;flex-shrink:0;}
details[open]>summary::before{transform:rotate(90deg);}
.leaf{padding:5px 7px 5px 22px;border-radius:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
summary:hover,.leaf:hover{background:var(--hover);}
.children{margin:2px 0 5px 16px;padding-left:10px;border-left:2px solid color-mix(in srgb,var(--accent) 15%,var(--bdr));display:flex;flex-direction:column;gap:3px;}
.badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;letter-spacing:.04em;flex-shrink:0;}
.name{font-family:ui-monospace,monospace;font-weight:600;font-size:12px;}
.vis{font-size:10px;padding:1px 5px;border-radius:5px;flex-shrink:0;}
.vis.priv{background:#ef44441a;color:#ef4444;}
.vis.exp{background:#22c55e1a;color:#16a34a;}
.sig{font-family:ui-monospace,monospace;font-size:11px;background:var(--hover);padding:1px 6px;border-radius:5px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
.lines{font-size:10px;opacity:.5;margin-left:auto;font-family:ui-monospace,monospace;flex-shrink:0;}
.doc{font-size:11px;opacity:.75;margin:2px 0 5px 26px;white-space:pre-wrap;font-style:italic;color:var(--fg2);}
.copy-btn{
  opacity:0;font-size:11px;padding:1px 5px;border-radius:4px;border:1px solid var(--bdr);
  background:transparent;color:var(--fg2);cursor:pointer;transition:opacity .12s,background .12s;
  flex-shrink:0;margin-left:2px;
}
.copy-btn:hover{background:var(--hover);color:var(--fg);}
summary:hover .copy-btn,.leaf:hover .copy-btn{opacity:1;}
.copy-btn.copied{opacity:1;color:#16a34a;border-color:#16a34a;}

.empty{opacity:.6;font-size:12px;padding:4px 0;}
.no-match{padding:60px 20px;text-align:center;color:var(--fg2);font-size:13px;}
.no-match-icon{font-size:32px;margin-bottom:8px;opacity:.4;}
.hidden-kind{display:none !important;}

/* ── Keyboard hint tooltip ───────────────────────────────── */
.kbd{font-size:10px;background:var(--bdr);color:var(--fg2);border-radius:4px;padding:1px 5px;font-family:ui-monospace,monospace;border:1px solid color-mix(in srgb,var(--fg) 20%,var(--bdr));}

/* ── Toast ───────────────────────────────────────────────── */
#toast{
  position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
  background:#0f172a;color:#fff;font-size:12px;padding:6px 14px;
  border-radius:8px;opacity:0;pointer-events:none;z-index:99;
  transition:opacity .2s;box-shadow:0 4px 12px rgba(0,0,0,.3);
}
#toast.show{opacity:1;}
</style>
</head>
<body>

<header class="topbar">
  <div class="topbar-logo">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
    AST Map
  </div>
  <div class="topbar-sep"></div>
  <span class="topbar-meta">${skeletons.length} files &middot; ${totalSymbols} symbols &middot; <time title="${esc(generatedAt)}">${esc(generatedAt.slice(0, 10))}</time></span>
  <div class="topbar-actions">
    <button class="btn" id="btn-expand" title="Expand all sections">Expand all</button>
    <button class="btn" id="btn-collapse" title="Collapse all sections">Collapse all</button>
    <button class="btn btn-accent" id="btn-export" title="Export skeleton as JSON">Export JSON</button>
  </div>
</header>

<div class="filter-bar" id="filter-bar">
  <span class="filter-label">Filter:</span>
  ${kindPills}
  <div class="filter-div"></div>
  <button class="kind-pill" id="clear-filter" style="--kc:#64748b" onclick="clearKindFilter()">× clear</button>
</div>

<div class="layout">
  <nav class="sidebar">
    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input id="search" type="search" placeholder="Search files or symbols…" autocomplete="off" spellcheck="false" aria-label="Search">
      <div class="search-hint">Press <kbd class="kbd">/</kbd> to focus</div>
    </div>

    <div class="sb-section" id="lang-stats"></div>
    <div class="sb-section" id="kind-stats"></div>

    <div id="nav-tree" class="nav-tree"></div>
  </nav>

  <main id="main" class="main-panel">
${sections}
    <div id="no-match" class="no-match" style="display:none">
      <div class="no-match-icon">⊘</div>
      No matching files or symbols found.
    </div>
  </main>
</div>

<div id="toast"></div>

<script>
(function(){
'use strict';
const FILES=${fileData};
const KIND_COUNTS=${kindData};
const LANG_DATA=${langData};
const KIND_COLORS={class:"#7c3aed",interface:"#0ea5e9",struct:"#0d9488",function:"#2563eb",method:"#4f46e5",type:"#db2777",enum:"#ea580c","const":"#65a30d","var":"#ca8a04",field:"#64748b",namespace:"#9333ea"};
const LANG_COLORS={typescript:"#3178c6",javascript:"#f7df1e",python:"#3572a5",go:"#00acd7",rust:"#dea584",java:"#b07219","c++":"#f34b7d",c:"#555555",csharp:"#239120",kotlin:"#a97bff",swift:"#f05138",tsx:"#3178c6",jsx:"#f7df1e"};

// ── Open state ─────────────────────────────────────────────
const openState=new Set();
FILES.forEach(f=>openState.add(f.id));

function toggleSection(id){
  const sec=document.getElementById('file-'+id);
  if(!sec)return;
  if(openState.has(id)){openState.delete(id);sec.classList.remove('open');}
  else{openState.add(id);sec.classList.add('open');}
  document.getElementById('tog-'+id).textContent=openState.has(id)?'▾':'▸';
}

// Initialise open state
FILES.forEach(f=>{
  const sec=document.getElementById('file-'+f.id);
  if(sec){sec.classList.add('open');}
});

// ── Sidebar stats ──────────────────────────────────────────
function e(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function buildLangStats(){
  const el=document.getElementById('lang-stats');
  if(!LANG_DATA.length){el.style.display='none';return;}
  const max=LANG_DATA[0][1];
  let html='<div class="sb-title">Languages</div>';
  for(const[lang,cnt]of LANG_DATA){
    const c=LANG_COLORS[lang]||'#94a3b8';
    const pct=Math.round(cnt/max*100);
    html+=\`<div class="sb-stat-row">
      <span class="lang-dot" style="background:\${c}"></span>
      <span class="sb-stat-label">\${e(lang)}</span>
      <div class="sb-stat-bar"><div class="sb-stat-fill" style="width:\${pct}%;background:\${c}"></div></div>
      <span class="sb-stat-num">\${cnt}</span>
    </div>\`;
  }
  el.innerHTML=html;
}

function buildKindStats(){
  const el=document.getElementById('kind-stats');
  const entries=Object.entries(KIND_COUNTS).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){el.style.display='none';return;}
  const max=entries[0][1];
  let html='<div class="sb-title">Symbol kinds</div>';
  for(const[kind,cnt]of entries.slice(0,8)){
    const c=KIND_COLORS[kind]||'#64748b';
    const pct=Math.round(cnt/max*100);
    html+=\`<div class="sb-stat-row">
      <span style="width:8px;height:8px;border-radius:2px;background:\${c};flex-shrink:0;display:inline-block"></span>
      <span class="sb-stat-label">\${e(kind)}</span>
      <div class="sb-stat-bar"><div class="sb-stat-fill" style="width:\${pct}%;background:\${c}44"></div></div>
      <span class="sb-stat-num">\${cnt}</span>
    </div>\`;
  }
  el.innerHTML=html;
}

buildLangStats();
buildKindStats();

// ── Nav tree ───────────────────────────────────────────────
function buildTreeData(files){
  const root={dirs:{},files:[]};
  for(const f of files){
    const parts=f.file.split('/');
    let node=root;
    for(let i=0;i<parts.length-1;i++){
      if(!node.dirs[parts[i]])node.dirs[parts[i]]={dirs:{},files:[]};
      node=node.dirs[parts[i]];
    }
    node.files.push(f);
  }
  return root;
}

const linkMap=new Map();
function renderTreeNode(node,container){
  const dirs=Object.entries(node.dirs).sort(([a],[b])=>a.localeCompare(b));
  for(const[name,child]of dirs){
    const det=document.createElement('details');
    det.className='dir-node';det.open=true;
    const sum=document.createElement('summary');
    sum.textContent=name;
    det.appendChild(sum);
    const inner=document.createElement('div');
    inner.className='dir-children';
    renderTreeNode(child,inner);
    det.appendChild(inner);
    container.appendChild(det);
  }
  for(const f of node.files){
    const a=document.createElement('a');
    a.href='#file-'+f.id;
    a.className='file-link';
    a.dataset.id=String(f.id);
    const fname=f.file.split('/').pop()||f.file;
    const lc=LANG_COLORS[f.lang]||'#94a3b8';
    a.innerHTML=\`<span class="lang-dot" style="background:\${lc}"></span><span class="fname">\${e(fname)}</span><span class="fmeta">\${f.n}</span>\`;
    a.addEventListener('click',ev=>{
      ev.preventDefault();
      const sec=document.getElementById('file-'+f.id);
      if(sec){
        if(!openState.has(f.id)){toggleSection(f.id);}
        sec.scrollIntoView({behavior:'smooth',block:'start'});
      }
    });
    container.appendChild(a);
    linkMap.set(f.id,a);
  }
}

const navTree=document.getElementById('nav-tree');
renderTreeNode(buildTreeData(FILES),navTree);

// ── Search ─────────────────────────────────────────────────
const searchEl=document.getElementById('search');
const mainEl=document.getElementById('main');
const noMatch=document.getElementById('no-match');

searchEl.addEventListener('input',applyFilter);
function applyFilter(){
  const q=searchEl.value.trim().toLowerCase();
  let vis=0;
  FILES.forEach(f=>{
    const sec=document.getElementById('file-'+f.id);
    if(!sec)return;
    const match=!q||f.file.toLowerCase().includes(q)||f.syms.toLowerCase().includes(q);
    sec.style.display=match?'':'none';
    const link=linkMap.get(f.id);
    if(link)link.style.display=match?'':'none';
    if(match)vis++;
  });
  noMatch.style.display=vis===0&&q?'':'none';
}

// ── Kind filter ────────────────────────────────────────────
let activeKinds=new Set();
function toggleKind(kind,btn){
  if(activeKinds.has(kind)){activeKinds.delete(kind);btn.classList.remove('active');}
  else{activeKinds.add(kind);btn.classList.add('active');}
  applyKindFilter();
}
function clearKindFilter(){
  activeKinds.clear();
  document.querySelectorAll('.kind-pill').forEach(p=>p.classList.remove('active'));
  applyKindFilter();
}
function applyKindFilter(){
  if(!activeKinds.size){
    document.querySelectorAll('.node[data-kind]').forEach(n=>n.classList.remove('hidden-kind'));
    return;
  }
  document.querySelectorAll('.node[data-kind]').forEach(n=>{
    const k=n.getAttribute('data-kind');
    n.classList.toggle('hidden-kind',!activeKinds.has(k));
  });
}
window.toggleKind=toggleKind;
window.clearKindFilter=clearKindFilter;

// ── Expand / Collapse ──────────────────────────────────────
document.getElementById('btn-expand').addEventListener('click',()=>{
  FILES.forEach(f=>{
    const sec=document.getElementById('file-'+f.id);
    if(sec&&!openState.has(f.id)){toggleSection(f.id);}
  });
  document.querySelectorAll('details.node').forEach(d=>d.open=true);
});
document.getElementById('btn-collapse').addEventListener('click',()=>{
  FILES.forEach(f=>{
    const sec=document.getElementById('file-'+f.id);
    if(sec&&openState.has(f.id)){toggleSection(f.id);}
  });
  document.querySelectorAll('details.node').forEach(d=>d.open=false);
});

// ── Export JSON ────────────────────────────────────────────
document.getElementById('btn-export').addEventListener('click',()=>{
  const data=JSON.stringify(FILES,null,2);
  const blob=new Blob([data],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='ast-map.json';a.click();
  URL.revokeObjectURL(url);
  showToast('Exported ast-map.json');
});

// ── Active sidebar link on scroll ─────────────────────────
const io=new IntersectionObserver(entries=>{
  for(const en of entries){
    if(en.isIntersecting){
      const idx=parseInt(en.target.id.replace('file-',''),10);
      linkMap.forEach((a,id)=>a.classList.toggle('active',id===idx));
    }
  }
},{root:mainEl,threshold:0.1});
document.querySelectorAll('.file-section').forEach(s=>io.observe(s));

// ── Keyboard shortcuts ─────────────────────────────────────
document.addEventListener('keydown',ev=>{
  if(ev.key==='/'&&document.activeElement!==searchEl){
    ev.preventDefault();
    searchEl.focus();searchEl.select();
  }
  if(ev.key==='Escape'&&document.activeElement===searchEl){
    searchEl.value='';applyFilter();searchEl.blur();
  }
});

// ── Copy helper ────────────────────────────────────────────
function copyText(text,btn){
  navigator.clipboard.writeText(text).then(()=>{
    btn.classList.add('copied');
    btn.textContent='✓';
    showToast('Copied: '+text);
    setTimeout(()=>{btn.classList.remove('copied');btn.textContent='⎘';},1500);
  }).catch(()=>{showToast('Copy failed');});
}
window.copyText=copyText;

// ── Toast ──────────────────────────────────────────────────
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}
window.showToast=showToast;

// ── window.toggleSection ───────────────────────────────────
window.toggleSection=toggleSection;

})();
</script>
</body>
</html>`;
}

export function renderHtml(skel: SkeletonFile): string {
  const body = skel.symbols.length > 0
    ? skel.symbols.map((s) => renderSymbol(s)).join("")
    : `<p class="empty">No top-level symbols found.</p>`;
  const lc = LANG_COLOR[skel.language] ?? "#94a3b8";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AST Map — ${esc(skel.file)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f8fa;--bg2:#fff;--fg:#0f172a;--fg2:#64748b;--bdr:#e2e8f0;--hover:#f1f5f9;--accent:#6366f1;}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--bg2:#161b22;--fg:#e6edf3;--fg2:#7d8590;--bdr:#21262d;--hover:#1c2128;}}
*{box-sizing:border-box;margin:0;padding:0;}
body{font:13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);padding:20px;}
header.meta{background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:14px 18px;margin-bottom:14px;}
header.meta h1{font-size:14px;font-family:ui-monospace,monospace;font-weight:700;margin-bottom:4px;}
header.meta .sub{font-size:11px;color:var(--fg2);}
.lang-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;margin-right:8px;}
.toolbar{margin:10px 0;display:flex;gap:6px;flex-wrap:wrap;}
.btn{font:12px ui-sans-serif,sans-serif;cursor:pointer;border:1px solid var(--bdr);background:transparent;color:inherit;border-radius:7px;padding:4px 11px;}
.btn:hover{background:var(--hover);}
.tree{display:flex;flex-direction:column;gap:3px;}
details.node{border:1px solid var(--bdr);border-radius:9px;padding:1px 3px;}
details.node[open]{border-color:color-mix(in srgb,var(--accent) 25%,var(--bdr));}
summary{list-style:none;cursor:pointer;padding:5px 7px;border-radius:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
summary::-webkit-details-marker{display:none;}
summary::before{content:"\\25B8";opacity:.4;transition:transform .15s;font-size:10px;}
details[open]>summary::before{transform:rotate(90deg);}
.leaf{padding:5px 7px 5px 22px;border-radius:7px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
summary:hover,.leaf:hover{background:var(--hover);}
.children{margin:2px 0 5px 16px;padding-left:10px;border-left:2px solid color-mix(in srgb,var(--accent) 15%,var(--bdr));display:flex;flex-direction:column;gap:3px;}
.badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;letter-spacing:.04em;}
.name{font-family:ui-monospace,monospace;font-weight:600;font-size:12px;}
.vis{font-size:10px;padding:1px 5px;border-radius:5px;}
.vis.priv{background:#ef44441a;color:#ef4444;}.vis.exp{background:#22c55e1a;color:#16a34a;}
.sig{font-family:ui-monospace,monospace;font-size:11px;background:var(--hover);padding:1px 6px;border-radius:5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lines{font-size:10px;opacity:.5;margin-left:auto;font-family:ui-monospace,monospace;}
.doc{font-size:11px;opacity:.75;margin:2px 0 5px 26px;white-space:pre-wrap;font-style:italic;color:var(--fg2);}
.copy-btn{opacity:0;font-size:11px;padding:1px 5px;border-radius:4px;border:1px solid var(--bdr);background:transparent;color:var(--fg2);cursor:pointer;transition:opacity .12s;}
summary:hover .copy-btn,.leaf:hover .copy-btn{opacity:1;}
.copy-btn.copied{opacity:1;color:#16a34a;border-color:#16a34a;}
.empty{opacity:.6;}
</style>
</head>
<body>
<header class="meta">
  <h1>${esc(skel.file)}</h1>
  <div class="sub">
    <span class="lang-badge" style="background:${lc}22;color:${lc};border:1px solid ${lc}44">${esc(skel.language)}</span>
    ${skel.symbolCount} symbols &middot; ${esc(skel.parser.grammar)} &middot; <time>${esc(skel.generatedAt.slice(0, 10))}</time>
  </div>
</header>
<div class="toolbar">
  <button class="btn" onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">Expand all</button>
  <button class="btn" onclick="document.querySelectorAll('details').forEach(d=>d.open=false)">Collapse all</button>
</div>
<div class="tree">
${body}
</div>
<script>
function copyText(text,btn){navigator.clipboard.writeText(text).then(()=>{btn.classList.add('copied');btn.textContent='✓';setTimeout(()=>{btn.classList.remove('copied');btn.textContent='⎘';},1500);});}
</script>
</body>
</html>`;
}
