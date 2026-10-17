import { afterEach, describe, expect, test } from 'vitest'
import { discovery } from './discoveryData'
import { clearLiveCrowd, crowdAt, setLiveCrowd, type CrowdResponse } from './crowd'

const original = JSON.parse(JSON.stringify(discovery.canteens))

afterEach(() => {
  discovery.canteens = JSON.parse(JSON.stringify(original))
  clearLiveCrowd()
})

describe('crowdAt', () => {
  test('aggregates live outlet feedback for one canteen', () => {
    discovery.canteens = [{
      id: 'c1', zh: '一食堂', en: '', place: 'b1', pos: [121.6, 31.18],
      outlets: [
        { id: 'o1', zh: '一楼', en: '', floor: '1F', hours: null, closures: [], stalls: [], dishes: [] },
        { id: 'o2', zh: '二楼', en: '', floor: '2F', hours: null, closures: [], stalls: [], dishes: [] },
      ],
    }]
    const data: CrowdResponse = {
      o1: { level: 1, waitMin: 5, reports: 2, updatedAt: 1_000 },
      o2: { level: 2, waitMin: 15, reports: 1, updatedAt: 1_000 },
    }
    setLiveCrowd(data)
    expect(crowdAt('c1', 2_000)).toEqual({ level: 1, waitMin: 8, source: 'live' })
  })

  test('falls back to estimate when the live snapshot is stale', () => {
    setLiveCrowd({ c1: { level: 2, waitMin: 20, reports: 1, updatedAt: 0 } })
    expect(crowdAt('c1', 31 * 60_000)).toEqual(expect.objectContaining({ source: 'guess' }))
  })
})
