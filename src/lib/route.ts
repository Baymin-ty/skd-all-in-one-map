import type { RouteEdgeStep } from './streetViewOrder'
import type { Campus, LngLat } from './types'
import { meters, polyDist } from './measure'

/**
 * 步行导航：在数据包的统一步行栅格（250×172 格，每格约 5.4 m）上跑 8 邻接 Dijkstra。
 * 构建阶段的手绘路和 OSM 补充路已经合并；运行时只关心「可走 / 不可走」，不再按来源改变路线。
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
  layer: RouteLayer
  /** 地下段经过的有向路网边序列（用于街景点排序）。 */
  edges?: RouteEdgeStep[]
}

export interface RouteResult {
  /** 首尾相接的路段。 */
  segments: RouteSegment[]
  meters: number
  minutes: number
  /** 地下段实际长度；纯地面路线为 0。 */
  undergroundMeters: number
  /** 进入地下、回到地面的顺序化提示点。 */
  transitions: RouteTransition[]
}

const WALK_SPEED = 75 // m/min

let W = 0
let H = 0
let g: Campus['grid']
let mx = 5.4
let my = 5.4
let walk = new Uint8Array(0) // 0 不能走，1 统一路网
// 搜索缓冲区按格子数复用，避免每次寻路重新分配
let dist = new Float64Array(0)
let prev = new Int32Array(0)
let done = new Uint8Array(0)
// 与 DIRS 同序的步长（Math.hypot 结果与旧实现逐位一致）
const STEP = new Float64Array(8)
/** 路线长度下界系数：实际（平滑后）长度 ≥ 系数 × 格网最短距离，见 routeLengthLowerBounds。 */
let lowerBoundFactor = 0

const cellOf = (p: LngLat) => [Math.floor((g.y0 - p[1]) / g.dy), Math.floor((p[0] - g.x0) / g.dx)] as const
export const posOf = (c: number): LngLat => [g.x0 + ((c % W) + 0.5) * g.dx, g.y0 - (Math.floor(c / W) + 0.5) * g.dy]
const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < H && j < W

export function initRouting(campus: Campus, extraWalkable: LngLat[] = []) {
  g = campus.grid
  H = g.rows.length
  W = g.rows[0].length
  mx = g.dx * 111320 * Math.cos((g.y0 * Math.PI) / 180)
  my = g.dy * 110574
  walk = new Uint8Array(W * H)
  dist = new Float64Array(W * H)
  prev = new Int32Array(W * H)
  done = new Uint8Array(W * H)
  DIRS.forEach(([di, dj], k) => (STEP[k] = Math.hypot(di * my, dj * mx)))
  // κ：meters() 按各点纬度取经度系数，格网按 y0 取；纬度绝对值越大系数越小，取网格内最小比值
  const rad = Math.PI / 180
  const kappa = Math.min(Math.cos(g.y0 * rad), Math.cos((g.y0 - H * g.dy) * rad)) / Math.cos(g.y0 * rad)
  // ρ：Bresenham 直线链（max(Δi,Δj) 步、min 个斜步）代价 / 欧氏距离的上界（Cauchy-Schwarz）
  const h = Math.hypot(mx, my)
  const rho = Math.max(Math.sqrt(1 + ((h - mx) / my) ** 2), Math.sqrt(1 + ((h - my) / mx) ** 2))
  lowerBoundFactor = (kappa / rho) * (1 - 1e-6)
  const extras = new Set<number>()
  for (const p of extraWalkable) {
    const [i, j] = cellOf(p)
    if (inGrid(i, j)) extras.add(i * W + j)
  }
  for (let i = 0; i < H; i++)
    for (let j = 0; j < W; j++) {
      const ch = g.rows[i][j]
      const c = i * W + j
      walk[c] = ch === '0' || ch === '2' || extras.has(c) ? 1 : 0
    }
}

