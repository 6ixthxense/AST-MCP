import type { SymbolGraph, GraphSymbolNode, GraphFileNode } from "./graph.js";

interface ExNode { id: string; symbols: number; group: string; lang: string; syms: string[]; ca: number; ce: number; inst: number }
interface ExLink { source: string; target: string }

/** Derive a file-level dependency graph (nodes = files, edges = imports). */
function deriveFileGraph(graph: SymbolGraph): { nodes: ExNode[]; links: ExLink[] } {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  // top-level symbol names per file (for the detail panel).
  const fileSyms = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.nodeType !== "symbol") continue;
    const s = n as GraphSymbolNode;
    if (s.id.indexOf("::") !== s.id.lastIndexOf("::")) continue; // skip nested (one :: only)
    const arr = fileSyms.get(s.file) ?? [];
    if (arr.length < 60) arr.push(s.kind + " " + s.symbol);
    fileSyms.set(s.file, arr);
  }
  const nodes: ExNode[] = [];
  for (const n of graph.nodes) {
    if (n.nodeType !== "file") continue;
    const f = n as GraphFileNode;
    const parts = f.id.split("/");
    nodes.push({ id: f.id, symbols: f.symbolCount, group: parts.length > 1 ? parts[0] : "(root)", lang: f.language, syms: fileSyms.get(f.id) ?? [], ca: 0, ce: 0, inst: 0 });
  }
  const seen = new Set<string>();
  const links: ExLink[] = [];
  for (const e of graph.edges) {
    if (e.edgeType !== "imports") continue;
    const to = nodeMap.get(e.to);
    const toFile = to ? (to.nodeType === "file" ? to.id : (to as GraphSymbolNode).file) : null;
    if (!toFile || e.from === toFile) continue;
    const key = e.from + "|" + toFile;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: e.from, target: toFile });
  }
  // Per-file coupling (Ca = fan-in, Ce = fan-out, I = Ce/(Ca+Ce)) from the deduped links.
  const outSet = new Map<string, Set<string>>();
  const inSet = new Map<string, Set<string>>();
  for (const l of links) {
    (outSet.get(l.source) ?? outSet.set(l.source, new Set()).get(l.source)!).add(l.target);
    (inSet.get(l.target) ?? inSet.set(l.target, new Set()).get(l.target)!).add(l.source);
  }
  for (const n of nodes) {
    n.ce = outSet.get(n.id)?.size ?? 0;
    n.ca = inSet.get(n.id)?.size ?? 0;
    n.inst = n.ca + n.ce === 0 ? 0 : Math.round((n.ce / (n.ca + n.ce)) * 100) / 100;
  }
  return { nodes, links };
}

