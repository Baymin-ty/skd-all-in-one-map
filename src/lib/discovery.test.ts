import { readFileSync, existsSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discovery, eventsAhead, eventsIn } from './discoveryData'
import { dateKey, eventStatus, evEnd, icsFor, nowTick, timestamp } from './campusTime'
import { availableNow, menuItems, parseQuery, priceLong, searchMenu } from './menu'
import type { CampusEvent, Canteen, Dish } from './discoveryTypes'
import type { Places } from './types'

vi.mock('./ui', () => ({ openSheet: vi.fn(), ui: { desktop: false, sheet: 740, anchors: [136, 388, 740] } }))
import { chooseSearch, closeRoute, navigateToPlace, search, state } from './store'
import { ui } from './ui'

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${name}.json`, import.meta.url), 'utf8'))
const canteens = load<{ canteens: Canteen[] }>('canteens').canteens
const events = load<CampusEvent[]>('events')
const places = load<Places>('places')
const event = (patch: Partial<CampusEvent> = {}): CampusEvent => ({ id: 'event', title: '测试活动', start: '2026-10-16T10:00:00+08:00', end: '2026-10-16T11:00:00+08:00', allDay: false, venueRaw: '图书馆305', place: null, room: '305', floor: 3, organizer: '测试主办方', category: 'lecture', source: 'official', ...patch })

beforeEach(() => {
  discovery.canteens = structuredClone(canteens)
  discovery.events = structuredClone(events)
  nowTick.value = timestamp('2026-10-16T12:00')
  state.buildings = places.buildings
  state.pois = places.pois
  state.categories = places.categories
  closeRoute()
  state.panel = 'home'
  state.radar.place = ''
  state.selected = null
})

describe('活动时间与筛选', () => {
  it('始终使用上海时区并在结束时切换为往期', () => {
    expect(dateKey(timestamp('2026-10-16T18:00:00Z'))).toBe('2026-10-17')
    expect(eventStatus(event(), timestamp('2026-10-16T10:30'))).toBe('live')
    expect(eventStatus(event(), timestamp('2026-10-16T11:00'))).toBe('past')
    expect(evEnd(event({ end: null }))).toBe(timestamp('2026-10-16T11:30'))
  })
  it('今天包含跨日进行中的活动，并排除当天已结束的活动', () => {
    discovery.events = [event(), event({ id: 'multi', start: '2026-10-15T09:00', end: '2026-10-17T18:00' }), event({ id: 'later', start: '2026-10-16T15:00', end: '2026-10-16T16:00' })]
    expect(eventsIn('today').map((e) => e.id)).toEqual(['multi', 'later'])
    expect(eventsIn('now').map((e) => e.id)).toEqual(['multi'])
    expect(eventsIn('past').map((e) => e.id)).toEqual(['event'])
  })
  it('地图常驻角标取进行中和未来 24 小时内开始的活动，可以跨过午夜', () => {
    discovery.events = [event(), event({ id: 'multi', start: '2026-10-15T09:00', end: '2026-10-17T18:00' }),
      event({ id: 'tomorrow', start: '2026-10-17T11:30', end: null }), event({ id: 'beyond', start: '2026-10-17T12:00', end: null })]
    expect(eventsAhead(24).map((e) => e.id)).toEqual(['multi', 'tomorrow'])
  })
  it('官网已取消的活动保留在目录但不进入待开始角标', () => {
    discovery.events = [event({ id: 'cancelled', start: '2026-10-17T10:00:00+08:00', end: '2026-10-17T11:00:00+08:00', status: 'cancelled' }), event({ id: 'active', start: '2026-10-17T11:00:00+08:00', end: '2026-10-17T12:00:00+08:00' })]
    expect(eventsIn('upcoming').map((e) => e.id)).toEqual(['active'])
  })
  it('近一周、分类和地点可以组合筛选，往期按时间倒序', () => {
    discovery.events = [event({ id: 'next', start: '2026-10-22T12:00', end: null, place: 'library' }), event({ id: 'beyond', start: '2026-10-23T00:00', end: null }), event(), event({ id: 'old', start: '2026-10-15T10:00', end: null })]
    expect(eventsIn('week', 'lecture', 'library').map((e) => e.id)).toEqual(['next'])
    expect(eventsIn('week', 'culture')).toHaveLength(0)
    expect(eventsIn('past').map((e) => e.id)).toEqual(['event', 'old'])
  })
  it('全天多日活动导出的日历覆盖整个活动，中文长标题按字节折行', () => {
    const ics = icsFor(event({ allDay: true, start: '2026-10-16', end: '2026-10-18T23:59:59+08:00', title: '中文讲座标题'.repeat(20) }))
    expect(ics).toContain('DTSTART;VALUE=DATE:20261016')
    expect(ics).toContain('DTEND;VALUE=DATE:20261019')
    expect(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true)
  })
})

describe('菜单搜索', () => {
  it('识别价格、口味和连续的食堂别名', () => {
    expect(parseQuery('15元以内的不辣牛肉')).toMatchObject({ words: ['牛肉'], max: 15, tags: ['mild'] })
    const result = searchMenu('白玉兰牛肉')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((x) => x.c.zh === '白玉兰食堂')).toBe(true)
    expect(searchMenu('饺子').items.length).toBeGreaterThan(0)
  })
  it('价格和标签约束作用于所有结果，排序保持价格升序', () => {
    const { items } = searchMenu('15元以内的牛肉', { max: 10, tags: ['mild'], sort: 'asc' })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((x) => x.lo! <= 10 && !x.d.tags?.some((t) => t.startsWith('spicy')))).toBe(true)
    expect(items.map((x) => x.lo)).toEqual(items.map((x) => x.lo).sort((a, b) => a! - b!))
  })
  it('价格区间要求同一个规格符合上下限，未知价不进入预算结果', () => {
    const outlet = discovery.canteens[0].outlets[0]
    outlet.dishes = [{ id: 'gap', zh: '区间测试', specs: [{ zh: '小份', price: 5 }, { zh: '大份', price: 30 }] }, { id: 'fits', zh: '区间测试', price: 15 }, { id: 'unknown', zh: '区间测试', price: null }]
    expect(searchMenu('区间测试', { min: 10, max: 20 }).items.map((x) => x.d.id)).toEqual(['fits'])
  })
  it('选择窗口不会混入同食堂其他窗口的菜', () => {
    const c = discovery.canteens[0], o = c.outlets[0], s = o.stalls[0]
    const result = searchMenu('', { canteen: c.id, outlet: o.id, stall: s.id })
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((x) => x.c.id === c.id && x.o.id === o.id && x.d.stall === s.zh)).toBe(true)
  })
  it('当前供餐排除售罄、临时停业、过期周菜单及停止点餐后的菜', () => {
    const x = menuItems.value.find((x) => !x.d.days && x.o.id === 'c1-1f' && (!x.d.meals?.length || x.d.meals.includes('lunch')) )!
    expect(availableNow(x)).toBe(true)
    x.d.soldOut = true
    expect(availableNow(x)).toBe(false)
    x.d.soldOut = false
    x.o.closures = [['2026-10-16', '2026-10-17']]
    expect(availableNow(x)).toBe(false)
    x.o.closures = []
    x.o.lastOrder = { lunch: '11:45' }
    expect(availableNow(x)).toBe(false)
    x.o.lastOrder = {}
    x.d.days = { '2026-10-12': ['lunch'] }
    if (x.s) x.s.week = ['2026-10-12', '2026-10-18']
    nowTick.value = timestamp('2026-10-20T12:00')
    expect(availableNow(x)).toBe(false)
  })
  it('多规格价格和单位完整显示', () => {
    const dish: Dish = { id: 'spec', zh: '菜', price: 9, specs: [{ zh: '小份', price: 9 }, { zh: '大份', price: 10 }], unit: '碗' }
    expect(priceLong(dish)).toBe('小份 ¥9 · 大份 ¥10 / 碗')
  })
})

describe('迁移的数据与入口联动', () => {
  it('所有菜品与菜单照片都能在本地找到，餐厅能定位到地图', () => {
    for (const c of canteens) {
      expect([...places.buildings, ...places.pois].some((p) => p.id === c.place), c.zh).toBe(true)
      for (const o of c.outlets) {
        for (const path of [...o.dishes.flatMap((d) => d.photo ? [d.photo] : []), ...o.stalls.flatMap((s) => s.photos || [])]) expect(existsSync(new URL(`../../public/${path}`, import.meta.url)), path).toBe(true)
      }
    }
  })
  it('全局菜品搜索直接打开正确菜品及窗口', () => {
    const hit = search('牛肉面').find((x) => x.sel.kind === 'dish')!
    expect(hit).toBeDefined()
    chooseSearch(hit)
    expect(state.panel).toBe('dining')
    expect(state.menu.dish).toBe(hit.sel.id)
    expect(state.selected?.id).toBe(menuItems.value.find((x) => x.d.id === hit.sel.id)!.c.place)
  })
  it('全局活动搜索打开详情，选导航端点时改为设置举办地点', () => {
    const hit = search('人的处境').find((x) => x.sel.kind === 'event')!
    chooseSearch(hit)
    expect(state.panel).toBe('events')
    expect(state.eventId).toBe(hit.sel.id)
    state.route.picking = 'to'
    chooseSearch(hit)
    expect(state.panel).toBe('home')
    expect(state.route.to?.name).toBe('图书馆')
    expect(state.route.picking).toBe('from')
  })
  it('从展开的菜品详情导航时收回半屏，留出地图供选择起点', () => {
    ui.sheet = ui.anchors[2]
    state.panel = 'dining'
    navigateToPlace(canteens[0].place)
    expect(state.route.to?.name).toBe('丝路食堂')
    expect(state.route.picking).toBe('from')
    expect(ui.sheet).toBe(ui.anchors[1])
  })
})
