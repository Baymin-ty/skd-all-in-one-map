import { meters } from './measure'
import type { LngLat, UndergroundConnector, UndergroundMap } from './types'

export type UndergroundRouteMap = Pick<UndergroundMap, 'floor' | 'nodes' | 'edges'> & {
  connectors: Pick<UndergroundConnector, 'id' | 'floorFrom' | 'floorTo' | 'kind' | 'pos' | 'node'>[]
}
export interface UndergroundRouteResult {
  floor: number
  connectorIds: [string, string]
  path: LngLat[]
  meters: number
}
export interface UndergroundRouteOptions { connectorSnapMeters?: number }

function project(p: LngLat, a: LngLat, b: LngLat) {
  const k = Math.cos(p[1] * Math.PI / 180)
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * k * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { t, pos, distance: meters(p, pos) }
}

/** 只沿显式双向边行走。未绑定连接点可临时投影接入，绝不移动持久化位置或连接邻近的孤立路网。 */
export function findUndergroundRoute(map: UndergroundRouteMap, fromId: string, toId: string, options: UndergroundRouteOptions = {}): UndergroundRouteResult | null {
  const from = map.connectors.find((c) => c.id === fromId), to = map.connectors.find((c) => c.id === toId)
  const reachesFloor = (c: UndergroundRouteMap['connectors'][number]) =>
    (c.floorFrom === 0 && c.floorTo === map.floor) || (c.floorTo === 0 && c.floorFrom === map.floor)
  if (!from || !to || !reachesFloor(from) || !reachesFloor(to)) return null
  const positions: LngLat[] = map.nodes.map((n) => n.pos)
  const index = new Map(map.nodes.map((n, i) => [n.id, i]))
  const adjacency: { to: number; cost: number }[][] = positions.map(() => [])
  const add = (pos: LngLat) => { positions.push(pos); adjacency.push([]); return positions.length - 1 }
  const link = (a: number, b: number) => {
    const cost = meters(positions[a], positions[b])
    adjacency[a].push({ to: b, cost }); adjacency[b].push({ to: a, cost })
  }
  const segments = map.edges.flatMap((e) => {
    const a = index.get(e.a), b = index.get(e.b)
    return a === undefined || b === undefined ? [] : [{ a, b, splits: [{ t: 0, id: a }, { t: 1, id: b }] }]
  })
  const attach = (connector: typeof from) => {
    const id = add(connector.pos)
    if (connector.node) {
      const bound = index.get(connector.node)
      if (bound === undefined) return null
      link(id, bound); return id
    }
    let best: { segment: typeof segments[number]; projection: ReturnType<typeof project> } | undefined
    for (const segment of segments) {
      const projection = project(connector.pos, positions[segment.a], positions[segment.b])
      if (!best || projection.distance < best.projection.distance) best = { segment, projection }
    }
    if (!best || best.projection.distance > (options.connectorSnapMeters ?? 45)) return null
    const projected = add(best.projection.pos)
    best.segment.splits.push({ t: best.projection.t, id: projected })
    link(id, projected)
    return id
  }
  const start = attach(from), end = attach(to)
  if (start === null || end === null) return null
  for (const segment of segments) {
    segment.splits.sort((a, b) => a.t - b.t)
    for (let i = 1; i < segment.splits.length; i++) link(segment.splits[i - 1].id, segment.splits[i].id)
  }
  const dist = positions.map(() => Infinity), prev = positions.map(() => -1), visited = new Set<number>()
  dist[start] = 0
  while (true) {
    let current = -1
    for (let i = 0; i < dist.length; i++) if (!visited.has(i) && Number.isFinite(dist[i]) && (current < 0 || dist[i] < dist[current])) current = i
    if (current < 0) return null
    if (current === end) break
    visited.add(current)
    for (const edge of adjacency[current]) if (dist[current] + edge.cost < dist[edge.to]) {
      dist[edge.to] = dist[current] + edge.cost; prev[edge.to] = current
    }
  }
  const path: LngLat[] = []
  for (let i = end; i >= 0; i = prev[i]) path.push([...positions[i]])
  path.reverse()
  return { floor: map.floor, connectorIds: [fromId, toId], path, meters: Math.round(dist[end]) }
}
