import { describe, expect, it } from 'vitest'
import { orderStreetViewPoints } from './streetViewOrder'
import { findUndergroundRoute, type UndergroundRouteMap } from './undergroundRoute'
import type { UndergroundStreetViewPoint } from './types'

// a —— b —— c —— d 一条直线（经度方向），另有一条平行旁路 b —— e —— c（北侧，更长）。
const map = (): UndergroundRouteMap => ({
  floor: -1,
  nodes: [
    { id: 'a', pos: [121.600, 31.184] }, { id: 'b', pos: [121.601, 31.184] },
    { id: 'c', pos: [121.602, 31.184] }, { id: 'd', pos: [121.603, 31.184] },
    { id: 'e', pos: [121.6015, 31.1846] },
  ],
  edges: [
    { id: 'ab', a: 'a', b: 'b' }, { id: 'cb', a: 'c', b: 'b' }, { id: 'cd', a: 'c', b: 'd' },
    { id: 'be', a: 'b', b: 'e' }, { id: 'ec', a: 'e', b: 'c' },
  ],
  connectors: [
    // 投影到 ab 的中点和 cd 的中点
    { id: 'west', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.6005, 31.18405] },
    { id: 'east', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.6025, 31.18405] },
  ],
})
const pt = (id: string, e1: string, e2: string, w2: number): UndergroundStreetViewPoint =>
  ({ id, endpointId1: e1, endpointWeight1: 1 - w2, endpointId2: e2, endpointWeight2: w2, imageId: id })
const points = [
  pt('cd-mid-before', 'c', 'd', 0.25),
  pt('ab-before-start', 'a', 'b', 0.2), // 在起点投影（0.5）之前，不在路线上
  pt('ab-on', 'a', 'b', 0.8),
  pt('bc-1', 'c', 'b', 0.7), // 存储方向与路线相反：c→b 的 0.7 即 b→c 的 0.3
  pt('bc-2', 'b', 'c', 0.6),
  pt('side', 'b', 'e', 0.5), // 平行旁路
  pt('cd-after-end', 'd', 'c', 0.1), // c→d 的 0.9，超出终点投影
]

describe('街景点按路线有向边排序', () => {
  it('正向：按经过顺序排列，排除旁路和部分边之外的点', () => {
    const route = findUndergroundRoute(map(), 'west', 'east')!
    expect(route.edges).toEqual([
      { a: 'a', b: 'b', from: expect.closeTo(0.5, 3), to: 1 },
      { a: 'c', b: 'b', from: 1, to: 0 },
      { a: 'c', b: 'd', from: 0, to: expect.closeTo(0.5, 3) },
    ])
    expect(orderStreetViewPoints(route.edges, points).map((p) => p.id)).toEqual(['ab-on', 'bc-1', 'bc-2', 'cd-mid-before'])
  })
  it('反向路线给出相反顺序', () => {
    const route = findUndergroundRoute(map(), 'east', 'west')!
    expect(orderStreetViewPoints(route.edges, points).map((p) => p.id)).toEqual(['cd-mid-before', 'bc-2', 'bc-1', 'ab-on'])
  })
  it('路线经过旁路时只包含旁路上的点', () => {
    const steps = [{ a: 'b', b: 'e', from: 0, to: 1 }, { a: 'e', b: 'c', from: 0, to: 1 }]
    expect(orderStreetViewPoints(steps, points).map((p) => p.id)).toEqual(['side'])
  })
  it('部分起止边：只保留实际走过的区间', () => {
    const steps = [{ a: 'a', b: 'b', from: 0.9, to: 0.1 }]
    expect(orderStreetViewPoints(steps, points).map((p) => p.id)).toEqual(['ab-on', 'ab-before-start'])
    expect(orderStreetViewPoints([{ a: 'a', b: 'b', from: 0.5, to: 0.7 }], points)).toEqual([])
  })
})
