import { describe, expect, it } from 'vitest'
import type { UndergroundMap } from './types'
import { mergeUndergroundSketch, sketchRoads } from './undergroundSketch'

const base: UndergroundMap = {
  version: 1,
  floor: -1,
  bounds: [[121.6, 31.183], [121.603, 31.186]],
  sources: [],
  roads: [],
  connectors: [],
}

describe('地下手绘迁移', () => {
  it('把已完成的手绘线段转换成可编辑的 B1 车行道路', () => {
    const roads = sketchRoads([[[121.601, 31.184], [121.602, 31.184]]])
    expect(roads).toEqual([expect.objectContaining({
      id: 'ug-sketch-1', floor: -1, mode: 'car', direction: 'both', status: 'candidate',
      path: [[121.601, 31.184], [121.602, 31.184]], source: 'front-sketch',
    })])
  })

  it('迁移手绘时保留已有地下道路，并且不会重复导入同一份草稿', () => {
    const first = mergeUndergroundSketch(base, [[[121.601, 31.184], [121.602, 31.184]]])
    const second = mergeUndergroundSketch(first, [[[121.601, 31.184], [121.602, 31.184]]])
    expect(first.roads).toHaveLength(1)
    expect(second.roads).toEqual(first.roads)
  })
})
