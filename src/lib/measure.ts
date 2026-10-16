import type { LngLat } from './types'

// 校园只有一公里见方，按等距近似算米数就够了（不依赖 Leaflet，方便单测）
const M_LAT = 110574
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

export function meters(a: LngLat, b: LngLat) {
  return Math.hypot((a[0] - b[0]) * mLng(a[1]), (a[1] - b[1]) * M_LAT)
}

/** 点到线段的距离（米） */
export function segDist(p: LngLat, a: LngLat, b: LngLat) {
  const k = mLng(p[1])
  const [px, py, ax, ay, bx, by] = [p[0] * k, p[1] * M_LAT, a[0] * k, a[1] * M_LAT, b[0] * k, b[1] * M_LAT]
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

export function pointInPoly(p: LngLat, poly: LngLat[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 点到多边形的距离，在里面算 0 */
export function polyDist(p: LngLat, poly: LngLat[]) {
  if (pointInPoly(p, poly)) return 0
  let d = Infinity
  for (let k = 0; k < poly.length; k++) d = Math.min(d, segDist(p, poly[k], poly[(k + 1) % poly.length]))
  return d
}
