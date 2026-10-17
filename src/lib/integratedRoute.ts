import { findRoute, routeWeatherCost, SHORT_EXPOSURE_METERS, type RouteResult, type RouteSegment, type RouteTransition, type Target } from './route'
import { findUndergroundRoute } from './undergroundRoute'
import type { LngLat, UndergroundConnector, UndergroundMap } from './types'

const DEFAULT_TRANSITION_PENALTY = 20
const DEFAULT_CONNECTOR_SNAP = 45

export interface IntegratedRouteOptions {
  rain?: boolean
  /** 每次进出地下额外增加的比较代价，避免为很短的露天段绕行。 */
  transitionPenaltyMeters?: number
  /** 连续露天不超过此长度时按实际距离计算。 */
  shortExposureMeters?: number
  connectorSnapMeters?: number
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
    const dx = (path[i][0] - path[i - 1][0]) * 111320 * Math.cos((path[i][1] * Math.PI) / 180)
    const dy = (path[i][1] - path[i - 1][1]) * 110574
    total += Math.hypot(dx, dy)
  }
  return total
}

function routeMetrics(segments: RouteSegment[], transitions: RouteTransition[], shortExposureMeters: number): RouteResult {
  let meters = 0, coveredMeters = 0, undergroundMeters = 0
  for (const segment of segments) {
    const length = lengthOf(segment.path)
    meters += length
    if (segment.covered || segment.layer === 'underground') coveredMeters += length
    if (segment.layer === 'underground') undergroundMeters += length
  }
  return {
    segments,
    meters: Math.round(meters),
    coveredMeters: Math.round(coveredMeters),
    undergroundMeters: Math.round(undergroundMeters),
    minutes: Math.max(1, Math.round(meters / 75)),
    transitions,
    routingCost: routeWeatherCost(segments, shortExposureMeters),
  }
}

/**
 * 晴天只跑地面子图；雨天额外比较「地面 → 地下 → 地面」的一次地下绕行。
 * 每个连接点都先通过地下路网最近路段投影吸附，无法接入的点自动跳过。
 */
export function findIntegratedRoute(from: Target, to: Target, map: UndergroundMap | null, options: IntegratedRouteOptions = {}): RouteResult | null {
  const rain = options.rain ?? false
  const direct = findRoute(from, to, rain)
  if (!rain || !map) return direct

  const transitionPenaltyMeters = options.transitionPenaltyMeters ?? DEFAULT_TRANSITION_PENALTY
  const shortExposureMeters = options.shortExposureMeters ?? SHORT_EXPOSURE_METERS
  const connectorSnapMeters = options.connectorSnapMeters ?? DEFAULT_CONNECTOR_SNAP
  const network = map
  const connectors = network.connectors.filter((c) => (c.floorFrom === 0 && c.floorTo === network.floor) || (c.floorTo === 0 && c.floorFrom === network.floor))
  if (connectors.length < 2) return direct

  const fromRoutes = connectors.map((connector) => findRoute(from, { point: connector.pos }, true))
  const toRoutes = connectors.map((connector) => findRoute({ point: connector.pos }, to, true))
  let best = direct
  let bestCost = direct ? routeWeatherCost(direct.segments, shortExposureMeters) : Infinity

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
        { path: underground.path, covered: true, layer: 'underground' },
        ...finish.segments,
      ]
      const transitions = [transition(connectors[i], 'enter'), transition(connectors[j], 'exit')]
      const candidate = routeMetrics(segments, transitions, shortExposureMeters)
      const cost = candidate.routingCost + transitionPenaltyMeters * transitions.length
      if (cost + 1e-6 < bestCost) {
        best = { ...candidate, routingCost: cost }
        bestCost = cost
      }
    }
  }
  return best
}
