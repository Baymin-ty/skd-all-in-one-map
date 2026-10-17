import { describe, expect, it } from 'vitest'
import type { LngLat, UndergroundMap } from './types'
import { mergeUndergroundSketch } from './undergroundSketch'

const base: UndergroundMap = { version: 2, floor: -1, bounds: [[121.6, 31.183], [121.603, 31.186]], sources: [], nodes: [], edges: [], connectors: [] }
const paths: LngLat[][] = [[[121.601, 31.184], [121.602, 31.184]], [[121.6015, 31.184], [121.6015, 31.185]]]
describe('地下手绘导入', () => {
  it('转成共享节点和双向边，重复导入分叉草稿无变化', () => {
    const first = mergeUndergroundSketch(base, paths)
    expect(first.edges).toHaveLength(3)
    expect(first.nodes).toHaveLength(4)
    expect(mergeUndergroundSketch(first, paths)).toEqual(first)
    expect(first).not.toHaveProperty('roads')
    expect(first.edges.every((edge) => Object.keys(edge).sort().join() === 'a,b,id')).toBe(true)
  })
  it('保留图纸、图片点及离路连接点', () => {
    const map: UndergroundMap = { ...base, connectors: [{ id: 'off', kind: 'stairs', floorFrom: 0, floorTo: -1, pos: [121.603, 31.186], note: '独立楼梯' }] }
    expect(mergeUndergroundSketch(map, paths).connectors).toEqual(map.connectors)
    expect(mergeUndergroundSketch(base, [[]])).toEqual({ ...base, points: [] })
  })
})
