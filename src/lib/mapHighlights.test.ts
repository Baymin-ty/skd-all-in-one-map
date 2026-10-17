import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discovery } from './discoveryData'
import { nowTick, timestamp } from './campusTime'
import type { CampusEvent, Canteen } from './discoveryTypes'
import type { Places } from './types'

vi.mock('./ui', () => ({ openSheet: vi.fn(), ui: { desktop: true, sheet: 388, anchors: [136, 388, 740] } }))
import { mapHighlights, myAgenda, openCanteen, select, setChip, setMapView, setMyScope, showPanel, state } from './store'
import { plan, type PlanItem } from './today'

const places: Places = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8'))
const canteens: Canteen[] = JSON.parse(readFileSync(new URL('../../public/data/canteens.json', import.meta.url), 'utf8')).canteens
const events: CampusEvent[] = JSON.parse(readFileSync(new URL('../../public/data/events.json', import.meta.url), 'utf8'))

beforeEach(() => {
  state.buildings = places.buildings
  state.pois = places.pois
  discovery.canteens = canteens
  discovery.events = events
  nowTick.value = timestamp('2026-10-16T12:00')
  Object.assign(state.radar, { range: 'week', cat: 'all', place: '' })
  showPanel('home')
})

describe('分类在地图中批量选中', () => {
  it('食堂面板即使不使用普通分类列表，也选中所有食堂建筑及餐饮地点', () => {
    setChip('dining')
    expect(state.chip).toBeNull()
    expect(state.panel).toBe('dining')
    const buildings = places.buildings.filter((b) => mapHighlights.value.has(b.id))
    expect(buildings.map((b) => b.id).sort()).toEqual(places.buildings.filter((b) => b.cat === 'dining').map((b) => b.id).sort())
    for (const c of canteens) expect(mapHighlights.value.has(c.place)).toBe(true)
    expect(buildings.map((b) => b.id)).toContain('5149e81e') // 咖啡馆有独立楼体，同样参与餐饮分类高亮。
  })
  it('打开某个食堂详情时保留同类批量选中，并单独选中当前食堂', () => {
    openCanteen(canteens[0].id)
    expect(state.selected?.id).toBe(canteens[0].place)
    for (const b of places.buildings.filter((b) => b.cat === 'dining')) expect(mapHighlights.value.has(b.id)).toBe(true)
  })
  it('切换分类替换整个集合，楼群内的每栋楼都选中，退出分类后清空', () => {
    setChip('dining')
    setChip('academic')
    expect([...mapHighlights.value].sort()).toEqual(places.buildings.filter((b) => b.cat === 'academic').map((b) => b.id).sort())
    setChip('academic')
    expect(mapHighlights.value.size).toBe(0)
    setChip('housing')
    const building = places.buildings.find((b) => b.cat === 'housing')!
    select({ kind: 'building', id: building.id }, false)
    expect(mapHighlights.value.size).toBe(0)
    expect(state.selected?.id).toBe(building.id)
  })
  it('活动场地随时间、类型和地点筛选更新，没有可定位结果时不保留上次高亮', () => {
    const a = places.buildings[0].id, b = places.buildings[1].id
    discovery.events = [
      { ...events[0], id: 'a', place: a, start: '2026-10-16T14:00', end: '2026-10-16T16:00', category: 'lecture' },
      { ...events[0], id: 'b', place: b, start: '2026-10-16T14:00', end: '2026-10-16T16:00', category: 'culture' },
      { ...events[0], id: 'unmapped', place: 'missing-place', start: '2026-10-16T14:00', end: '2026-10-16T16:00' },
    ]
    showPanel('events')
    expect([...mapHighlights.value].sort()).toEqual([a, b].sort())
    state.radar.cat = 'lecture'
    expect([...mapHighlights.value]).toEqual([a])
    state.radar.place = b
    expect(mapHighlights.value.size).toBe(0)
  })
  it('导航选点仍可批量高亮分类，不会替用户提交导航终点', () => {
    state.route.open = true
    state.route.picking = 'to'
    setChip('dining')
    expect(state.panel).toBe('home')
    expect(state.route.picking).toBe('to')
    expect(mapHighlights.value.has(canteens[0].place)).toBe(true)
  })
})

describe('我的地图', () => {
  const item = (patch: Partial<PlanItem>): PlanItem => ({ id: Math.random().toString(36), kind: 'class', title: '课', start: '08:15', end: '09:55', source: 'manual', ...patch })
  const [teach, lab, canteen, dorm] = ['edb12f3d', '82807efc', 'd7191508', 'a747029d']
  beforeEach(() => {
    // 2026-10-16 是周五
    plan.items = [
      item({ place: teach, weekdays: [5] }),
      item({ place: lab, weekdays: [2] }),
      item({ kind: 'meal', place: canteen, date: '2026-10-16', start: '12:00' }),
    ]
    plan.date = '2026-10-16'
    state.mapPrefs = { ...state.mapPrefs, places: [{ id: 'dorm', role: 'dorm', place: dorm }] }
    setMapView('mine')
  })

  it('只高亮这一天有安排的地点和常用地点，切回全校地图后清空', () => {
    expect([...mapHighlights.value].sort()).toEqual([teach, canteen, dorm].sort())
    expect(myAgenda.value.stops.map((s) => s.place)).toEqual([teach, canteen])
    setMapView('all')
    expect(mapHighlights.value.size).toBe(0)
  })
  it('本周把每周的课都算进来', () => {
    setMyScope('week')
    expect(myAgenda.value.week).toBe(true)
    expect(new Set(myAgenda.value.stops.map((s) => s.place))).toEqual(new Set([teach, lab, canteen]))
    setMyScope('today')
    expect(myAgenda.value.week).toBe(false)
  })
  it('打开活动雷达等其他功能时让给它们自己的高亮', () => {
    showPanel('events')
    expect(mapHighlights.value.has(dorm)).toBe(false)
    expect(mapHighlights.value.has(teach)).toBe(false)
  })
})