const STYLE =
  "body{margin:0;font-family:system-ui,sans-serif;color:#222;background:#fafafa}" +
  "#bar{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#fff;border-bottom:1px solid #e5e5e5;z-index:4;box-sizing:border-box}" +
  "#bar h1{font-size:14px;margin:0;font-weight:600}#bar .muted{color:#888;font-size:12px;flex-shrink:0}" +
  "#q{flex:0 0 170px;padding:5px 9px;border:1px solid #ddd;border-radius:6px;font-size:13px}" +
  "#cv{position:fixed;top:48px;left:0;right:0;bottom:0;display:block;cursor:grab}" +
  "#tip{position:fixed;pointer-events:none;background:#1a1a1a;color:#eee;font-size:12px;padding:5px 9px;border-radius:6px;display:none;z-index:5;line-height:1.6;max-width:320px}" +
  "#panel{position:fixed;top:48px;right:0;bottom:0;width:300px;background:#fff;border-left:1px solid #e5e5e5;z-index:3;overflow-y:auto;padding:14px 16px;box-sizing:border-box;display:none;font-size:13px}" +
  "#panel h2{font-size:14px;margin:0 0 2px;word-break:break-all}#panel .path{color:#888;font-size:11px;margin-bottom:8px;word-break:break-all}" +
  "#panel .meta{color:#555;margin-bottom:4px;font-size:12px}" +
  "#panel h3{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin:14px 0 5px}" +
  "#panel .row{padding:3px 6px;border-radius:5px;cursor:pointer;word-break:break-all;line-height:1.5}#panel .row:hover{background:#f0f0f0}" +
  "#panel .sym{color:#444;padding:2px 6px;word-break:break-all}#panel .k{color:#999;font-size:11px}" +
  "#panel .mbar-label{font-size:11px;color:#888;margin:8px 0 2px}" +
  "#panel .mbar-row{display:flex;align-items:center;gap:7px;margin-bottom:3px}" +
  "#panel .mbar-wrap{flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden}" +
  "#panel .mbar-fill{height:100%;border-radius:3px;transition:width .3s}" +
  "#panel .mv{font-size:11px;color:#555;min-width:32px;text-align:right;flex-shrink:0}" +
  "#close{position:absolute;top:10px;right:12px;cursor:pointer;color:#999;font-size:18px;line-height:1;border:none;background:none;padding:0}" +
  "#mode{padding:5px 7px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;color:#222;cursor:pointer}" +
  "#fit{padding:5px 9px;border:1px solid #ddd;border-radius:6px;font-size:12px;background:#fff;color:#555;cursor:pointer;flex-shrink:0}" +
  "#leg{position:fixed;left:14px;bottom:40px;z-index:3;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:8px 12px;font-size:11px;color:#555;display:none}" +
  "#leg .lbar{width:150px;height:8px;border-radius:4px;background:linear-gradient(90deg,hsl(120,65%,46%),hsl(60,75%,50%),hsl(0,70%,52%));margin:5px 0 3px}" +
  "#keys{position:fixed;left:14px;bottom:12px;z-index:3;font:11px system-ui;color:#bbb;pointer-events:none;line-height:1}" +
  "@media(prefers-color-scheme:dark){" +
  "body{color:#ddd;background:#161616}" +
  "#bar,#panel,#leg{background:#1e1e1e;border-color:#333}" +
  "#q,#mode,#fit{background:#2a2a2a;border-color:#444;color:#ddd}" +
  "#panel .row:hover{background:#2a2a2a}#panel .sym{color:#bbb}#panel .meta{color:#aaa}" +
  "#panel .mbar-wrap{background:#333}#panel .mv{color:#aaa}#panel .k{color:#666}" +
  "#keys{color:#555}}";

