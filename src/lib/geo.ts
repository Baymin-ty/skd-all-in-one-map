import L from 'leaflet'
import type { LngLat } from './types'

// 百度墨卡托：旧校园地图瓦片用的投影。系数是公开常数，见 datapack/reference/projection.md
const LLBAND = [75, 60, 45, 30, 15, 0]
const LL2MC = [
  [-0.0015702102444, 111320.7020616939, 1704480524535203, -10338987376042340, 26112667856603880, -35149669176653700, 26595700718403920, -10725012454188240, 1800819912950474, 82.5],
  [0.0008277824516172526, 111320.7020463578, 647795574.6671607, -4082003173.641316, 10774905663.51142, -15171875531.51559, 12053065338.62167, -5124939663.577472, 913311935.9512032, 67.5],
  [0.00337398766765, 111320.7020202162, 4481351.045890365, -23393751.19931662, 79682215.47186455, -115964993.2797253, 97236711.15602145, -43661946.33752821, 8477230.501135234, 52.5],
  [0.00220636496208, 111320.7020209128, 51751.86112841131, 3796837.749470245, 992013.7397791013, -1221952.21711287, 1340652.697009075, -620943.6990984312, 144416.9293806241, 37.5],
  [-0.0003441963504368392, 111320.7020576856, 278.2353980772752, 2485758.690035394, 6070.750963243378, 54821.18345352118, 9540.606633304236, -2710.55326746645, 1405.483844121726, 22.5],
  [-0.0003218135878613132, 111320.7020701615, 0.00369383431289, 823725.6402795718, 0.46104986909093, 2351.343141331292, 1.58060784298199, 8.77738589078284, 0.37238884252424, 7.45],
]
const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0]
const MC2LL = [
  [1.410526172116255e-8, 0.00000898305509648872, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 17337981.2],
  [-7.435856389565537e-9, 0.000008983055097726239, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 10260144.86],
  [-3.030883460898826e-8, 0.00000898305509983578, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6856817.37],
  [-1.981981304930552e-8, 0.000008983055099779535, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4482777.06],
  [3.09191371068437e-9, 0.000008983055096812155, 0.00006995724062, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2555164.4],
  [2.890871144776878e-9, 0.000008983055095805407, -3.068298e-8, 7.47137025468032, -0.00000353937994, -0.02145144861037, -0.00001234426596, 0.00010322952773, -0.00000323890364, 826088.5],
]

function conv(x: number, y: number, f: number[]): [number, number] {
  const xx = f[0] + f[1] * Math.abs(x)
  const c = Math.abs(y) / f[9]
  let yy = 0
  for (let k = 0; k < 7; k++) yy += f[2 + k] * c ** k
  return [Math.sign(x) * xx, Math.sign(y) * yy]
}
export function bdToMc(lng: number, lat: number): [number, number] {
  return conv(lng, lat, LL2MC[LLBAND.findIndex((b) => Math.abs(lat) >= b)])
}
export function mcToBd(x: number, y: number): [number, number] {
  return conv(x, y, MC2LL[MCBAND.findIndex((b) => Math.abs(y) >= b)])
}

// z18 时 1 像素 = 1 米，y 向北增大
export const BaiduCRS: L.CRS = L.extend({}, L.CRS.Earth, {
  code: 'BAIDU',
  projection: {
    project: (ll: L.LatLng) => L.point(...bdToMc(ll.lng, ll.lat)),
    unproject: (p: L.Point) => {
      const [lng, lat] = mcToBd(p.x, p.y)
      return L.latLng(lat, lng)
    },
    bounds: L.bounds([-20037726.37, -12474104.17], [20037726.37, 12474104.17]),
  },
  transformation: new L.Transformation(1, 0, -1, 0),
  scale: (z: number) => Math.pow(2, z - 18),
  zoom: (s: number) => Math.log(s) / Math.LN2 + 18,
  infinite: true,
})

/** 本地瓦片，百度编号：y 要写成 -y-1 */
export function baiduTiles(opts: L.TileLayerOptions) {
  const Layer = L.TileLayer.extend({
    getTileUrl: (c: L.Coords) => `/tiles/${c.z}/tile${c.x}_${-c.y - 1}.png`,
  })
  return new (Layer as unknown as new (url: string, o: L.TileLayerOptions) => L.TileLayer)('', opts)
}

/** 手绘底图画出来的范围（八边形），拖动不超过它的外接矩形 */
export const PAINTED_OUTLINE: LngLat[] = [
  [121.605279, 31.187255], [121.608333, 31.184629], [121.608333, 31.181787], [121.605063, 31.178976],
  [121.597849, 31.178976], [121.594616, 31.181756], [121.594616, 31.184598], [121.597706, 31.187255],
]

export const toLatLng = (p: LngLat) => L.latLng(p[1], p[0])
export const fromLatLng = (ll: L.LatLng): LngLat => [+ll.lng.toFixed(6), +ll.lat.toFixed(6)]

// ---------- 拖动 / 缩放范围（移植自 skdmap 的 geo.ts） ----------

