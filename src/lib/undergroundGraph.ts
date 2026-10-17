import { meters } from './measure'
import type { LngLat, UndergroundConnector, UndergroundMap, UndergroundMode, UndergroundNode, UndergroundRoad, UndergroundRoadPoint, UndergroundStatus } from './types'

/**
 * 后台标注用的地下路网：节点 + 路段 + 出入口。
 * 共享节点就是路口，拖一个点所有相连的路段一起动。保存时再拆回 roads/connectors，
 * 连续的二度节点合并成一条折线，路口处折线首尾坐标完全相同，重新载入时据此还原成同一个节点。
 * 出入口可以绑定到节点上：绑定后跟着节点走，保存时坐标与节点完全相同，载入时同样据此还原绑定。
 */
export type UgNode = UndergroundNode
export interface UgEdge {
  id: string
  a: string
  b: string
  status: UndergroundStatus
  mode: UndergroundMode
  source?: string
  note?: string
}
export type UgRoadPoint = UndergroundRoadPoint
/** node 是绑定的路网节点；只存在于编辑器里，保存时去掉 */
export type UgEntrance = UndergroundConnector & { node?: string }
export interface UndergroundGraph { nodes: UgNode[]; edges: UgEdge[]; entrances: UgEntrance[]; points: UgRoadPoint[] }
export type UgEdgeProps = Omit<UgEdge, 'id' | 'a' | 'b'>

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
const roadPoints = (g: UndergroundGraph) => g.points ?? (g.points = [])

export function addNode(g: UndergroundGraph, pos: LngLat, id = ugId('n')) {
  g.nodes.push({ id, pos: roundPos(pos) }); return id
}
/** 连接两个节点；同一节点或已相连时不重复添加。 */
export function connect(g: UndergroundGraph, a: string, b: string, props: UgEdgeProps) {
  if (a === b || findEdge(g, a, b) || !node(g, a) || !node(g, b)) return null
  const id = ugId('e'); g.edges.push({ id, a, b, ...props }); return id
}
export function moveNode(g: UndergroundGraph, id: string, pos: LngLat) {
  const n = node(g, id); if (n) n.pos = roundPos(pos)
  syncEntrances(g)
}

