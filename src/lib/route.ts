import type { Campus, LngLat } from './types'
import { meters, polyDist } from './measure'

/**
 * 步行导航：在数据包的统一步行栅格（250×172 格，每格约 5.4 m）上跑 8 邻接 Dijkstra。
 * 构建阶段的手绘路和 OSM 补充路已经合并；运行时只关心「可走 / 不可走」，不再按来源改变路线。
 * 雨天模式下露天的格子更贵，路线主要绕向风雨长廊和地下；宿舍/食堂楼边只提供很小的挡雨收益。
 */
export interface Target {
  point: LngLat
  /** 楼的轮廓：走到轮廓边上就算到了 */
  poly?: LngLat[]
  /** 楼的出入口：有的话只走到入口 */
  entrances?: LngLat[]
}

export type RouteLayer = 'surface' | 'underground'
export type RouteTransitionKind = 'enter' | 'exit'
export interface RouteTransition {
  connectorId: string
  kind: RouteTransitionKind
  connectorKind: string
  pos: LngLat
  label: string
}
export interface RouteSegment {
  path: LngLat[]
  covered: boolean
  /** 建筑边缘的少量挡雨；它的雨天代价高于风雨长廊和地下。 */
  sheltered?: boolean
  layer: RouteLayer
}

export interface RouteResult {
  /** 首尾相接的路段，covered = 在风雨长廊或地下，sheltered = 建筑边缘的局部挡雨 */
  segments: RouteSegment[]
  meters: number
  coveredMeters: number
  minutes: number
  /** 地下段实际长度；纯地面路线为 0。 */
  undergroundMeters: number
  /** 进入地下、回到地面的顺序化提示点。 */
  transitions: RouteTransition[]
  /** 雨天比较路线时使用的代价，不等同于实际距离。 */
  routingCost: number
}

/** 露天路段在雨天的代价倍数：沿着长廊走时，愿意为每 2 m 长廊多绕 1 m 露天路 */
export const RAIN_PENALTY = 2
/** 宿舍/食堂楼边的局部挡雨只提供轻微收益，避免压过地下车库和风雨长廊。 */
export const SHELTER_PENALTY = 1.25
/** 连续十米以内的露天段允许直接走地面，只有超出的部分产生雨天代价。 */
export const SHORT_EXPOSURE_METERS = 10
/** 2.5D 手绘图里长廊顶棚画得比地面偏北，轮廓外这么多米内的格子也算在长廊下 */
const COVER_RADIUS = 6
/** 建筑边缘只有贴楼的一小圈算作轻微挡雨，学院建筑不会传入这类多边形。 */
const SHELTER_RADIUS = 3
const WALK_SPEED = 75 // m/min

let W = 0
let H = 0
let g: Campus['grid']
let mx = 5.4
let my = 5.4
let walk = new Uint8Array(0) // 0 不能走，1 统一路网
let covered = new Uint8Array(0)
let sheltered = new Uint8Array(0)

const cellOf = (p: LngLat) => [Math.floor((g.y0 - p[1]) / g.dy), Math.floor((p[0] - g.x0) / g.dx)] as const
export const posOf = (c: number): LngLat => [g.x0 + ((c % W) + 0.5) * g.dx, g.y0 - (Math.floor(c / W) + 0.5) * g.dy]
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < H && j < W

export function initRouting(campus: Campus, walkways: LngLat[][], shelterPolys: LngLat[][] = []) {
  g = campus.grid
  H = g.rows.length
  W = g.rows[0].length
  mx = g.dx * 111320 * Math.cos((g.y0 * Math.PI) / 180)
  my = g.dy * 110574
  walk = new Uint8Array(W * H)
  covered = new Uint8Array(W * H)
  sheltered = new Uint8Array(W * H)
  for (let i = 0; i < H; i++)
    for (let j = 0; j < W; j++) {
      const ch = g.rows[i][j]
      walk[i * W + j] = ch === '0' || ch === '2' ? 1 : 0
    }
  for (const poly of walkways) for (const c of cellsNear(poly, COVER_RADIUS)) covered[c] = 1
  for (const poly of shelterPolys) for (const c of cellsNear(poly, SHELTER_RADIUS)) sheltered[c] = 1
}

