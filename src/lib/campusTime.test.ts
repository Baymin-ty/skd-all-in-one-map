import { afterEach, describe, expect, test } from 'vitest'
import { clockOffset, configureDemoClock, demoClockEnabled, demoNow, resetDemoClock, speed, timestamp } from './campusTime'

afterEach(() => resetDemoClock(0))

describe('demo campus clock', () => {
  test('maps a campus timestamp to the wall clock', () => {
    const wall = 1_000
    const target = timestamp('2026-10-20T11:50')
    expect(configureDemoClock('?now=2026-10-20T11:50', wall)).toBe(true)
    expect(clockOffset.value).toBe(target - wall)
    expect(speed.value).toBe(1)
    expect(demoClockEnabled.value).toBe(true)
    expect(demoNow(wall + 30_000)).toBe(target + 30_000)
  })

  test('advances by the requested speed', () => {
    const wall = 2_000
    const target = timestamp('2026-10-20T11:50')
    configureDemoClock('?now=2026-10-20T11:50&speed=60', wall)
    expect(speed.value).toBe(60)
    expect(demoNow(wall + 1_000)).toBe(target + 60_000)
  })

  test('ignores malformed clock parameters', () => {
    expect(configureDemoClock('?now=not-a-date&speed=60', 3_000)).toBe(false)
    expect(demoClockEnabled.value).toBe(false)
    expect(demoNow(4_000)).toBe(4_000)
    expect(configureDemoClock('?now=2026-10-20T11:50&speed=-1', 3_000)).toBe(true)
    expect(speed.value).toBe(1)
  })
})
