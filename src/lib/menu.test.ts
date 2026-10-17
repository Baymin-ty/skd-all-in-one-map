import { beforeEach, describe, expect, it } from 'vitest'
import type { Canteen, Dish, Outlet } from './discoveryTypes'
import type { MenuItem } from './menu'
import { groupByCanteen } from './menu'

const dish = (id: string, zh = id, price: number | null = 12): Dish => ({ id, zh, price })
const outlet = (id: string, zh = id): Outlet => ({ id, zh, en: zh, floor: '1F', hours: null, closures: [], stalls: [], dishes: [] })
const item = (cId: string, cZh: string, oId: string, price: number | null, id: string, available = true): MenuItem => {
  const o = outlet(oId)
  const d = dish(id, id, price)
  if (!available) d.soldOut = true
  const c: Canteen = { id: cId, zh: cZh, en: cZh, place: `${cId}-place`, pos: [121.6, 31.18], outlets: [o] }
  o.dishes = [d]
  return { d, o, c, lo: price, hi: price, name: id.toLowerCase(), en: '', stallWords: [], extra: '', place: cZh.toLowerCase() }
}

describe('groupByCanteen', () => {
  it('groups matching dishes by canteen then outlet and aggregates price and hit count', () => {
    const items = [item('c1', '尚科食堂', 'c1-2f', 18, '麻辣香锅'), item('c1', '尚科食堂', 'c1-2f', 28, '麻辣香锅大份'), item('c2', '白玉兰食堂', 'c2-1f', 20, '麻辣香锅')]
    const groups = groupByCanteen(items, () => true)

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ canteen: { id: 'c1' }, count: 2, hitCount: 2, available: true, price: { min: 18, max: 28 } })
    expect(groups[0].outlets).toHaveLength(1)
    expect(groups[0].outlets[0]).toMatchObject({ outlet: { id: 'c1-2f' }, count: 2, hitCount: 2, price: { min: 18, max: 28 } })
    expect(groups[1]).toMatchObject({ canteen: { id: 'c2' }, count: 1, price: { min: 20, max: 20 } })
  })

  it('puts canteens and outlets with no currently available match after available ones', () => {
    const items = [item('c1', '尚科食堂', 'c1-2f', 18, '售罄', false), item('c2', '白玉兰食堂', 'c2-1f', 20, '供应中', true)]
    const groups = groupByCanteen(items, (x) => !x.d.soldOut)

    expect(groups.map((x) => [x.canteen.id, x.available])).toEqual([['c2', true], ['c1', false]])
    expect(groups[1].outlets[0].available).toBe(false)
  })

  it('does not mutate the input or create a price range for unknown prices', () => {
    const items = [item('c1', '尚科食堂', 'c1-2f', null, '现场价')]
    const original = items.slice()
    const groups = groupByCanteen(items, () => false)

    expect(items).toEqual(original)
    expect(groups[0]).toMatchObject({ count: 1, available: false, price: { min: null, max: null } })
  })
})
