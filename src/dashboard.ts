import type { SymbolGraph, GraphSymbolNode } from "./graph.js";
import type { SkeletonFile, SymbolKind } from "./types.js";

function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

interface FlatSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

function flattenSymbols(skeletons: SkeletonFile[]): FlatSymbol[] {
  const out: FlatSymbol[] = [];
  const walk = (syms: import("./types.js").SymbolNode[], file: string) => {
    for (const s of syms) {
      out.push({ name: s.name, kind: s.kind, file, startLine: s.range.startLine, endLine: s.range.endLine, exported: s.exported ?? false });
      if (s.children.length) walk(s.children, file);
    }
  };
  for (const sk of skeletons) walk(sk.symbols, sk.file);
  return out;
}

const KIND_COLORS: Record<string, string> = {
  class: "#7c3aed", interface: "#0ea5e9", struct: "#0d9488",
  function: "#2563eb", method: "#4f46e5", type: "#db2777",
  enum: "#ea580c", const: "#65a30d", var: "#ca8a04",
  field: "#64748b", namespace: "#9333ea",
};

export function buildDashboardHtml(
  reportHtml: string,
  skeletonHtml: string,
  explorerHtml: string,
  skeletons: SkeletonFile[],
  title: string,
  liveReloadPort?: number,
): string {
  const symbols = flattenSymbols(skeletons);
  const totalSymbols = skeletons.reduce((n, s) => n + s.symbolCount, 0);

  const tabsData = safeJson({ overview: reportHtml, files: skeletonHtml, graph: explorerHtml });
  const symData = safeJson(symbols);
  const kindColorsData = safeJson(KIND_COLORS);

  const liveReloadScript = liveReloadPort
    ? `<script>
(function(){
  var es=new EventSource('http://localhost:${liveReloadPort ?? 0}/events');
  es.addEventListener('reload',function(){location.reload();});
  es.onerror=function(){setTimeout(function(){location.reload();},2000);};
})();
</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AST Map Dashboard — ${title}</title>
<style>
:root{color-scheme:light dark;--bg:#0d1117;--bg2:#161b22;--fg:#e6edf3;--fg2:#7d8590;--bdr:#21262d;--accent:#6366f1;--accent2:#8b5cf6;--tab-h:44px;}
@media(prefers-color-scheme:light){:root{--bg:#f6f8fa;--bg2:#fff;--fg:#0f172a;--fg2:#64748b;--bdr:#e2e8f0;}}
*{box-sizing:border-box;margin:0;padding:0;}
body{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;height:100vh;overflow:hidden;}
/* Topbar */
.topbar{display:flex;align-items:center;gap:10px;padding:0 16px;height:48px;background:var(--bg2);border-bottom:1px solid var(--bdr);flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.15);}
.topbar-logo{display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;color:var(--accent);text-decoration:none;}
.topbar-sep{width:1px;height:18px;background:var(--bdr);}
.topbar-title{font-size:13px;font-weight:600;}
.topbar-meta{font-size:11px;color:var(--fg2);flex:1;}
.live-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;display:${liveReloadPort ? "inline-block" : "none"};animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
/* Tabs */
.tabs{display:flex;align-items:stretch;background:var(--bg2);border-bottom:1px solid var(--bdr);flex-shrink:0;height:var(--tab-h);padding:0 12px;gap:2px;}
.tab-btn{font:13px/1 ui-sans-serif,sans-serif;cursor:pointer;border:none;background:transparent;color:var(--fg2);padding:0 14px;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;display:flex;align-items:center;gap:6px;font-weight:500;}
.tab-btn:hover{color:var(--fg);}
.tab-btn.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600;}
.tab-icon{font-size:14px;}
/* Content */
.tab-content{flex:1;display:none;min-height:0;}
.tab-content.active{display:flex;flex-direction:column;}
iframe{border:none;flex:1;width:100%;height:100%;}
/* Symbols tab */
.sym-pane{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}
.sym-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--bdr);background:var(--bg2);flex-shrink:0;flex-wrap:wrap;}
.sym-search{font:12px ui-monospace,monospace;padding:5px 10px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);color:var(--fg);outline:none;width:220px;transition:border-color .15s;}
.sym-search:focus{border-color:var(--accent);}
.kind-sel{font:12px ui-sans-serif,sans-serif;padding:4px 8px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);color:var(--fg);outline:none;cursor:pointer;}
.sym-count{font-size:11px;color:var(--fg2);margin-left:auto;}
.sym-table-wrap{flex:1;overflow-y:auto;scrollbar-width:thin;}
table{width:100%;border-collapse:collapse;font-size:12px;}
th{position:sticky;top:0;background:var(--bg2);border-bottom:2px solid var(--bdr);padding:7px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--fg2);cursor:pointer;user-select:none;white-space:nowrap;}
th:hover{color:var(--fg);}
th .sort-arrow{opacity:.5;margin-left:4px;}
td{padding:5px 12px;border-bottom:1px solid var(--bdr);vertical-align:middle;}
tr:hover td{background:color-mix(in srgb,var(--accent) 4%,var(--bg));}
.mono{font-family:ui-monospace,monospace;font-weight:600;}
.kind-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;letter-spacing:.04em;}
.exp-badge{font-size:10px;color:#16a34a;background:#dcfce7;padding:1px 6px;border-radius:5px;}
.file-cell{color:var(--fg2);font-size:11px;font-family:ui-monospace,monospace;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.line-cell{color:var(--fg2);font-family:ui-monospace,monospace;font-size:11px;white-space:nowrap;}
.no-results{padding:48px;text-align:center;color:var(--fg2);}
@media(prefers-color-scheme:dark){.exp-badge{background:#14532d;color:#4ade80;}}
</style>
</head>
<body>
${liveReloadScript}
<header class="topbar">
  <div class="topbar-logo">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    AST Map
  </div>
  <div class="topbar-sep"></div>
  <span class="topbar-title">${title}</span>
  <span class="topbar-meta">${skeletons.length} files &middot; ${totalSymbols} symbols</span>
  <span class="live-dot" title="Live reload active"></span>
</header>

<nav class="tabs">
  <button class="tab-btn active" data-tab="overview"><span class="tab-icon">📊</span>Overview</button>
  <button class="tab-btn" data-tab="files"><span class="tab-icon">📁</span>Files</button>
  <button class="tab-btn" data-tab="graph"><span class="tab-icon">🕸</span>Dependencies</button>
  <button class="tab-btn" data-tab="symbols"><span class="tab-icon">⬡</span>Symbols</button>
</nav>

<div id="tc-overview" class="tab-content active">
  <iframe id="fr-overview" title="Overview"></iframe>
</div>
<div id="tc-files" class="tab-content">
  <iframe id="fr-files" title="Files"></iframe>
</div>
<div id="tc-graph" class="tab-content">
  <iframe id="fr-graph" title="Dependencies"></iframe>
</div>
<div id="tc-symbols" class="tab-content">
  <div class="sym-pane">
    <div class="sym-toolbar">
      <input class="sym-search" id="sym-q" type="search" placeholder="Search symbols…" autocomplete="off">
      <select class="kind-sel" id="kind-filter">
        <option value="">All kinds</option>
        <option>class</option><option>interface</option><option>struct</option>
        <option>function</option><option>method</option><option>type</option>
        <option>enum</option><option>const</option><option>var</option>
        <option>field</option><option>namespace</option>
      </select>
      <label style="font-size:11px;color:var(--fg2);display:flex;align-items:center;gap:5px;">
        <input type="checkbox" id="exp-only"> Exported only
      </label>
      <span class="sym-count" id="sym-count"></span>
    </div>
    <div class="sym-table-wrap">
      <table>
        <thead>
          <tr>
            <th data-col="name">Symbol <span class="sort-arrow" id="sa-name"></span></th>
            <th data-col="kind">Kind <span class="sort-arrow" id="sa-kind"></span></th>
            <th data-col="file">File <span class="sort-arrow" id="sa-file"></span></th>
            <th data-col="startLine">Line <span class="sort-arrow" id="sa-startLine"></span></th>
            <th>Export</th>
          </tr>
        </thead>
        <tbody id="sym-tbody"></tbody>
      </table>
      <div id="sym-empty" class="no-results" style="display:none">No symbols match.</div>
    </div>
  </div>
</div>

<script>
(function(){
'use strict';
const TABS=${tabsData};
const SYMS=${symData};
const KIND_COLORS=${kindColorsData};

// ── Tab switching ───────────────────────────────────────────
const loaded={};

function showTab(name){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(tc=>tc.classList.toggle('active',tc.id==='tc-'+name));
  if(name!=='symbols'){
    if(!loaded[name]){
      const fr=document.getElementById('fr-'+name);
      if(fr){fr.srcdoc=TABS[name]||'';loaded[name]=true;}
    }
  }else{
    renderSymbols();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click',()=>showTab(btn.dataset.tab));
});

// Load overview immediately
showTab('overview');

// ── Symbols table ───────────────────────────────────────────
let sortCol='name',sortAsc=true,filtered=[];

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function renderSymbols(){
  const q=document.getElementById('sym-q').value.trim().toLowerCase();
  const kind=document.getElementById('kind-filter').value;
  const expOnly=document.getElementById('exp-only').checked;

  filtered=SYMS.filter(s=>{
    if(kind&&s.kind!==kind)return false;
    if(expOnly&&!s.exported)return false;
    if(q&&!s.name.toLowerCase().includes(q)&&!s.file.toLowerCase().includes(q))return false;
    return true;
  });

  filtered.sort((a,b)=>{
    const va=String(a[sortCol]),vb=String(b[sortCol]);
    if(sortCol==='startLine')return sortAsc?(a.startLine-b.startLine):(b.startLine-a.startLine);
    return sortAsc?va.localeCompare(vb):vb.localeCompare(va);
  });

  const tbody=document.getElementById('sym-tbody');
  const c=KIND_COLORS;
  tbody.innerHTML=filtered.slice(0,500).map(s=>{
    const col=c[s.kind]||'#64748b';
    return \`<tr>
      <td class="mono">\${esc(s.name)}</td>
      <td><span class="kind-badge" style="background:\${col}1a;color:\${col};border:1px solid \${col}44">\${s.kind}</span></td>
      <td class="file-cell" title="\${esc(s.file)}">\${esc(s.file)}</td>
      <td class="line-cell">L\${s.startLine}</td>
      <td>\${s.exported?'<span class="exp-badge">exp</span>':''}</td>
    </tr>\`;
  }).join('');

  const extra=filtered.length>500?' (showing 500 of '+filtered.length+')'+'':'';
  document.getElementById('sym-count').textContent=filtered.length+' symbol(s)'+extra;
  document.getElementById('sym-empty').style.display=filtered.length?'none':'block';
  tbody.style.display=filtered.length?'':'none';

  // Update sort arrows
  ['name','kind','file','startLine'].forEach(col=>{
    const el=document.getElementById('sa-'+col);
    if(el)el.textContent=col===sortCol?(sortAsc?'↑':'↓'):'';
  });
}

document.getElementById('sym-q').addEventListener('input',renderSymbols);
document.getElementById('kind-filter').addEventListener('change',renderSymbols);
document.getElementById('exp-only').addEventListener('change',renderSymbols);
document.querySelectorAll('th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    if(sortCol===col)sortAsc=!sortAsc;else{sortCol=col;sortAsc=true;}
    renderSymbols();
  });
});

// Keyboard shortcut
document.addEventListener('keydown',ev=>{
  if(ev.key==='/'&&document.activeElement?.tagName!=='INPUT'&&document.activeElement?.tagName!=='SELECT'){
    const q=document.getElementById('sym-q');
    if(document.getElementById('tc-symbols').classList.contains('active')){
      ev.preventDefault();q.focus();q.select();
    }
  }
});

})();
</script>
</body>
</html>`;
}
