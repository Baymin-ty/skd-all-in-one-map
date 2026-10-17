import { meters } from './measure'
import type { LngLat, UndergroundConnector, UndergroundEdge, UndergroundMap, UndergroundNode, UndergroundStreetViewPoint } from './types'

/** 编辑器直接操作持久化的节点与双向边，连接点可独立放置或显式绑定。 */
export type UgNode = UndergroundNode
export type UgEdge = UndergroundEdge
export type UgStreetViewPoint = UndergroundStreetViewPoint
export type UgEntrance = UndergroundConnector
export interface UndergroundGraph { nodes: UgNode[]; edges: UgEdge[]; entrances: UgEntrance[]; points: UgStreetViewPoint[] }

let seq = 0
export function ugId(prefix: string) { return `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}` }
/** RFC 4122 v4 GUID，用作街景图片 ID 和文件名。 */
export function guid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const roundPos = (p: LngLat): LngLat => [+p[0].toFixed(6), +p[1].toFixed(6)]

export function node(g: UndergroundGraph, id: string) { return g.nodes.find((n) => n.id === id) }
export function edgesOf(g: UndergroundGraph, id: string) { return g.edges.filter((e) => e.a === id || e.b === id) }
export function degree(g: UndergroundGraph, id: string) { return edgesOf(g, id).length }
const other = (e: UgEdge, id: string) => e.a === id ? e.b : e.a
const findEdge = (g: UndergroundGraph, a: string, b: string) => g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
const streetViewPoints = (g: UndergroundGraph) => g.points ?? (g.points = [])

