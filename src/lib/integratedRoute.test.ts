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

beforeEach(() => initRouting(campus))

describe('地上地下距离导航', () => {
  it('没有地下数据时只返回地面路线', () => {
    const result = findIntegratedRoute({ point: longA }, { point: longB }, null)!
    expect(result).not.toBeNull()
    expect(result.undergroundMeters).toBe(0)
    expect(result.transitions).toEqual([])
    expect(result.segments.every((segment) => segment.layer === 'surface')).toBe(true)
  })

  it('地下捷径短于地面绕行时进入地下并标记分界点', () => {
    initRouting({ ...campus, grid: { ...campus.grid, rows: campus.grid.rows.map((row, i) => i < 25 ? row.slice(0, 18) + '1' + row.slice(19) : row) } })
    const result = findIntegratedRoute({ point: longA }, { point: longB }, underground(longA, longB))!
    expect(result.undergroundMeters).toBeGreaterThan(0)
    expect(result.segments.map((segment) => segment.layer)).toEqual(['surface', 'underground', 'surface'])
    expect(result.transitions.map((transition) => transition.kind)).toEqual(['enter', 'exit'])
    expect(result.transitions.map((transition) => transition.connectorId)).toEqual(['a', 'b'])
  })

  it('地下路线不短于地面时保留地面路线', () => {
    const result = findIntegratedRoute({ point: shortA }, { point: shortB }, underground(shortA, shortB))!
    expect(result.undergroundMeters).toBe(0)
    expect(result.transitions).toEqual([])
  })

  it('小于旧换层附加距离的地下捷径也按距离选择', () => {
    const a: LngLat = [0.00025, 0.00375], b: LngLat = [0.00045, 0.00375]
    initRouting({ ...campus, grid: { ...campus.grid, rows: ['000000', '000000', '000100', '000000', '000000', '000000'] } })
    const result = findIntegratedRoute({ point: a }, { point: b }, underground(a, b))!
    expect(result.undergroundMeters).toBeGreaterThan(0)
    expect(result.transitions).toHaveLength(2)
  })

  it('地下连接点不可达时回退到地面路线', () => {
    const map = underground(longA, longB)
    map.edges = []
    const result = findIntegratedRoute({ point: longA }, { point: longB }, map)!
    expect(result).not.toBeNull()
    expect(result.undergroundMeters).toBe(0)
    expect(result.segments.every((segment) => segment.layer === 'surface')).toBe(true)
  })

  it('支持固定地下路线的进出连接点', () => {
    initRouting({ ...campus, grid: { ...campus.grid, rows: campus.grid.rows.map((row, i) => i < 25 ? row.slice(0, 18) + '1' + row.slice(19) : row) } })
    const map = underground(longA, longB)
    map.connectors.push({ id: 'other-enter', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [0.0003, 0.0038] })
    const result = findIntegratedRoute({ point: longA }, { point: longB }, map, { forceUnderground: true, fixedUndergroundConnectors: { enterId: 'other-enter', exitId: 'b' } })!
    expect(result.transitions.map((transition) => transition.connectorId)).toEqual(['other-enter', 'b'])
  })
})
