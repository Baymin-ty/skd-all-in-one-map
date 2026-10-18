import { describe, expect, it } from 'vitest'
import { allMapLabels, defaultMapLabels, labelShown, PICKER_CATEGORIES } from './mapLabelCategories'

describe('on-demand label categories', () => {
  it('keeps parking out of the picker', () => {
    const ids = PICKER_CATEGORIES.map((c) => c.id)
    expect(ids).not.toContain('transport')
    expect(ids).toContain('academic')
  })

  it('never shows them by default, even when an old saved setting turned them on', () => {
    const all = allMapLabels(true)
    expect(labelShown(all, 'transport')).toBe(false)
    expect(labelShown(all, 'academic')).toBe(true)
    expect(labelShown(allMapLabels(false), 'academic')).toBe(false)
  })

  it('shows life services by default on the whole-campus map', () => {
    expect(defaultMapLabels().service).toBe(true)
  })
})
