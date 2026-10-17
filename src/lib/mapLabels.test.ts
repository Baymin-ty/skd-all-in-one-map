import { describe, expect, it } from 'vitest'
import { collapsedLabelGroups, labelFits, labelLevels, labelPresentation, labelProximity, labelSlots, labelsOverlap, shiftRect } from './mapLabels'

describe('地图标签分层', () => {
  const base = { zoom: 17, detailed: false, emphasized: false }

  it('全校视图保留主要地点和楼群，放大后逐步显示建筑、设施图标和名称', () => {
    expect(labelPresentation({ ...base, kind: 'group' })).toBe('full')
    expect(labelPresentation({ ...base, kind: 'building', overview: true })).toBe('full')
    expect(labelPresentation({ ...base, kind: 'building' })).toBe('hidden')
    expect(labelPresentation({ ...base, kind: 'building', zoom: 18 })).toBe('full')
    expect([17, 18, 19].map(zoom => labelPresentation({ ...base, kind: 'poi', zoom })))
      .toEqual(['hidden', 'icon', 'full'])
  })

  it('选中和筛选中的地点不受缩放层级限制；详细模式允许查看所有候选名称', () => {
    for (const kind of ['building', 'poi'] as const) {
      expect(labelPresentation({ ...base, kind, zoom: 15, emphasized: true })).toBe('full')
      expect(labelPresentation({ ...base, kind, detailed: true })).toBe('full')
    }
  })
})

describe('地图标签避让', () => {
  const label = { left: 100, right: 180, top: 100, bottom: 126 }

  it('标签之间保留可读间距，详细模式可以更紧凑', () => {
    const nearby = { left: 186, right: 230, top: 100, bottom: 126 }
    expect(labelsOverlap(label, nearby)).toBe(true)
    expect(labelsOverlap(label, nearby, 5, 4)).toBe(false)
    expect(labelsOverlap(label, { ...nearby, left: 175 }, 5, 4)).toBe(true)
    expect(labelsOverlap(label, { ...label, top: 130, bottom: 155 })).toBe(true)
    expect(labelsOverlap(label, { ...label, top: 134, bottom: 160 })).toBe(false)
  })

  it('界面遮挡区和越过可见边缘的标签不能占用排布位置', () => {
    expect(labelFits(label, { left: 90, right: 240, top: 80, bottom: 180 })).toBe(true)
    expect(labelFits(label, { left: 110, right: 240, top: 80, bottom: 180 })).toBe(false)
    expect(labelFits(label, { left: 90, right: 170, top: 80, bottom: 180 })).toBe(false)
    expect(labelFits(label, { left: 90, right: 240, top: 110, bottom: 180 })).toBe(false)
    expect(labelFits(label, { left: 90, right: 240, top: 80, bottom: 120 })).toBe(false)
  })
})

describe('标签候选位置与精简层级', () => {
  const label = { left: 100, right: 190, top: 100, bottom: 129 }

  it('先放正中，再上下、左右小幅微移，标签仍压在地点上', () => {
    const slots = labelSlots(90, 29)
    expect(slots.map((s) => s.slot)).toEqual(['c', 'n', 's', 'e', 'w'])
    expect(slots[0]).toEqual({ slot: 'c', dx: 0, dy: 0 })
    for (const s of slots) {
      expect(Math.abs(s.dy)).toBeLessThanOrEqual(22)
      expect(Math.abs(s.dx)).toBeLessThanOrEqual(36)
    }
    // 两行的活动标签也只挪半个身位左右，不会离开地点太远
    expect(Math.max(...labelSlots(220, 50).map((s) => Math.abs(s.dy)))).toBe(22)
    // 只剩图标时左右至少挪开一个图标宽
    expect(labelSlots(29, 29).find((s) => s.slot === 'w')!.dx).toBe(-26)
  })

  it('上一次用过的位置优先，平移地图时标签不会来回跳', () => {
    expect(labelSlots(90, 29, 's').map((s) => s.slot)).toEqual(['s', 'c', 'n', 'e', 'w'])
    expect(labelSlots(90, 29, 'c').map((s) => s.slot)).toEqual(['c', 'n', 's', 'e', 'w'])
    expect(labelSlots(90, 29, 'unknown').map((s) => s.slot)).toEqual(['c', 'n', 's', 'e', 'w'])
  })

  it('微移后的范围参与避让：正中挡住时，上移一格可以让开', () => {
    const blocker = { left: 120, right: 200, top: 132, bottom: 160 }
    const up = labelSlots(90, 29).find((s) => s.slot === 'n')!
    expect(labelsOverlap(label, blocker)).toBe(true)
    expect(labelsOverlap(shiftRect(label, up.dx, up.dy), blocker)).toBe(false)
  })

  it('层级按给定顺序尝试，未知值忽略，缺省只有完整一级', () => {
    expect(labelLevels('full brief icon')).toEqual(['full', 'brief', 'icon'])
    expect(labelLevels('brief icon')).toEqual(['brief', 'icon'])
    expect(labelLevels('full bogus')).toEqual(['full'])
    expect(labelLevels(undefined)).toEqual(['full'])
    expect(labelLevels('')).toEqual(['full'])
  })
})

describe('鼠标距离聚焦', () => {
  const rect = { left: 100, right: 180, top: 100, bottom: 130 }

  it('标签内强度稳定，边界连续，距离增大时平滑减弱', () => {
    expect(labelProximity(140, 115, rect)).toBe(1)
    expect(labelProximity(100, 100, rect)).toBe(1)
    expect(labelProximity(99.99, 100, rect)).toBeCloseTo(1, 5)
    expect(labelProximity(245, 115, rect)).toBeCloseTo(.5)
    expect(labelProximity(310, 115, rect)).toBe(0)
    expect(labelProximity(500, 500, rect)).toBe(0)
  })

  it('两侧和对角线使用相同的实际距离，不会产生超过 1 的放大强度', () => {
    expect(labelProximity(35, 115, rect)).toBe(labelProximity(245, 115, rect))
    expect(labelProximity(180 + 39, 130 + 52, rect)).toBeCloseTo(.5)
    for (const x of [-1000, 0, 100, 140, 180, 500])
      for (const y of [-1000, 0, 100, 115, 130, 500]) {
        expect(labelProximity(x, y, rect)).toBeGreaterThanOrEqual(0)
        expect(labelProximity(x, y, rect)).toBeLessThanOrEqual(1)
      }
  })
})

describe('楼群标签层级互斥', () => {
  const groups = [{ id: 'housing', members: ['h1', 'h2'] }, { id: 'academic', members: ['a1', 'a2'] }]
  it('未展开时保留父标签，显示任一子项时仅隐藏对应父标签', () => {
    expect(collapsedLabelGroups(groups, new Set(), new Set()).map(g => g.id)).toEqual(['housing', 'academic'])
    expect(collapsedLabelGroups(groups, new Set(), new Set(['h1', 'unrelated'])).map(g => g.id)).toEqual(['academic'])
    expect(collapsedLabelGroups(groups, new Set(), new Set(['h1', 'a2']))).toEqual([])
  })
  it('主动展开的楼群不因子项暂时被避让而再次出现父标签', () => {
    expect(collapsedLabelGroups(groups, new Set(['academic']), new Set()).map(g => g.id)).toEqual(['housing'])
  })
})
