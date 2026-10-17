import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findUndergroundRoute, type UndergroundRouteMap } from './undergroundRoute'
import type { UndergroundMap } from './types'

const map = JSON.parse(readFileSync(new URL('../../public/data/underground.json', import.meta.url), 'utf8')) as UndergroundMap

describe('地下候选路网寻路', () => {
  it('可以在导入的 B1 路网中连接两个地面车库出入口', () => {
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
})
