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
  version: 2,
  floor: -1,
  bounds: [[121.6, 31.183], [121.603, 31.186]],
  sources: [source],
  nodes: [{ id: 'n-a', pos: [121.6, 31.185] }, { id: 'n-b', pos: [121.601, 31.185] }],
  edges: [{ id: 'e-1', a: 'n-a', b: 'n-b' }],
  connectors: [{ id: 'c-1', kind: 'stairs', floorFrom: -1, floorTo: 0, pos: [121.601, 31.184] }],
}

describe('地下图层数据校验', () => {
  it('种子地下数据有效：保留参考图纸，道路和出入口由后台重新标注', () => {
    const map = JSON.parse(readFileSync(new URL('../../public/data/underground.json', import.meta.url), 'utf8')) as UndergroundMap
    expect(validateUndergroundMap(map, JSON.parse(readFileSync(new URL('../../public/data/campus.json', import.meta.url), 'utf8')))).toEqual([])
    expect(map.sources).toHaveLength(6)
    expect(map.edges.length).toBeGreaterThan(0)
    expect(map).not.toHaveProperty('roads')
    expect(map.connectors).toHaveLength(26)
    expect([...map.edges, ...map.connectors].every((entity) => !Object.hasOwn(entity, 'status'))).toBe(true)
  })

  it('接受带来源、道路和上下连接点的无状态地下图', () => {
    expect(validateUndergroundMap(valid, campus)).toEqual([])
  })

  it('拒绝越界节点、自环与不存在的引用', () => {
    expect(validateUndergroundMap({ ...valid, nodes: [{ ...valid.nodes[0], pos: [121.7, 31.185] }] }, campus).some((e) => e.includes('范围'))).toBe(true)
    for (const b of ['missing', 'n-a']) expect(validateUndergroundMap({ ...valid, edges: [{ id: 'bad', a: 'n-a', b }] }, campus).some((e) => e.includes('端点'))).toBe(true)
  })

  it('校验路网上图片点的端点、权重和图片 ID', () => {
    const map: UndergroundMap = {
      ...valid,
      nodes: [{ id: 'n-a', pos: [121.6, 31.185] }, { id: 'n-b', pos: [121.601, 31.185] }],
      points: [{ id: 'p-1', endpointId1: 'n-a', endpointWeight1: 0.25, endpointId2: 'n-b', endpointWeight2: 0.75, imageId: 'photo-1' }],
    }
    expect(validateUndergroundMap(map, campus)).toEqual([])
    const errors = validateUndergroundMap({ ...map, points: [{ ...map.points![0], endpointId2: 'missing', endpointWeight1: 0.2, imageId: '' }] }, campus)
    expect(errors.some((e) => e.includes('p-1') && e.includes('端点'))).toBe(true)
    expect(errors.some((e) => e.includes('p-1') && e.includes('权重'))).toBe(true)
    expect(errors.some((e) => e.includes('p-1') && e.includes('图片'))).toBe(true)
  })
})