/** 所有可走格子的中心坐标。 */
export function walkableCells() {
  const out: { pos: LngLat }[] = []
  for (let c = 0; c < walk.length; c++) if (walk[c]) out.push({ pos: posOf(c) })
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

/**
 * 二叉最小堆（类型化数组 + 空位下沉/上浮）。比较规则与旧版交换实现完全相同，
 * 因此任何操作序列下堆内布局、同键弹出顺序都与旧版一致。
 */
class Heap {
  k = new Float64Array(1024)
  v = new Int32Array(1024)
  size = 0
  clear() {
    this.size = 0
  }
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2)
      const v = new Int32Array(this.size * 2)
      k.set(this.k), v.set(this.v)
      this.k = k, this.v = v
    }
    const { k, v } = this
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p], v[i] = v[p]
      i = p
    }
    k[i] = key, v[i] = val
  }
  pop(): number {
    const { k, v } = this
    const top = v[0]
    const n = --this.size
    if (n > 0) {
      const key = k[n]
      const val = v[n]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        let mk = key
        if (l < n && k[l] < mk) (m = l), (mk = k[l])
        if (r < n && k[r] < mk) m = r
        if (m === i) break
        k[i] = k[m], v[i] = v[m]
        i = m
      }
      k[i] = key, v[i] = val
    }
    return top
  }
}
const heap = new Heap()

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

/**
 * 统一地面路网的实际八邻接边，不是道路中线，也不做寻路路径的平滑。
 * 每个无向方向只取正向，从连续可走格的起点遍历，恰好展示每条边一次。
 * 仅合并同方向连续边，保留各格中心；斜边与 DIRS 一致，不额外禁止切角。
 */
export function walkablePaths(): LngLat[][] {
  const paths: LngLat[][] = []
  for (const [di, dj] of DIRS) {
    if (di < 0 || (di === 0 && dj < 0)) continue
    for (let i = 0; i < H; i++)
      for (let j = 0; j < W; j++) {
        if (!walk[i * W + j]) continue
        // 有同方向前驱的格子由前驱所在的连续段负责，避免重复边。
        if (inGrid(i - di, j - dj) && walk[(i - di) * W + j - dj]) continue
        const path = [posOf(i * W + j)]
        for (let ni = i + di, nj = j + dj; inGrid(ni, nj) && walk[ni * W + nj]; ni += di, nj += dj)
          path.push(posOf(ni * W + nj))
        if (path.length > 1) paths.push(path)
      }
  }
  return paths
}

/**
 * 8 邻接 Dijkstra 主循环；onPop 返回 true 时停止。
 * 弹出/松弛顺序与旧实现逐步一致，所以同一起点集合在任一提前终止点之前的 dist/prev 完全相同；
 * 这正是「一次搜索服务多个终点」与逐个 findRoute 结果一致的依据。
 * 重复（过期）弹出直接跳过：旧实现对它们的松弛都不会成功，目标判定也已在首次弹出时做过。
 */
function dijkstra(starts: Iterable<number>, onPop: (u: number) => boolean) {
  dist.fill(Infinity)
  prev.fill(-1)
  done.fill(0)
  heap.clear()
  for (const s of starts) (dist[s] = 0), heap.push(0, s)
  while (heap.size) {
    const u = heap.pop()
    if (done[u]) continue
    done[u] = 1
    if (onPop(u)) return
    const ui = Math.floor(u / W)
    const uj = u % W
    for (let k = 0; k < 8; k++) {
      const i = ui + DIRS[k][0]
      const j = uj + DIRS[k][1]
      if (i < 0 || j < 0 || i >= H || j >= W) continue
      const v = i * W + j
      if (!walk[v]) continue
      const d = dist[u] + STEP[k]
      if (d < dist[v]) {
        dist[v] = d
        prev[v] = u
        heap.push(d, v)
      }
    }
  }
}

export function findRoute(from: Target, to: Target): RouteResult | null {
  if (!walk.length) return null
  const starts = anchors(from)
  const goals = anchors(to)
  if (!starts.size || !goals.size) return null
  let end = -1
  dijkstra(starts.keys(), (u) => goals.has(u) && ((end = u), true))
  return end < 0 ? null : buildRoute(end, starts, goals)
}

/**
 * 同一起点到多个终点：一次 Dijkstra，结果与逐个 findRoute(from, targets[k]) 完全相同。
 * 每个终点取其锚点格中最先弹出的那个（与单独搜索的提前终止点相同），全部命中即停止。
 */
