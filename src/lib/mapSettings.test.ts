import { describe, expect, it } from 'vitest'
import { batchHighlightOpacity, DEFAULT_MAP_SETTINGS } from './mapSettings'

describe('map settings', () => {
  it('uses 80% of selectable opacity for ordinary buildings during batch highlights', () => {
    expect(batchHighlightOpacity({ ...DEFAULT_MAP_SETTINGS, selectable: 1 })).toBe(0.8)
  })
})
