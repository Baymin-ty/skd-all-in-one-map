import { describe, expect, it } from 'vitest'
import { findUndergroundRoute, type UndergroundRouteMap } from './undergroundRoute'

const simple = (): UndergroundRouteMap => ({
  floor: -1,
  nodes: [{ id: 'a', pos: [121.6, 31.184] }, { id: 'b', pos: [121.602, 31.184] }],
  edges: [{ id: 'ab', a: 'a', b: 'b' }],
  connectors: [
    { id: 'from', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.601, 31.1842] },
    { id: 'to', floorFrom: -1, floorTo: 0, kind: 'elevator', pos: [121.6018, 31.1842] },
  ],
})
describe('地下显式图寻路', () => {
  it('双向可达；同一边两个投影点直接相连，连接点保持原位', () => {
    const map = simple(), before = structuredClone(map)
    const result = findUndergroundRoute(map, 'from', 'to')!
    expect(result.path[0]).toEqual(map.connectors[0].pos)
    expect(result.path.at(-1)).toEqual(map.connectors[1].pos)
    expect(result.meters).toBeGreaterThan(100)
    expect(result.meters).toBeLessThan(130)
    expect(findUndergroundRoute(map, 'to', 'from')!.meters).toBe(result.meters)
    expect(map).toEqual(before)
  })
  it('相邻但未连接的图不自动连通，几何交叉也不连通', () => {
    const map = simple()
    map.nodes.push({ id: 'c', pos: [121.601, 31.1839] }, { id: 'd', pos: [121.601, 31.1841] })
    map.edges.push({ id: 'cd', a: 'c', b: 'd' })
    map.connectors[0].node = 'a'; map.connectors[1].node = 'd'
    expect(findUndergroundRoute(map, 'from', 'to')).toBeNull()
    map.edges.push({ id: 'bc', a: 'b', b: 'c' })
    expect(findUndergroundRoute(map, 'from', 'to')).not.toBeNull()
  })
  it('绑定优先于最近路段；孤立节点与远处连接点不可达', () => {
    const map = simple()
    map.nodes.push({ id: 'island', pos: map.connectors[0].pos })
    map.connectors[0].node = 'island'
    expect(findUndergroundRoute(map, 'from', 'to')).toBeNull()
    delete map.connectors[0].node
    map.connectors[0].pos = [121.61, 31.19]
    expect(findUndergroundRoute(map, 'from', 'to')).toBeNull()
    expect(findUndergroundRoute(map, 'missing', 'to')).toBeNull()
  })
  it('楼层必须连通地面和本地图楼层', () => {
    const map = simple()
    map.connectors[0].floorFrom = -2
    expect(findUndergroundRoute(map, 'from', 'to')).toBeNull()
  })
})