/** 所有可走格子，画路网用 */
export function walkableCells() {
  const out: { pos: LngLat; covered: boolean; sheltered: boolean }[] = []
  for (let c = 0; c < walk.length; c++) if (walk[c]) out.push({ pos: posOf(c), covered: !!covered[c], sheltered: !covered[c] && !!sheltered[c] })
  return out
}

/** 离多边形（含内部）radius 米内的可走格子 */
function cellsNear(poly: LngLat[], radius: number): number[] {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const [i0, j0] = cellOf([Math.min(...xs), Math.max(...ys)])
  const [i1, j1] = cellOf([Math.max(...xs), Math.min(...ys)])
  const pad = Math.ceil(radius / Math.min(mx, my)) + 1
  const out: number[] = []
  for (let i = i0 - pad; i <= i1 + pad; i++)
    for (let j = j0 - pad; j <= j1 + pad; j++) {
      const c = i * W + j
      if (inGrid(i, j) && walk[c] && polyDist(posOf(c), poly) <= radius) out.push(c)
    }
  return out
}

/** 离点最近的可走格子（一圈圈往外找） */
function snap(p: LngLat, maxR = 40): number {
  const [ci, cj] = cellOf(p)
  for (let r = 0; r <= maxR; r++) {
    let best = -1
    let bd = Infinity
    for (let di = -r; di <= r; di++)
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
        const i = ci + di
        const j = cj + dj
        if (!inGrid(i, j) || !walk[i * W + j]) continue
        const d = (di * my) ** 2 + (dj * mx) ** 2
        if (d < bd) (bd = d), (best = i * W + j)
      }
    if (best >= 0) return best
  }
  return -1
}

/** 起点/终点对应的格子 → 要额外连上的点（入口、地图上点的位置；楼的轮廓边不用连） */
function anchors(t: Target): Map<number, LngLat | null> {
  const m = new Map<number, LngLat | null>()
  if (t.entrances?.length) {
    for (const e of t.entrances) {
      const c = snap(e, 12)
      if (c >= 0 && !m.has(c)) m.set(c, e)
    }
  } else if (t.poly) {
    for (const c of cellsNear(t.poly, 14)) m.set(c, null)
    if (!m.size) for (const c of cellsNear(t.poly, 40)) m.set(c, null)
  }
  if (!m.size) {
    const c = snap(t.point)
    if (c >= 0) m.set(c, t.point)
  }
  return m
}

class Heap {
  k: number[] = []
  v: number[] = []
  push(key: number, val: number) {
    const { k, v } = this
    k.push(key), v.push(val)
    let i = k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]
      ;[v[p], v[i]] = [v[i], v[p]]
      i = p
    }
  }
  pop(): number {
    const { k, v } = this
    const top = v[0]
    const lk = k.pop()!
    const lv = v.pop()!
    if (k.length) {
      k[0] = lk
      v[0] = lv
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < k.length && k[l] < k[m]) m = l
        if (r < k.length && k[r] < k[m]) m = r
        if (m === i) break
        ;[k[m], k[i]] = [k[i], k[m]]
        ;[v[m], v[i]] = [v[i], v[m]]
        i = m
      }
    }
    return top
  }
  get size() {
    return this.k.length
  }
}

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

