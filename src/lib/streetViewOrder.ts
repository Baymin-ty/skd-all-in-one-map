import type { UndergroundStreetViewPoint } from './types'

/** 地下路线经过的一段原始路网边：沿 a→b 方向的参数从 from 走到 to（0..1，起止段可能只走一部分）。 */
export interface RouteEdgeStep {
  a: string
  b: string
  from: number
  to: number
}

const EPS = 1e-6

/** 按路线行进方向给街景点排序；只保留落在路线实际经过区间内的点。 */
export function orderStreetViewPoints<P extends Pick<UndergroundStreetViewPoint, 'id' | 'endpointId1' | 'endpointId2' | 'endpointWeight2'>>(
  steps: RouteEdgeStep[], points: P[],
): P[] {
  const keyed = new Map<string, { point: P; key: number }>()
  steps.forEach((step, index) => {
    const lo = Math.min(step.from, step.to), hi = Math.max(step.from, step.to)
    const span = hi - lo
    for (const point of points) {
      let t: number
      if (point.endpointId1 === step.a && point.endpointId2 === step.b) t = point.endpointWeight2
      else if (point.endpointId1 === step.b && point.endpointId2 === step.a) t = 1 - point.endpointWeight2
      else continue
      if (t < lo - EPS || t > hi + EPS) continue
      const progress = span < EPS ? 0 : Math.min(1, Math.max(0, (step.to >= step.from ? t - step.from : step.from - t) / span))
      const key = index + progress
      if (!keyed.has(point.id)) keyed.set(point.id, { point, key })
    }
  })
  return [...keyed.values()].sort((x, y) => x.key - y.key).map((x) => x.point)
}
