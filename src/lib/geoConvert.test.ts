import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { distanceToPath, gpsToMap, realToMap, wgsToBd } from './geoConvert'
import { meters, pointInPoly } from './measure'
import type { Campus, LngLat } from './types'

const campus = JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8')) as Campus

describe('GPS 落到手绘图上', () => {
  it('WGS-84 到 BD-09 的偏移在上海约为经度 +0.011、纬度 +0.004', () => {
    const [lng, lat] = wgsToBd(121.59, 31.18)
    expect(lng - 121.59).toBeGreaterThan(0.008)
    expect(lng - 121.59).toBeLessThan(0.014)
    expect(lat - 31.18).toBeGreaterThan(0.002)
    expect(lat - 31.18).toBeLessThan(0.008)
  })
  it('控制点校正只挪动几十米以内，没有校正数据时原样返回', () => {
    expect(campus.warp?.src).toHaveLength(175)
    for (const p of campus.warp!.src) expect(meters(p, realToMap(p, campus.warp))).toBeLessThan(60)
    const p: LngLat = [121.6, 31.183]
    expect(realToMap(p, null)).toEqual(p)
  })
  it('校园中心附近的 GPS 读数落在校园边界里', () => {
    // 校园中心（BD-09）大致反推回 WGS-84：减去 BD 偏移
    const [lng, lat] = [121.6014 - 0.0111, 31.1831 - 0.0040]
    expect(pointInPoly(gpsToMap(lng, lat, campus.warp), campus.boundary)).toBe(true)
  })
  it('点到路线的距离用来判断是否偏离', () => {
    const path: LngLat[] = [[121.6, 31.18], [121.601, 31.18]]
    expect(distanceToPath([121.6005, 31.18], path)).toBeLessThan(0.01)
    expect(distanceToPath([121.6005, 31.1803], path)).toBeGreaterThan(30)
    expect(distanceToPath([121.6005, 31.1803], path)).toBeLessThan(35)
  })
})
