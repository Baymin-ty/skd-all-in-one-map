import { findRoute, findRoutesToMany, routeLengthLowerBounds, type RouteResult, type RouteSegment, type RouteTransition, type Target } from './route'
import { meters as distance } from './measure'
import { findUndergroundRoute, type UndergroundRouteResult } from './undergroundRoute'
import type { LngLat, UndergroundConnector, UndergroundMap } from './types'

const DEFAULT_CONNECTOR_SNAP = 45
/** 地下路线长度 ≥ 此系数 × 两连接点直线距离（等距近似的经度系数随纬度变化，校园范围内远小于 1%）。 */
const UNDERGROUND_STRAIGHT_FACTOR = 0.99

export interface FixedUndergroundConnectors {
  /** 强制地下路线使用的地面入口连接点。 */
  enterId: string
  /** 强制地下路线使用的地面出口连接点。 */
  exitId: string
}

export interface IntegratedRouteOptions {
  connectorSnapMeters?: number
  /** 强制走地下：只返回「地面 → 地下 → 地面」候选，不比较地面直达。 */
  forceUnderground?: boolean
  /** 路线覆盖：直接使用指定的地下入口和出口，不参与自动选择。 */
  fixedUndergroundConnectors?: FixedUndergroundConnectors
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
 *
 * 结果与「对每个连接点各调一次 findRoute」的枚举完全一致，但：
 * - 起点 → 各连接点（及地面直达）合并为一次多终点搜索；
 * - 各连接点 → 终点只做一次反向搜索取长度下界，仅在下界可能胜出时才按需调用 findRoute 求精确路线；
 * - 地下路线同样先用直线下界剪枝，并按连接点对缓存。
 */
export function findIntegratedRoute(from: Target, to: Target, map: UndergroundMap | null, options: IntegratedRouteOptions = {}): RouteResult | null {
  const compareDirect = !options.forceUnderground && !options.fixedUndergroundConnectors
  if (!map) return compareDirect ? findRoute(from, to) : null
  const connectorSnapMeters = options.connectorSnapMeters ?? DEFAULT_CONNECTOR_SNAP
  const network = map
  // 所有连通地面与当前地下楼层的连接点都允许步行使用，包括车辆坡道（ramp）、楼梯（stairs）、电梯（elevator）。
  const connectors = network.connectors.filter((c) => (c.floorFrom === 0 && c.floorTo === network.floor) || (c.floorTo === 0 && c.floorFrom === network.floor))
  if (connectors.length < 2) return compareDirect ? findRoute(from, to) : null
  const targets: Target[] = connectors.map((connector) => ({ point: connector.pos }))
  const n = connectors.length

  const ugCache = new Map<number, UndergroundRouteResult | null>()
  const undergroundRoute = (i: number, j: number) => {
    let r = ugCache.get(i * n + j)
    if (r === undefined) ugCache.set(i * n + j, (r = findUndergroundRoute(network, connectors[i].id, connectors[j].id, { connectorSnapMeters })))
    return r
  }

  // 路线覆盖优先于“最近入口/出口”：两个连接点都必须可达且地下路网可连通。只需算这两段地面路线。
  if (options.fixedUndergroundConnectors) {
    const enterIdx = connectors.findIndex((connector) => connector.id === options.fixedUndergroundConnectors!.enterId)
    const exitIdx = connectors.findIndex((connector) => connector.id === options.fixedUndergroundConnectors!.exitId)
    if (enterIdx < 0 || exitIdx < 0 || enterIdx === exitIdx) return null
    const start = findRoute(from, targets[enterIdx])
    const finish = start && findRoute(targets[exitIdx], to)
    if (!start || !finish) return null
    const underground = undergroundRoute(enterIdx, exitIdx)
    if (!underground) return null
    return routeMetrics([
      ...start.segments,
      { path: underground.path, layer: 'underground', edges: underground.edges },
      ...finish.segments,
    ], [transition(connectors[enterIdx], 'enter'), transition(connectors[exitIdx], 'exit')])
  }

  // 起点 → 各连接点（非强制时顺带地面直达）：一次多终点搜索，结果与逐个 findRoute 相同
  const forward = findRoutesToMany(from, compareDirect ? [...targets, to] : targets)
  const fromRoutes = forward.slice(0, n)
  const direct = compareDirect ? forward[n] : null
  // 各连接点 → 终点：下界一次算出；精确路线按需调用 findRoute 并缓存（下界为 Infinity 时必为 null）
  const toBounds = routeLengthLowerBounds(targets, to)
  const toCache = new Map<number, RouteResult | null>()
  const toRoute = (j: number) => {
    let r = toCache.get(j)
    if (r === undefined) toCache.set(j, (r = toBounds[j] === Infinity ? null : findRoute(targets[j], to)))
    return r
  }

  if (options.forceUnderground) {
    let enterIdx = -1, exitIdx = -1
    let enterCost = Infinity, exitCost = Infinity
    for (let i = 0; i < n; i++) {
      const start = fromRoutes[i]
      if (start && start.meters < enterCost) { enterCost = start.meters; enterIdx = i }
    }
    // 出口：与原先「取取整米数最小、同值取下标最小」等价。按下界升序求精确值，
    // 下界 > 当前最优 + 0.5 时取整后必然更大，其后的连接点都不必再算。
    const order = targets.map((_, j) => j).sort((a, b) => toBounds[a] - toBounds[b] || a - b)
    for (const j of order) {
      if (toBounds[j] > exitCost + 0.5) break
      const finish = toRoute(j)
      if (finish && (finish.meters < exitCost || (finish.meters === exitCost && j < exitIdx))) { exitCost = finish.meters; exitIdx = j }
    }
    if (enterIdx >= 0 && exitIdx >= 0 && enterIdx !== exitIdx) {
      const start = fromRoutes[enterIdx]!
      const finish = toRoute(exitIdx)!
      const underground = undergroundRoute(enterIdx, exitIdx)
      if (underground) {
        const segments: RouteSegment[] = [
          ...start.segments,
          { path: underground.path, layer: 'underground', edges: underground.edges },
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

  for (let i = 0; i < n; i++) {
    const start = fromRoutes[i]
    if (!start) continue
    // 与下方 segments.reduce 的前缀和逐位相同
    const startCost = start.segments.reduce((sum, segment) => sum + lengthOf(segment.path), 0)
    for (let j = 0; j < n; j++) {
      if (i === j || toBounds[j] === Infinity) continue
      // 剪枝：浮点加法单调，各段下界之和 ≤ 实际 cost；下界都不能严格优于当前最优时，原枚举也不会替换
      if (startCost + UNDERGROUND_STRAIGHT_FACTOR * distance(connectors[i].pos, connectors[j].pos) + toBounds[j] + 1e-6 >= bestCost) continue
      const underground = undergroundRoute(i, j)
      if (!underground) continue
      if (startCost + lengthOf(underground.path) + toBounds[j] + 1e-6 >= bestCost) continue
      const finish = toRoute(j)
      if (!finish) continue
      const segments: RouteSegment[] = [
        ...start.segments,
        { path: underground.path, layer: 'underground', edges: underground.edges },
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
