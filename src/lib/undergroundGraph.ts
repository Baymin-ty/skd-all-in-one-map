import { meters } from './measure'
import type { LngLat, UndergroundConnector, UndergroundMap, UndergroundMode, UndergroundRoad, UndergroundStatus } from './types'

/**
 * 后台标注用的地下路网：节点 + 路段 + 出入口。
 * 共享节点就是路口，拖一个点所有相连的路段一起动。保存时再拆回 roads/connectors，
 * 连续的二度节点合并成一条折线，路口处折线首尾坐标完全相同，重新载入时据此还原成同一个节点。
 */
export interface UgNode { id: string; pos: LngLat }
export interface UgEdge {
  id: string
  a: string
  b: string
  status: UndergroundStatus
  mode: UndergroundMode
  source?: string
  note?: string
}
export interface UndergroundGraph { nodes: UgNode[]; edges: UgEdge[]; entrances: UndergroundConnector[] }
export type UgEdgeProps = Omit<UgEdge, 'id' | 'a' | 'b'>

/** 出入口离最近路网节点超过这个距离时，地下寻路接不上（与 findUndergroundRoute 的吸附距离一致）。 */
export const ENTRANCE_REACH_METERS = 45

let seq = 0
export function ugId(prefix: string) { return `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}` }
export const roundPos = (p: LngLat): LngLat => [+p[0].toFixed(6), +p[1].toFixed(6)]
const key = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
const sameProps = (x: UgEdge, y: UgEdge) => x.status === y.status && x.mode === y.mode && x.source === y.source && x.note === y.note

export function node(g: UndergroundGraph, id: string) { return g.nodes.find((n) => n.id === id) }
export function edgesOf(g: UndergroundGraph, id: string) { return g.edges.filter((e) => e.a === id || e.b === id) }
export function degree(g: UndergroundGraph, id: string) { return edgesOf(g, id).length }
const other = (e: UgEdge, id: string) => e.a === id ? e.b : e.a
const findEdge = (g: UndergroundGraph, a: string, b: string) => g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))

export function addNode(g: UndergroundGraph, pos: LngLat) {
  const id = ugId('n'); g.nodes.push({ id, pos: roundPos(pos) }); return id
}
/** 连接两个节点；同一节点或已相连时不重复添加。 */
export function connect(g: UndergroundGraph, a: string, b: string, props: UgEdgeProps) {
  if (a === b || findEdge(g, a, b) || !node(g, a) || !node(g, b)) return null
  const id = ugId('e'); g.edges.push({ id, a, b, ...props }); return id
}
export function moveNode(g: UndergroundGraph, id: string, pos: LngLat) {
  const n = node(g, id); if (n) n.pos = roundPos(pos)
}

/** 把点投影到路段上，返回投影点和 0..1 的位置。 */
export function projectOnEdge(g: UndergroundGraph, edgeId: string, p: LngLat) {
  const e = g.edges.find((item) => item.id === edgeId)
  const a = e && node(g, e.a), b = e && node(g, e.b)
  if (!a || !b) return null
  const k = Math.cos((p[1] * Math.PI) / 180)
  const dx = (b.pos[0] - a.pos[0]) * k, dy = b.pos[1] - a.pos[1]
  const t = Math.max(0, Math.min(1, (((p[0] - a.pos[0]) * k) * dx + (p[1] - a.pos[1]) * dy) / (dx * dx + dy * dy || 1)))
  const pos: LngLat = roundPos([a.pos[0] + (b.pos[0] - a.pos[0]) * t, a.pos[1] + (b.pos[1] - a.pos[1]) * t])
  return { pos, t, meters: meters(p, pos) }
}

/** 在路段上插入一个节点，原路段拆成两段并保留属性。 */
export function splitEdge(g: UndergroundGraph, edgeId: string, p: LngLat) {
  const index = g.edges.findIndex((e) => e.id === edgeId)
  const projected = projectOnEdge(g, edgeId, p)
  if (index < 0 || !projected) return null
  const e = g.edges[index]
  if (projected.t <= 0) return e.a
  if (projected.t >= 1) return e.b
  const mid = addNode(g, projected.pos)
  const { id: _id, a, b, ...props } = e
  g.edges.splice(index, 1, { id: ugId('e'), a, b: mid, ...props }, { id: ugId('e'), a: mid, b, ...props })
  return mid
}

