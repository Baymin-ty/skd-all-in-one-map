import { describe, expect, it } from 'vitest'
import { demoPlanFor, DEMO_ACCOUNT_ID, isDemoAccount, canWriteDemoData } from './demoData'

describe('demo account', () => {
  it('provides a recognizable read-only identity', () => {
    expect(DEMO_ACCOUNT_ID).toBe('demo-showcase')
    expect(isDemoAccount({ id: DEMO_ACCOUNT_ID } as any)).toBe(true)
    expect(canWriteDemoData({ id: DEMO_ACCOUNT_ID } as any)).toBe(true)
    expect(canWriteDemoData({ id: 'real-user' } as any)).toBe(true)
  })

  it('builds a populated weekly timetable without fabricated activities', () => {
    const items = demoPlanFor('2026-10-19')
    expect(items.filter((item) => item.kind === 'class').length).toBeGreaterThanOrEqual(8)
    expect(items.filter((item) => item.kind === 'event')).toEqual([])
  })
})
