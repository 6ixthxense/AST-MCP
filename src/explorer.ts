import type { SymbolGraph, GraphSymbolNode, GraphFileNode } from "./graph.js";

interface ExNode { id: string; symbols: number; group: string; lang: string; syms: string[] }
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
    nodes.push({ id: f.id, symbols: f.symbolCount, group: parts.length > 1 ? parts[0] : "(root)", lang: f.language, syms: fileSyms.get(f.id) ?? [] });
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
  return { nodes, links };
}

const STYLE =
  "body{margin:0;font-family:system-ui,sans-serif;color:#222;background:#fafafa}" +
  "#bar{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#fff;border-bottom:1px solid #e5e5e5;z-index:4;box-sizing:border-box}" +
  "#bar h1{font-size:14px;margin:0;font-weight:600}#bar .muted{color:#888;font-size:12px}" +
  "#q{flex:0 0 200px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px}" +
  "#cv{position:fixed;top:48px;left:0;right:0;bottom:0;display:block;cursor:grab}" +
  "#tip{position:fixed;pointer-events:none;background:#222;color:#fff;font-size:12px;padding:4px 8px;border-radius:5px;display:none;z-index:5}" +
  "#panel{position:fixed;top:48px;right:0;bottom:0;width:300px;background:#fff;border-left:1px solid #e5e5e5;z-index:3;overflow-y:auto;padding:14px 16px;box-sizing:border-box;display:none;font-size:13px}" +
  "#panel h2{font-size:14px;margin:0 0 2px;word-break:break-all}#panel .path{color:#888;font-size:11px;margin-bottom:10px;word-break:break-all}" +
  "#panel .meta{color:#555;margin-bottom:12px}#panel h3{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#999;margin:14px 0 6px}" +
  "#panel .row{padding:3px 6px;border-radius:5px;cursor:pointer;word-break:break-all;line-height:1.5}#panel .row:hover{background:#f0f0f0}" +
  "#panel .sym{color:#444;padding:2px 6px;word-break:break-all}#panel .k{color:#999;font-size:11px}" +
  "#close{position:absolute;top:10px;right:12px;cursor:pointer;color:#999;font-size:18px;line-height:1;border:none;background:none}" +
  "@media(prefers-color-scheme:dark){body{color:#ddd;background:#161616}#bar,#panel{background:#1e1e1e;border-color:#333}#q{background:#2a2a2a;border-color:#444;color:#ddd}#panel .row:hover{background:#2a2a2a}#panel .sym{color:#bbb}}";

