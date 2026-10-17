import { describe, expect, it } from 'vitest'
import { normalizeRoadGrid } from './road-network.mjs'

describe('统一地面路网', () => {
  it('把构建期的 OSM 补充格归一为同一类可走格', () => {
    const campus = { grid: { rows: ['10220', '21101'] } }
    expect(normalizeRoadGrid(campus).grid.rows).toEqual(['10000', '01101'])
  })

  it('不改动非路网数据和原对象', () => {
    const construction = [{ name: 'x' }]
    const campus = { name: 'campus', construction, grid: { rows: ['120'] } }
    const normalized = normalizeRoadGrid(campus)
    expect(normalized.name).toBe('campus')
    expect(normalized.construction).toBe(construction)
    expect(campus.grid.rows).toEqual(['120'])
  })
})