/** 把 from 节点并入 into 节点：from 的路段改接到 into，自环和重复路段去掉。 */
export function mergeNodes(g: UndergroundGraph, from: string, into: string) {
  if (from === into || !node(g, from) || !node(g, into)) return
  for (const e of edgesOf(g, from)) {
    const target = other(e, from)
    if (target === into || findEdge(g, into, target)) g.edges.splice(g.edges.indexOf(e), 1)
    else if (e.a === from) e.a = into
    else e.b = into
  }
  g.nodes.splice(g.nodes.findIndex((n) => n.id === from), 1)
}

function dropOrphans(g: UndergroundGraph, ids: string[]) {
  for (const id of ids) if (!degree(g, id)) {
    const index = g.nodes.findIndex((n) => n.id === id)
    if (index >= 0) g.nodes.splice(index, 1)
  }
}

/** 删除节点。路中间的点（恰好两条路段）删掉后两侧自动接上，路口则连同相连路段一起删除。 */
export function removeNode(g: UndergroundGraph, id: string) {
  const incident = edgesOf(g, id)
  const neighbours = incident.map((e) => other(e, id))
  g.edges = g.edges.filter((e) => !incident.includes(e))
  g.nodes = g.nodes.filter((n) => n.id !== id)
  if (incident.length === 2 && neighbours[0] !== neighbours[1]) {
    const { id: _id, a: _a, b: _b, ...props } = incident[0]
    connect(g, neighbours[0], neighbours[1], props)
  } else dropOrphans(g, neighbours)
}

/** 删除路段，两端如果因此成了孤立点也一并删除。 */
export function removeEdge(g: UndergroundGraph, id: string) {
  const e = g.edges.find((item) => item.id === id); if (!e) return
  g.edges.splice(g.edges.indexOf(e), 1)
  dropOrphans(g, [e.a, e.b])
}

function emptyGraph(entrances: UndergroundConnector[] = []): UndergroundGraph {
  return { nodes: [], edges: [], entrances }
}

function addPath(g: UndergroundGraph, path: LngLat[], props: UgEdgeProps, nodeFor: (p: LngLat) => string) {
  let prev: string | null = null
  for (const point of path) {
    const id = nodeFor(point)
    if (prev) connect(g, prev, id, props)
    prev = id
  }
}

/** 从后台保存的地下地图还原路网：坐标完全相同的折点视为同一个节点。 */
export function graphFromMap(map: UndergroundMap): UndergroundGraph {
  const g = emptyGraph(map.connectors.map((c) => ({ ...c, pos: roundPos(c.pos) })))
  const byKey = new Map<string, string>()
  const nodeFor = (p: LngLat) => {
    const k = key(p)
    let id = byKey.get(k)
    if (!id) { id = addNode(g, p); byKey.set(k, id) }
    return id
  }
  for (const road of map.roads) {
    addPath(g, road.path, {
      status: road.status, mode: road.mode,
      ...(road.source ? { source: road.source } : {}), ...(road.note ? { note: road.note } : {}),
    }, nodeFor)
  }
  return g
}

/** 断点：端点、路口，或者两侧路段属性不同的二度节点。 */
function isBreak(g: UndergroundGraph, id: string) {
  const incident = edgesOf(g, id)
  return incident.length !== 2 || !sameProps(incident[0], incident[1])
}

/** 路网拆回折线道路：断点之间的连续路段合并成一条，纯环路从任意点断开。 */
export function graphToRoads(g: UndergroundGraph, floor: number): UndergroundRoad[] {
  const pos = new Map(g.nodes.map((n) => [n.id, n.pos]))
  const visited = new Set<string>()
  const roads: UndergroundRoad[] = []
  const walk = (start: string, first: UgEdge) => {
    const ids = [start]
    let current = start, edge: UgEdge | undefined = first
    while (edge && !visited.has(edge.id)) {
      visited.add(edge.id)
      current = other(edge, current); ids.push(current)
      if (isBreak(g, current)) break
      edge = edgesOf(g, current).find((e) => !visited.has(e.id))
    }
    const { status, mode, source, note } = first
    roads.push({
      id: `ug-road-${first.id}`, floor, mode, direction: 'both', status,
      path: ids.map((id) => pos.get(id)!), ...(source ? { source } : {}), ...(note ? { note } : {}),
    })
  }
  for (const n of g.nodes) if (isBreak(g, n.id)) for (const e of edgesOf(g, n.id)) if (!visited.has(e.id)) walk(n.id, e)
  for (const e of g.edges) if (!visited.has(e.id)) walk(e.a, e)
  return roads
}

