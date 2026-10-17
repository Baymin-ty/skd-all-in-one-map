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

/**
 * 在一个地下楼层的候选路网中寻路。候选道路参与计算，rejected 道路和连接点完全排除。
 * 地面↕地下的跨层连接暂时只作为 B1 端点，等现场确认后再接入地面寻路。
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
  const addNode = (pos: LngLat) => { const id = nodes.length; nodes.push({ pos, edges: [] }); return id }
  for (const road of map.roads) {
    if (road.floor !== map.floor || road.mode !== mode || road.status === 'rejected' || road.path.length < 2) continue
    const ids = road.path.map(addNode)
    roadNodeIds.push(...ids)
    addRoadEdges(nodes, road, ids)
  }
  const fromNode = addNode(from.pos)
  const toNode = addNode(to.pos)
  for (const connectorNode of [fromNode, toNode]) {
    let nearest = -1, nearestDistance = Infinity
    for (const roadNode of roadNodeIds) {
      const distance = meters(nodes[connectorNode].pos, nodes[roadNode].pos)
      if (distance < nearestDistance) nearest = roadNode, nearestDistance = distance
    }
    if (nearest < 0 || nearestDistance > connectorSnapMeters) return null
    connectNearby(nodes, connectorNode, nearest, connectorSnapMeters)
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