const CLIENT =
  // ── Init ──────────────────────────────────────────────────────────────────
  "var c=document.getElementById('cv'),ctx=c.getContext('2d'),tip=document.getElementById('tip'),panel=document.getElementById('panel');" +
  "var PANELW=300,panelOpen=false;" +
  "var W,H;" +
  "function resize(){var r=devicePixelRatio||1;W=innerWidth||800;H=(innerHeight-48)||600;c.width=W*r;c.height=H*r;ctx.setTransform(r,0,0,r,0,0);}" +
  "addEventListener('resize',function(){resize();});resize();" +
  "function availW(){return W-(panelOpen?PANELW:0);}" +
  // ── Data setup ────────────────────────────────────────────────────────────
  "var nodes=DATA.nodes,links=DATA.links,byId={};" +
  "nodes.forEach(function(n){byId[n.id]=n;n.vx=0;n.vy=0;});" +
  "var deg={},out={},inn={};" +
  "links.forEach(function(l){deg[l.source]=(deg[l.source]||0)+1;deg[l.target]=(deg[l.target]||0)+1;" +
  "(out[l.source]=out[l.source]||[]).push(l.target);(inn[l.target]=inn[l.target]||[]).push(l.source);});" +
  "var sim=nodes.filter(function(n){return deg[n.id];}),orphans=nodes.filter(function(n){return !deg[n.id];});" +
  "sim.forEach(function(n){n.x=W/2+(Math.random()-0.5)*240;n.y=H/2+(Math.random()-0.5)*240;});" +
  "var groups={},gi=0;" +
  "function color(g){if(groups[g]==null)groups[g]=gi++;return 'hsl('+((groups[g]*67)%360)+',55%,52%)';}" +
  "function instColor(v){return 'hsl('+Math.round((1-v)*120)+',65%,'+Math.round(46+v*8)+'%)';}" +
  "var adj={};" +
  "links.forEach(function(l){(adj[l.source]=adj[l.source]||[]).push(l.target);(adj[l.target]=adj[l.target]||[]).push(l.source);});" +
  // ── State ─────────────────────────────────────────────────────────────────
  "var view={x:0,y:0,k:1},sel=null,hover=null,drag=null,pan=null,q='',autofit=true,mode='group',pinned=new Set();" +
  // ── Geometry ──────────────────────────────────────────────────────────────
  "function radius(n){return 4+Math.sqrt(n.symbols||0)*1.7;}" +
  // ── Simulation ────────────────────────────────────────────────────────────
  "function tick(){" +
  "if(!sim.length)return;" +
  "var k=0.0016;" +
  "for(var i=0;i<sim.length;i++){var a=sim[i];a.vx+=(W/2-a.x)*k;a.vy+=(H/2-a.y)*k;" +
  "for(var j=i+1;j<sim.length;j++){var b=sim[j];var dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy;" +
  "if(d2<100)d2=100;var d=Math.sqrt(d2),f=2200/d2,fx=f*dx/d,fy=f*dy/d;" +
  "a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}" +
  "links.forEach(function(l){var a=byId[l.source],b=byId[l.target];if(!a||!b)return;" +
  "var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-90)*0.02,fx=f*dx/d,fy=f*dy/d;" +
  "a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;});" +
  "for(var i=0;i<sim.length;i++){var n=sim[i];" +
  "if(n===drag||pinned.has(n.id))continue;" +
  "n.vx*=0.85;n.vy*=0.85;" +
  "if(n.vx>30)n.vx=30;if(n.vx<-30)n.vx=-30;if(n.vy>30)n.vy=30;if(n.vy<-30)n.vy=-30;" +
  "n.x+=n.vx;n.y+=n.vy;}}" +
  // ── Layout helpers ────────────────────────────────────────────────────────
  "function bb4(arr){var a=1e9,b=1e9,c2=-1e9,d2=-1e9;" +
  "for(var i=0;i<arr.length;i++){var n=arr[i];" +
  "if(n.x<a)a=n.x;if(n.y<b)b=n.y;if(n.x>c2)c2=n.x;if(n.y>d2)d2=n.y;}return[a,b,c2,d2];}" +
  "function layoutOrphans(){if(!orphans.length)return;" +
  "var bb=sim.length?bb4(sim):[W*0.3,H*0.3,W*0.7,H*0.5];" +
  "var left=bb[0],bottom=bb[3]+46,wide=Math.max(bb[2]-bb[0],260);" +
  "var cols=Math.max(1,Math.ceil(Math.sqrt(orphans.length*1.8))),gap=Math.max(22,wide/cols);" +
  "for(var i=0;i<orphans.length;i++){orphans[i].x=left+(i%cols)*gap;orphans[i].y=bottom+Math.floor(i/cols)*22;}}" +
  "function fitView(){var bb=bb4(nodes);var aw=availW();" +
  "var bw=Math.max(bb[2]-bb[0],1),bh=Math.max(bb[3]-bb[1],1);" +
  "var k=Math.min(aw/(bw+80),H/(bh+80));k=Math.max(0.12,Math.min(k,2.2));" +
  "view.k=k;view.x=aw/2-((bb[0]+bb[2])/2)*k;view.y=H/2-((bb[1]+bb[3])/2)*k;}" +
  "function center(n){view.k=Math.max(view.k,0.7);view.x=availW()/2-n.x*view.k;view.y=H/2-n.y*view.k;}" +
  // ── HTML helpers ──────────────────────────────────────────────────────────
  "function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');}" +
  "function rowList(ids){if(!ids||!ids.length)return '<div class=\"sym\" style=\"color:#aaa\">none</div>';" +
  "return ids.slice().sort().map(function(id){return '<div class=\"row\" data-id=\"'+esc(id)+'\">'+esc(id)+'</div>';}).join('');}" +
  "function mbar(val,max,col){var pct=max>0?Math.round(val*100/max):0;" +
  "return '<div class=\"mbar-row\"><div class=\"mbar-wrap\"><div class=\"mbar-fill\" style=\"width:'+pct+'%;background:'+col+'\"></div></div><span class=\"mv\">'+val+'</span></div>';}" +
  // ── Panel ─────────────────────────────────────────────────────────────────
  "function showPanel(n){sel=n;panelOpen=true;" +
  "var imp=out[n.id]||[],impBy=inn[n.id]||[];" +
  "var syms=(n.syms||[]).map(function(s){var i=s.indexOf(' ');" +
  "return '<div class=\"sym\"><span class=\"k\">'+esc(s.slice(0,i))+'</span> '+esc(s.slice(i+1))+'</div>';}).join('')||'<div class=\"sym\" style=\"color:#aaa\">none</div>';" +
  "var maxVal=0;nodes.forEach(function(x){if((x.ca||0)>maxVal)maxVal=x.ca;if((x.ce||0)>maxVal)maxVal=x.ce;});" +
  "var coupHtml='';" +
  "if(deg[n.id]){" +
  "var instPct=Math.round((n.inst||0)*100);" +
  "var iCol=(n.inst||0)>=0.8?'#e44':(n.inst||0)>=0.5?'#e80':'#4a4';" +
  "coupHtml='<h3>Coupling</h3>'+" +
  "'<div class=\"mbar-label\">Ca &middot; fan-in ('+( n.ca||0)+')</div>'+mbar(n.ca||0,maxVal,'#3a9')+" +
  "'<div class=\"mbar-label\">Ce &middot; fan-out ('+(n.ce||0)+')</div>'+mbar(n.ce||0,maxVal,'#55e')+" +
  "'<div class=\"mbar-label\">I &middot; instability '+instPct+'%</div>'+mbar(instPct,100,iCol);}" +
  "panel.innerHTML='<button id=\"close\">&times;</button>'+" +
  "'<h2>'+esc(n.id.split('/').pop())+'</h2>'+" +
  "'<div class=\"path\">'+esc(n.id)+'</div>'+" +
  "'<div class=\"meta\">'+esc(n.lang)+' &middot; '+(n.symbols||0)+' symbols'+(pinned.has(n.id)?' &middot; 📌 pinned':'')+'</div>'+" +
  "coupHtml+" +
  "'<h3>Imports ('+imp.length+')</h3>'+rowList(imp)+" +
  "'<h3>Imported by ('+impBy.length+')</h3>'+rowList(impBy)+" +
  "'<h3>Symbols</h3>'+syms;" +
  "panel.style.display='block';}" +
  "panel.addEventListener('click',function(e){" +
  "if(e.target.id==='close'){panelOpen=false;sel=null;panel.style.display='none';autofit=true;return;}" +
  "var id=e.target.getAttribute('data-id');if(id&&byId[id]){showPanel(byId[id]);center(byId[id]);}});" +
  // ── Draw ──────────────────────────────────────────────────────────────────
  "function draw(){" +
  "ctx.clearRect(0,0,W,H);" +
  "ctx.save();" +
  "ctx.translate(view.x,view.y);" +
  "ctx.scale(view.k,view.k);" +
  // Draw edges with arrowheads
  "links.forEach(function(l){" +
  "var a=byId[l.source],b=byId[l.target];if(!a||!b)return;" +
  "var onSel=sel&&(l.source===sel.id||l.target===sel.id);" +
  "var onHov=!onSel&&hover&&(l.source===hover.id||l.target===hover.id);" +
  "var edgeCol=onSel?'rgba(90,100,230,0.9)':onHov?'rgba(90,100,230,0.5)':'rgba(150,150,150,0.15)';" +
  "ctx.strokeStyle=edgeCol;ctx.fillStyle=edgeCol;" +
  "var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy);" +
  "if(d<4)return;" +
  "var rb=radius(b),ra=radius(a);" +
  "var ex=b.x-(dx/d)*(rb+1),ey=b.y-(dy/d)*(rb+1);" +
  "var sx=a.x+(dx/d)*(ra+1),sy=a.y+(dy/d)*(ra+1);" +
  "ctx.lineWidth=onSel?1.5:0.8;" +
  "ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();" +
  // arrowhead
  "if(d>rb+ra+12){" +
  "var hl=8,ang=Math.atan2(dy,dx);" +
  "ctx.beginPath();" +
  "ctx.moveTo(ex,ey);" +
  "ctx.lineTo(ex-hl*Math.cos(ang-0.42),ey-hl*Math.sin(ang-0.42));" +
  "ctx.lineTo(ex-hl*Math.cos(ang+0.42),ey-hl*Math.sin(ang+0.42));" +
  "ctx.closePath();ctx.fill();}" +
  "ctx.lineWidth=0.8;});" +
  // Draw nodes
  "function dot(n,orphan){" +
  "var dim=(sel&&n!==sel&&(adj[sel.id]||[]).indexOf(n.id)<0)||(q&&n.id.toLowerCase().indexOf(q)<0);" +
  "ctx.globalAlpha=dim?0.12:orphan?0.5:1;" +
  "var r=orphan?3.2:radius(n);" +
  // instability ring (group mode only, volatile nodes)
  "if(!orphan&&mode!=='inst'&&(n.inst||0)>=0.8&&deg[n.id]){" +
  "ctx.beginPath();ctx.arc(n.x,n.y,r+3.5,0,6.2832);" +
  "ctx.strokeStyle='rgba(220,55,55,0.6)';ctx.lineWidth=1.5;ctx.stroke();ctx.lineWidth=0.8;}" +
  // node circle
  "ctx.beginPath();ctx.arc(n.x,n.y,r,0,6.2832);" +
  "ctx.fillStyle=mode==='inst'?(deg[n.id]?instColor(n.inst):'#888'):color(n.group);" +
  "ctx.fill();" +
  // selected/hover ring
  "if(n===sel||n===hover){ctx.lineWidth=2;ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.stroke();ctx.lineWidth=0.8;}" +
  // pin dot
  "if(pinned.has(n.id)){" +
  "ctx.beginPath();ctx.arc(n.x,n.y-r-5,2.5,0,6.2832);" +
  "ctx.fillStyle='#e06';ctx.globalAlpha=dim?0.12:1;ctx.fill();}}" +
  "orphans.forEach(function(n){dot(n,true);});" +
  "sim.forEach(function(n){dot(n,false);});" +
  // Labels — zoom-adaptive
  "ctx.globalAlpha=1;" +
  "ctx.fillStyle=getComputedStyle(document.body).color;" +
  "ctx.font='11px system-ui';" +
  "sim.concat(orphans).forEach(function(n){" +
  "var r=deg[n.id]?radius(n):3.2;" +
  "var show=n===sel||n===hover||view.k>1.4||(view.k>0.7&&(n.symbols||0)>=8)||(n.symbols||0)>=14;" +
  "if(!show)return;" +
  "var dim=(sel&&n!==sel&&(adj[sel.id]||[]).indexOf(n.id)<0)||(q&&n.id.toLowerCase().indexOf(q)<0);" +
  "ctx.globalAlpha=dim?0.25:1;" +
  "ctx.fillText(n.id.split('/').pop(),n.x+r+3,n.y+4);});" +
  "ctx.globalAlpha=1;" +
  "ctx.restore();}" +
  // ── Loop ──────────────────────────────────────────────────────────────────
  "function loop(){" +
  "var w=innerWidth,hh=innerHeight-48;" +
  "if(w&&hh&&(w!==W||hh!==H))resize();" +
  "tick();tick();layoutOrphans();" +
  "if(autofit)fitView();" +
  "draw();" +
  "requestAnimationFrame(loop);}" +
  // ── Event helpers ─────────────────────────────────────────────────────────
  "function world(e){return{x:(e.clientX-view.x)/view.k,y:(e.clientY-48-view.y)/view.k};}" +
  "function pick(p){var all=sim.concat(orphans);" +
  "for(var i=all.length-1;i>=0;i--){var n=all[i];var r=(deg[n.id]?radius(n):3.2)+5;" +
  "if((p.x-n.x)*(p.x-n.x)+(p.y-n.y)*(p.y-n.y)<=r*r)return n;}return null;}" +
  // ── Mouse events ──────────────────────────────────────────────────────────
  "c.addEventListener('mousedown',function(e){" +
  "autofit=false;" +
  "var n=pick(world(e));" +
  "if(n){drag=n;showPanel(n);}else{pan={x:e.clientX-view.x,y:e.clientY-view.y};}});" +
  // double-click: toggle pin on node, reset view on canvas
  "c.addEventListener('dblclick',function(e){" +
  "var n=pick(world(e));" +
  "if(n){if(pinned.has(n.id))pinned.delete(n.id);else pinned.add(n.id);if(sel===n)showPanel(n);}" +
  "else{panelOpen=false;sel=null;panel.style.display='none';autofit=true;}});" +
  "addEventListener('mousemove',function(e){" +
  "var p=world(e);" +
  "if(drag){drag.x=p.x;drag.y=p.y;drag.vx=0;drag.vy=0;}" +
  "else if(pan){view.x=e.clientX-pan.x;view.y=e.clientY-pan.y;}" +
  "else{hover=pick(p);" +
  "if(hover){tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';" +
  "tip.innerHTML='<b>'+esc(hover.id)+'</b><br>'+(hover.symbols||0)+' symbols · '+esc(hover.lang)+" +
  "(deg[hover.id]?'<br>Ca '+( hover.ca||0)+' · Ce '+(hover.ce||0)+' · I '+(hover.inst||0):'<br>no in-scope deps')+" +
  "(pinned.has(hover.id)?'<br>📌 pinned':'');}" +
  "else tip.style.display='none';}});" +
  "addEventListener('mouseup',function(){drag=null;pan=null;});" +
  "c.addEventListener('wheel',function(e){" +
  "e.preventDefault();autofit=false;" +
  "var s=e.deltaY<0?1.11:0.9;" +
  "var mx=e.clientX,my=e.clientY-48;" +
  "view.x=mx-(mx-view.x)*s;view.y=my-(my-view.y)*s;view.k*=s;" +
  "},{passive:false});" +
  // ── Touch events (pinch-to-zoom) ──────────────────────────────────────────
  "var _pd=0;" +
  "c.addEventListener('touchstart',function(e){" +
  "e.preventDefault();autofit=false;" +
  "if(e.touches.length===1){var t=e.touches[0];" +
  "var n=pick(world({clientX:t.clientX,clientY:t.clientY}));" +
  "if(n){drag=n;showPanel(n);}else pan={x:t.clientX-view.x,y:t.clientY-view.y};}" +
  "else if(e.touches.length===2){drag=null;pan=null;" +
  "var dx=e.touches[1].clientX-e.touches[0].clientX,dy=e.touches[1].clientY-e.touches[0].clientY;" +
  "_pd=Math.sqrt(dx*dx+dy*dy);}},{passive:false});" +
  "c.addEventListener('touchmove',function(e){" +
  "e.preventDefault();" +
  "if(e.touches.length===1){var t=e.touches[0];" +
  "if(drag){var p=world({clientX:t.clientX,clientY:t.clientY});drag.x=p.x;drag.y=p.y;drag.vx=0;drag.vy=0;}" +
  "else if(pan){view.x=t.clientX-pan.x;view.y=t.clientY-pan.y;}}" +
  "else if(e.touches.length===2){" +
  "var dx=e.touches[1].clientX-e.touches[0].clientX,dy=e.touches[1].clientY-e.touches[0].clientY;" +
  "var d=Math.sqrt(dx*dx+dy*dy);" +
  "var s=_pd>0?d/_pd:1;" +
  "var cx=(e.touches[0].clientX+e.touches[1].clientX)/2;" +
  "var cy=(e.touches[0].clientY+e.touches[1].clientY)/2-48;" +
  "view.x=cx-(cx-view.x)*s;view.y=cy-(cy-view.y)*s;view.k*=s;_pd=d;}},{passive:false});" +
  "c.addEventListener('touchend',function(){drag=null;pan=null;});" +
  // ── Toolbar controls ──────────────────────────────────────────────────────
  "document.getElementById('q').addEventListener('input',function(e){q=e.target.value.toLowerCase();});" +
  "document.getElementById('mode').addEventListener('change',function(e){" +
  "mode=e.target.value;" +
  "document.getElementById('leg').style.display=mode==='inst'?'block':'none';});" +
  "document.getElementById('fit').addEventListener('click',function(){autofit=true;});" +
  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  "addEventListener('keydown',function(e){" +
  "var tag=e.target.tagName;" +
  "if(tag==='INPUT'||tag==='SELECT')return;" +
  "if(e.key==='Escape'){" +
  "if(sel){panelOpen=false;sel=null;panel.style.display='none';autofit=true;}" +
  "var qi=document.getElementById('q');if(qi.value){qi.value='';q='';qi.blur();}}" +
  "else if(e.key==='/'||e.key==='f'){e.preventDefault();document.getElementById('q').focus();}" +
  "else if(e.key==='F'||e.key==='Home'){autofit=true;}" +
  "else if(e.key==='d'){var x=document.getElementById('dbg');x.style.display=x.style.display==='none'?'block':'none';}" +
  "});" +
  // ── Start ─────────────────────────────────────────────────────────────────
  "loop();";

