/** Generate the self-contained SPA HTML served by `ast-map serve`. */
export function webAppHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AST Map — Live Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<style>
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2d3142;
    --text: #e2e8f0; --muted: #94a3b8; --accent: #7c3aed;
    --green: #22c55e; --yellow: #eab308; --red: #ef4444; --blue: #3b82f6;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; display: flex; height: 100vh; overflow: hidden; }
  #sidebar { width: 220px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 16px 0; flex-shrink: 0; }
  .logo { padding: 0 16px 16px; font-size: 14px; font-weight: 700; color: var(--accent); letter-spacing: 1px; border-bottom: 1px solid var(--border); }
  .logo span { color: var(--muted); font-weight: 400; }
  .nav-item { padding: 10px 16px; cursor: pointer; font-size: 13px; color: var(--muted); transition: all .15s; border-left: 3px solid transparent; }
  .nav-item:hover { color: var(--text); background: rgba(124,58,237,.1); }
  .nav-item.active { color: var(--text); border-left-color: var(--accent); background: rgba(124,58,237,.15); }
  .nav-section { padding: 12px 16px 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-top: 8px; }
  #main { flex: 1; overflow-y: auto; padding: 24px; }
  .page { display: none; } .page.active { display: block; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; gap: 16px; }
  .grid-4 { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .grid-2 { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
  .stat-value { font-size: 28px; font-weight: 700; line-height: 1; }
  .stat-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .score-ring { width: 80px; height: 80px; margin: 0 auto 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-green { background: rgba(34,197,94,.15); color: var(--green); }
  .badge-yellow { background: rgba(234,179,8,.15); color: var(--yellow); }
  .badge-red { background: rgba(239,68,68,.15); color: var(--red); }
  .badge-blue { background: rgba(59,130,246,.15); color: var(--blue); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 8px 12px; border-bottom: 1px solid rgba(45,49,66,.5); }
  tr:hover td { background: rgba(124,58,237,.05); }
  .search { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; color: var(--text); font-size: 13px; margin-bottom: 16px; outline: none; }
  .search:focus { border-color: var(--accent); }
  #graph-canvas { width: 100%; height: calc(100vh - 140px); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .tooltip { position: fixed; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 12px; pointer-events: none; z-index: 9999; max-width: 260px; display: none; }
  .sparkline { display: inline-block; width: 80px; height: 24px; vertical-align: middle; }
  .refresh-btn { margin-left: auto; padding: 6px 14px; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer; }
  .refresh-btn:hover { opacity: .85; }
  .header-row { display: flex; align-items: center; margin-bottom: 16px; }
  .pill { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; background: var(--border); color: var(--muted); margin-left: 6px; }
  .error-box { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); border-radius: 6px; padding: 12px 16px; color: var(--red); font-size: 13px; margin-top: 8px; }
  .loading { color: var(--muted); font-size: 13px; padding: 32px; text-align: center; }
  .timeline { height: 120px; width: 100%; }
  .run-layout { display: grid; grid-template-columns: 260px 1fr; gap: 16px; height: calc(100vh - 120px); }
  .cmd-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow-y: auto; padding: 10px; }
  .cmd-group-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); padding: 10px 6px 4px; }
  .cmd-btn { width: 100%; text-align: left; padding: 8px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text); font-size: 13px; cursor: pointer; display: block; margin-bottom: 1px; }
  .cmd-btn:hover { background: rgba(124,58,237,.15); color: var(--accent); }
  .cmd-form { padding: 4px 10px 8px; display: none; }
  .cmd-form.open { display: block; }
  .cmd-input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 5px 8px; color: var(--text); font-size: 12px; margin-bottom: 4px; outline: none; }
  .cmd-input:focus { border-color: var(--accent); }
  .cmd-run-btn { padding: 5px 14px; background: var(--accent); border: none; border-radius: 4px; color: #fff; font-size: 12px; cursor: pointer; }
  .result-panel { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .tab-bar { display: flex; border-bottom: 1px solid var(--border); overflow-x: auto; flex-shrink: 0; background: var(--bg); min-height: 36px; }
  .tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; font-size: 12px; cursor: pointer; border-right: 1px solid var(--border); white-space: nowrap; color: var(--muted); user-select: none; }
  .tab.active { background: var(--surface); color: var(--text); border-bottom: 2px solid var(--accent); margin-bottom: -1px; }
  .tab-close { opacity: .5; line-height: 1; }
  .tab-close:hover { opacity: 1; }
  .tab-content { flex: 1; overflow-y: auto; padding: 16px; }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  .result-pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; overflow-x: auto; max-height: 500px; overflow-y: auto; }
  .empty-tabs { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--muted); font-size: 13px; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .6s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="sidebar">
  <div class="logo">AST Map <span>v2</span></div>
  <div class="nav-section">Overview</div>
  <div class="nav-item active" data-page="overview">📊 Dashboard</div>
  <div class="nav-item" data-page="timeline">📈 History</div>
  <div class="nav-section">Analysis</div>
  <div class="nav-item" data-page="files">📁 Files</div>
  <div class="nav-item" data-page="symbols">🔷 Symbols</div>
  <div class="nav-item" data-page="deps">🕸️ Dependency Graph</div>
  <div class="nav-section">Issues</div>
  <div class="nav-item" data-page="smells">🤢 Code Smells</div>
  <div class="nav-item" data-page="security">🔒 Security</div>
  <div class="nav-item" data-page="dead">💀 Dead Code</div>
  <div class="nav-section">Commands</div>
  <div class="nav-item" data-page="run">⚡ Run Commands</div>
