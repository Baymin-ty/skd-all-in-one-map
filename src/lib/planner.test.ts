import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nowTick, timestamp } from './campusTime'
import { crowdAt } from './crowd'
import type { CampusEvent, Canteen } from './discoveryTypes'
import { lateLegs, nextStep, suggestActivityPushes, suggestEvents, suggestMeals, type PlanContext } from './planner'
import { addItem, endMin, fromMin, initPlan, itemFromEvent, itemsOn, itemsOnIncludingEvents, plan, weekdayOf, type PlanItem } from './today'

const canteen = (id: string, place: string, hours: [string, string, 'lunch' | 'dinner' | 'allday'][], extra: Partial<Canteen['outlets'][number]> = {}): Canteen => ({
  id, zh: id, en: id, place, pos: [0, 0],
  outlets: [{ id: `${id}-1`, zh: '1 楼', en: '1F', floor: '1', hours, closures: [], stalls: [], dishes: [], ...extra }],
})
const event = (patch: Partial<CampusEvent>): CampusEvent => ({ id: 'e', title: '讲座', start: '2026-10-16T14:00:00+08:00', end: '2026-10-16T15:00:00+08:00', allDay: false, venueRaw: '', place: 'lib', room: '', floor: null, organizer: '', category: 'lecture', source: 'official', ...patch })
const item = (patch: Partial<PlanItem>): PlanItem => ({ id: Math.random().toString(36), kind: 'class', title: '课', start: '08:00', end: '09:35', date: '2026-10-16', source: 'manual', ...patch })
/** 地点之间的步行分钟数：同一字母开头算近，其他 8 分钟 */
const walk = (a?: string, b?: string) => !a || !b ? null : a === b ? 0 : a[0] === b[0] ? 3 : 8
const ctx = (items: PlanItem[], patch: Partial<PlanContext> = {}): PlanContext => ({
  date: '2026-10-16', now: timestamp('2026-10-16T08:00'), items, walk, crowd: crowdAt,
  canteens: [canteen('near', 'sem-canteen', [['11:00', '13:00', 'lunch'], ['17:00', '19:00', 'dinner']]), canteen('far', 'x-canteen', [['11:00', '13:00', 'lunch'], ['17:00', '19:00', 'dinner']])],
  events: [], ...patch,
})

describe('我的今天：时间线', () => {
  it('每周重复的课按星期展开，一次性安排只在当天出现', () => {
    expect(weekdayOf('2026-10-16')).toBe(5)
    const items = [item({ id: 'weekly', date: undefined, weekdays: [5] }), item({ id: 'once', date: '2026-10-17', start: '07:00' })]
    expect(itemsOn(items, '2026-10-16').map((i) => i.id)).toEqual(['weekly'])
    expect(itemsOn(items, '2026-10-23').map((i) => i.id)).toEqual(['weekly'])
    expect(itemsOn(items, '2026-10-17').map((i) => i.id)).toEqual(['once'])
  })
  it('按校历教学周过滤限定周次的课程', () => {
    const limited = item({ id: 'week-2', date: undefined, weekdays: [1], weeks: [2], term: '2026-autumn' })
    expect(itemsOn([limited], '2026-09-14')).toHaveLength(0)
    expect(itemsOn([limited], '2026-09-21')).toHaveLength(1)
  })
  it('把活动数据自动并入当天时间线，并避免和已导入活动重复', () => {
    const events = [event({ id: 'campus-1', start: '2026-10-16T12:00', end: '2026-10-16T13:00' }), event({ id: 'campus-2', start: '2026-10-17T12:00', end: '2026-10-17T13:00' })]
    const imported = { ...itemFromEvent(events[0]), id: 'saved-event', source: 'event' as const }
    expect(itemsOnIncludingEvents([imported], events, '2026-10-16').map((i) => i.id)).toEqual(['saved-event'])
    expect(itemsOnIncludingEvents([], events, '2026-10-16').map((i) => i.id)).toEqual(['event:campus-1'])
  })
  it('没填结束时间按类型估算；活动加入时跨天的只取开始那天', () => {
    expect(fromMin(endMin(item({ end: undefined })))).toBe('09:30')
    expect(itemFromEvent(event({ start: '2026-10-15T09:00', end: '2026-10-18T18:00' }))).toMatchObject({ date: '2026-10-15', start: '09:00', end: undefined })
    expect(itemFromEvent(event({}))).toMatchObject({ kind: 'event', date: '2026-10-16', start: '14:00', end: '15:00', eventId: 'e' })
  })
  it('相邻两项来不及走过去时算出会迟到几分钟', () => {
    const legs = lateLegs(ctx([item({ id: 'a', place: 'sem', end: '11:55' }), item({ id: 'b', place: 'lib', start: '12:00', end: '13:00' })]))
    expect(legs.get('b')).toEqual({ walk: 8, late: 3 })
  })
})