export function findRoute(from: Target, to: Target, rain = false): RouteResult | null {
  if (!walk.length) return null
  const starts = anchors(from)
  const goals = anchors(to)
  if (!starts.size || !goals.size) return null
  const dist = new Float64Array(W * H).fill(Infinity)
  const prev = new Int32Array(W * H).fill(-1)
  const heap = new Heap()
  for (const s of starts.keys()) (dist[s] = 0), heap.push(0, s)
  let end = -1
  while (heap.size) {
    const u = heap.pop()
    if (goals.has(u)) {
      end = u
      break
    }
    const ui = Math.floor(u / W)
    const uj = u % W
    for (const [di, dj] of DIRS) {
      const i = ui + di
      const j = uj + dj
      const v = i * W + j
      if (!inGrid(i, j) || !walk[v]) continue
      let step = Math.hypot(di * my, dj * mx)
      if (rain && !covered[v]) step *= sheltered[v] ? SHELTER_PENALTY : RAIN_PENALTY
      if (dist[u] + step < dist[v]) {
        dist[v] = dist[u] + step
        prev[v] = u
        heap.push(dist[v], v)
      }
    }
  }
  if (end < 0) return null
  const cells: number[] = []
  for (let c = end; c >= 0; c = prev[c]) cells.push(c)
  cells.reverse()

  // 按「在不在长廊下」切成几段，每段各自拉直，再首尾相接
  const segments: RouteResult['segments'] = []
  for (let a = 0; a < cells.length; ) {
    let b = a
    const segmentState = covered[cells[a]] ? 2 : sheltered[cells[a]] ? 1 : 0
    while (b + 1 < cells.length) {
      const nextState = covered[cells[b + 1]] ? 2 : sheltered[cells[b + 1]] ? 1 : 0
      if (nextState !== segmentState) break
      b++
    }
    const segmentCovered = segmentState === 2
    const segmentSheltered = segmentState === 1
    const path = smooth(cells.slice(a, b + 1)).map(posOf)
    if (b + 1 < cells.length) path.push(posOf(cells[b + 1]))
    segments.push({ path, covered: segmentCovered, sheltered: segmentSheltered, layer: 'surface' })
    a = b + 1
  }
  const head = starts.get(cells[0])
  const tail = goals.get(end)
  if (head) segments[0].path.unshift(head)
  if (tail) segments[segments.length - 1].path.push(tail)

  let total = 0
  let under = 0
  for (const s of segments) {
    let m = 0
    for (let i = 1; i < s.path.length; i++) m += meters(s.path[i - 1], s.path[i])
    total += m
    if (s.covered) under += m
  }
  const result: RouteResult = {
    segments,
    meters: Math.round(total),
    coveredMeters: Math.round(under),
    minutes: Math.max(1, Math.round(total / WALK_SPEED)),
    undergroundMeters: 0,
    transitions: [],
    routingCost: routeWeatherCost(segments),
  }
  return result
}

/** 计算路线在雨天的比较代价；短露天段只按实际距离，长露天段才加价。 */
export function routeWeatherCost(segments: Pick<RouteSegment, 'path' | 'covered' | 'sheltered' | 'layer'>[], shortExposureMeters = SHORT_EXPOSURE_METERS) {
  let cost = 0
  for (const segment of segments) {
    let length = 0
    for (let i = 1; i < segment.path.length; i++) length += meters(segment.path[i - 1], segment.path[i])
    if (segment.layer === 'underground' || segment.covered) cost += length
    else {
      const penalty = segment.sheltered ? SHELTER_PENALTY : RAIN_PENALTY
      cost += length + Math.max(0, length - shortExposureMeters) * (penalty - 1)
    }
  }
  return cost
}

/** 去掉中间格子，只要两个保留点之间的直线还压在同类（可走、同样有没有顶棚）的格子上 */
function smooth(cells: number[]) {
  if (cells.length < 3) return cells
  const out = [cells[0]]
  let a = 0
  for (let b = 2; b < cells.length; b++) {
    if (!lineClear(cells[a], cells[b])) {
      out.push(cells[b - 1])
      a = b - 1
    }
  }
  out.push(cells[cells.length - 1])
  return out
}

function lineClear(a: number, b: number) {
  const cov = covered[a]
  const shelter = !cov && sheltered[a]
  let [i0, j0] = [Math.floor(a / W), a % W]
  const [i1, j1] = [Math.floor(b / W), b % W]
  const di = Math.abs(i1 - i0)
  const dj = Math.abs(j1 - j0)
  const si = i0 < i1 ? 1 : -1
  const sj = j0 < j1 ? 1 : -1
  let err = dj - di
  for (;;) {
    const c = i0 * W + j0
    if (!walk[c] || covered[c] !== cov || (!cov && sheltered[c] !== shelter)) return false
    if (i0 === i1 && j0 === j1) return true
    const e2 = 2 * err
    if (e2 > -di) (err -= di), (j0 += sj)
    if (e2 < dj) (err += dj), (i0 += si)
  }
}
