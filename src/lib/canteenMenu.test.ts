import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Canteen, Dish, Outlet } from './discoveryTypes'
import { dateKey, nowTick, timestamp } from './campusTime'
import { defaultMenuDay, dishOnMenu, menuGroups, menuMeals, outletSummary, outletTone, weekDates } from './canteenMenu'
import { roomFloors, roomsFrom } from './rooms'
import { discovery } from './discoveryData'

vi.mock('./ui', () => ({ openSheet: vi.fn(), ui: { desktop: false, sheet: 388, anchors: [136, 388, 740] } }))
import { chooseSearch, closeRoute, openCanteen, search, selectCanteenOutlet, setChip, state } from './store'

const canteens: Canteen[] = JSON.parse(readFileSync(new URL('../../public/data/canteens.json', import.meta.url), 'utf8')).canteens
const places = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8'))
const baseOutlet = (): Outlet => ({ id: 'test', zh: '测试餐厅', en: 'Test', floor: '1F', hours: [['11:00', '13:00', 'lunch'], ['17:00', '20:00', 'dinner']], closures: [], stalls: [{ id: 's', zh: '自选', week: ['2026-10-12', '2026-10-18'] }], dishes: [] })
beforeEach(() => {
  nowTick.value = timestamp('2026-10-16T12:00')
  discovery.canteens = structuredClone(canteens)
  state.buildings = places.buildings
  state.pois = places.pois
  state.categories = places.categories
  state.panel = 'home'
  state.chip = null
  closeRoute()
})

describe('食堂详情的周菜单', () => {
  it('在有记录的周内默认今天，过期后默认整周', () => {
    expect(weekDates(baseOutlet())).toHaveLength(7)
    expect(defaultMenuDay(baseOutlet())).toBe('2026-10-16')
    nowTick.value = timestamp('2026-10-20T12:00')
    expect(defaultMenuDay(baseOutlet())).toBe('')
    nowTick.value = timestamp('2026-10-10T12:00')
    expect(defaultMenuDay(baseOutlet())).toBe('2026-10-12')
  })
  it('同一道菜的不同日期可以对应不同餐次', () => {
    const dish: Dish = { id: 'd', zh: '红烧肉', stall: '自选', days: { '2026-10-16': ['lunch'], '2026-10-17': ['dinner'] } }
    const o = baseOutlet()
    expect(dishOnMenu(dish, o, '2026-10-16', 'lunch')).toBe(true)
    expect(dishOnMenu(dish, o, '2026-10-16', 'dinner')).toBe(false)
    expect(dishOnMenu(dish, o, '2026-10-17', 'dinner')).toBe(true)
    expect(dishOnMenu(dish, o, '2026-10-18')).toBe(false)
    expect(dishOnMenu(dish, o, '', 'dinner')).toBe(true)
    dish.days!['2026-10-18'] = []
    expect(dishOnMenu(dish, o, '', 'breakfast')).toBe(true)
  })
  it('固定菜单每天可见，过期的周菜单不会当成当日菜单', () => {
    const o = baseOutlet()
    expect(dishOnMenu({ id: 'd', zh: '牛肉面' }, o, '2026-10-20')).toBe(true)
    expect(dishOnMenu({ id: 'd', zh: '红烧肉', stall: '自选', days: { '2026-10-16': [] } }, o, '2026-10-20')).toBe(false)
  })
  it('未知营业时间的餐厅仍能从菜单中识别餐次', () => {
    const o = baseOutlet()
    o.hours = null
    o.dishes = [{ id: 'd', zh: '早餐', meals: ['breakfast'] }, { id: 'x', zh: '自选', days: { [dateKey()]: ['lunch', 'dinner'] } }]
    expect(menuMeals(o)).toEqual(['breakfast', 'lunch', 'dinner'])
  })
  it('窗口顺序、空窗口和窗口别名搜索均保留', () => {
    const o = baseOutlet()
    o.stalls.push({ id: 'noodle', zh: '面档', aliases: ['拉面'] }, { id: 'empty', zh: '待录入' })
    o.dishes = [{ id: 'd', zh: '牛肉面', stall: '面档' }]
    expect(menuGroups(o).map((g) => g.stall?.id)).toEqual(['s', 'noodle', 'empty'])
    expect(menuGroups(o, { query: '拉面' })[0].dishes[0].id).toBe('d')
    expect(menuGroups(o, { stall: 'empty' })[0].total).toBe(0)
  })
  it('停止点餐后不再显示供餐中的绿色状态', () => {
    const o = baseOutlet()
    o.lastOrder = { dinner: '19:15' }
    nowTick.value = timestamp('2026-10-16T19:16')
    expect(outletTone(o)).toBe('closed')
    expect(outletSummary(o)).toContain('已停止点餐')
  })
})

describe('入口与房间目录', () => {
  it('左上角食堂进入菜单，再次点击返回；导航选点仍保留地点列表', () => {
    setChip('dining')
    expect(state.panel).toBe('dining')
    setChip('dining')
    expect(state.panel).toBe('home')
    state.route.open = true
    state.route.picking = 'to'
    setChip('dining')
    expect(state.chip).toBe('dining')
    expect(state.route.picking).toBe('to')
  })
  it('食堂详情定位楼层窗口，不清除全校菜单搜索条件', () => {
    state.menu.query = '15元以内的牛肉'
    const c = canteens[0], o = c.outlets[1], s = o.stalls[0]
    openCanteen(c.id, o.id, s.id)
    expect(state.panel).toBe('canteen')
    expect(state.canteen).toMatchObject({ id: c.id, outlet: o.id, stall: s.id })
    expect(state.selected?.id).toBe(c.place)
    expect(state.menu.query).toBe('15元以内的牛肉')
  })
  it('全局搜到窗口后进入该窗口的食堂详情', () => {
    const hit = search('手工牛肉面').find((h) => h.sel.kind === 'canteen' && h.sel.stall)!
    chooseSearch(hit)
    expect(state.panel).toBe('canteen')
    expect(state.canteen.id).toBe(hit.sel.id)
    expect(state.canteen.stall).toBeTruthy()
  })
  it('进入楼层时初始化今天和餐次，重复选当前楼层保留筛选', () => {
    const c = canteens[0]
    openCanteen(c.id)
    expect(state.canteen.day).toBe('2026-10-16')
    expect(state.canteen.meal).toBe('lunch')
    state.canteen.query = '牛肉'
    state.canteen.day = '2026-10-17'
    selectCanteenOutlet(c.outlets[0].id)
    expect(state.canteen.query).toBe('牛肉')
    expect(state.canteen.day).toBe('2026-10-17')
    selectCanteenOutlet(c.outlets[1].id)
    expect(state.canteen.query).toBe('')
    expect(state.canteen.day).toBe('2026-10-16')
    expect(state.canteen.meal).toBe('')
  })
  it('房间目录按楼层排序并允许省略房间号里的连字符', () => {
    const rooms = roomsFrom([{ code: '1B-B101', label: '实验室', floor: -1, kind: 'lab' }, { code: '1A-200', label: '会议室', floor: 2, kind: 'meeting' }, { code: '101', label: '教室', floor: 1 }, null, { id: 'invalid' }])
    expect(roomFloors(rooms, '').map((x) => x.floor)).toEqual([-1, 1, 2])
    expect(roomFloors(rooms, '1a200')[0].rooms[0].label).toBe('会议室')
    expect(roomFloors(rooms, '实验室')[0].floor).toBe(-1)
    expect(roomFloors(rooms, '不存在')).toHaveLength(0)
  })
})
