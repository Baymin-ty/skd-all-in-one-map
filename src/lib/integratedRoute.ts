import { findRoute, type RouteResult, type RouteSegment, type RouteTransition, type Target } from './route'
import { meters as distance } from './measure'
import { findUndergroundRoute } from './undergroundRoute'
import type { LngLat, UndergroundConnector, UndergroundMap } from './types'

const DEFAULT_CONNECTOR_SNAP = 45

export interface IntegratedRouteOptions {
  connectorSnapMeters?: number
  /** 强制走地下：只返回「地面 → 地下 → 地面」候选，不比较地面直达。 */
  forceUnderground?: boolean
}

type Connector = Pick<UndergroundConnector, 'id' | 'floorFrom' | 'floorTo' | 'kind' | 'pos'>

function connectorLabel(connector: Connector, kind: 'enter' | 'exit'): string {
  const name = connector.kind === 'ramp' ? '坡道' : connector.kind === 'stairs' ? '楼梯' : connector.kind === 'elevator' ? '电梯' : '连接点'
  return kind === 'enter' ? `进入地下 · ${name}` : `回到地面 · ${name}`
}

function transition(connector: Connector, kind: 'enter' | 'exit'): RouteTransition {
  return { connectorId: connector.id, kind, connectorKind: connector.kind, pos: connector.pos, label: connectorLabel(connector, kind) }
}

function lengthOf(path: LngLat[]) {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += distance(path[i - 1], path[i])
  }
  return total
}

function routeMetrics(segments: RouteSegment[], transitions: RouteTransition[]): RouteResult {
  let meters = 0, undergroundMeters = 0
  for (const segment of segments) {
    const length = lengthOf(segment.path)
    meters += length
    if (segment.layer === 'underground') undergroundMeters += length
  }
  return {
    segments,
    meters: Math.round(meters),
    undergroundMeters: Math.round(undergroundMeters),
    minutes: Math.max(1, Math.round(meters / 75)),
    transitions,
  }
}

/**
 * 按实际距离比较地面与「地面 → 地下 → 地面」的一次地下通行候选。
 * 保留现有枚举架构，不支持一次路线多次进出地下。
 * 每个连接点都先通过地下路网最近路段投影吸附，无法接入的点自动跳过。
 */
export function findIntegratedRoute(from: Target, to: Target, map: UndergroundMap | null, options: IntegratedRouteOptions = {}): RouteResult | null {
  const direct = options.forceUnderground ? null : findRoute(from, to)
  if (!map) return direct
  const connectorSnapMeters = options.connectorSnapMeters ?? DEFAULT_CONNECTOR_SNAP
  const network = map
  // 所有连通地面与当前地下楼层的连接点都允许步行使用，包括车辆坡道（ramp）、楼梯（stairs）、电梯（elevator）。
  const connectors = network.connectors.filter((c) => (c.floorFrom === 0 && c.floorTo === network.floor) || (c.floorTo === 0 && c.floorFrom === network.floor))
  if (connectors.length < 2) return direct

  const fromRoutes = connectors.map((connector) => findRoute(from, { point: connector.pos }))
  const toRoutes = connectors.map((connector) => findRoute({ point: connector.pos }, to))

  // 强制避雨走地下时：固定使用离出发点最近的入口、离终点最近的出口，不比较全组合。
  if (options.forceUnderground) {
    let enterIdx = -1, exitIdx = -1
    let enterCost = Infinity, exitCost = Infinity
    for (let i = 0; i < connectors.length; i++) {
      const start = fromRoutes[i]
      if (start && start.meters < enterCost) { enterCost = start.meters; enterIdx = i }
      const finish = toRoutes[i]
      if (finish && finish.meters < exitCost) { exitCost = finish.meters; exitIdx = i }
    }
    if (enterIdx >= 0 && exitIdx >= 0 && enterIdx !== exitIdx) {
      const start = fromRoutes[enterIdx]!
      const finish = toRoutes[exitIdx]!
      const underground = findUndergroundRoute(network, connectors[enterIdx].id, connectors[exitIdx].id, { connectorSnapMeters })
      if (underground) {
        const segments: RouteSegment[] = [
          ...start.segments,
          { path: underground.path, layer: 'underground' },
          ...finish.segments,
        ]
        const transitions = [transition(connectors[enterIdx], 'enter'), transition(connectors[exitIdx], 'exit')]
        return routeMetrics(segments, transitions)
      }
    }
    // 最近出入口无法连通（同一点或地下不可达）时，退回枚举最短组合。
  }

  let best: RouteResult | null = direct
  let bestCost = best ? best.segments.reduce((sum, segment) => sum + lengthOf(segment.path), 0) : Infinity

  for (let i = 0; i < connectors.length; i++) {
    const start = fromRoutes[i]
    if (!start) continue
    for (let j = 0; j < connectors.length; j++) {
      if (i === j) continue
      const finish = toRoutes[j]
      if (!finish) continue
      const underground = findUndergroundRoute(network, connectors[i].id, connectors[j].id, { connectorSnapMeters })
      if (!underground) continue
      const segments: RouteSegment[] = [
        ...start.segments,
        { path: underground.path, layer: 'underground' },
        ...finish.segments,
      ]
      const transitions = [transition(connectors[i], 'enter'), transition(connectors[j], 'exit')]
      const candidate = routeMetrics(segments, transitions)
      const cost = segments.reduce((sum, segment) => sum + lengthOf(segment.path), 0)
      if (cost + 1e-6 < bestCost) {
        best = candidate
        bestCost = cost
      }
    }
  }
  return best
}
