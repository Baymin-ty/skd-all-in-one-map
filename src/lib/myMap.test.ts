import { describe, expect, it } from 'vitest'
import { timestamp } from './campusTime'
import { agendaEntries, agendaStops, minutesUntil, prefersMine, startsInText, upNext, weekDates } from './myMap'
import type { PlanItem } from './today'

const item = (patch: Partial<PlanItem>): PlanItem => ({ id: Math.random().toString(36), kind: 'class', title: '课', start: '08:15', end: '09:55', source: 'manual', ...patch })
// 2026-10-16 是周五
const FRIDAY_10 = timestamp('2026-10-16T10:00')

describe('我的地图：按地点归并安排', () => {
  it('本周从周一排到周日', () => {
    expect(weekDates('2026-10-16')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(weekDates('2026-10-12')[0]).toBe('2026-10-12')
    expect(weekDates('2026-10-18')[6]).toBe('2026-10-18')
  })

  it('标出已结束、正在进行和接下来的第一项', () => {
    const items = [
      item({ id: 'a', weekdays: [5], start: '08:15', end: '09:55', place: 'teach' }),
      item({ id: 'b', weekdays: [5], start: '09:30', end: '11:00', place: 'lab' }),
      item({ id: 'c', kind: 'event', date: '2026-10-16', start: '19:00', place: 'hall' }),
      item({ id: 'd', kind: 'meal', date: '2026-10-16', start: '12:00', place: 'canteen' }),
    ]
    const entries = agendaEntries(items, ['2026-10-16'], FRIDAY_10)
    expect(entries.map((e) => [e.item.id, e.status])).toEqual([['a', 'past'], ['b', 'now'], ['d', 'upnext'], ['c', 'later']])
  })

  it('同一栋楼的几项合成一站，标注优先显示正在进行或接下来的那项', () => {
    const items = [
      item({ id: 'early', weekdays: [5], start: '08:15', end: '09:55', place: 'teach' }),
      item({ id: 'late', weekdays: [5], start: '13:00', end: '14:40', place: 'teach' }),
      item({ id: 'gone', weekdays: [5], start: '08:00', end: '09:00', place: 'old-id' }),
      item({ id: 'nowhere', weekdays: [5], start: '15:00' }),
    ]
    const stops = agendaStops(agendaEntries(items, ['2026-10-16'], FRIDAY_10), (id) => id === 'old-id' ? null : id)
    expect(stops).toHaveLength(1)
    expect(stops[0].place).toBe('teach')
    expect(stops[0].entries.map((e) => e.item.id)).toEqual(['early', 'late'])
    expect(stops[0].lead.item.id).toBe('late')
    expect(stops[0].kinds).toEqual(['class'])
  })

  it('全部结束的地点用最近结束的那一项', () => {
    const items = [item({ id: 'x', weekdays: [5], start: '07:00', end: '07:30', place: 'p' }), item({ id: 'y', weekdays: [5], start: '08:00', end: '08:30', place: 'p', kind: 'todo' })]
    const [stop] = agendaStops(agendaEntries(items, ['2026-10-16'], FRIDAY_10), (id) => id)
    expect(stop.lead.item.id).toBe('y')
    expect(stop.kinds).toEqual(['class', 'todo'])
  })

  it('今天没有了就往后找下一项', () => {
    const items = [item({ id: 'mon', weekdays: [1], start: '08:15', place: 'teach' }), item({ id: 'fri', weekdays: [5], start: '08:15', end: '09:55', place: 'teach' })]
    const { current, next } = upNext(items, FRIDAY_10)
    expect(current).toBeUndefined()
    expect(next?.item.id).toBe('mon')
    expect(next?.date).toBe('2026-10-19')
    expect(startsInText(next!, FRIDAY_10)).toBe('周一 08:15')
    expect(minutesUntil(next!, FRIDAY_10)).toBe(3 * 24 * 60 - 105)
  })

  it('相对时间：一小时内说几分钟后，明天说明天', () => {
    const soon = upNext([item({ weekdays: [5], start: '10:25', end: '11:00' })], FRIDAY_10).next!
    expect(startsInText(soon, FRIDAY_10)).toBe('25 分钟后')
    const tomorrow = upNext([item({ weekdays: [6], start: '09:00' })], FRIDAY_10).next!
    expect(startsInText(tomorrow, FRIDAY_10)).toBe('明天 09:00')
  })

  it('登录、或本机已有安排和常用地点时默认显示我的地图', () => {
    expect(prefersMine(true, [])).toBe(true)
    expect(prefersMine(false, [])).toBe(false)
    expect(prefersMine(false, [item({ deleted: true })])).toBe(false)
    expect(prefersMine(false, [item({})])).toBe(true)
    expect(prefersMine(false, [], 1)).toBe(true)
  })
})