const CLIENT =
  "var c=document.getElementById('cv'),ctx=c.getContext('2d'),tip=document.getElementById('tip'),panel=document.getElementById('panel');" +
  "var PANELW=300,panelOpen=false;" +
  "var W,H;function resize(){var r=devicePixelRatio||1;var b=c.getBoundingClientRect();W=Math.round(b.width)||c.clientWidth||innerWidth;H=Math.round(b.height)||c.clientHeight||(innerHeight-48);c.width=W*r;c.height=H*r;ctx.setTransform(r,0,0,r,0,0);}addEventListener('resize',function(){resize();});resize();" +
  "function availW(){return W-(panelOpen?PANELW:0);}" +
  "var nodes=DATA.nodes,links=DATA.links,byId={};nodes.forEach(function(n){byId[n.id]=n;n.vx=0;n.vy=0;});" +
  "var deg={},out={},inn={};links.forEach(function(l){deg[l.source]=(deg[l.source]||0)+1;deg[l.target]=(deg[l.target]||0)+1;(out[l.source]=out[l.source]||[]).push(l.target);(inn[l.target]=inn[l.target]||[]).push(l.source);});" +
  "var sim=nodes.filter(function(n){return deg[n.id];}),orphans=nodes.filter(function(n){return !deg[n.id];});" +
  "sim.forEach(function(n){n.x=W/2+(Math.random()-0.5)*240;n.y=H/2+(Math.random()-0.5)*240;});" +
  "var groups={},gi=0;function color(g){if(groups[g]==null)groups[g]=gi++;return 'hsl('+((groups[g]*67)%360)+',58%,55%)';}" +
  "var adj={};links.forEach(function(l){(adj[l.source]=adj[l.source]||[]).push(l.target);(adj[l.target]=adj[l.target]||[]).push(l.source);});" +
  "var view={x:0,y:0,k:1},sel=null,hover=null,drag=null,pan=null,q='',autofit=true;" +
  "function radius(n){return 4+Math.sqrt(n.symbols||0)*1.7;}" +
  "function tick(){if(!sim.length)return;var k=0.0016;for(var i=0;i<sim.length;i++){var a=sim[i];a.vx+=(W/2-a.x)*k;a.vy+=(H/2-a.y)*k;for(var j=i+1;j<sim.length;j++){var b=sim[j];var dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+0.01,d=Math.sqrt(d2),f=2200/d2,fx=f*dx/d,fy=f*dy/d;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}" +
  "links.forEach(function(l){var a=byId[l.source],b=byId[l.target];if(!a||!b)return;var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-90)*0.02,fx=f*dx/d,fy=f*dy/d;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;});" +
  "for(var i=0;i<sim.length;i++){var n=sim[i];if(n===drag)continue;n.vx*=0.85;n.vy*=0.85;n.x+=n.vx;n.y+=n.vy;}}" +
  "function bb4(arr){var a=1e9,b=1e9,c2=-1e9,d2=-1e9;for(var i=0;i<arr.length;i++){var n=arr[i];if(n.x<a)a=n.x;if(n.y<b)b=n.y;if(n.x>c2)c2=n.x;if(n.y>d2)d2=n.y;}return[a,b,c2,d2];}" +
  "function layoutOrphans(){if(!orphans.length)return;var bb=sim.length?bb4(sim):[W*0.3,H*0.3,W*0.7,H*0.5];var left=bb[0],bottom=bb[3]+46,wide=Math.max(bb[2]-bb[0],260);var cols=Math.max(1,Math.ceil(Math.sqrt(orphans.length*1.8)));var gap=Math.max(22,wide/cols);for(var i=0;i<orphans.length;i++){orphans[i].x=left+(i%cols)*gap;orphans[i].y=bottom+Math.floor(i/cols)*22;}}" +
  "function fitView(){var bb=bb4(nodes);var aw=availW();var bw=Math.max(bb[2]-bb[0],1),bh=Math.max(bb[3]-bb[1],1),k=Math.min(aw/(bw+70),H/(bh+70));k=Math.max(0.12,Math.min(k,2.2));view.k=k;view.x=aw/2-((bb[0]+bb[2])/2)*k;view.y=H/2-((bb[1]+bb[3])/2)*k;}" +
  "function center(n){view.k=Math.max(view.k,0.7);view.x=availW()/2-n.x*view.k;view.y=H/2-n.y*view.k;}" +
  "function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');}" +
  "function rowList(ids){if(!ids||!ids.length)return '<div class=\"sym\" style=\"color:#aaa\">none</div>';return ids.slice().sort().map(function(id){return '<div class=\"row\" data-id=\"'+esc(id)+'\">'+esc(id)+'</div>';}).join('');}" +
  "function showPanel(n){sel=n;panelOpen=true;var imp=out[n.id]||[],impBy=inn[n.id]||[];var syms=(n.syms||[]).map(function(s){var i=s.indexOf(' ');return '<div class=\"sym\"><span class=\"k\">'+esc(s.slice(0,i))+'</span> '+esc(s.slice(i+1))+'</div>';}).join('')||'<div class=\"sym\" style=\"color:#aaa\">none</div>';" +
  "panel.innerHTML='<button id=\"close\">&times;</button>'+'<h2>'+esc(n.id.split('/').pop())+'</h2><div class=\"path\">'+esc(n.id)+'</div>'+'<div class=\"meta\">'+esc(n.lang)+' &middot; '+(n.symbols||0)+' symbols'+(deg[n.id]?'':' &middot; no in-scope deps')+'</div>'+'<h3>Imports ('+imp.length+')</h3>'+rowList(imp)+'<h3>Imported by ('+impBy.length+')</h3>'+rowList(impBy)+'<h3>Symbols</h3>'+syms;" +
  "panel.style.display='block';}" +
  "panel.addEventListener('click',function(e){if(e.target.id==='close'){panelOpen=false;sel=null;panel.style.display='none';autofit=true;return;}var id=e.target.getAttribute('data-id');if(id&&byId[id]){showPanel(byId[id]);center(byId[id]);}});" +
  "function draw(){ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.k,view.k);ctx.lineWidth=0.8;" +
  "links.forEach(function(l){var a=byId[l.source],b=byId[l.target];if(!a||!b)return;var on=sel&&(l.source===sel.id||l.target===sel.id);ctx.strokeStyle=on?'rgba(110,110,240,0.9)':'rgba(150,150,150,0.18)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();});" +
  "function dot(n,orphan){var dim=(sel&&n!==sel&&(adj[sel.id]||[]).indexOf(n.id)<0)||(q&&n.id.toLowerCase().indexOf(q)<0);ctx.globalAlpha=dim?0.14:(orphan?0.55:1);ctx.beginPath();ctx.arc(n.x,n.y,orphan?3.2:radius(n),0,6.2832);ctx.fillStyle=color(n.group);ctx.fill();if(n===sel||n===hover){ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.lineWidth=0.8;}}" +
  "orphans.forEach(function(n){dot(n,true);});sim.forEach(function(n){dot(n,false);});" +
  "ctx.globalAlpha=1;ctx.fillStyle=getComputedStyle(document.body).color;ctx.font='11px system-ui';sim.forEach(function(n){if(n===sel||n===hover||n.symbols>=14){ctx.fillText(n.id.split('/').pop(),n.x+radius(n)+3,n.y+3);}});ctx.restore();}" +
  "function loop(){var bb=c.getBoundingClientRect();var w=Math.round(bb.width)||innerWidth,hh=Math.round(bb.height)||(innerHeight-48);if(w&&hh&&(w!==W||hh!==H))resize();tick();tick();layoutOrphans();if(autofit)fitView();draw();requestAnimationFrame(loop);}" +
  "function world(e){return{x:(e.clientX-view.x)/view.k,y:(e.clientY-48-view.y)/view.k};}" +
  "function pick(p){var all=sim.concat(orphans);for(var i=all.length-1;i>=0;i--){var n=all[i];var r=(deg[n.id]?radius(n):3.2)+5;if((p.x-n.x)*(p.x-n.x)+(p.y-n.y)*(p.y-n.y)<=r*r)return n;}return null;}" +
  "c.addEventListener('mousedown',function(e){autofit=false;var n=pick(world(e));if(n){drag=n;showPanel(n);}else{pan={x:e.clientX-view.x,y:e.clientY-view.y};}});" +
  "c.addEventListener('dblclick',function(){panelOpen=false;sel=null;panel.style.display='none';autofit=true;});" +
  "addEventListener('mousemove',function(e){var p=world(e);if(drag){drag.x=p.x;drag.y=p.y;drag.vx=0;drag.vy=0;}else if(pan){view.x=e.clientX-pan.x;view.y=e.clientY-pan.y;}else{hover=pick(p);if(hover){tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';tip.textContent=hover.id+'  ·  '+(hover.symbols||0)+' symbols  ·  '+hover.lang;}else tip.style.display='none';}});" +
  "addEventListener('mouseup',function(){drag=null;pan=null;});" +
  "c.addEventListener('wheel',function(e){e.preventDefault();autofit=false;var s=e.deltaY<0?1.1:0.9;var mx=e.clientX,my=e.clientY-48;view.x=mx-(mx-view.x)*s;view.y=my-(my-view.y)*s;view.k*=s;},{passive:false});" +
  "document.getElementById('q').addEventListener('input',function(e){q=e.target.value.toLowerCase();});loop();";

/** Build a self-contained, dependency-free HTML graph explorer. */
export function buildExplorerHtml(graph: SymbolGraph, root: string): string {
  const data = deriveFileGraph(graph);
  const dataJson = JSON.stringify(data);
  const title = root.split(/[\\/]/).filter(Boolean).pop() || "project";
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>AST-MCP — " + title + " graph</title><style>" + STYLE + "</style></head><body>" +
    "<div id=\"bar\"><h1>AST-MCP graph</h1><span class=\"muted\">" + data.nodes.length + " files · " + data.links.length + " edges · drag / scroll / click</span>" +
    "<input id=\"q\" placeholder=\"filter files…\" /></div>" +
    "<canvas id=\"cv\"></canvas><div id=\"tip\"></div><div id=\"panel\"></div>" +
    "<script>var DATA=" + dataJson + ";</script><script>" + CLIENT + "</script></body></html>"
  );
}
