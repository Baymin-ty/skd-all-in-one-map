import { findRoute, routeWeatherCost, SHORT_EXPOSURE_METERS, type RouteResult, type RouteSegment, type RouteTransition, type Target } from './route'
import { findUndergroundRoute, type UndergroundRouteMap } from './undergroundRoute'
import type { LngLat, UndergroundConnector, UndergroundMap, UndergroundMode } from './types'

const DEFAULT_TRANSITION_PENALTY = 20
const DEFAULT_CONNECTOR_SNAP = 45
const MODES: UndergroundMode[] = ['walk', 'car']

export interface IntegratedRouteOptions {
  rain?: boolean
  /** 候选道路在确认前也参与计算；rejected 始终排除。 */
  allowCandidate?: boolean
  /** 每次进出地下额外增加的比较代价，避免为很短的露天段绕行。 */
  transitionPenaltyMeters?: number
  /** 连续露天不超过此长度时按实际距离计算。 */
  shortExposureMeters?: number
  /** 地下路网的道路类型，按顺序尝试并取最短可达路线。 */
  undergroundModes?: UndergroundMode[]
  connectorSnapMeters?: number
}

type Connector = Pick<UndergroundConnector, 'id' | 'floorFrom' | 'floorTo' | 'kind' | 'status' | 'pos'>

function usable(status: Connector['status'] | UndergroundRouteMap['roads'][number]['status'], allowCandidate: boolean) {
  return status !== 'rejected' && (allowCandidate || status === 'confirmed')
}

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

function filteredMap(map: UndergroundMap, allowCandidate: boolean): UndergroundRouteMap {
  return {
    floor: map.floor,
    roads: map.roads.filter((road) => usable(road.status, allowCandidate)).map((road) => ({
      id: road.id, floor: road.floor, mode: road.mode, direction: road.direction, status: road.status, path: road.path,
    })),
    connectors: map.connectors.filter((connector) => usable(connector.status, allowCandidate)).map((connector) => ({
      id: connector.id, floorFrom: connector.floorFrom, floorTo: connector.floorTo, kind: connector.kind, status: connector.status, pos: connector.pos,
    })),
  }
}

function undergroundBetween(map: UndergroundRouteMap, from: Connector, to: Connector, modes: UndergroundMode[], snap: number) {
  let best: ReturnType<typeof findUndergroundRoute> = null
  for (const mode of modes) {
    const route = findUndergroundRoute(map, from.id, to.id, { mode, connectorSnapMeters: snap })
    if (route && (!best || route.meters < best.meters)) best = route
  }
  return best
}

/**
 * 晴天只跑地面子图；雨天额外比较「地面 → 地下 → 地面」的一次地下绕行。
 * 每个连接点都先通过地下路网最近路段投影吸附，无法接入的点自动跳过。
 */
export function findIntegratedRoute(from: Target, to: Target, map: UndergroundMap | null, options: IntegratedRouteOptions = {}): RouteResult | null {
  const rain = options.rain ?? false
  const direct = findRoute(from, to, rain)
  if (!rain || !map) return direct

  const allowCandidate = options.allowCandidate ?? true
  const transitionPenaltyMeters = options.transitionPenaltyMeters ?? DEFAULT_TRANSITION_PENALTY
  const shortExposureMeters = options.shortExposureMeters ?? SHORT_EXPOSURE_METERS
  const connectorSnapMeters = options.connectorSnapMeters ?? DEFAULT_CONNECTOR_SNAP
  const modes = options.undergroundModes?.length ? options.undergroundModes : MODES
  const network = filteredMap(map, allowCandidate)
  const connectors = network.connectors.filter((connector) => connector.floorTo === network.floor) as Connector[]
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
      const underground = undergroundBetween(network, connectors[i], connectors[j], modes, connectorSnapMeters)
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
