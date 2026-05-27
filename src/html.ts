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
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badge(kind: SymbolKind): string {
  const color = KIND_COLORS[kind] ?? "#64748b";
  return `<span class="badge" style="background:${color}1a;color:${color};border:1px solid ${color}55;">${kind}</span>`;
}

function renderSymbol(sym: SymbolNode): string {
  const vis =
    sym.visibility === "private"
      ? `<span class="vis priv" title="private">private</span>`
      : "";
  const exported = sym.exported ? `<span class="vis exp" title="exported">export</span>` : "";
  const sig = sym.signature
    ? `<code class="sig">${esc(sym.signature)}</code>`
    : "";
  const lines = `<span class="lines">L${sym.range.startLine}–${sym.range.endLine}</span>`;
  const doc = sym.doc ? `<div class="doc">${esc(sym.doc)}</div>` : "";

  const head =
    `${badge(sym.kind)}<span class="name">${esc(sym.name)}</span>${exported}${vis}${sig}${lines}`;

  if (sym.children.length > 0) {
    const kids = sym.children.map(renderSymbol).join("");
    return `<details open class="node"><summary>${head}</summary>${doc}<div class="children">${kids}</div></details>`;
  }
  return `<div class="node leaf">${head}${doc}</div>`;
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
  const body =
    skel.symbols.length > 0
      ? skel.symbols.map(renderSymbol).join("")
      : `<p class="empty">No top-level symbols found.</p>`;
  return `<details id="file-${index}" class="file-section" open>
<summary class="file-summary">
  <span class="fs-path">${esc(skel.file)}</span>
  <span class="fs-meta">${esc(skel.language)} &middot; ${skel.symbolCount} symbols &middot; <time>${esc(skel.generatedAt)}</time></span>
</summary>
<div class="fs-body"><div class="tree">${body}</div></div>
</details>`;
}

