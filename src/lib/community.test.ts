import { describe, expect, test } from 'vitest'
import { dishCommunity } from './community'

describe('community dish identifiers', () => {
  test('keeps a dish rating scoped to its canteen and outlet', () => {
    expect(dishCommunity('c1', 'o2', 'd3')).toBe('c1:o2:d3')
  })
})
