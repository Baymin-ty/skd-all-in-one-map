import { describe, expect, it } from 'vitest'
import { copyGrid, paintGrid, toRainDraft, validSurfaceGrid } from './network'
const grid = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['010', '111'] }
describe('避雨地面栅格', () => {
  it('校验坐标、尺寸和字符，并可复制成独立版本', () => {
    expect(validSurfaceGrid(grid, grid)).toBe(true)
    expect(validSurfaceGrid({ ...grid, rows: ['00'] }, grid)).toBe(false)
    expect(validSurfaceGrid({ ...grid, rows: ['01x', '111'] }, grid)).toBe(false)
    expect(copyGrid(grid).rows).not.toBe(grid.rows)
  })
  it('画笔/擦除只改变目标格，越界不改变副本', () => {
    const painted = paintGrid(grid, 0, 1, true)
    expect(painted.rows).toEqual(['000', '111'])
    expect(grid.rows).toEqual(['010', '111'])
    expect(paintGrid(grid, -1, 0, true).rows).toEqual(grid.rows)
  })
  it('支持调节画笔大小，以落点为中心覆盖方形区域', () => {
    const big = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['11111', '11111', '11111', '11111', '11111'] }
    expect(paintGrid(big, 2, 2, true, 3).rows).toEqual(['11111', '10001', '10001', '10001', '11111'])
    expect(paintGrid(big, 0, 0, true, 3).rows).toEqual(['00111', '00111', '11111', '11111', '11111'])
    expect(paintGrid(big, 4, 4, true, 3).rows).toEqual(['11111', '11111', '11111', '11100', '11100'])
  })
  it('画笔未改变任何格子时返回原对象', () => {
    const filled = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['000', '000'] }
    expect(paintGrid(filled, 1, 1, true, 3)).toBe(filled)
  })
  it('普通路网草稿转避雨版本时可走字符统一为 0，且幂等', () => {
    const base = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['021', '120'] }
    const draft = toRainDraft(base)
    expect(draft.rows).toEqual(['001', '100'])
    expect([draft.x0, draft.y0, draft.dx, draft.dy]).toEqual([1, 2, .1, .1])
    expect(base.rows).toEqual(['021', '120'])
    expect(toRainDraft(draft).rows).toEqual(draft.rows)
  })
  it('画笔可走时受普通路网 mask 限制，不能创建新路', () => {
    const base = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['010', '111'] }
    const rain = { x0: 1, y0: 2, dx: .1, dy: .1, rows: ['111', '111'] }
    expect(paintGrid(rain, 0, 0, true, 1, base).rows).toEqual(['011', '111'])
    expect(paintGrid(rain, 0, 1, true, 1, base).rows).toEqual(['111', '111'])
    expect(paintGrid(rain, 0, 2, true, 1, base).rows).toEqual(['110', '111'])
  })
})