describe('我的今天：存储', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('浏览器禁用存储时退回内存并标记未保存', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    initPlan()
    addItem({ kind: 'todo', title: '取快递', start: '18:00', date: plan.date, source: 'manual' })
    expect(plan.items).toHaveLength(1)
    expect(plan.persisted).toBe(false)
  })
  it('读写同一个键，坏数据被过滤', () => {
    const store = new Map<string, string>([['stmap.today.v1', JSON.stringify({ items: [{ id: 'x', kind: 'class', title: '数学', start: '08:00' }, { bad: true }] })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    initPlan()
    expect(plan.items.map((i) => i.id)).toEqual(['x'])
    addItem({ kind: 'todo', title: '取快递', start: '18:00', source: 'manual' })
    expect(JSON.parse(store.get('stmap.today.v1')!).items).toHaveLength(2)
    expect(plan.persisted).toBe(true)
  })
})

describe('我的今天：建议', () => {
  beforeEach(() => { nowTick.value = timestamp('2026-10-16T08:00') })
  it('按下课地点推荐近的食堂，并在下一节课前回来', () => {
    const [lunch, dinner] = suggestMeals(ctx([item({ place: 'sem', start: '10:15', end: '11:50' }), item({ place: 'sem', start: '13:30', end: '15:05' })]))
    expect(lunch).toMatchObject({ meal: 'lunch', walkIn: 3, walkOut: 3 })
    expect(lunch.canteen.id).toBe('near')
    expect(lunch.back).toBeLessThanOrEqual(13 * 60 + 30)
    expect(dinner.meal).toBe('dinner')
  })
  it('空档够长时晚点出发避开 12 点高峰，空档紧时下课就走', () => {
    const [relaxed] = suggestMeals(ctx([item({ place: 'sem', start: '10:15', end: '11:50' }), item({ place: 'sem', start: '13:30', end: '15:05' })]))
    expect(relaxed.delay).toBeGreaterThan(0)
    expect(relaxed.crowd.waitMin).toBeLessThan(crowdAt('near', timestamp('2026-10-16T11:53')).waitMin)
    const [tight] = suggestMeals(ctx([item({ place: 'sem', start: '10:15', end: '11:50' }), item({ place: 'sem', start: '12:40', end: '15:05' })]))
    expect(tight).toMatchObject({ delay: 0, leave: 11 * 60 + 50 })
  })
  it('空档太短、已经安排了吃饭、或者饭点已过都不推荐', () => {
    const tight = suggestMeals(ctx([item({ place: 'sem', start: '10:15', end: '11:50' }), item({ place: 'lib', start: '12:00', end: '17:00' })]))
    expect(tight.map((s) => s.meal)).toEqual(['dinner'])
    const planned = suggestMeals(ctx([item({ kind: 'meal', start: '12:00', end: '12:30' })]))
    expect(planned.map((s) => s.meal)).toEqual(['dinner'])
    expect(suggestMeals(ctx([], { now: timestamp('2026-10-16T19:30') }))).toEqual([])
  })
  it('食堂停业或没开门的窗口不推荐', () => {
    const closed = canteen('near', 'sem-canteen', [['11:00', '13:00', 'lunch']], { closures: [['2026-10-10', '2026-10-20']] })
    const [lunch] = suggestMeals(ctx([item({ place: 'sem', start: '10:15', end: '11:50' })], { canteens: [closed, canteen('far', 'x-canteen', [['11:00', '13:00', 'lunch']])] }))
    expect(lunch.canteen.id).toBe('far')
  })
  it('只推荐放得进空档、还没开始的活动', () => {
    const items = [item({ place: 'sem', start: '13:00', end: '13:50' }), item({ place: 'sem', start: '15:10', end: '16:00' })]
    const events = [event({ id: 'fits', place: 'lib', start: '2026-10-16T14:00', end: '2026-10-16T15:00' }), event({ id: 'clash', start: '2026-10-16T13:30', end: '2026-10-16T14:30' }),
      event({ id: 'tooLate', place: 'xx', start: '2026-10-16T14:05', end: '2026-10-16T15:05' }), event({ id: 'allDay', allDay: true, start: '2026-10-16', end: null })]
    expect(suggestEvents(ctx(items, { events })).map((s) => s.event.id)).toEqual(['fits'])
  })
  it('智能推送只占用课程和用户明确加入的安排，并覆盖未来七天', () => {
    const items = [item({ id: 'class', date: undefined, weekdays: [5], place: 'sem', start: '13:00', end: '13:50' })]
    const events = [
      event({ id: 'free-today', place: 'lib', start: '2026-10-16T14:00', end: '2026-10-16T15:00' }),
      event({ id: 'free-tomorrow', place: 'lib', start: '2026-10-17T10:00', end: '2026-10-17T11:00' }),
      event({ id: 'cancelled', place: 'lib', status: 'cancelled', start: '2026-10-17T12:00', end: '2026-10-17T13:00' }),
      event({ id: 'hidden', place: 'lib', hidden: true, start: '2026-10-17T14:00', end: '2026-10-17T15:00' }),
    ]
    const suggestions = suggestActivityPushes({
      startDate: '2026-10-16', now: timestamp('2026-10-16T08:00'), items, events, walk,
    })
    expect(suggestions.map((s) => s.event.id)).toEqual(['free-today', 'free-tomorrow'])
    expect(suggestions.map((s) => s.date)).toEqual(['2026-10-16', '2026-10-17'])
  })
  it('智能推送排除已经加入我的今天的活动', () => {
    const events = [event({ id: 'saved', place: 'lib', start: '2026-10-16T14:00', end: '2026-10-16T15:00' })]
    const saved = { ...itemFromEvent(events[0]), id: 'saved-item', source: 'event' as const }
    expect(suggestActivityPushes({ startDate: '2026-10-16', now: timestamp('2026-10-16T08:00'), items: [saved], events, walk })).toEqual([])
  })
  it('下一项：算出出发时间，晚了是负数', () => {
    const items = [item({ id: 'a', place: 'sem', start: '08:00', end: '09:35' }), item({ id: 'b', place: 'lib', start: '10:00', end: '11:35' })]
    expect(nextStep(ctx(items, { now: timestamp('2026-10-16T09:00') }))).toMatchObject({ current: { id: 'a' }, next: { id: 'b' }, walk: 8, leaveAt: 9 * 60 + 50, leaveIn: 50 })
    expect(nextStep(ctx(items, { now: timestamp('2026-10-16T09:55') }))?.leaveIn).toBe(-5)
    expect(nextStep(ctx(items, { date: '2026-10-17' }))).toBeNull()
  })
})