/** 绑定的出入口跟到节点的位置；节点没了就解除绑定，出入口留在原地。 */
export function syncEntrances(g: UndergroundGraph) {
  for (const e of g.entrances) {
    if (!e.node) continue
    const n = node(g, e.node)
    if (n) e.pos = [...n.pos]
    else delete e.node
  }
}
export function bindEntrance(g: UndergroundGraph, entranceId: string, nodeId: string) {
  const e = g.entrances.find((item) => item.id === entranceId)
  if (e && node(g, nodeId)) { e.node = nodeId; syncEntrances(g) }
}
export function unbindEntrance(g: UndergroundGraph, entranceId: string) {
  const e = g.entrances.find((item) => item.id === entranceId)
  if (e) delete e.node
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

/** 计算图片点在路网上的位置。权重按 endpoint1、endpoint2 相加为 1。 */
export function roadPointPosition(g: UndergroundGraph, point: UgRoadPoint): LngLat | null {
  const a = node(g, point.endpointId1), b = node(g, point.endpointId2)
  if (!a || !b) return null
  return roundPos([
    a.pos[0] * point.endpointWeight1 + b.pos[0] * point.endpointWeight2,
    a.pos[1] * point.endpointWeight1 + b.pos[1] * point.endpointWeight2,
  ])
}

/** 在线段上创建图片点；只保存端点 ID 和插值权重，不把坐标作为事实来源。 */
export function createRoadPoint(g: UndergroundGraph, edgeId: string, p: LngLat, imageId?: string) {
  const edge = g.edges.find((item) => item.id === edgeId)
  const projected = projectOnEdge(g, edgeId, p)
  if (!edge || !projected) return null
  const id = ugId('ug-point')
  const point: UgRoadPoint = {
    id,
    endpointId1: edge.a,
    endpointWeight1: +((1 - projected.t).toFixed(6)),
    endpointId2: edge.b,
    endpointWeight2: +(projected.t.toFixed(6)),
    imageId: imageId?.trim() || `image-${id}`,
  }
  roadPoints(g).push(point)
  return point
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
  g.points = roadPoints(g).filter((point) => {
    if (point.endpointId1 === from) point.endpointId1 = into
    if (point.endpointId2 === from) point.endpointId2 = into
    return point.endpointId1 !== point.endpointId2
  })
  for (const e of g.entrances) if (e.node === from) e.node = into
  syncEntrances(g)
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
  g.points = roadPoints(g).filter((point) => point.endpointId1 !== id && point.endpointId2 !== id)
  if (incident.length === 2 && neighbours[0] !== neighbours[1]) {
    const { id: _id, a: _a, b: _b, ...props } = incident[0]
    connect(g, neighbours[0], neighbours[1], props)
  } else dropOrphans(g, neighbours)
  syncEntrances(g)
}

/** 删除路段，两端如果因此成了孤立点也一并删除。 */
export function removeEdge(g: UndergroundGraph, id: string) {
  const e = g.edges.find((item) => item.id === id); if (!e) return
  g.edges.splice(g.edges.indexOf(e), 1)
  g.points = roadPoints(g).filter((point) => !((point.endpointId1 === e.a && point.endpointId2 === e.b) || (point.endpointId1 === e.b && point.endpointId2 === e.a)))
  dropOrphans(g, [e.a, e.b])
  syncEntrances(g)
}

function emptyGraph(entrances: UgEntrance[] = [], points: UgRoadPoint[] = []): UndergroundGraph {
  return { nodes: [], edges: [], entrances, points }
}

function addPath(g: UndergroundGraph, path: LngLat[], props: UgEdgeProps, nodeFor: (p: LngLat) => string) {
  let prev: string | null = null
  for (const point of path) {
    const id = nodeFor(point)
    if (prev) connect(g, prev, id, props)
    prev = id
  }
}

/** 从后台保存的地下地图还原路网：坐标完全相同的折点视为同一个节点，落在节点上的出入口视为已绑定。 */
export function graphFromMap(map: UndergroundMap): UndergroundGraph {
  const g = emptyGraph(map.connectors.map((c) => ({ ...c, pos: roundPos(c.pos) })), (map.points ?? []).map((point) => ({ ...point })))
  const byKey = new Map<string, string>()
  for (const n of map.nodes ?? []) {
    if (!byKey.has(key(n.pos))) { byKey.set(key(n.pos), n.id); g.nodes.push({ id: n.id, pos: roundPos(n.pos) }) }
  }
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
  for (const e of g.entrances) { const id = byKey.get(key(e.pos)); if (id) e.node = id }
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
  const pos = new Map(g.nodes.map((n) => [n.id, n.pos]))
  return {
    ...base, nodes: g.nodes.map((n) => ({ ...n, pos: roundPos(n.pos) })), points: (g.points ?? []).map((point) => ({ ...point })), roads: graphToRoads(g, base.floor),
    connectors: g.entrances.map(({ node: id, ...c }) => ({ ...c, pos: (id && pos.get(id)) || c.pos })),
  }
}

/** 离点最近、且在 maxMeters 以内的节点或路段 */
export function nearestOnNetwork(g: UndergroundGraph, p: LngLat, maxMeters: number) {
  let best: { node: string; meters: number } | { edge: string; meters: number } | null = null
  for (const n of g.nodes) {
    const d = meters(n.pos, p)
    if (d <= maxMeters && (!best || d < best.meters)) best = { node: n.id, meters: d }
  }
  if (best) return best
  for (const e of g.edges) {
    const d = projectOnEdge(g, e.id, p)?.meters ?? Infinity
    if (d <= maxMeters && (!best || d < best.meters)) best = { edge: e.id, meters: d }
  }
  return best
}

/** 把还没绑定的出入口接到 maxMeters 内最近的节点；附近只有路段时在路段上插点再绑定。返回绑上的个数。 */
export function autoBindEntrances(g: UndergroundGraph, maxMeters: number, ids?: string[]) {
  let count = 0
  for (const e of g.entrances) {
    if (e.node || e.status === 'rejected' || (ids && !ids.includes(e.id))) continue
    const hit = nearestOnNetwork(g, e.pos, maxMeters)
    const target = hit && ('node' in hit ? hit.node : splitEdge(g, hit.edge, e.pos))
    if (target) { e.node = target; count++ }
  }
  syncEntrances(g)
  return count
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
  /** 还没绑定到路网节点的出入口 id（已排除的不算） */
  unboundEntrances: string[]
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
  const unboundEntrances = g.entrances.filter((c) => c.status !== 'rejected' && !(c.node && node(g, c.node))).map((c) => c.id)
  return { islands, looseEnds, unboundEntrances }
}

export function edgeMeters(g: UndergroundGraph, e: UgEdge) {
  const a = node(g, e.a), b = node(g, e.b)
  return a && b ? meters(a.pos, b.pos) : 0
}
