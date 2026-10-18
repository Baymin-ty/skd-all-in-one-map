/**
 * 把地上格网路网 + B1 地下路网渲染成分层 3D 效果图。
 * 用法: node scripts/render-network-3d.mjs  → artifacts/campus-network-3d-layers.html / .png
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const campus = JSON.parse(readFileSync(resolve(root, 'public/data/campus.json'), 'utf8'))
const places = JSON.parse(readFileSync(resolve(root, 'public/data/places.json'), 'utf8'))
const ug = JSON.parse(readFileSync(resolve(root, 'public/data/underground.json'), 'utf8'))

// --- 地面路网：相邻可走格之间连线段 -----------------------------------------
const g = campus.grid, rows = g.rows, H = rows.length, W = rows[0].length
const posOf = (r, c) => [g.x0 + (c + 0.5) * g.dx, g.y0 - (r + 0.5) * g.dy]
const walk = (r, c) => r >= 0 && c >= 0 && r < H && c < W && rows[r][c] === '0'
const surface = []
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  if (!walk(r, c)) continue
  if (walk(r, c + 1)) surface.push([posOf(r, c), posOf(r, c + 1)])
  if (walk(r + 1, c)) surface.push([posOf(r, c), posOf(r + 1, c)])
  if (walk(r + 1, c + 1) && !walk(r, c + 1) && !walk(r + 1, c)) surface.push([posOf(r, c), posOf(r + 1, c + 1)])
  if (walk(r + 1, c - 1) && !walk(r, c - 1) && !walk(r + 1, c)) surface.push([posOf(r, c), posOf(r + 1, c - 1)])
}
// 把共线的小段合并成折线，减少绘制量
const nodeMap = new Map(ug.nodes.map((n) => [n.id, n.pos]))
const underground = ug.edges.map((e) => [nodeMap.get(e.a), nodeMap.get(e.b)]).filter((s) => s[0] && s[1])
const connectors = ug.connectors.map((c) => ({ kind: c.kind, pos: c.pos, note: c.note ?? '' }))
const buildings = places.buildings.filter((b) => Array.isArray(b.poly) && b.poly.length >= 3)
  .map((b) => ({ id: b.id, name: b.short?.zh ?? b.name?.zh ?? '', poly: b.poly, cat: b.cat }))

const data = {
  boundary: campus.boundary, construction: (campus.construction ?? []).map((c) => c.poly),
  ugBounds: ug.bounds, surface, underground, connectors, buildings,
  stats: { cells: rows.join('').split('0').length - 1, segments: surface.length, ugNodes: ug.nodes.length, ugEdges: underground.length, connectors: connectors.length,
    ramps: connectors.filter((c) => c.kind === 'ramp').length, stairs: connectors.filter((c) => c.kind === 'stairs').length, elevators: connectors.filter((c) => c.kind === 'elevator').length },
}

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>上科大 地上 + 地下路网 3D 总览</title>
<style>
html,body{margin:0;background:#05070d;overflow:hidden;font-family:"PingFang SC","Helvetica Neue",Inter,sans-serif}
canvas{display:block;cursor:grab}
#hint{position:fixed;right:28px;bottom:22px;color:#6b7a99;font-size:12px;letter-spacing:.08em;opacity:.75}
</style></head><body><canvas id="c"></canvas><div id="hint">拖动旋转 · 滚轮缩放 · 按 R 复位</div>
<script>
const DATA = ${JSON.stringify(data)};
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
let WIDTH, HEIGHT;
function fit(){ WIDTH = innerWidth; HEIGHT = innerHeight; canvas.width = WIDTH*DPR; canvas.height = HEIGHT*DPR; canvas.style.width = WIDTH+'px'; canvas.style.height = HEIGHT+'px'; }
fit();

// ---- 地理 → 米 ----
const allPts = [...DATA.boundary, ...DATA.ugBounds];
const cLng = (Math.min(...allPts.map(p=>p[0]))+Math.max(...allPts.map(p=>p[0])))/2;
const cLat = (Math.min(...allPts.map(p=>p[1]))+Math.max(...allPts.map(p=>p[1])))/2;
const KX = Math.cos(cLat*Math.PI/180)*111320, KY = 110540;
const M = (p)=>[(p[0]-cLng)*KX, -(p[1]-cLat)*KY]; // y 向南为正（屏幕坐标习惯）

const LAYER_GAP = 260;     // 地上/地下爆炸层间距（米）
const BUILDING_H = 22;

// ---- 相机 ----
const cam = { yaw: -0.38, pitch: 0.78, zoom: 1.0, panX: 60, panY: 0 };
const home = {...cam};
function project(x, y, z){
  // 绕 z 轴偏航
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const rx = x*cy - y*sy, ry = x*sy + y*cy;
  // 绕 x 轴俯仰（pitch=π/2 为纯俯视）
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const vy = ry*sp - z*cp;       // 屏幕上方向
  const depth = ry*cp + z*sp;    // 朝向相机的距离分量
  const F = 2600, D = 2300;
  const s = F/(D - depth) * cam.zoom * Math.min(WIDTH/1900, HEIGHT/1150);
  return [WIDTH/2 + rx*s + cam.panX, HEIGHT*0.47 + vy*s + cam.panY, s, depth];
}
const P = (p, z=0)=>{ const m=M(p); return project(m[0], m[1], z); };

function pathPoly(poly, z){ ctx.beginPath(); poly.forEach((p,i)=>{ const q=P(p,z); i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]); }); ctx.closePath(); }
function glowLine(segs, z, color, width, blur, alpha=1){
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a,b] of segs){ const pa=P(a,z), pb=P(b,z); ctx.moveTo(pa[0],pa[1]); ctx.lineTo(pb[0],pb[1]); }
  ctx.stroke(); ctx.restore();
}
const KIND = {
  ramp:     { color:'#ff9a3c', glow:'rgba(255,154,60,.9)',  label:'车行坡道 Ramp' },
  stairs:   { color:'#c8ff5a', glow:'rgba(200,255,90,.9)',  label:'楼梯 Stairs' },
  elevator: { color:'#fff1b8', glow:'rgba(255,241,184,.95)', label:'电梯 Elevator' },
};

function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  // 背景
  const bg = ctx.createRadialGradient(WIDTH*.5,HEIGHT*.45,80,WIDTH*.5,HEIGHT*.5,Math.max(WIDTH,HEIGHT)*.75);
  bg.addColorStop(0,'#101a2e'); bg.addColorStop(.55,'#070b14'); bg.addColorStop(1,'#020308');
  ctx.fillStyle = bg; ctx.fillRect(0,0,WIDTH,HEIGHT);
  // 远处星点/颗粒
  ctx.save(); ctx.globalAlpha=.35; ctx.fillStyle='#8ea2c9';
  let seed=7; const rnd=()=> (seed=(seed*16807)%2147483647)/2147483647;
  for(let i=0;i<260;i++){ ctx.globalAlpha=.08+rnd()*.3; ctx.fillRect(rnd()*WIDTH, rnd()*HEIGHT, 1.2, 1.2); } ctx.restore();

  const zUG = -LAYER_GAP, zS = 0;

  // ===== B1 层 =====
  // 底板（比边界外扩）
  const ugRect = [[DATA.ugBounds[0][0],DATA.ugBounds[0][1]],[DATA.ugBounds[1][0],DATA.ugBounds[0][1]],[DATA.ugBounds[1][0],DATA.ugBounds[1][1]],[DATA.ugBounds[0][0],DATA.ugBounds[1][1]]];
  ctx.save();
  pathPoly(DATA.boundary, zUG - 14); ctx.fillStyle='rgba(60,20,110,.22)'; ctx.fill();            // 底板厚度阴影
  pathPoly(DATA.boundary, zUG); ctx.fillStyle='rgba(72,34,138,.30)'; ctx.fill();
  ctx.strokeStyle='rgba(190,120,255,.55)'; ctx.lineWidth=1.6; ctx.shadowColor='rgba(190,120,255,.8)'; ctx.shadowBlur=18; ctx.stroke();
  // 侧面厚度
  for(let i=0;i<DATA.boundary.length;i++){
    const a=DATA.boundary[i], b=DATA.boundary[(i+1)%DATA.boundary.length];
    const a0=P(a,zUG), b0=P(b,zUG), a1=P(a,zUG-14), b1=P(b,zUG-14);
    ctx.beginPath(); ctx.moveTo(a0[0],a0[1]); ctx.lineTo(b0[0],b0[1]); ctx.lineTo(b1[0],b1[1]); ctx.lineTo(a1[0],a1[1]); ctx.closePath();
    ctx.fillStyle='rgba(120,70,200,.18)'; ctx.shadowBlur=0; ctx.fill();
  }
  ctx.restore();
  // B1 底板网格纹理
  ctx.save(); pathPoly(DATA.boundary, zUG); ctx.clip();
  ctx.strokeStyle='rgba(170,120,255,.12)'; ctx.lineWidth=.6;
  for(let x=-700;x<=700;x+=40){ const a=project(x,-500,zUG), b=project(x,500,zUG); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); }
  for(let y=-500;y<=500;y+=40){ const a=project(-700,y,zUG), b=project(700,y,zUG); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); }
  ctx.restore();
  // B1 车库范围
  ctx.save(); pathPoly(ugRect, zUG+0.5); ctx.setLineDash([8,6]); ctx.strokeStyle='rgba(255,120,255,.35)'; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
  // B1 路网
  glowLine(DATA.underground, zUG, 'rgba(255,80,220,.55)', 9, 30);
  glowLine(DATA.underground, zUG, '#ff5fe0', 3.2, 14);
  glowLine(DATA.underground, zUG, '#ffd6fb', 1.1, 0);
  // 地面路网在 B1 的投影（淡）
  glowLine(DATA.surface, zUG, 'rgba(90,200,255,.08)', 1.2, 0);

  // ===== 连接光柱（下半段，先画，透过地面玻璃可见）=====
  const sorted = [...DATA.connectors].sort((a,b)=>P(a.pos)[3]-P(b.pos)[3]);
  for(const c of sorted){
    const k = KIND[c.kind]||KIND.elevator;
    const bot=P(c.pos,zUG), top=P(c.pos,zS);
    // 底部落点光环
    ctx.save(); ctx.shadowColor=k.glow; ctx.shadowBlur=24; ctx.strokeStyle=k.color; ctx.lineWidth=1.6;
    ellipse(bot[0],bot[1],13*bot[2]*1.1, 13*bot[2]*1.1*Math.cos(cam.pitch)); ctx.stroke();
    ctx.fillStyle=k.color; ctx.beginPath(); ctx.arc(bot[0],bot[1],3.2,0,7); ctx.fill(); ctx.restore();
    // 光柱
    const grad = ctx.createLinearGradient(bot[0],bot[1],top[0],top[1]);
    grad.addColorStop(0,k.glow); grad.addColorStop(.5,k.color); grad.addColorStop(1,k.glow);
    ctx.save(); ctx.shadowColor=k.glow; ctx.shadowBlur=26; ctx.strokeStyle=grad; ctx.lineCap='round';
    ctx.globalAlpha=.55; ctx.lineWidth=7; ctx.beginPath(); ctx.moveTo(bot[0],bot[1]); ctx.lineTo(top[0],top[1]); ctx.stroke();
    ctx.globalAlpha=1; ctx.lineWidth=2.2; ctx.shadowBlur=10; ctx.stroke();
    ctx.strokeStyle='#fff'; ctx.lineWidth=.8; ctx.shadowBlur=0; ctx.globalAlpha=.9; ctx.stroke();
    // 光柱上的小刻度（楼层感）
    ctx.globalAlpha=.8; ctx.fillStyle='#fff';
    for(let t=.15;t<1;t+=.17){ const x=bot[0]+(top[0]-bot[0])*t, y=bot[1]+(top[1]-bot[1])*t; ctx.beginPath(); ctx.arc(x,y,1.3,0,7); ctx.fill(); }
    ctx.restore();
  }

  // ===== 地面层玻璃板 =====
  ctx.save();
  pathPoly(DATA.boundary, zS);
  const gl = ctx.createLinearGradient(0,HEIGHT*.15,0,HEIGHT*.85);
  gl.addColorStop(0,'rgba(30,80,140,.20)'); gl.addColorStop(1,'rgba(14,40,90,.26)');
  ctx.fillStyle=gl; ctx.fill();
  ctx.strokeStyle='rgba(120,220,255,.9)'; ctx.lineWidth=1.8; ctx.shadowColor='rgba(80,200,255,.9)'; ctx.shadowBlur=22; ctx.stroke();
  ctx.restore();
  // 在建区域
  ctx.save(); for(const poly of DATA.construction){ pathPoly(poly, zS+0.2); ctx.setLineDash([5,4]); ctx.strokeStyle='rgba(255,210,120,.45)'; ctx.lineWidth=1; ctx.stroke(); ctx.fillStyle='rgba(255,200,100,.06)'; ctx.fill(); } ctx.restore();

  // ===== 地面路网 =====
  glowLine(DATA.surface, zS, 'rgba(40,170,255,.45)', 6, 22);
  glowLine(DATA.surface, zS, '#39c6ff', 2.2, 8);
  glowLine(DATA.surface, zS, '#dff7ff', .8, 0, .95);

  // ===== 建筑体块（按深度从远到近）=====
  const bl = DATA.buildings.map(b=>{ const cx=b.poly.reduce((s,p)=>s+p[0],0)/b.poly.length, cy=b.poly.reduce((s,p)=>s+p[1],0)/b.poly.length; return {...b, depth:P([cx,cy])[3]}; }).sort((a,b)=>a.depth-b.depth);
  for(const b of bl){
    const h = BUILDING_H * (0.7 + ((hash(b.id)%100)/100)*0.9);
    // 侧面
    for(let i=0;i<b.poly.length;i++){
      const a=b.poly[i], c=b.poly[(i+1)%b.poly.length];
      const a0=P(a,zS), c0=P(c,zS), a1=P(a,zS+h), c1=P(c,zS+h);
      // 背面剔除：只画法线朝向屏幕的侧面（用屏幕空间叉积判断）
      const cross=(c0[0]-a0[0])*(a1[1]-a0[1])-(c0[1]-a0[1])*(a1[0]-a0[0]);
      if(cross<=0) continue;
      ctx.beginPath(); ctx.moveTo(a0[0],a0[1]); ctx.lineTo(c0[0],c0[1]); ctx.lineTo(c1[0],c1[1]); ctx.lineTo(a1[0],a1[1]); ctx.closePath();
      const dx=c0[0]-a0[0], dy=c0[1]-a0[1], ang=Math.abs(Math.atan2(dy,dx));
      const shade = 0.55 + 0.45*Math.abs(Math.cos(ang));
      ctx.fillStyle=\`rgba(\${Math.round(40*shade+20)},\${Math.round(70*shade+30)},\${Math.round(120*shade+40)},.78)\`; ctx.fill();
      ctx.strokeStyle='rgba(150,220,255,.25)'; ctx.lineWidth=.5; ctx.stroke();
    }
    // 顶面
    pathPoly(b.poly, zS+h); ctx.fillStyle='rgba(90,140,200,.45)'; ctx.fill();
    ctx.strokeStyle='rgba(170,235,255,.6)'; ctx.lineWidth=.8; ctx.stroke();
    // 顶面窗光点缀
    const top=P(b.poly[0],zS+h);
  }

  // 玻璃之上再补一层光柱，保证穿层可见
  for(const c of sorted){ const k=KIND[c.kind]||KIND.elevator; const bot=P(c.pos,zUG), top=P(c.pos,zS);
    ctx.save(); ctx.globalAlpha=.45; ctx.strokeStyle=k.color; ctx.shadowColor=k.glow; ctx.shadowBlur=14; ctx.lineWidth=1.6; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(bot[0],bot[1]); ctx.lineTo(top[0],top[1]); ctx.stroke(); ctx.restore(); }
  // ===== 连接点顶部标记（穿出玻璃）=====
  for(const c of sorted){
    const k = KIND[c.kind]||KIND.elevator; const top=P(c.pos,zS);
    ctx.save(); ctx.shadowColor=k.glow; ctx.shadowBlur=30;
    ctx.strokeStyle=k.color; ctx.lineWidth=2;
    ellipse(top[0],top[1],16*top[2]*1.1, 16*top[2]*1.1*Math.cos(cam.pitch)); ctx.stroke();
    ctx.globalAlpha=.5; ctx.lineWidth=1; ellipse(top[0],top[1],28*top[2]*1.1, 28*top[2]*1.1*Math.cos(cam.pitch)); ctx.stroke();
    ctx.globalAlpha=1; ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(top[0],top[1],4,0,7); ctx.fill();
    ctx.fillStyle=k.color; ctx.beginPath(); ctx.arc(top[0],top[1],2.2,0,7); ctx.fill();
    // 上方短柱 + 图标
    const up=P(c.pos,zS+34);
    ctx.strokeStyle=k.color; ctx.lineWidth=1.2; ctx.shadowBlur=12; ctx.beginPath(); ctx.moveTo(top[0],top[1]); ctx.lineTo(up[0],up[1]); ctx.stroke();
    ctx.fillStyle=k.color; ctx.shadowBlur=18;
    if(c.kind==='ramp'){ ctx.beginPath(); ctx.moveTo(up[0]-6,up[1]+4); ctx.lineTo(up[0]+6,up[1]+4); ctx.lineTo(up[0]+6,up[1]-5); ctx.closePath(); ctx.fill(); }
    else if(c.kind==='stairs'){ for(let s=0;s<3;s++){ ctx.fillRect(up[0]-6+s*4, up[1]+3-s*3.5, 4, 2.2); } }
    else { ctx.fillRect(up[0]-4.5,up[1]-6,9,10); ctx.fillStyle='#1a2340'; ctx.fillRect(up[0]-.6,up[1]-4.5,1.2,7); }
    ctx.restore();
  }

  // ===== 层标签 =====
  const west = DATA.boundary.reduce((a,p)=>p[0]<a[0]?p:a); const lblS = P(west, zS), lblU = P(west, zUG);
  layerTag(lblS[0]-30, lblS[1], 'L0  地面路网 · Surface', '#39c6ff');
  layerTag(lblU[0]-30, lblU[1], 'B1  地下路网 · Underground', '#ff5fe0');

  // ===== 标题 / 图例 =====
  ctx.save();
  ctx.fillStyle='#eaf4ff'; ctx.font='600 34px "PingFang SC","Helvetica Neue",sans-serif'; ctx.fillText('上海科技大学 · 地上 + 地下路网 3D 总览', 48, 72);
  ctx.fillStyle='#7f93b8'; ctx.font='500 15px Inter,"Helvetica Neue",sans-serif'; ctx.letterSpacing='0.22em';
  ctx.fillText('SHANGHAITECH CAMPUS  ·  SURFACE L0 + UNDERGROUND B1  ·  EXPLODED LAYER VIEW', 50, 100); ctx.letterSpacing='0';
  ctx.restore();

  // 图例面板
  const s=DATA.stats; const px=48, py=HEIGHT-262, pw=430, ph=214;
  ctx.save(); roundRect(px,py,pw,ph,14); ctx.fillStyle='rgba(8,14,28,.72)'; ctx.fill(); ctx.strokeStyle='rgba(120,160,220,.25)'; ctx.lineWidth=1; ctx.stroke();
  ctx.fillStyle='#9fb3d6'; ctx.font='600 12px Inter,sans-serif'; ctx.letterSpacing='0.2em'; ctx.fillText('NETWORK LAYERS  图层与连接', px+22, py+30); ctx.letterSpacing='0';
  legendLine(px+22, py+58, '#39c6ff', \`地面路网 L0 · \${s.cells.toLocaleString()} 可走格 / \${s.segments.toLocaleString()} 段\`);
  legendLine(px+22, py+86, '#ff5fe0', \`地下路网 B1 · \${s.ugNodes} 节点 / \${s.ugEdges} 边\`);
  ctx.fillStyle='#9fb3d6'; ctx.font='600 12px Inter,sans-serif'; ctx.letterSpacing='0.2em'; ctx.fillText(\`VERTICAL LINKS  上下连接 ×\${s.connectors}\`, px+22, py+122); ctx.letterSpacing='0';
  legendDot(px+22, py+150, KIND.ramp.color, \`\${KIND.ramp.label} ×\${s.ramps}\`);
  legendDot(px+22, py+176, KIND.stairs.color, \`\${KIND.stairs.label} ×\${s.stairs}\`);
  legendDot(px+22, py+202, KIND.elevator.color, \`\${KIND.elevator.label} ×\${s.elevators}\`);
  ctx.restore();

  ctx.save(); ctx.fillStyle='#55627f'; ctx.font='12px Inter,sans-serif'; ctx.textAlign='right';
  ctx.fillText('数据：public/data/campus.json · underground.json · places.json   层间距为示意，非真实埋深', WIDTH-30, HEIGHT-54); ctx.restore();
}
function ellipse(x,y,rx,ry){ ctx.beginPath(); ctx.ellipse(x,y,Math.max(rx,.1),Math.max(Math.abs(ry),.1),0,0,7); }
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function legendLine(x,y,color,text){ ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=3; ctx.shadowColor=color; ctx.shadowBlur=10; ctx.beginPath(); ctx.moveTo(x,y-4); ctx.lineTo(x+34,y-4); ctx.stroke(); ctx.restore(); ctx.fillStyle='#dbe6f7'; ctx.font='14px "PingFang SC",Inter,sans-serif'; ctx.fillText(text, x+48, y); }
function legendDot(x,y,color,text){ ctx.save(); ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=12; ctx.beginPath(); ctx.arc(x+17,y-5,5,0,7); ctx.fill(); ctx.restore(); ctx.fillStyle='#dbe6f7'; ctx.font='14px "PingFang SC",Inter,sans-serif'; ctx.fillText(text, x+48, y); }
function layerTag(x,y,text,color){ ctx.save(); ctx.font='600 13px "PingFang SC",Inter,sans-serif'; const w=ctx.measureText(text).width+26; roundRect(x-w,y-14,w,26,6); ctx.fillStyle='rgba(6,10,22,.8)'; ctx.fill(); ctx.strokeStyle=color; ctx.lineWidth=1; ctx.shadowColor=color; ctx.shadowBlur=10; ctx.stroke(); ctx.shadowBlur=0; ctx.fillStyle=color; ctx.fillText(text, x-w+13, y+4); ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+40,y); ctx.stroke(); ctx.restore(); }
function hash(s){ let h=0; for(const ch of s) h=(h*31+ch.charCodeAt(0))>>>0; return h; }

// 交互
let drag=null;
canvas.addEventListener('mousedown',e=>{drag=[e.clientX,e.clientY]; canvas.style.cursor='grabbing';});
addEventListener('mouseup',()=>{drag=null; canvas.style.cursor='grab';});
addEventListener('mousemove',e=>{ if(!drag) return; cam.yaw+=(e.clientX-drag[0])*.005; cam.pitch=Math.max(.25,Math.min(1.5,cam.pitch+(e.clientY-drag[1])*.004)); drag=[e.clientX,e.clientY]; requestAnimationFrame(render); });
addEventListener('wheel',e=>{ cam.zoom=Math.max(.4,Math.min(3,cam.zoom*(e.deltaY>0?.92:1.08))); render(); },{passive:true});
addEventListener('keydown',e=>{ if(e.key==='r'||e.key==='R'){ Object.assign(cam,home); render(); } });
addEventListener('resize',()=>{fit();render();});
render();
</script></body></html>`

mkdirSync(resolve(root, 'artifacts'), { recursive: true })
const out = resolve(root, 'artifacts/campus-network-3d-layers.html')
writeFileSync(out, html)
console.log('wrote', out, JSON.stringify(data.stats))

if (!process.argv.includes('--no-png')) {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const png = resolve(root, 'artifacts/campus-network-3d-layers.png')
  execFileSync(chrome, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=2560,1600', `--screenshot=${png}`, '--virtual-time-budget=3000', `file://${out}`], { stdio: 'inherit' })
  console.log('wrote', png)
}