/** Build a self-contained, dependency-free HTML graph explorer. */
export function buildExplorerHtml(graph: SymbolGraph, root: string): string {
  const data = deriveFileGraph(graph);
  const dataJson = JSON.stringify(data);
  const title = root.split(/[\\/]/).filter(Boolean).pop() || "project";
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>AST-MCP — " + title + " graph</title><style>" + STYLE + "</style></head><body>" +
    "<div id=\"bar\"><h1>AST-MCP graph</h1>" +
    "<span class=\"muted\">" + data.nodes.length + " files \xb7 " + data.links.length + " edges</span>" +
    "<input id=\"q\" placeholder=\"filter (/)\"/>" +
    "<select id=\"mode\"><option value=\"group\">color: folder</option><option value=\"inst\">color: coupling</option></select>" +
    "<button id=\"fit\" title=\"fit view (F)\">&#8982; fit</button></div>" +
    "<canvas id=\"cv\"></canvas>" +
    "<div id=\"tip\"></div>" +
    "<div id=\"panel\"></div>" +
    "<div id=\"leg\"><b>Instability I = Ce∕(Ca+Ce)</b><div class=\"lbar\"></div>" +
    "<div style=\"display:flex;justify-content:space-between\"><span>0 – stable</span><span>1 – volatile</span></div></div>" +
    "<div id=\"keys\">esc·deselect   /·search   F·fit   dbl·pin</div>" +
    "<div id=\"dbg\" style=\"position:fixed;left:8px;bottom:8px;font:11px monospace;color:#e07;z-index:6;pointer-events:none;white-space:pre;display:none\"></div>" +
    "<script>var DATA=" + dataJson + ";<\/script><script>" + CLIENT + "<\/script></body></html>"
  );
}