export function findRoutesToMany(from: Target, targets: Target[]): (RouteResult | null)[] {
  const out: (RouteResult | null)[] = targets.map(() => null)
  if (!walk.length) return out
  const starts = anchors(from)
  if (!starts.size) return out
  const goalSets = targets.map(anchors)
  const byCell = new Map<number, number[]>()
  let pending = 0
  goalSets.forEach((goals, k) => {
    if (!goals.size) return
    pending++
    for (const c of goals.keys()) {
      const list = byCell.get(c)
      if (list) list.push(k)
      else byCell.set(c, [k])
    }
  })
  if (!pending) return out
  const ends = new Int32Array(targets.length).fill(-1)
  dijkstra(starts.keys(), (u) => {
    const list = byCell.get(u)
    if (list) for (const k of list) if (ends[k] < 0) (ends[k] = u), pending--
    return pending === 0
  })
  // 已弹出格子的 prev 不再变化，搜索结束后统一回溯即可
  for (let k = 0; k < targets.length; k++) if (ends[k] >= 0) out[k] = buildRoute(ends[k], starts, goalSets[k])
  return out
}

/**
 * 多个起点到同一终点的路线长度下界（米，未取整，对应 findRoute(sources[k], to) 各段长度之和）。
 * 只从终点锚点做一次反向多源 Dijkstra：步长只取决于 |Δi|、|Δj|，可走性按格子判定，图是无向的，
 * 所以反向距离就是起点格到终点锚点集的最短格网距离 D。
 * 但同代价路径的取舍取决于堆顺序和浮点累加顺序，反向搜索并不能复现正向的具体路径，故这里只给下界：
 * 平滑后每段都是 lineClear 的 Bresenham 链，链代价 ≤ ρ·格网欧氏距离 ≤ ρ/κ·meters，
 * 因此长度 ≥ 起点连线 + κ/ρ·D。返回 Infinity 当且仅当 findRoute 必然返回 null。
 */
export function routeLengthLowerBounds(sources: Target[], to: Target): number[] {
  const out = sources.map(() => Infinity)
  if (!walk.length) return out
  const goals = anchors(to)
  if (!goals.size) return out
  const startSets = sources.map(anchors)
  const need = new Set<number>()
  for (const starts of startSets) for (const c of starts.keys()) need.add(c)
  if (!need.size) return out
  let pending = need.size
  dijkstra(goals.keys(), (u) => need.has(u) && --pending === 0)
  startSets.forEach((starts, k) => {
    for (const [c, head] of starts) {
      if (!done[c]) continue // 搜索只在全部命中或堆空时结束，未弹出即不可达
      const lb = Math.max(0, ((head ? meters(head, posOf(c)) : 0) + lowerBoundFactor * dist[c]) * (1 - 1e-9) - 1e-6)
      if (lb < out[k]) out[k] = lb
    }
  })
  return out
}

/** 按 prev 回溯并生成与旧实现相同的路线（平滑、首尾锚点、长度）。 */
function buildRoute(end: number, starts: Map<number, LngLat | null>, goals: Map<number, LngLat | null>): RouteResult {
  const cells: number[] = []
  for (let c = end; c >= 0; c = prev[c]) cells.push(c)
  cells.reverse()

  const segments: RouteSegment[] = [{ path: smooth(cells).map(posOf), layer: 'surface' }]
  const head = starts.get(cells[0])
  const tail = goals.get(end)
  if (head) segments[0].path.unshift(head)
  if (tail) segments[segments.length - 1].path.push(tail)

  let total = 0
  for (const s of segments) {
    let m = 0
    for (let i = 1; i < s.path.length; i++) m += meters(s.path[i - 1], s.path[i])
    total += m
  }
  const result: RouteResult = {
    segments,
    meters: Math.round(total),
    minutes: Math.max(1, Math.round(total / WALK_SPEED)),
    undergroundMeters: 0,
    transitions: [],
  }
  return result
}

/** 去掉中间格子，只要两个保留点之间的直线还压在可走格子上。 */
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
  let [i0, j0] = [Math.floor(a / W), a % W]
  const [i1, j1] = [Math.floor(b / W), b % W]
  const di = Math.abs(i1 - i0)
  const dj = Math.abs(j1 - j0)
  const si = i0 < i1 ? 1 : -1
  const sj = j0 < j1 ? 1 : -1
  let err = dj - di
  for (;;) {
    const c = i0 * W + j0
    if (!walk[c]) return false
    if (i0 === i1 && j0 === j1) return true
    const e2 = 2 * err
    if (e2 > -di) (err -= di), (j0 += sj)
    if (e2 < dj) (err += dj), (i0 += si)
  }
}
