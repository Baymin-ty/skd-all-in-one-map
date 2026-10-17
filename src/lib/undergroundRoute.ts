import { meters } from './measure'
import type { LngLat, UndergroundConnector, UndergroundMap, UndergroundMode, UndergroundRoad } from './types'

export interface UndergroundRouteMap {
  floor: number
  roads: Pick<UndergroundRoad, 'id' | 'floor' | 'mode' | 'direction' | 'status' | 'path'>[]
  connectors: Pick<UndergroundConnector, 'id' | 'floorFrom' | 'floorTo' | 'kind' | 'status' | 'pos'>[]
}

export interface UndergroundRouteResult {
  floor: number
  connectorIds: [string, string]
  path: LngLat[]
  meters: number
}

export interface UndergroundRouteOptions {
  mode?: UndergroundMode
  /** 道路折点之间视为同一交叉点的最大距离。 */
  roadJoinMeters?: number
  /** 上下连接点吸附到最近道路的最大距离。 */
  connectorSnapMeters?: number
}

interface Edge { to: number; cost: number }
interface Node { pos: LngLat; edges: Edge[] }

interface RoadNodes {
  road: UndergroundRouteMap['roads'][number]
  ids: number[]
}

class Heap {
  keys: number[] = []
  values: number[] = []
  push(key: number, value: number) {
    this.keys.push(key); this.values.push(value)
    let i = this.keys.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      ;[this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]]
      ;[this.values[p], this.values[i]] = [this.values[i], this.values[p]]
      i = p
    }
  }
  pop() {
    const value = this.values[0]
    const key = this.keys.pop()!
    const last = this.values.pop()!
    if (this.keys.length) {
      this.keys[0] = key; this.values[0] = last
      for (let i = 0; ; ) {
        const left = i * 2 + 1
        const right = left + 1
        let child = i
        if (left < this.keys.length && this.keys[left] < this.keys[child]) child = left
        if (right < this.keys.length && this.keys[right] < this.keys[child]) child = right
        if (child === i) break
        ;[this.keys[i], this.keys[child]] = [this.keys[child], this.keys[i]]
        ;[this.values[i], this.values[child]] = [this.values[child], this.values[i]]
        i = child
      }
    }
    return value
  }
  get size() { return this.keys.length }
}

function addEdge(nodes: Node[], from: number, to: number, cost: number) {
  if (from === to) return
  nodes[from].edges.push({ to, cost })
}

function addRoadEdges(nodes: Node[], road: UndergroundRoad, ids: number[]) {
  const forward = road.direction !== 'out'
  const reverse = road.direction !== 'in'
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1], b = ids[i]
    const cost = meters(nodes[a].pos, nodes[b].pos)
    if (forward) addEdge(nodes, a, b, cost)
    if (reverse) addEdge(nodes, b, a, cost)
  }
}

function connectNearby(nodes: Node[], a: number, b: number, maxMeters: number) {
  const distance = meters(nodes[a].pos, nodes[b].pos)
  if (distance <= maxMeters) {
    addEdge(nodes, a, b, distance)
    addEdge(nodes, b, a, distance)
  }
}

/** 点在线段上的投影，使用米制近似避免经纬度比例影响吸附位置。 */
function projectOnSegment(p: LngLat, a: LngLat, b: LngLat) {
  const k = Math.cos((p[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * k
  const dy = b[1] - a[1]
  const px = (p[0] - a[0]) * k
  const py = p[1] - a[1]
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)))
  const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { pos, t, meters: meters(p, pos) }
}

function connectProjection(nodes: Node[], road: RoadNodes, segment: number, projection: number) {
  const a = road.ids[segment], b = road.ids[segment + 1]
  const forward = road.road.direction !== 'out'
  const reverse = road.road.direction !== 'in'
  if (forward) { addEdge(nodes, a, projection, meters(nodes[a].pos, nodes[projection].pos)); addEdge(nodes, projection, b, meters(nodes[projection].pos, nodes[b].pos)) }
  if (reverse) { addEdge(nodes, b, projection, meters(nodes[b].pos, nodes[projection].pos)); addEdge(nodes, projection, a, meters(nodes[projection].pos, nodes[a].pos)) }
}

