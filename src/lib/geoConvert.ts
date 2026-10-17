import { meters, segDist } from './measure'
import type { LngLat } from './types'

/**
 * 手机 GPS（WGS-84）→ 百度坐标（BD-09）→ 手绘底图上的位置。
 * 公式来自赛前数据包 reference/projection.md；手绘图和真实地理有 10–30 m 偏差，
 * campus.json 的 warp 用 175 个路口控制点做「仿射 + 残差插值」校正。
 */
export interface Warp { A: number[][]; src: LngLat[]; res: LngLat[] }

const A = 6378245.0
const EE = 0.00669342162296594323
function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3
  return r
}
function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3
  return r
}
export function wgsToGcj(lng: number, lat: number): LngLat {
  let dLat = tLat(lng - 105, lat - 35)
  let dLng = tLng(lng - 105, lat - 35)
  const rad = (lat / 180) * Math.PI
  let m = Math.sin(rad)
  m = 1 - EE * m * m
  const sm = Math.sqrt(m)
  dLat = (dLat * 180) / (((A * (1 - EE)) / (m * sm)) * Math.PI)
  dLng = (dLng * 180) / ((A / sm) * Math.cos(rad) * Math.PI)
  return [lng + dLng, lat + dLat]
}
export function gcjToBd(lng: number, lat: number): LngLat {
  const xpi = (Math.PI * 3000) / 180
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * xpi)
  const t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * xpi)
  return [z * Math.cos(t) + 0.0065, z * Math.sin(t) + 0.006]
}
export const wgsToBd = (lng: number, lat: number) => gcjToBd(...wgsToGcj(lng, lat))

/** 真实位置（BD-09）→ 手绘图上的位置：仿射变换，再按附近 120 m 内控制点的残差反距离加权修正 */
export function realToMap(p: LngLat, warp: Warp | null | undefined): LngLat {
  if (!warp) return p
  const { A: a, src, res } = warp
  const base: LngLat = [p[0] * a[0][0] + p[1] * a[1][0] + a[2][0], p[0] * a[0][1] + p[1] * a[1][1] + a[2][1]]
  let sw = 0
  let rx = 0
  let ry = 0
  for (let i = 0; i < src.length; i++) {
    const d = meters(p, src[i])
    if (d >= 120) continue
    const w = 1 / Math.max(d, 3) ** 2
    sw += w
    rx += w * res[i][0]
    ry += w * res[i][1]
  }
  if (!sw) return base
  const k = Math.min(1, sw * 900)
  return [base[0] + (rx / sw) * k, base[1] + (ry / sw) * k]
}

/** GPS 读数直接换到底图坐标 */
export const gpsToMap = (lng: number, lat: number, warp: Warp | null | undefined) => realToMap(wgsToBd(lng, lat), warp)

/** 点到折线的最短距离（米），用来判断是否偏离路线 */
export function distanceToPath(p: LngLat, path: LngLat[]) {
  if (path.length === 1) return meters(p, path[0])
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, segDist(p, path[i - 1], path[i]))
  return best
}
