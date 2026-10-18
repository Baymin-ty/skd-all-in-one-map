import { describe, expect, test } from 'vitest'
import { isTechathon, techathonBadge } from './eventVisuals'

describe('Techathon event visual identity', () => {
  test('recognizes the Techathon event and exposes its badge copy', () => {
    const event = { id: 'm-techathon-2026', title: '上科大首届黑客松 Techathon', category: 'student' } as const
    expect(isTechathon(event)).toBe(true)
    expect(techathonBadge(event)).toEqual({ label: '今日主活动', short: 'TECHATHON' })
  })
})