export function renderCombinedHtml(skeletons: SkeletonFile[]): string {
  const sections = skeletons.map((s, i) => renderFileSection(s, i)).join("\n");
  const totalSymbols = skeletons.reduce((n, s) => n + s.symbolCount, 0);
  const generatedAt = new Date().toISOString();

  // Compact per-file data for client-side search and tree rendering.
  const fileData = JSON.stringify(
    skeletons.map((s, i) => ({
      id: i,
      file: s.file,
      lang: s.language,
      n: s.symbolCount,
      syms: collectSymbolNames(s.symbols).join(" "),
    })),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codebase Skeleton (${skeletons.length} files)</title>
<style>
:root{color-scheme:light dark;--bg:#f8fafc;--bg2:#fff;--fg:#0f172a;--fg2:#475569;--bdr:#e2e8f0;--hover:#f1f5f9;--sb-bg:#fff;--sb-w:260px;--accent:#6366f1;}
@media(prefers-color-scheme:dark){:root{--bg:#0b1120;--bg2:#111827;--fg:#e2e8f0;--fg2:#94a3b8;--bdr:#1f2937;--hover:#111827;--sb-bg:#0f172a;}}
*{box-sizing:border-box;margin:0;padding:0;}
body{font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;height:100vh;overflow:hidden;}
/* topbar */
.topbar{display:flex;align-items:center;gap:12px;padding:8px 16px;background:var(--bg2);border-bottom:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap;}
.topbar-title{font-weight:700;font-size:14px;}
.topbar-meta{font-size:12px;color:var(--fg2);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.topbar-actions{display:flex;gap:6px;flex-shrink:0;}
button{font:inherit;cursor:pointer;border:1px solid var(--bdr);background:transparent;color:inherit;border-radius:8px;padding:3px 10px;font-size:12px;}
button:hover{background:var(--hover);}
/* layout */
.layout{display:flex;flex:1;min-height:0;}
/* sidebar */
.sidebar{width:var(--sb-w);flex-shrink:0;background:var(--sb-bg);border-right:1px solid var(--bdr);display:flex;flex-direction:column;overflow:hidden;}
.search-wrap{padding:8px;border-bottom:1px solid var(--bdr);}
#search{width:100%;font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--bdr);border-radius:8px;background:var(--bg);color:var(--fg);outline:none;}
#search:focus{border-color:var(--accent);}
.nav-tree{flex:1;overflow-y:auto;padding:6px 4px;}
/* nav tree nodes */
.dir-node{margin:1px 0;}
.dir-node>summary{list-style:none;cursor:pointer;padding:3px 6px;border-radius:6px;font-size:12px;font-weight:600;color:var(--fg2);display:flex;align-items:center;gap:4px;user-select:none;}
.dir-node>summary::-webkit-details-marker{display:none;}
.dir-node>summary::before{content:"\\25B8";font-size:10px;opacity:.5;transition:transform .12s;flex-shrink:0;}
.dir-node[open]>summary::before{transform:rotate(90deg);}
.dir-node>summary:hover{background:var(--hover);}
.dir-children{padding-left:12px;}
a.file-link{display:flex;align-items:center;justify-content:space-between;padding:3px 8px;border-radius:6px;text-decoration:none;color:var(--fg);font-size:12px;cursor:pointer;gap:4px;}
a.file-link:hover{background:var(--hover);}
a.file-link.active{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);}
.fname{font-family:ui-monospace,monospace;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fmeta{font-size:10px;color:var(--fg2);flex-shrink:0;}
/* main panel */
.main-panel{flex:1;overflow-y:auto;padding:16px;}
/* file sections */
details.file-section{border:1px solid var(--bdr);border-radius:12px;margin-bottom:14px;background:var(--bg2);}
summary.file-summary{list-style:none;cursor:pointer;padding:10px 14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;border-radius:12px;}
summary.file-summary::-webkit-details-marker{display:none;}
summary.file-summary::before{content:"\\25B8";opacity:.4;transition:transform .15s;flex-shrink:0;}
details.file-section[open]>summary.file-summary::before{transform:rotate(90deg);}
summary.file-summary:hover{background:var(--hover);}
.fs-path{font-family:ui-monospace,monospace;font-weight:700;font-size:13px;}
.fs-meta{font-size:11px;color:var(--fg2);margin-left:auto;}
.fs-body{padding:8px 14px 14px;}
/* symbol tree (reused styles) */
.tree{display:flex;flex-direction:column;gap:4px;}
details.node{border:1px solid var(--bdr);border-radius:10px;padding:2px 4px;}
summary{list-style:none;cursor:pointer;padding:6px 8px;border-radius:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
summary::-webkit-details-marker{display:none;}
summary::before{content:"\\25B8";opacity:.5;transition:transform .15s;}
details[open]>summary::before{transform:rotate(90deg);}
.leaf{padding:6px 8px 6px 24px;border-radius:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
summary:hover,.leaf:hover{background:var(--hover);}
.children{margin:2px 0 6px 18px;padding-left:10px;border-left:2px solid #e2e8f033;display:flex;flex-direction:column;gap:4px;}
.badge{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;}
.name{font-family:ui-monospace,monospace;font-weight:600;}
.vis{font-size:10px;padding:1px 6px;border-radius:6px;}
.vis.priv{background:#ef44441a;color:#ef4444;}
.vis.exp{background:#22c55e1a;color:#16a34a;}
.sig{font-family:ui-monospace,monospace;font-size:12px;background:var(--hover);padding:1px 6px;border-radius:6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.lines{font-size:11px;opacity:.55;margin-left:auto;font-family:ui-monospace,monospace;}
.doc{font-size:12px;opacity:.8;margin:2px 0 6px 28px;white-space:pre-wrap;font-style:italic;}
.empty{opacity:.6;}
.no-match{padding:40px;text-align:center;color:var(--fg2);font-size:13px;}
</style>
</head>
<body>
<header class="topbar">
  <span class="topbar-title">Codebase Skeleton</span>
  <span class="topbar-meta">${skeletons.length} files &middot; ${totalSymbols} symbols &middot; ${esc(generatedAt)}</span>
  <div class="topbar-actions">
    <button id="btn-expand">Expand all</button>
    <button id="btn-collapse">Collapse all</button>
  </div>
</header>
<div class="layout">
  <nav class="sidebar">
    <div class="search-wrap">
      <input id="search" type="search" placeholder="Search files or symbols…" autocomplete="off" spellcheck="false">
    </div>
    <div id="nav-tree" class="nav-tree"></div>
  </nav>
  <main id="main" class="main-panel">
${sections}
    <div id="no-match" class="no-match" style="display:none">No matching files or symbols.</div>
  </main>
</div>
<script>
(function(){
const FILES=${fileData};

// ── folder tree ──────────────────────────────────────────────────────────────
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

function e(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const linkMap=new Map(); // id -> <a>
function renderTreeNode(node,container){
  const dirs=Object.entries(node.dirs).sort(([a],[b])=>a.localeCompare(b));
  for(const[name,child]of dirs){
    const det=document.createElement('details');
    det.className='dir-node';
    det.open=true;
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
    a.innerHTML='<span class="fname">'+e(fname)+'</span><span class="fmeta">'+f.n+'</span>';
    container.appendChild(a);
    linkMap.set(f.id,a);
  }
}

const navTree=document.getElementById('nav-tree');
renderTreeNode(buildTreeData(FILES),navTree);

// ── search ───────────────────────────────────────────────────────────────────
const searchEl=document.getElementById('search');
const mainEl=document.getElementById('main');
const noMatch=document.getElementById('no-match');
const sections=Array.from(document.querySelectorAll('details.file-section'));

searchEl.addEventListener('input',applyFilter);
function applyFilter(){
  const q=searchEl.value.trim().toLowerCase();
  let visCount=0;
  FILES.forEach(f=>{
    const sec=document.getElementById('file-'+f.id);
    if(!sec)return;
    const match=!q||f.file.toLowerCase().includes(q)||f.syms.toLowerCase().includes(q);
    sec.style.display=match?'':'none';
    const link=linkMap.get(f.id);
    if(link)link.style.display=match?'':'none';
    if(match)visCount++;
  });
  noMatch.style.display=visCount===0&&q?'':'none';
}

// ── expand / collapse ────────────────────────────────────────────────────────
document.getElementById('btn-expand').addEventListener('click',()=>{
  document.querySelectorAll('details').forEach(d=>d.open=true);
});
document.getElementById('btn-collapse').addEventListener('click',()=>{
  document.querySelectorAll('details').forEach(d=>d.open=false);
});

// ── active sidebar link on scroll ────────────────────────────────────────────
const io=new IntersectionObserver(entries=>{
  for(const en of entries){
    if(en.isIntersecting){
      const idx=parseInt(en.target.id.replace('file-',''),10);
      linkMap.forEach((a,id)=>a.classList.toggle('active',id===idx));
    }
  }
},{root:mainEl,threshold:0.15});
sections.forEach(s=>io.observe(s));
})();
</script>
</body>
</html>`;
}

export function renderHtml(skel: SkeletonFile): string {
  const body =
    skel.symbols.length > 0
      ? skel.symbols.map(renderSymbol).join("")
      : `<p class="empty">No top-level symbols found.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skeleton — ${esc(skel.file)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
         margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
  @media (prefers-color-scheme: dark) { body { background:#0b1120; color:#e2e8f0; } header.meta{background:#111827;border-color:#1f2937;} .node{border-color:#1f2937;} summary:hover,.leaf:hover{background:#111827;} .sig{background:#111827;color:#93c5fd;} .doc{color:#94a3b8;} }
  header.meta { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 20px; margin-bottom:20px; }
  header.meta h1 { font-size:16px; margin:0 0 6px; font-family:ui-monospace,monospace; }
  header.meta .sub { font-size:12px; opacity:.7; }
  .toolbar { margin:14px 0; display:flex; gap:8px; }
  button { font:inherit; cursor:pointer; border:1px solid #cbd5e1; background:transparent; color:inherit;
           border-radius:8px; padding:4px 10px; }
  .tree { display:flex; flex-direction:column; gap:4px; }
  details.node { border:1px solid #e2e8f0; border-radius:10px; padding:2px 4px; }
  summary { list-style:none; cursor:pointer; padding:6px 8px; border-radius:8px; display:flex; align-items:center;
            gap:8px; flex-wrap:wrap; }
  summary::-webkit-details-marker { display:none; }
  summary::before { content:"\\25B8"; opacity:.5; transition:transform .15s; }
  details[open] > summary::before { transform:rotate(90deg); }
  .leaf { padding:6px 8px 6px 24px; border-radius:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  summary:hover,.leaf:hover { background:#f1f5f9; }
  .children { margin:2px 0 6px 18px; padding-left:10px; border-left:2px solid #e2e8f033; display:flex;
              flex-direction:column; gap:4px; }
  .badge { font-size:11px; font-weight:600; padding:1px 7px; border-radius:999px; text-transform:uppercase;
           letter-spacing:.03em; }
  .name { font-family:ui-monospace,monospace; font-weight:600; }
  .vis { font-size:10px; padding:1px 6px; border-radius:6px; }
  .vis.priv { background:#ef44441a; color:#ef4444; }
  .vis.exp { background:#22c55e1a; color:#16a34a; }
  .sig { font-family:ui-monospace,monospace; font-size:12px; background:#f1f5f9; padding:1px 6px; border-radius:6px;
         max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lines { font-size:11px; opacity:.55; margin-left:auto; font-family:ui-monospace,monospace; }
  .doc { font-size:12px; opacity:.8; margin:2px 0 6px 28px; white-space:pre-wrap; font-style:italic; }
  .empty { opacity:.6; }
</style>
</head>
<body>
<header class="meta">
  <h1>${esc(skel.file)}</h1>
  <div class="sub">${esc(skel.language)} &middot; ${skel.symbolCount} symbols &middot; parser: ${esc(skel.parser.grammar)} &middot; ${esc(skel.generatedAt)}</div>
</header>
<div class="toolbar">
  <button onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">Expand all</button>
  <button onclick="document.querySelectorAll('details').forEach(d=>d.open=false)">Collapse all</button>
</div>
<div class="tree">
${body}
</div>
</body>
</html>`;
}