/**
 * 在一个地下楼层的候选路网中寻路。候选道路参与计算，rejected 道路和连接点完全排除。
 * 连接点会投影到最近的地下路段，返回的首尾路径包含这段短连接，供地上地下寻路器拼接。
 */
export function findUndergroundRoute(map: UndergroundRouteMap | UndergroundMap, fromId: string, toId: string, options: UndergroundRouteOptions = {}): UndergroundRouteResult | null {
  const mode = options.mode ?? 'car'
  const roadJoinMeters = options.roadJoinMeters ?? 18
  const connectorSnapMeters = options.connectorSnapMeters ?? 45
  const from = map.connectors.find((c) => c.id === fromId && c.status !== 'rejected')
  const to = map.connectors.find((c) => c.id === toId && c.status !== 'rejected')
  if (!from || !to || from.floorTo !== map.floor || to.floorTo !== map.floor) return null

  const nodes: Node[] = []
  const roadNodeIds: number[] = []
  const roadNodes: RoadNodes[] = []
  const addNode = (pos: LngLat) => { const id = nodes.length; nodes.push({ pos, edges: [] }); return id }
  for (const road of map.roads) {
    if (road.floor !== map.floor || road.mode !== mode || road.status === 'rejected' || road.path.length < 2) continue
    const ids = road.path.map(addNode)
    roadNodes.push({ road, ids })
    roadNodeIds.push(...ids)
    addRoadEdges(nodes, road, ids)
  }
  const fromNode = addNode(from.pos)
  const toNode = addNode(to.pos)
  for (const connectorNode of [fromNode, toNode]) {
    let nearestRoad: RoadNodes | undefined
    let nearestSegment = -1
    let nearestProjection: ReturnType<typeof projectOnSegment> | undefined
    for (const road of roadNodes) for (let i = 0; i < road.ids.length - 1; i++) {
      const projection = projectOnSegment(nodes[connectorNode].pos, nodes[road.ids[i]].pos, nodes[road.ids[i + 1]].pos)
      if (!nearestProjection || projection.meters < nearestProjection.meters) {
        nearestRoad = road; nearestSegment = i; nearestProjection = projection
      }
    }
    if (!nearestRoad || nearestSegment < 0 || !nearestProjection || nearestProjection.meters > connectorSnapMeters) return null
    const projectionNode = addNode(nearestProjection.pos)
    roadNodeIds.push(projectionNode)
    connectProjection(nodes, nearestRoad, nearestSegment, projectionNode)
    connectNearby(nodes, connectorNode, projectionNode, connectorSnapMeters)
  }
  for (let i = 0; i < roadNodeIds.length; i++)
    for (let j = i + 1; j < roadNodeIds.length; j++)
      connectNearby(nodes, roadNodeIds[i], roadNodeIds[j], roadJoinMeters)

  const dist = new Float64Array(nodes.length).fill(Infinity)
  const prev = new Int32Array(nodes.length).fill(-1)
  const heap = new Heap()
  dist[fromNode] = 0; heap.push(0, fromNode)
  while (heap.size) {
    const current = heap.pop()
    if (current === toNode) break
    for (const edge of nodes[current].edges) {
      const next = dist[current] + edge.cost
      if (next < dist[edge.to]) {
        dist[edge.to] = next; prev[edge.to] = current; heap.push(next, edge.to)
      }
    }
  }
  if (!Number.isFinite(dist[toNode])) return null
  const nodePath: number[] = []
  for (let current = toNode; current >= 0; current = prev[current]) nodePath.push(current)
  nodePath.reverse()
  const path = nodePath.map((id) => nodes[id].pos)
  return { floor: map.floor, connectorIds: [fromId, toId], path, meters: Math.round(dist[toNode]) }
}