</div>

<div id="main">
  <!-- OVERVIEW -->
  <div class="page active" id="page-overview">
    <div class="header-row"><h1>Dashboard</h1><button class="refresh-btn" onclick="loadAll()">↺ Refresh</button></div>
    <div class="subtitle" id="root-label">Loading…</div>
    <div class="grid grid-4" id="stat-cards" style="margin-bottom:20px"></div>
    <div class="grid grid-2">
      <div class="card"><div class="stat-label">Top imported symbols</div><div id="top-syms"></div></div>
      <div class="card"><div class="stat-label">Recent issues</div><div id="recent-issues"></div></div>
    </div>
  </div>

  <!-- HISTORY -->
  <div class="page" id="page-timeline">
    <h1>Health Score History</h1>
    <div class="subtitle">Score trend over time</div>
    <div class="card" style="margin-bottom:16px"><svg class="timeline" id="timeline-svg"></svg></div>
    <div class="card"><table><thead><tr><th>Date</th><th>Score</th><th>Grade</th><th>Files</th><th>Dead</th><th>Cycles</th></tr></thead><tbody id="history-table"></tbody></table></div>
  </div>

  <!-- FILES -->
  <div class="page" id="page-files">
    <h1>Files</h1>
    <input class="search" id="file-search" placeholder="Filter files…" oninput="filterFiles()">
    <div class="card"><table><thead><tr><th>File</th><th>Lang</th><th>Symbols</th><th>Lines</th></tr></thead><tbody id="file-table"></tbody></table></div>
  </div>

  <!-- SYMBOLS -->
  <div class="page" id="page-symbols">
    <h1>Symbols</h1>
    <input class="search" id="sym-search" placeholder="Search symbols…" oninput="filterSymbols()">
    <div class="card"><table><thead><tr><th>Symbol</th><th>Kind</th><th>File</th><th>Exported</th></tr></thead><tbody id="sym-table"></tbody></table></div>
  </div>

  <!-- DEPS GRAPH -->
  <div class="page" id="page-deps">
    <h1>Dependency Graph</h1>
    <div class="subtitle">File-level import relationships — drag to explore</div>
    <svg id="graph-canvas"></svg>
  </div>

  <!-- SMELLS -->
  <div class="page" id="page-smells">
    <h1>Code Smells</h1>
    <div id="smells-content"></div>
  </div>

  <!-- SECURITY -->
  <div class="page" id="page-security">
    <h1>Security Issues</h1>
    <div id="security-content"></div>
  </div>

  <!-- DEAD CODE -->
  <div class="page" id="page-dead">
    <h1>Dead Exports</h1>
    <div class="subtitle">Exported symbols with no known importers inside the scanned directory</div>
    <div class="card"><table><thead><tr><th>Symbol</th><th>Kind</th><th>File</th><th>Confidence</th></tr></thead><tbody id="dead-table"></tbody></table></div>
  </div>

  <!-- RUN COMMANDS -->
  <div class="page" id="page-run">
    <div class="header-row"><h1>Run Commands</h1></div>
    <div class="subtitle">Interactive analysis — click a command to run it instantly</div>
    <div class="run-layout">
      <div class="cmd-panel" id="cmd-panel"></div>
      <div class="result-panel">
        <div class="tab-bar" id="tab-bar"></div>
        <div class="tab-content" id="tab-content">
          <div class="empty-tabs" id="empty-tabs">↑ Pick a command to run</div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="tooltip" id="tooltip"></div>

<script>
const API = 'http://localhost:${port}/api';
let state = { report: null, graph: null, dead: [], history: [], skeletons: [], smells: [], security: [] };

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    const page = document.getElementById('page-' + el.dataset.page);
    if (page) { page.classList.add('active'); renderPage(el.dataset.page); }
  });
});

