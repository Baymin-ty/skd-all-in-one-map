import { beforeEach, describe, expect, it } from 'vitest'
import { initRouting } from './route'
import { findIntegratedRoute } from './integratedRoute'
import type { Campus, LngLat, UndergroundMap } from './types'

const campus: Campus = {
  boundary: [[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.004]],
  bounds: [[0, 0], [0.004, 0.004]],
  grid: {
    x0: 0, y0: 0.004, dx: 0.0001, dy: 0.0001,
    rows: Array.from({ length: 40 }, () => '0'.repeat(40)),
  },
}

const longA: LngLat = [0.0002, 0.0038]
const longB: LngLat = [0.0035, 0.0038]
const shortA: LngLat = [0.001, 0.0038]
const shortB: LngLat = [0.0012, 0.0038]

function underground(a: LngLat, b: LngLat): UndergroundMap {
  return {
    version: 2,
    floor: -1,
    bounds: [[0, 0], [0.004, 0.004]],
    sources: [],
    nodes: [{ id: 'na', pos: a }, { id: 'nb', pos: b }],
    edges: [{ id: 'edge', a: 'na', b: 'nb' }],
    connectors: [
      { id: 'a', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: a },
      { id: 'b', floorFrom: 0, floorTo: -1, kind: 'elevator', pos: b },
    ],
  }
}

beforeEach(() => initRouting(campus, []))

describe('地上地下雨天一体化导航', () => {
  it('晴天只返回地面路线', () => {
    const result = findIntegratedRoute({ point: longA }, { point: longB }, underground(longA, longB), { rain: false })!
    expect(result).not.toBeNull()
    expect(result.undergroundMeters).toBe(0)
    expect(result.transitions).toEqual([])
    expect(result.segments.every((segment) => segment.layer === 'surface')).toBe(true)
  })

  it('雨天长露天段会进入地下并标记两个分界点', () => {
    const result = findIntegratedRoute({ point: longA }, { point: longB }, underground(longA, longB), { rain: true })!
    expect(result.undergroundMeters).toBeGreaterThan(0)
    expect(result.segments.map((segment) => segment.layer)).toEqual(['surface', 'underground', 'surface'])
    expect(result.transitions.map((transition) => transition.kind)).toEqual(['enter', 'exit'])
    expect(result.transitions.map((transition) => transition.connectorId)).toEqual(['a', 'b'])
  })

  it('雨天只有十米左右露天时保留地面路线', () => {
    const result = findIntegratedRoute({ point: shortA }, { point: shortB }, underground(shortA, shortB), { rain: true })!
    expect(result.undergroundMeters).toBe(0)
    expect(result.transitions).toEqual([])
  })

  it('地下连接点不可达时回退到地面雨天路线', () => {
    const map = underground(longA, longB)
    map.edges = []
    const result = findIntegratedRoute({ point: longA }, { point: longB }, map, { rain: true })!
    expect(result).not.toBeNull()
    expect(result.undergroundMeters).toBe(0)
    expect(result.segments.every((segment) => segment.layer === 'surface')).toBe(true)
  })

})
