// 优化前实现的原样副本，仅供等价性测试与基准对比使用，不要在业务代码中引用。
import type { RouteEdgeStep } from '../../src/lib/streetViewOrder'
import type { Campus, LngLat } from '../../src/lib/types'
import { meters, polyDist } from '../../src/lib/measure'

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

export function findRoute(from: Target, to: Target): RouteResult | null {
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
      const step = Math.hypot(di * my, dj * mx)
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
