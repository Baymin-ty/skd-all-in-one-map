import { describe, expect, it } from 'vitest'
import { demoEventsFor, demoPlanFor, DEMO_ACCOUNT_ID, isDemoAccount, canWriteDemoData } from './demoData'
import { overlaps, startMin, endMin } from './today'

describe('demo account', () => {
  it('provides a recognizable read-only identity', () => {
    expect(DEMO_ACCOUNT_ID).toBe('demo-showcase')
    expect(isDemoAccount({ id: DEMO_ACCOUNT_ID } as any)).toBe(true)
    expect(canWriteDemoData({ id: DEMO_ACCOUNT_ID } as any)).toBe(true)
    expect(canWriteDemoData({ id: 'real-user' } as any)).toBe(true)
  })

  it('adds activities that can also appear in the activity radar', () => {
    const events = demoEventsFor('2026-10-19')
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.source === 'organizer' && event.place && event.room)).toBe(true)
    expect(events[0]).toMatchObject({ place: 'a747029d', title: expect.stringContaining('科道书院') })
  })

  it('builds a populated weekly schedule with non-conflicting demo activities', () => {
    const items = demoPlanFor('2026-10-19')
    const classes = items.filter((item) => item.kind === 'class')
    const activities = items.filter((item) => item.kind === 'event')
    expect(classes.length).toBeGreaterThanOrEqual(8)
    expect(activities.length).toBeGreaterThanOrEqual(2)
    expect(activities.every((event) => !classes.some((course) => event.date === '2026-10-19' && course.weekdays?.includes(1) && overlaps(event, course)))).toBe(true)
    expect(activities.every((event) => event.place && event.room)).toBe(true)
    expect(activities.every((event) => startMin(event) < endMin(event))).toBe(true)
  })
})