export function addNode(g: UndergroundGraph, pos: LngLat, id = ugId('n')) {
  g.nodes.push({ id, pos: roundPos(pos) }); return id
}
/** 连接两个节点；同一节点或已相连时不重复添加。 */
export function connect(g: UndergroundGraph, a: string, b: string) {
  if (a === b || findEdge(g, a, b) || !node(g, a) || !node(g, b)) return null
  const id = ugId('e'); g.edges.push({ id, a, b }); return id
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

/** 在路段上插入一个节点，原边拆成两条双向边。 */
export function splitEdge(g: UndergroundGraph, edgeId: string, p: LngLat) {
  const index = g.edges.findIndex((e) => e.id === edgeId)
  const projected = projectOnEdge(g, edgeId, p)
  if (index < 0 || !projected) return null
  const e = g.edges[index]
  if (projected.t <= 0) return e.a
  if (projected.t >= 1) return e.b
  const mid = addNode(g, projected.pos)
  const { a, b } = e
  g.edges.splice(index, 1, { id: ugId('e'), a, b: mid }, { id: ugId('e'), a: mid, b })
  return mid
}

/** 计算街景点在路网上的位置。权重按 endpoint1、endpoint2 相加为 1。 */
export function streetViewPointPosition(g: UndergroundGraph, point: UgStreetViewPoint): LngLat | null {
  const a = node(g, point.endpointId1), b = node(g, point.endpointId2)
  if (!a || !b) return null
  return roundPos([
    a.pos[0] * point.endpointWeight1 + b.pos[0] * point.endpointWeight2,
    a.pos[1] * point.endpointWeight1 + b.pos[1] * point.endpointWeight2,
  ])
}

/** 在线段上创建街景点；只保存端点 ID、插值权重和随机 GUID 图片 ID，不把坐标作为事实来源。 */
export function createStreetViewPoint(g: UndergroundGraph, edgeId: string, p: LngLat) {
  const edge = g.edges.find((item) => item.id === edgeId)
  const projected = projectOnEdge(g, edgeId, p)
  if (!edge || !projected) return null
  const id = ugId('ug-point')
  const point: UgStreetViewPoint = {
    id,
    endpointId1: edge.a,
    endpointWeight1: +((1 - projected.t).toFixed(6)),
    endpointId2: edge.b,
    endpointWeight2: +(projected.t.toFixed(6)),
    imageId: guid(),
  }
  streetViewPoints(g).push(point)
  return point
}

/** 沿按顺序选中的节点连成折线，按总里程均匀计算街景点位置；不写入路网。 */
export function planStreetViewPathInterpolation(g: UndergroundGraph, nodeIds: string[], count: number): { points: UgStreetViewPoint[]; error?: string; meters?: number } {
  if (nodeIds.length < 2) return { points: [], error: '至少选择两个节点' }
  if (new Set(nodeIds).size !== nodeIds.length) return { points: [], error: '节点不能重复' }
  if (!Number.isInteger(count) || count < 1 || count > 50) return { points: [], error: '插值数量必须是 1–50 的整数' }
  const segments: { edge: UgEdge; length: number }[] = []
  for (let i = 1; i < nodeIds.length; i++) {
    const prev = node(g, nodeIds[i - 1]), current = node(g, nodeIds[i])
    const edge = findEdge(g, nodeIds[i - 1], nodeIds[i])
    if (!prev || !current) return { points: [], error: '选中的节点不存在' }
    if (!edge) return { points: [], error: `第 ${i} 个和第 ${i + 1} 个节点之间没有路段，请按道路顺序选择` }
    segments.push({ edge, length: meters(prev.pos, current.pos) })
  }
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  if (total < 1e-6) return { points: [], error: '折线长度为零，无法插值' }
  const points: UgStreetViewPoint[] = []
  for (let k = 1; k <= count; k++) {
    const target = (total * k) / (count + 1)
    let travelled = 0
    for (let i = 0; i < segments.length; i++) {
      const { edge, length } = segments[i]
      if (target <= travelled + length + 1e-9 || i === segments.length - 1) {
        const t = length > 0 ? Math.max(0, Math.min(1, (target - travelled) / length)) : 0
        const weight2 = +t.toFixed(6)
        points.push({
          id: ugId('ug-point'),
          endpointId1: edge.a,
          endpointWeight1: +(1 - weight2).toFixed(6),
          endpointId2: edge.b,
          endpointWeight2: weight2,
          imageId: guid(),
        })
        break
      }
      travelled += length
    }
  }
  return { points, meters: total }
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
  g.points = streetViewPoints(g).filter((point) => {
    if (point.endpointId1 === from) point.endpointId1 = into
    if (point.endpointId2 === from) point.endpointId2 = into
    return point.endpointId1 !== point.endpointId2
  })
  for (const e of g.entrances) if (e.node === from) e.node = into
  syncEntrances(g)
}

function dropOrphans(g: UndergroundGraph, ids: string[]) {
  for (const id of ids) if (!degree(g, id) && !streetViewPoints(g).some((p) => p.endpointId1 === id || p.endpointId2 === id)) {
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
  g.points = streetViewPoints(g).filter((point) => point.endpointId1 !== id && point.endpointId2 !== id)
  if (incident.length === 2 && neighbours[0] !== neighbours[1]) {
    connect(g, neighbours[0], neighbours[1])
  } else dropOrphans(g, neighbours)
  syncEntrances(g)
}

/** 删除路段，两端如果因此成了孤立点也一并删除。 */
export function removeEdge(g: UndergroundGraph, id: string) {
  const e = g.edges.find((item) => item.id === id); if (!e) return
  g.edges.splice(g.edges.indexOf(e), 1)
  g.points = streetViewPoints(g).filter((point) => !((point.endpointId1 === e.a && point.endpointId2 === e.b) || (point.endpointId1 === e.b && point.endpointId2 === e.a)))
  dropOrphans(g, [e.a, e.b])
  syncEntrances(g)
}

/** 已被分割的同一直线也算已导入，避免重复草稿生成跨越中间节点的捷径。 */
function coveredStraightPath(g: UndergroundGraph, a: string, b: string) {
  const start = node(g, a)!, end = node(g, b)!
  const dx = end.pos[0] - start.pos[0], dy = end.pos[1] - start.pos[1]
  const onSegment = (id: string) => {
    const p = node(g, id)!.pos
    const t = ((p[0] - start.pos[0]) * dx + (p[1] - start.pos[1]) * dy) / (dx * dx + dy * dy || 1)
    return t >= 0 && t <= 1 && meters(p, [start.pos[0] + dx * t, start.pos[1] + dy * t]) < 0.2
  }
  const seen = new Set([a]), pending = [a]
  while (pending.length) {
    const current = pending.pop()!
    if (current === b) return true
    for (const edge of edgesOf(g, current)) {
      const next = other(edge, current)
      if (!seen.has(next) && onSegment(next)) { seen.add(next); pending.push(next) }
    }
  }
  return false
}

function addPath(g: UndergroundGraph, path: LngLat[], nodeFor: (p: LngLat) => string) {
  let prev: string | null = null
  for (const point of path) {
    const id = nodeFor(point)
    if (prev && !coveredStraightPath(g, prev, id)) connect(g, prev, id)
    prev = id
  }
}

/** 直接载入持久化图，不按坐标推断绑定或合并不同 ID。 */
export function graphFromMap(map: UndergroundMap): UndergroundGraph {
  return {
    nodes: map.nodes.map(({ id, pos }) => ({ id, pos: [...pos] })),
    edges: map.edges.map(({ id, a, b }) => ({ id, a, b })),
    entrances: map.connectors.map((c) => ({ ...c, pos: [...c.pos] })),
    points: (map.points ?? []).map((point) => ({ ...point })),
  }
}

export function graphToMap(g: UndergroundGraph, base: UndergroundMap): UndergroundMap {
  return {
    version: 2, floor: base.floor, bounds: base.bounds, sources: base.sources,
    nodes: g.nodes.map(({ id, pos }) => ({ id, pos: roundPos(pos) })),
    edges: g.edges.map(({ id, a, b }) => ({ id, a, b })),
    points: (g.points ?? []).map((point) => ({ ...point })),
    connectors: g.entrances.map((c) => ({ ...c, pos: [...c.pos] })),
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
    if (e.node || (ids && !ids.includes(e.id))) continue
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
export function importSketch(g: UndergroundGraph, paths: LngLat[][], toleranceMeters = 4) {
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
  for (const path of paths) if (path.length >= 2) {
    const before = JSON.stringify(g)
    addPath(g, path, nodeFor)
    if (JSON.stringify(g) !== before) count++
  }
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
  /** 还没绑定到路网节点的出入口 id */
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
  const unboundEntrances = g.entrances.filter((c) => !(c.node && node(g, c.node))).map((c) => c.id)
  return { islands, looseEnds, unboundEntrances }
}

export function edgeMeters(g: UndergroundGraph, e: UgEdge) {
  const a = node(g, e.a), b = node(g, e.b)
  return a && b ? meters(a.pos, b.pos) : 0
}