/** 屏幕坐标（y 向下）里，点 p 是否在顺时针的凸多边形 outline 内 */
export const inOutline = (p: L.Point, outline: L.Point[]) =>
  outline.every((a, i) => {
    const e = outline[(i + 1) % outline.length]
    return (e.x - a.x) * (p.y - a.y) - (e.y - a.y) * (p.x - a.x) >= 0
  })

/**
 * 离 c 最近的地图中心（世界像素），使没被侧栏/面板挡住的那块视野（半宽 hw、半高 hh，中心偏离地图中心 d）
 * 只看到 outline 里面的画：四边不出界，四角最多伸进斜边外 40% 的较短半边（落在画的淡出边缘里）。
 * 视野比 outline 还宽/高时就居中。
 */
export function clampToOutline(c: L.Point, outline: L.Point[], hw: number, hh: number, d = L.point(0, 0)): L.Point {
  const xs = outline.map((q) => q.x)
  const ys = outline.map((q) => q.y)
  const lo = L.point(Math.min(...xs) + hw - d.x, Math.min(...ys) + hh - d.y)
  const hi = L.point(Math.max(...xs) - hw - d.x, Math.max(...ys) - hh - d.y)
  const inRange = (v: number, a: number, b: number) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)))
  let x = inRange(c.x, lo.x, hi.x)
  let y = inRange(c.y, lo.y, hi.y)
  if (lo.x > hi.x || lo.y > hi.y) return L.point(x, y)
  const inset = 0.4 * Math.min(hw, hh)
  for (let round = 0; round < 6; round++) {
    // 把（内缩后的）视野角推回每条斜边内侧，交替投影几轮
    let moved = false
    outline.forEach((a, i) => {
      const e = outline[(i + 1) % outline.length]
      const len = Math.hypot(e.x - a.x, e.y - a.y)
      const nx = (e.y - a.y) / len
      const ny = (a.x - e.x) / len
      if (Math.abs(nx) < 1e-6 || Math.abs(ny) < 1e-6) return
      const over = nx * (x + d.x) + ny * (y + d.y) + Math.abs(nx) * (hw - inset) + Math.abs(ny) * (hh - inset) - (nx * a.x + ny * a.y)
      if (over <= 0.5) return
      x = inRange(x - nx * over, lo.x, hi.x)
      y = inRange(y - ny * over, lo.y, hi.y)
      moved = true
    })
    if (!moved) break
  }
  return L.point(x, y)
}

/**
 * 让地图停在 clamp 允许的位置。Leaflet 的 maxBounds 只能是经纬度矩形，而手绘图是八边形、面板占的是像素，
 * 所以保留 Leaflet 自己的检查（每次移动/缩放结束、拖动惯性、键盘）但改问 clamp（Leaflet 1.9 的三个私有钩子），
 * 拖到边上直接停住而不是弹回。返回「立刻挪回范围内」，面板高度等 clamp 依赖的东西变了时调用。
 */
export function limitPan(map: L.Map, clamp: (c: L.Point, zoom: number) => L.Point) {
  type LimitCenter = (center: L.LatLng, zoom: number, bounds?: L.LatLngBounds) => L.LatLng
  type LimitOffset = (offset: L.Point, bounds?: L.LatLngBounds) => L.Point
  const m = map as unknown as { _limitCenter: LimitCenter; _limitOffset: LimitOffset }
  m._limitCenter = (center, zoom, bounds) => {
    if (!bounds) return center
    const p = map.project(center, zoom)
    const q = clamp(p, zoom)
    return p.distanceTo(q) < 1 ? center : map.unproject(q, zoom)
  }
  m._limitOffset = (offset, bounds) => {
    if (!bounds) return offset
    const p = map.project(map.getCenter(), map.getZoom())
    return clamp(p.add(offset), map.getZoom()).subtract(p).round()
  }
  const drag = (map.dragging as unknown as { _draggable: L.Draggable & { _newPos: L.Point } })._draggable
  drag.on('predrag', () => {
    const mid = map.getPixelOrigin().add(map.getSize().divideBy(2))
    drag._newPos = mid.subtract(clamp(mid.subtract(drag._newPos), map.getZoom()))
  })
  let moving = false
  map.on('movestart', () => (moving = true))
  map.on('moveend', () => (moving = false))
  map.setMaxBounds(L.latLngBounds(PAINTED_OUTLINE.map(toLatLng))) // 打开 Leaflet 的检查；真正的范围是 clamp
  return () => {
    if (!moving) map.panInsideBounds(map.options.maxBounds!)
  }
}

/** box 差不多铺满 size 像素视野的最小缩放级别：只用整数级；slack 越大越倾向放大一级（0.2 约超出 15%，0.7 约超出 60%） */
export function fillZoom(map: L.Map, box: L.LatLngBounds, size: L.Point, min = 15, max = 18, slack = 0.2) {
  const nw = map.project(box.getNorthWest(), 17)
  const se = map.project(box.getSouthEast(), 17)
  const z = 17 + Math.log2(Math.min(size.x / (se.x - nw.x), size.y / (se.y - nw.y)))
  return Math.min(max, Math.max(min, Math.floor(z + slack)))
}
