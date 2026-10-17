import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Campus } from './types'
import { validateUndergroundMap, type UndergroundMap } from './underground'

const campus = {
  bounds: [[121.594, 31.179], [121.608, 31.187]],
} as Campus

const source = {
  id: 'info-garage-map',
  title: '信息学院地下车库导向图',
  image: '/data/underground/info-garage.jpg',
  floor: -1,
  anchors: [
    { image: [0, 0] as [number, number], pos: [121.6, 31.186] as [number, number] },
    { image: [1, 1] as [number, number], pos: [121.603, 31.183] as [number, number] },
  ],
}

const valid: UndergroundMap = {
  version: 1,
  floor: -1,
  bounds: [[121.6, 31.183], [121.603, 31.186]],
  sources: [source],
  roads: [{ id: 'r-1', floor: -1, mode: 'car', status: 'candidate', path: [[121.6, 31.185], [121.601, 31.185]] }],
  connectors: [{ id: 'c-1', kind: 'stairs', floorFrom: -1, floorTo: 0, status: 'candidate', pos: [121.601, 31.184] }],
}

describe('地下图层数据校验', () => {
  it('当前导入的地下图纸和候选线全部落在地上校园范围内', () => {
    const map = JSON.parse(readFileSync(new URL('../../public/data/underground.json', import.meta.url), 'utf8')) as UndergroundMap
    expect(validateUndergroundMap(map, JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8')))).toEqual([])
    expect(map.sources).toHaveLength(6)
    expect(map.roads.length).toBeGreaterThan(10)
    expect(map.connectors.length).toBeGreaterThan(10)
  })

  it('接受带来源、道路和候选上下点的地下图', () => {
    expect(validateUndergroundMap(valid, campus)).toEqual([])
  })

  it('拒绝越过校园范围的道路', () => {
    const errors = validateUndergroundMap({ ...valid, roads: [{ ...valid.roads[0], path: [[121.6, 31.185], [121.7, 31.185]] }] }, campus)
    expect(errors.some((e) => e.includes('r-1') && e.includes('范围'))).toBe(true)
  })

  it('拒绝没有候选或确认状态的上下点', () => {
    const errors = validateUndergroundMap({ ...valid, connectors: [{ ...valid.connectors[0], status: 'draft' as never }] }, campus)
    expect(errors.some((e) => e.includes('c-1') && e.includes('status'))).toBe(true)
  })
})