// ─── Data loading ─────────────────────────────────────────────────────────────
async function fetchJson(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function loadAll() {
  try {
    const [report, graph, dead, history, skeletons, smells, security] = await Promise.all([
      fetchJson('/report'), fetchJson('/graph'), fetchJson('/dead'),
      fetchJson('/history'), fetchJson('/skeletons'), fetchJson('/smells'), fetchJson('/security'),
    ]);
    state = { report, graph, dead, history, skeletons, smells, security };
    renderPage(document.querySelector('.nav-item.active')?.dataset.page ?? 'overview');
  } catch(e) {
    document.getElementById('root-label').textContent = 'Error: ' + e.message;
  }
}

// ─── Renderers ────────────────────────────────────────────────────────────────
function renderPage(name) {
  if (name === 'overview') renderOverview();
  else if (name === 'timeline') renderTimeline();
  else if (name === 'files') renderFiles();
  else if (name === 'symbols') renderSymbols();
  else if (name === 'deps') renderGraph();
  else if (name === 'smells') renderSmells();
  else if (name === 'security') renderSecurity();
  else if (name === 'dead') renderDead();
  else if (name === 'run') renderRun();
}

function grade(s) { return s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 60 ? 'D' : 'F'; }
function gradeClass(s) { return s >= 80 ? 'badge-green' : s >= 60 ? 'badge-yellow' : 'badge-red'; }

function renderOverview() {
  const r = state.report;
  if (!r) return;
  document.getElementById('root-label').textContent = r.directory ?? '.';
  const score = r.score ?? 0;
  document.getElementById('stat-cards').innerHTML = [
    { label: 'Health Score', value: score, sub: 'Grade ' + (r.grade ?? grade(score)), cls: gradeClass(score) },
    { label: 'Files', value: r.files ?? 0, sub: '' },
    { label: 'Symbols', value: r.symbols ?? 0, sub: '' },
    { label: 'Dead Exports', value: r.deadExports ?? state.dead.length, sub: '', cls: (r.deadExports || state.dead.length) > 0 ? 'badge-yellow' : 'badge-green' },
    { label: 'Circular Deps', value: r.cyclicGroups ?? 0, sub: '', cls: (r.cyclicGroups ?? 0) > 0 ? 'badge-red' : 'badge-green' },
    { label: 'Max Complexity', value: r.maxComplexity ?? 0, sub: '', cls: (r.maxComplexity ?? 0) > 20 ? 'badge-red' : (r.maxComplexity ?? 0) > 10 ? 'badge-yellow' : 'badge-green' },
    { label: 'Smells', value: state.smells.length, sub: '', cls: state.smells.length > 0 ? 'badge-yellow' : 'badge-green' },
    { label: 'Security', value: state.security.length, sub: '', cls: state.security.length > 0 ? 'badge-red' : 'badge-green' },
  ].map(s => \`<div class="card"><div class="stat-label">\${s.label}</div><div class="stat-value"><span class="badge \${s.cls || ''}">\${s.value}</span></div><div class="stat-sub">\${s.sub}</div></div>\`).join('');

  const topNodes = (state.graph?.nodes ?? []).filter(n => n.nodeType === 'symbol').sort((a, b) => (b.inDegree ?? 0) - (a.inDegree ?? 0)).slice(0, 8);
  document.getElementById('top-syms').innerHTML = topNodes.map(n =>
    \`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid var(--border)"><span>\${n.id?.split('::').pop() ?? n.id}</span><span class="badge badge-blue">\${n.inDegree ?? 0}</span></div>\`
  ).join('') || '<div style="color:var(--muted);font-size:12px">No data</div>';

  const recent = [...state.smells.slice(0, 3).map(s => ({ type: '🤢', msg: (s.symbol ?? s.smell), file: s.file })),
    ...state.security.slice(0, 3).map(s => ({ type: '🔒', msg: s.rule, file: s.file }))];
  document.getElementById('recent-issues').innerHTML = recent.map(i =>
    \`<div style="display:flex;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid var(--border)"><span>\${i.type}</span><div><div>\${i.msg}</div><div style="color:var(--muted)">\${i.file}</div></div></div>\`
  ).join('') || '<div style="color:var(--green);font-size:12px">No issues 🎉</div>';
}

function renderTimeline() {
  const hist = state.history;
  const tbody = document.getElementById('history-table');
  tbody.innerHTML = [...hist].reverse().map(h =>
    \`<tr><td>\${h.date}</td><td><span class="badge \${gradeClass(h.score)}">\${h.score}</span></td><td>\${h.grade}</td><td>\${h.files}</td><td>\${h.dead}</td><td>\${h.cycles}</td></tr>\`
  ).join('');

  if (hist.length < 2) return;
  const svg = document.getElementById('timeline-svg');
  const W = svg.clientWidth || 600, H = 120, M = { t: 10, r: 20, b: 30, l: 40 };
  const iW = W - M.l - M.r, iH = H - M.t - M.b;
  const xs = d3.scalePoint().domain(hist.map(h => h.date)).range([0, iW]);
  const ys = d3.scaleLinear().domain([0, 100]).range([iH, 0]);
  const line = d3.line().x(h => xs(h.date) ?? 0).y(h => ys(h.score));
  svg.innerHTML = \`<g transform="translate(\${M.l},\${M.t})">
    <g transform="translate(0,\${iH})">\${d3.axisBottom(xs).ticks(5)(d3.select(document.createElementNS('http://www.w3.org/2000/svg','g'))?.node?.() ?? document.createElementNS('http://www.w3.org/2000/svg','g'))?.outerHTML ?? ''}</g>
    <path d="\${line(hist)}" fill="none" stroke="#7c3aed" stroke-width="2"/>
    \${hist.map(h => \`<circle cx="\${xs(h.date)}" cy="\${ys(h.score)}" r="4" fill="#7c3aed"/>\`).join('')}
  </g>\`;
}

let allFiles = [];
function renderFiles() {
  allFiles = state.skeletons;
  filterFiles();
}
function filterFiles() {
  const q = document.getElementById('file-search')?.value?.toLowerCase() ?? '';
  const rows = allFiles.filter(s => !q || s.file.toLowerCase().includes(q));
  document.getElementById('file-table').innerHTML = rows.map(s =>
    \`<tr><td style="font-family:monospace">\${s.file}</td><td><span class="pill">\${s.language}</span></td><td>\${s.symbolCount ?? s.symbols?.length ?? 0}</td><td>\${s.lineCount ?? '?'}</td></tr>\`
  ).join('');
}

let allSymbols = [];
function renderSymbols() {
  allSymbols = state.skeletons.flatMap(s => flattenSyms(s.symbols, s.file));
  filterSymbols();
}
function flattenSyms(syms, file, out = []) {
  for (const s of syms) { out.push({ ...s, file }); flattenSyms(s.children ?? [], file, out); }
  return out;
}
function filterSymbols() {
  const q = document.getElementById('sym-search')?.value?.toLowerCase() ?? '';
  const rows = allSymbols.filter(s => !q || s.name.toLowerCase().includes(q) || s.kind.includes(q));
  document.getElementById('sym-table').innerHTML = rows.slice(0, 200).map(s =>
    \`<tr><td><b>\${esc(s.name)}</b></td><td><span class="pill">\${s.kind}</span></td><td style="font-family:monospace;font-size:11px">\${esc(s.file)}</td><td>\${s.exported ? '✓' : ''}</td></tr>\`
  ).join('');
}

function renderGraph() {
  const g = state.graph;
  if (!g) return;
  const svgEl = document.getElementById('graph-canvas');
  const svg = d3.select('#graph-canvas');
  svg.selectAll('*').remove();
  const W = svgEl.clientWidth || 800;
  const H = svgEl.clientHeight || 500;

  const fileNodes = g.nodes.filter(n => n.nodeType === 'file').slice(0, 80).map(n => Object.assign({}, n));
  const nodeIds = new Set(fileNodes.map(n => n.id));
  const links = g.edges
    .filter(e => e.edgeType === 'imports' && nodeIds.has(e.from) && nodeIds.has(e.to))
    .map(e => ({ source: e.from, target: e.to }));

  const degree = {};
  fileNodes.forEach(n => { degree[n.id] = 0; });
  links.forEach(l => { degree[l.source] = (degree[l.source]||0)+1; degree[l.target] = (degree[l.target]||0)+1; });
  const maxDeg = Math.max(1, ...Object.values(degree));

  svg.append('defs').append('marker')
    .attr('id', 'arr').attr('viewBox', '0 -4 8 8').attr('refX', 14).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#6d28d9');

  const zoom = d3.zoom().scaleExtent([0.15, 4]).on('zoom', e => container.attr('transform', e.transform));
  svg.call(zoom);
  const container = svg.append('g');

  svg.append('text').attr('x', W - 10).attr('y', H - 10)
    .attr('text-anchor', 'end').attr('font-size', '11px').attr('fill', '#475569')
    .text('scroll to zoom · drag to pan · drag nodes to arrange');

  const sim = d3.forceSimulation(fileNodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(110))
    .force('charge', d3.forceManyBody().strength(-250))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(32));

  const linkG = container.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', '#6d28d9').attr('stroke-width', 1.5).attr('stroke-opacity', 0.45)
    .attr('marker-end', 'url(#arr)');

  const nodeG = container.append('g').selectAll('g').data(fileNodes).join('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', e => { if (!e.active) sim.alphaTarget(.3).restart(); e.subject.fx = e.subject.x; e.subject.fy = e.subject.y; })
      .on('drag', e => { e.subject.fx = e.x; e.subject.fy = e.y; })
      .on('end', e => { if (!e.active) sim.alphaTarget(0); e.subject.fx = null; e.subject.fy = null; }));

  nodeG.append('circle')
    .attr('r', d => 7 + Math.round((degree[d.id]||0) / maxDeg * 10))
    .attr('fill', d => degree[d.id] > maxDeg * 0.6 ? '#7c3aed' : degree[d.id] > maxDeg * 0.3 ? '#6d28d9' : '#4c1d95')
    .attr('fill-opacity', 0.92)
    .attr('stroke', '#a78bfa').attr('stroke-width', 1.5);

  nodeG.append('text')
    .text(d => d.id.split('/').pop().replace(/\.[^.]+$/, ''))
    .attr('font-size', '10px').attr('fill', '#cbd5e1').attr('text-anchor', 'middle')
    .attr('dy', d => 7 + Math.round((degree[d.id]||0) / maxDeg * 10) + 13)
    .attr('pointer-events', 'none');

  nodeG
    .on('mouseover', (ev, d) => {
      const t = document.getElementById('tooltip');
      t.style.display = 'block'; t.style.left = ev.clientX + 14 + 'px'; t.style.top = ev.clientY + 'px';
      t.innerHTML = \`<b>\${d.id}</b><br><span style="color:var(--muted)">connections: \${degree[d.id]||0}</span>\`;
    })
    .on('mouseout', () => { document.getElementById('tooltip').style.display = 'none'; });

  sim.on('tick', () => {
    linkG.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
         .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeG.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
  });
}

function renderSmells() {
  const s = state.smells;
  document.getElementById('smells-content').innerHTML = s.length === 0
    ? '<div class="card" style="color:var(--green)">No smells detected 🎉</div>'
    : \`<div class="card"><table><thead><tr><th>Smell</th><th>Symbol</th><th>File</th><th>Line</th><th>Severity</th></tr></thead><tbody>\${s.map(i =>
      \`<tr><td><span class="badge badge-yellow">\${esc(i.smell)}</span></td><td>\${esc(i.symbol??'')}</td><td style="font-size:11px">\${esc(i.file)}</td><td>\${i.line??''}</td><td>\${i.severity}</td></tr>\`
    ).join('')}</tbody></table></div>\`;
}

function renderSecurity() {
  const s = state.security;
  document.getElementById('security-content').innerHTML = s.length === 0
    ? '<div class="card" style="color:var(--green)">No security issues detected 🎉</div>'
    : \`<div class="card"><table><thead><tr><th>Rule</th><th>Severity</th><th>File</th><th>Line</th><th>Message</th></tr></thead><tbody>\${s.map(i =>
      \`<tr><td><span class="badge \${i.severity==='critical'||i.severity==='high'?'badge-red':'badge-yellow'}">\${esc(i.rule)}</span></td><td>\${esc(i.severity)}</td><td style="font-size:11px">\${esc(i.file)}</td><td>\${i.line}</td><td style="font-size:11px">\${esc(i.message)}</td></tr>\`
    ).join('')}</tbody></table></div>\`;
}

function renderDead() {
  const d = state.dead;
  document.getElementById('dead-table').innerHTML = d.map(i =>
    \`<tr><td><b>\${esc(i.symbol)}</b></td><td><span class="pill">\${esc(i.kind)}</span></td><td style="font-family:monospace;font-size:11px">\${esc(i.file)}</td><td><span class="badge \${i.confidence==='high'?'badge-red':'badge-yellow'}">\${esc(i.confidence)}</span></td></tr>\`
  ).join('');
}

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── Run Commands ─────────────────────────────────────────────────────────────
var CMDS = [
  { group: 'Analysis', items: [
    { id: 'dead', label: '💀 Dead Exports', desc: 'Find unused exported symbols' },
    { id: 'cycles', label: '🔄 Circular Deps', desc: 'Circular dependency chains' },
    { id: 'duplicates', label: '♊ Duplicates', desc: 'Symbols defined more than once' },
    { id: 'similar', label: '🔍 Similar Code', desc: 'Structurally similar functions' },
    { id: 'complexity', label: '📊 Complexity', desc: 'Cyclomatic complexity per file' },
    { id: 'top', label: '🏆 Top Symbols', desc: 'Most imported symbols' }
  ]},
  { group: 'Quality', items: [
    { id: 'smells', label: '🤢 Code Smells', desc: 'Detect anti-patterns' },
    { id: 'security', label: '🔒 Security Scan', desc: 'Security vulnerabilities' },
    { id: 'arch', label: '🏛️ Arch Rules', desc: 'Architecture rule violations' }
  ]},
  { group: 'Search & Explore', items: [
    { id: 'find', label: '🔎 Find Symbol', desc: 'Search symbols by name', fields: [
      { name: 'query', ph: 'Symbol name…', req: true },
      { name: 'kind', ph: 'Kind filter (fn, class…)', req: false }
    ]},
    { id: 'impact', label: '💥 Change Impact', desc: 'Blast radius of changing a symbol', fields: [
      { name: 'symbol', ph: 'file.ts::SymbolName', req: true }
    ]},
    { id: 'fileDeps', label: '📦 File Deps', desc: 'What a file imports and who imports it', fields: [
      { name: 'file', ph: 'src/foo.ts', req: true }
    ]},
    { id: 'explain', label: '💡 Explain Symbol', desc: 'Full structural context of a symbol', fields: [
      { name: 'file', ph: 'src/foo.ts', req: true },
      { name: 'symbol', ph: 'SymbolName', req: true }
    ]}
  ]},
  { group: 'Generate', items: [
    { id: 'diagram', label: '🕸️ Diagram', desc: 'Mermaid diagram of the codebase', fields: [
      { name: 'type', ph: 'deps | class | modules', req: false }
    ]},
    { id: 'doc', label: '📝 Docs', desc: 'Generate Markdown documentation' }
  ]}
];

var _tabCount = 0;
var _runInit = false;

function renderRun() {
  if (_runInit) return;
  _runInit = true;
  var panel = document.getElementById('cmd-panel');
  var html = '';
  CMDS.forEach(function(g) {
    html += '<div class="cmd-group-label">' + g.group + '</div>';
    g.items.forEach(function(cmd) {
      html += '<button class="cmd-btn" title="' + esc(cmd.desc) + '" data-cmd="' + cmd.id + '">' + cmd.label + '</button>';
      if (cmd.fields) {
        html += '<div class="cmd-form" id="form-' + cmd.id + '">';
        cmd.fields.forEach(function(f) {
          html += '<input class="cmd-input" id="inp-' + cmd.id + '-' + f.name + '" placeholder="' + esc(f.ph) + '" data-run="' + cmd.id + '" />';
        });
        html += '<button class="cmd-run-btn" data-run="' + cmd.id + '">▶ Run</button>';
        html += '</div>';
      }
    });
  });
  panel.innerHTML = html;
  panel.addEventListener('click', function(e) {
    var t = e.target;
    if (t.dataset.run) { runCmd(t.dataset.run); return; }
    if (t.dataset.cmd) { toggleForm(t.dataset.cmd); }
  });
  panel.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.dataset.run) runCmd(e.target.dataset.run);
  });
}

function findCmd(id) {
  for (var i = 0; i < CMDS.length; i++) {
    for (var j = 0; j < CMDS[i].items.length; j++) {
      if (CMDS[i].items[j].id === id) return CMDS[i].items[j];
    }
  }
  return null;
}

function toggleForm(id) {
  var cmd = findCmd(id);
  if (!cmd || !cmd.fields) { runCmd(id); return; }
  var form = document.getElementById('form-' + id);
  if (form) form.classList.toggle('open');
}

async function runCmd(id) {
  var cmd = findCmd(id);
  if (!cmd) return;
  var args = {};
  if (cmd.fields) {
    for (var i = 0; i < cmd.fields.length; i++) {
      var f = cmd.fields[i];
      var inp = document.getElementById('inp-' + id + '-' + f.name);
      var v = inp ? inp.value.trim() : '';
      if (f.req && !v) { alert(f.name + ' is required'); return; }
      if (v) args[f.name] = v;
    }
  }
  var firstArg = args.query || args.symbol || args.file || args.type || '';
  var label = cmd.label + (firstArg ? ': ' + firstArg : '');
  var tabId = ++_tabCount;
  addTab(tabId, label, '<div class="loading"><span class="spinner"></span> Running…</div>');
  try {
    var r = await fetch('http://localhost:${port}/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: id, args: args })
    });
    var json = await r.json();
    if (!r.ok) throw new Error(json.error || r.statusText);
    setTabContent(tabId, renderResult(id, json.data));
  } catch(e) {
    setTabContent(tabId, '<div class="error-box">' + esc(e.message) + '</div>');
  }
}

function addTab(id, label, content) {
  var emptyEl = document.getElementById('empty-tabs');
  if (emptyEl) emptyEl.remove();
  var bar = document.getElementById('tab-bar');
  var tc = document.getElementById('tab-content');
  bar.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  tc.querySelectorAll('.tab-pane').forEach(function(t) { t.classList.remove('active'); });
  var tab = document.createElement('div');
  tab.className = 'tab active';
  tab.dataset.tab = id;
  tab.innerHTML = '<span>' + esc(label) + '</span><span class="tab-close" onclick="closeTab(' + id + ',event)">✕</span>';
  tab.addEventListener('click', function(e) { if (!e.target.classList.contains('tab-close')) switchTab(id); });
  bar.appendChild(tab);
  var pane = document.createElement('div');
  pane.className = 'tab-pane active';
  pane.id = 'pane-' + id;
  pane.innerHTML = content;
  tc.appendChild(pane);
}

function setTabContent(id, html) {
  var pane = document.getElementById('pane-' + id);
  if (pane) pane.innerHTML = html;
}

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab == id); });
  document.querySelectorAll('.tab-pane').forEach(function(t) { t.classList.toggle('active', t.id === 'pane-' + id); });
}

function closeTab(id, e) {
  e.stopPropagation();
  var tab = document.querySelector('.tab[data-tab="' + id + '"]');
  var pane = document.getElementById('pane-' + id);
  var wasActive = tab && tab.classList.contains('active');
  if (tab) tab.remove();
  if (pane) pane.remove();
  if (wasActive) {
    var remaining = document.querySelectorAll('.tab');
    if (remaining.length > 0) {
      switchTab(remaining[remaining.length - 1].dataset.tab);
    } else {
      document.getElementById('tab-content').innerHTML = '<div class="empty-tabs" id="empty-tabs">↑ Pick a command to run</div>';
    }
  }
}

function renderResult(cmd, data) {
  if (data == null) return '<div style="color:var(--muted)">No results</div>';
  if (cmd === 'dead') {
    if (!data.length) return '<div style="color:var(--green)">No dead exports 🎉</div>';
    return renderTable(['Symbol','Kind','File','Confidence'], data, function(d) {
      return [d.symbol, '<span class="pill">'+esc(d.kind)+'</span>', d.file, '<span class="badge '+(d.confidence==='high'?'badge-red':'badge-yellow')+'">'+d.confidence+'</span>'];
    });
  }
  if (cmd === 'cycles') {
    if (!data.length) return '<div style="color:var(--green)">No cycles 🎉</div>';
    return data.map(function(c) { return '<div class="card" style="margin-bottom:8px"><b>Cycle:</b> <span style="font-family:monospace;font-size:12px">'+esc((c.cycle||[]).join(' → '))+'</span></div>'; }).join('');
  }
  if (cmd === 'duplicates') {
    if (!data.length) return '<div style="color:var(--green)">No duplicates 🎉</div>';
    return renderTable(['Symbol','Kind','Files'], data, function(d) {
      return [d.name, '<span class="pill">'+esc(d.kind)+'</span>', (d.locations||[]).map(function(l){return l.file;}).join(', ')];
    });
  }
  if (cmd === 'similar') {
    if (!data.length) return '<div style="color:var(--green)">No similar groups 🎉</div>';
    return data.map(function(g) {
      var members = (g.members||[]).map(function(m) { return '<span style="font-family:monospace;font-size:11px">'+esc(m.name)+' <span style="color:var(--muted)">('+esc(m.file)+')</span></span>'; }).join(', ');
      return '<div class="card" style="margin-bottom:8px"><b>'+esc(g.kind||'similar')+'</b> — '+members+'</div>';
    }).join('');
  }
  if (cmd === 'complexity') {
    return renderTable(['File','Functions','Max CC','Avg CC','Rating'], data, function(d) {
      var r = d.rating||'';
      var cls = (r==='high'||r==='very-high')?'badge-red':r==='moderate'?'badge-yellow':'badge-green';
      return [d.file, (d.functions||[]).length, d.maxComplexity||0, Math.round(d.avgComplexity||0), '<span class="badge '+cls+'">'+r+'</span>'];
    });
  }
  if (cmd === 'top') {
    return renderTable(['Symbol','Kind','File','Imports'], data, function(d) {
      return [d.symbol||d.id, '<span class="pill">'+esc(d.kind||'')+'</span>', d.file||'', '<span class="badge badge-blue">'+(d.inDegree||d.importCount||0)+'</span>'];
    });
  }
  if (cmd === 'smells') {
    if (!data.length) return '<div style="color:var(--green)">No smells 🎉</div>';
    return renderTable(['Smell','Symbol','File','Line','Sev'], data, function(d) {
      return ['<span class="badge badge-yellow">'+esc(d.smell)+'</span>', d.symbol||'', d.file, d.line||'', d.severity];
    });
  }
  if (cmd === 'security') {
    if (!data.length) return '<div style="color:var(--green)">No issues 🎉</div>';
    return renderTable(['Rule','Sev','File','Line','Message'], data, function(d) {
      var cls = (d.severity==='critical'||d.severity==='high')?'badge-red':'badge-yellow';
      return ['<span class="badge '+cls+'">'+esc(d.rule)+'</span>', d.severity, d.file, d.line, d.message];
    });
  }
  if (cmd === 'arch') {
    if (!data.length) return '<div style="color:var(--green)">No violations 🎉</div>';
    return renderTable(['Rule','From','To','Severity'], data, function(d) {
      return [d.rule||d.description||'', d.from||'', d.to||'', '<span class="badge '+(d.severity==='error'?'badge-red':'badge-yellow')+'">'+d.severity+'</span>'];
    });
  }
  if (cmd === 'find') {
    if (!data.length) return '<div style="color:var(--muted)">No symbols found</div>';
    return renderTable(['Symbol','Kind','File','Line','Exported'], data, function(d) {
      return [d.name, '<span class="pill">'+esc(d.kind)+'</span>', d.file, d.line||'', d.exported?'✓':''];
    });
  }
  if (cmd === 'impact') {
    if (!data) return '<div style="color:var(--muted)">Symbol not found in graph</div>';
    var header = '<div class="card" style="margin-bottom:8px"><b>Direct:</b> '+(data.direct||[]).length+' &nbsp; <b>Transitive:</b> '+(data.transitive||[]).length+' &nbsp; <b>Total files:</b> '+data.totalFiles+'</div>';
    var allNodes = (data.direct||[]).map(function(n){return Object.assign({},n,{rel:'direct'});}).concat((data.transitive||[]).map(function(n){return Object.assign({},n,{rel:'transitive'});}));
    return header + renderTable(['File','Symbol','Relation'], allNodes, function(d) {
      return [d.file, d.symbol||'', '<span class="badge '+(d.rel==='direct'?'badge-blue':'badge-yellow')+'">'+d.rel+'</span>'];
    });
  }
  if (cmd === 'fileDeps') {
    if (!data) return '<div style="color:var(--muted)">File not found in graph</div>';
    var imH = (data.imports||[]).map(function(f) { return '<div style="font-family:monospace;font-size:12px;padding:2px 0">'+esc(f.file)+'</div>'; }).join('');
    var ibH = (data.importedBy||[]).map(function(f) { return '<div style="font-family:monospace;font-size:12px;padding:2px 0">'+esc(f.file)+'</div>'; }).join('');
    return '<div class="card" style="margin-bottom:8px"><b>Imports:</b> '+(data.imports||[]).length+' &nbsp; <b>Imported by:</b> '+(data.importedBy||[]).length+'</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + '<div><div class="stat-label" style="margin-bottom:6px">Imports</div>'+imH+'</div>'
      + '<div><div class="stat-label" style="margin-bottom:6px">Imported by</div>'+ibH+'</div></div>';
  }
  if (cmd === 'explain') {
    if (!data) return '<div style="color:var(--muted)">Symbol not found</div>';
    var detail = JSON.stringify({ signature: data.signature, params: data.params, returnType: data.returnType, exported: data.exported, calls: (data.calls||[]).length, calledBy: (data.calledBy||[]).length }, null, 2);
    return '<div class="card" style="margin-bottom:8px"><b>'+esc(data.symbol||'')+'</b> <span class="pill">'+esc(data.kind||'')+'</span> in <code style="font-size:11px">'+esc(data.file||'')+'</code></div>'
      + (data.docstring ? '<div class="card" style="margin-bottom:8px;font-size:12px">'+esc(data.docstring)+'</div>' : '')
      + '<div class="result-pre">'+esc(detail)+'</div>';
  }
  if (cmd === 'diagram') {
    return '<div class="card" style="margin-bottom:8px"><b>'+esc(data.title||'Diagram')+'</b> — '+data.nodeCount+' nodes, '+data.edgeCount+' edges</div>'
      + '<div class="result-pre">'+esc(data.mermaid||'')+'</div>';
  }
  if (cmd === 'doc') {
    return '<div class="card" style="margin-bottom:8px"><b>Generated docs</b> — '+data.files+' files, '+data.symbols+' symbols</div>'
      + '<div class="result-pre">'+esc(data.markdown||'')+'</div>';
  }
  return '<div class="result-pre">'+esc(JSON.stringify(data, null, 2))+'</div>';
}

function renderTable(headers, rows, mapper) {
  if (!rows || !rows.length) return '<div style="color:var(--muted);font-size:13px;padding:12px">No results</div>';
  var h = headers.map(function(x) { return '<th>'+x+'</th>'; }).join('');
  var r = rows.slice(0, 200).map(function(d) {
    return '<tr>' + mapper(d).map(function(c) { return '<td>'+(c==null?'':c)+'</td>'; }).join('') + '</tr>';
  }).join('');
  return '<div class="card"><table><thead><tr>'+h+'</tr></thead><tbody>'+r+'</tbody></table></div>';
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
loadAll();

// ─── Live reload via SSE ──────────────────────────────────────────────────────
(function connectSSE() {
  const es = new EventSource('http://localhost:${port}/events');
  es.addEventListener('change', () => loadAll());
  es.addEventListener('error', () => { es.close(); setTimeout(connectSSE, 3000); });
})();
</script>
</body>
</html>`;
}
