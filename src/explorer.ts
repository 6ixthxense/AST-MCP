import type { SymbolGraph, GraphSymbolNode, GraphFileNode } from "./graph.js";

interface ExNode { id: string; symbols: number; group: string; lang: string }
interface ExLink { source: string; target: string }

/** Derive a file-level dependency graph (nodes = files, edges = imports). */
function deriveFileGraph(graph: SymbolGraph): { nodes: ExNode[]; links: ExLink[] } {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes: ExNode[] = [];
  for (const n of graph.nodes) {
    if (n.nodeType !== "file") continue;
    const f = n as GraphFileNode;
    const parts = f.id.split("/");
    nodes.push({ id: f.id, symbols: f.symbolCount, group: parts.length > 1 ? parts[0] : "(root)", lang: f.language });
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
  "#bar{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;gap:12px;padding:0 14px;background:#fff;border-bottom:1px solid #e5e5e5;z-index:2;box-sizing:border-box}" +
  "#bar h1{font-size:14px;margin:0;font-weight:600}#bar .muted{color:#888;font-size:12px}" +
  "#q{flex:0 0 220px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px}" +
  "#cv{position:fixed;top:48px;left:0;right:0;bottom:0;display:block;cursor:grab}" +
  "#tip{position:fixed;pointer-events:none;background:#222;color:#fff;font-size:12px;padding:4px 8px;border-radius:5px;display:none;z-index:3}" +
  "@media(prefers-color-scheme:dark){body{color:#ddd;background:#161616}#bar{background:#1e1e1e;border-color:#333}#q{background:#2a2a2a;border-color:#444;color:#ddd}}";

const CLIENT =
  "var c=document.getElementById('cv'),ctx=c.getContext('2d'),tip=document.getElementById('tip');" +
  "var W,H;function resize(){var r=devicePixelRatio||1;W=c.clientWidth||innerWidth;H=c.clientHeight||(innerHeight-48);c.width=W*r;c.height=H*r;ctx.setTransform(r,0,0,r,0,0);}addEventListener('resize',resize);resize();" +
  "var nodes=DATA.nodes,links=DATA.links,byId={};nodes.forEach(function(n){n.x=W/2+(Math.random()-0.5)*Math.min(W||800,600);n.y=H/2+(Math.random()-0.5)*Math.min(H||600,500);n.vx=0;n.vy=0;byId[n.id]=n;});" +
  "var groups={},gi=0;function color(g){if(groups[g]==null)groups[g]=gi++;return 'hsl('+((groups[g]*67)%360)+',58%,55%)';}" +
  "var adj={};links.forEach(function(l){(adj[l.source]=adj[l.source]||[]).push(l.target);(adj[l.target]=adj[l.target]||[]).push(l.source);});" +
  "var view={x:0,y:0,k:1},sel=null,hover=null,drag=null,pan=null,q='',autofit=true,frame=0;" +
  "function radius(n){return 4+Math.sqrt(n.symbols||0)*1.7;}" +
  "function tick(){var k=0.0006;for(var i=0;i<nodes.length;i++){var a=nodes[i];a.vx+=(W/2-a.x)*k;a.vy+=(H/2-a.y)*k;for(var j=i+1;j<nodes.length;j++){var b=nodes[j];var dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+0.01,d=Math.sqrt(d2),f=2600/d2,fx=f*dx/d,fy=f*dy/d;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;}}" +
  "links.forEach(function(l){var a=byId[l.source],b=byId[l.target];if(!a||!b)return;var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-115)*0.012,fx=f*dx/d,fy=f*dy/d;a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy;});" +
  "for(var i=0;i<nodes.length;i++){var n=nodes[i];if(n===drag)continue;n.vx*=0.86;n.vy*=0.86;n.x+=n.vx;n.y+=n.vy;}}" +
  "function draw(){ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.k,view.k);ctx.lineWidth=0.7;" +
  "links.forEach(function(l){var a=byId[l.source],b=byId[l.target];if(!a||!b)return;var on=sel&&(l.source===sel.id||l.target===sel.id);ctx.strokeStyle=on?'rgba(110,110,240,0.85)':'rgba(140,140,140,0.16)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();});" +
  "nodes.forEach(function(n){var dim=(sel&&n!==sel&&(adj[sel.id]||[]).indexOf(n.id)<0)||(q&&n.id.toLowerCase().indexOf(q)<0);ctx.globalAlpha=dim?0.16:1;ctx.beginPath();ctx.arc(n.x,n.y,radius(n),0,6.2832);ctx.fillStyle=color(n.group);ctx.fill();if(n===sel||n===hover){ctx.lineWidth=2;ctx.strokeStyle='#111';ctx.stroke();ctx.lineWidth=0.7;}});" +
  "ctx.globalAlpha=1;ctx.fillStyle=getComputedStyle(document.body).color;ctx.font='11px system-ui';nodes.forEach(function(n){if(n===sel||n===hover||n.symbols>=14){ctx.fillText(n.id.split('/').pop(),n.x+radius(n)+3,n.y+3);}});ctx.restore();}" +
  "function fitView(){if(!nodes.length)return;var a=1e9,b=1e9,c2=-1e9,d2=-1e9;for(var i=0;i<nodes.length;i++){var n=nodes[i];if(n.x<a)a=n.x;if(n.y<b)b=n.y;if(n.x>c2)c2=n.x;if(n.y>d2)d2=n.y;}var bw=Math.max(c2-a,1),bh=Math.max(d2-b,1),k=Math.min(W/(bw+90),H/(bh+90));k=Math.max(0.12,Math.min(k,2.5));view.k=k;view.x=W/2-((a+c2)/2)*k;view.y=H/2-((b+d2)/2)*k;}function loop(){tick();tick();frame++;if(autofit)fitView();draw();requestAnimationFrame(loop);}" +
  "function world(e){return{x:(e.clientX-view.x)/view.k,y:(e.clientY-48-view.y)/view.k};}" +
  "function pick(p){for(var i=nodes.length-1;i>=0;i--){var n=nodes[i];if((p.x-n.x)*(p.x-n.x)+(p.y-n.y)*(p.y-n.y)<=radius(n)*radius(n)+12)return n;}return null;}" +
  "c.addEventListener('mousedown',function(e){autofit=false;var n=pick(world(e));if(n){drag=n;sel=n;}else{pan={x:e.clientX-view.x,y:e.clientY-view.y};sel=null;}});c.addEventListener('dblclick',function(){fitView();});" +
  "addEventListener('mousemove',function(e){var p=world(e);if(drag){drag.x=p.x;drag.y=p.y;drag.vx=0;drag.vy=0;}else if(pan){view.x=e.clientX-pan.x;view.y=e.clientY-pan.y;}else{hover=pick(p);if(hover){tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';tip.textContent=hover.id+'  ·  '+hover.symbols+' symbols  ·  '+hover.lang;}else tip.style.display='none';}});" +
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
    "<canvas id=\"cv\"></canvas><div id=\"tip\"></div>" +
    "<script>var DATA=" + dataJson + ";</script><script>" + CLIENT + "</script></body></html>"
  );
}
