import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findUndergroundRoute, type UndergroundRouteMap } from './undergroundRoute'
import type { UndergroundMap } from './types'

// 种子数据已清空，用旧版候选路网（备份）验证真实规模的寻路
const map = JSON.parse(readFileSync(new URL('../../data/underground-sketch-backup-20261017.json', import.meta.url), 'utf8')) as UndergroundMap

describe('地下候选路网寻路', () => {
  it('可以在旧版 B1 候选路网中连接两个地面车库出入口', () => {
    const result = findUndergroundRoute(map, 'ug-conn-poi-9a5774fc', 'ug-conn-poi-1382d8df')
    expect(result).not.toBeNull()
    expect(result!.floor).toBe(-1)
    expect(result!.meters).toBeGreaterThan(100)
    expect(result!.path[0]).toEqual([121.596221, 31.18317])
    expect(result!.path.at(-1)).toEqual([121.6021, 31.185217])
  })

  it('拒绝状态的道路和连接点不会被用于路线', () => {
    const simple: UndergroundRouteMap = {
      floor: -1,
      roads: [{ id: 'road', floor: -1, mode: 'car', direction: 'both', status: 'rejected', path: [[121.6, 31.184], [121.601, 31.184]] }],
      connectors: [
        { id: 'from', floorFrom: 0, floorTo: -1, kind: 'ramp', status: 'candidate', pos: [121.6, 31.184] },
        { id: 'to', floorFrom: 0, floorTo: -1, kind: 'ramp', status: 'candidate', pos: [121.601, 31.184] },
      ],
    }
    expect(findUndergroundRoute(simple, 'from', 'to')).toBeNull()
  })

  it('遵守单向进出库道路方向', () => {
    const simple: UndergroundRouteMap = {
      floor: -1,
      roads: [{ id: 'one-way', floor: -1, mode: 'car', direction: 'in', status: 'candidate', path: [[121.6, 31.184], [121.601, 31.184]] }],
      connectors: [
        { id: 'from', floorFrom: 0, floorTo: -1, kind: 'ramp', status: 'candidate', pos: [121.6, 31.184] },
        { id: 'to', floorFrom: 0, floorTo: -1, kind: 'ramp', status: 'candidate', pos: [121.601, 31.184] },
      ],
    }
    expect(findUndergroundRoute(simple, 'from', 'to')).not.toBeNull()
    expect(findUndergroundRoute(simple, 'to', 'from')).toBeNull()
  })

  it('上下节点偏离路网时投影到最近路段后再接入', () => {
    const simple: UndergroundRouteMap = {
      floor: -1,
      roads: [{ id: 'road', floor: -1, mode: 'car', direction: 'both', status: 'candidate', path: [[121.6, 31.184], [121.602, 31.184]] }],
      connectors: [
        { id: 'from', floorFrom: 0, floorTo: -1, kind: 'stairs', status: 'candidate', pos: [121.601, 31.1842] },
        { id: 'to', floorFrom: 0, floorTo: -1, kind: 'elevator', status: 'candidate', pos: [121.6018, 31.1842] },
      ],
    }
    const result = findUndergroundRoute(simple, 'from', 'to')!
    expect(result).not.toBeNull()
    expect(result.path[0]).toEqual([121.601, 31.1842])
    expect(result.path.at(-1)).toEqual([121.6018, 31.1842])
    expect(result.path.some(([lng, lat]) => Math.abs(lng - 121.601) < 1e-6 && Math.abs(lat - 31.184) < 1e-6)).toBe(true)
  })
})