export function graphToMap(g: UndergroundGraph, base: UndergroundMap): UndergroundMap {
  return { ...base, roads: graphToRoads(g, base.floor), connectors: g.entrances.map((c) => ({ ...c })) }
}

/**
 * 导入前台手绘线段。手绘时点在已有点附近会差几米，按 toleranceMeters 合并成同一个节点；
 * 悬空的端点如果落在别的路段旁边，就在那条路段上插点接上，形成真正的路口。
 */
export function importSketch(g: UndergroundGraph, paths: LngLat[][], props: UgEdgeProps, toleranceMeters = 4) {
  const touched = new Set<string>()
  const nodeFor = (p: LngLat) => {
    let best: UgNode | undefined, bestDistance = toleranceMeters
    for (const n of g.nodes) {
      const d = meters(n.pos, p)
      if (d <= bestDistance) best = n, bestDistance = d
    }
    const id = best?.id ?? addNode(g, p)
    touched.add(id); return id
  }
  let count = 0
  for (const path of paths) if (path.length >= 2) { addPath(g, path, props, nodeFor); count++ }
  for (const id of touched) {
    if (degree(g, id) !== 1) continue
    const n = node(g, id)!
    let best: { edge: string; meters: number } | null = null
    for (const e of g.edges) {
      if (e.a === id || e.b === id) continue
      const projected = projectOnEdge(g, e.id, n.pos)
      if (projected && projected.meters <= toleranceMeters && (!best || projected.meters < best.meters)) best = { edge: e.id, meters: projected.meters }
    }
    if (best) { const joint = splitEdge(g, best.edge, n.pos); if (joint) mergeNodes(g, id, joint) }
  }
  return count
}

/** 连通片段：每个片段是一组节点 id，按大小从大到小。 */
export function components(g: UndergroundGraph) {
  const adjacency = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]))
  for (const e of g.edges) { adjacency.get(e.a)?.push(e.b); adjacency.get(e.b)?.push(e.a) }
  const seen = new Set<string>(), result: string[][] = []
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue
    const group: string[] = [], stack = [n.id]; seen.add(n.id)
    while (stack.length) {
      const id = stack.pop()!; group.push(id)
      for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) { seen.add(next); stack.push(next) }
    }
    result.push(group)
  }
  return result.sort((x, y) => y.length - x.length)
}

export interface UgIssues {
  /** 主路网之外的小片段（每项是片段里的节点 id） */
  islands: string[][]
  /** 悬空端点离别的路段/节点很近，可能是没接上 */
  looseEnds: string[]
  /** 离路网太远、寻路接不上的出入口 id */
  farEntrances: string[]
}

export function graphIssues(g: UndergroundGraph, looseMeters = 8): UgIssues {
  const islands = components(g).slice(1)
  const looseEnds = g.nodes.filter((n) => {
    if (degree(g, n.id) !== 1) return false
    // 自己所在的这一小段（含相邻点的路段）本来就挨着，不算没接上
    const neighbour = other(edgesOf(g, n.id)[0], n.id)
    const near = (id: string) => id === n.id || id === neighbour
    return g.edges.some((e) => !near(e.a) && !near(e.b) && (projectOnEdge(g, e.id, n.pos)?.meters ?? Infinity) <= looseMeters)
  }).map((n) => n.id)
  const farEntrances = g.entrances.filter((c) => c.status !== 'rejected'
    && !g.nodes.some((n) => meters(n.pos, c.pos) <= ENTRANCE_REACH_METERS)).map((c) => c.id)
  return { islands, looseEnds, farEntrances }
}

export function edgeMeters(g: UndergroundGraph, e: UgEdge) {
  const a = node(g, e.a), b = node(g, e.b)
  return a && b ? meters(a.pos, b.pos) : 0
}
