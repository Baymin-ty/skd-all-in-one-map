import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLabelHover } from './mapLabelHover'

const building = { kind: 'building', id: 'a' }
const poi = { kind: 'poi', id: 'a' }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('地点与标签的悬停交接', () => {
  it('在同一地点内移动不重复更新，从建筑移入标签不会先隐藏再显示', () => {
    const changed = vi.fn()
    const hover = createLabelHover(changed, () => true)
    hover.set(building)
    for (let i = 0; i < 20; i++) hover.set({ ...building })
    hover.leave(building)
    vi.advanceTimersByTime(50)
    hover.set({ ...building })
    vi.advanceTimersByTime(200)
    expect(changed.mock.calls).toEqual([[building]])
    hover.leave(building)
    vi.advanceTimersByTime(100)
    expect(changed.mock.calls).toEqual([[building], [null]])
  })

  it('从旧地点移入新地点，迟到的 mouseout 不会清掉新标签', () => {
    const changed = vi.fn()
    const hover = createLabelHover(changed, () => true)
    hover.set(building)
    hover.set(poi)
    hover.leave(building)
    vi.advanceTimersByTime(200)
    expect(changed.mock.calls).toEqual([[building], [poi]])
    hover.leave(poi)
    vi.advanceTimersByTime(100)
    expect(changed).toHaveBeenLastCalledWith(null)
  })

  it('拖动或触屏时不建立悬停，但离开地图可以立即清理现有标签', () => {
    let allowed = true
    const changed = vi.fn()
    const hover = createLabelHover(changed, () => allowed)
    hover.set(building)
    allowed = false
    hover.set(poi)
    expect(changed).toHaveBeenCalledTimes(1)
    hover.set(null)
    expect(changed).toHaveBeenLastCalledWith(null)
    hover.set(building)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('卸载后不再执行延迟隐藏回调', () => {
    const changed = vi.fn()
    const hover = createLabelHover(changed, () => true)
    hover.set(building)
    hover.leave(building)
    hover.dispose()
    vi.advanceTimersByTime(200)
    expect(changed.mock.calls).toEqual([[building]])
  })
})
