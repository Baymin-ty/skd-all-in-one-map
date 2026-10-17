import { describe, expect, it } from 'vitest'
import { timestamp } from './campusTime'
import type { CampusEvent } from './discoveryTypes'
import {
  busiestWindow, eventsInWindow, FAST_RATE, glowAt, glowColor, glowWhen, momentAt, nightAt, packLanes, rateAt, SLOW_RATE, windowStart,
} from './timeMachine'

const event = (patch: Partial<CampusEvent> = {}): CampusEvent => ({ id: 'e', title: '测试讲座', start: '2026-10-16T15:00', end: '2026-10-16T16:30', allDay: false, venueRaw: '', place: 'lib', room: '', floor: null, organizer: '', category: 'lecture', source: 'official', ...patch })
const at = (s: string) => timestamp(s)

describe('活动时光机', () => {
  it('越临近开始越醒目，进行中最亮，结束后淡出', () => {
    const e = event()
    const far = glowAt(e, at('2026-10-16T06:00'))!
    const hours3 = glowAt(e, at('2026-10-16T12:00'))!
    const hour1 = glowAt(e, at('2026-10-16T14:00'))!
    expect(far.phase).toBe('upcoming')
    expect(far.p).toBeLessThan(hours3.p)
    expect(hours3.p).toBeLessThan(hour1.p)
    expect(hour1.phase).toBe('soon')
    expect(glowAt(e, at('2026-10-16T15:10'))).toEqual({ phase: 'spot', p: 1 })
    expect(glowAt(e, at('2026-10-16T15:40'))).toEqual({ phase: 'live', p: 1 })
    const ended = glowAt(e, at('2026-10-16T16:35'))!
    expect(ended.phase).toBe('past')
    expect(ended.p).toBeLessThan(0.5)
    expect(glowAt(e, at('2026-10-16T18:00'))).toBeNull()
  })
  it('跨天展览和全天活动只淡淡标出', () => {
    expect(glowAt(event({ start: '2026-10-12T10:00', end: '2026-10-23T18:00' }), at('2026-10-16T12:00'))).toEqual({ phase: 'ongoing', p: 0.3 })
    expect(glowAt(event({ start: '2026-10-16', end: null, allDay: true }), at('2026-10-16T12:00'))?.phase).toBe('ongoing')
  })
  it('颜色从远处的淡紫过渡到临近的橙色，进行中为绿色', () => {
    const e = event()
    expect(glowColor(glowAt(e, at('2026-10-15T15:00'))!)).toBe('#9d8fb8')
    expect(glowColor({ phase: 'soon', p: 0.98 })).toBe('#e08a1e')
    expect(glowColor({ phase: 'upcoming', p: 0.55 })).toBe('#9b4f72')
    expect(glowColor({ phase: 'live', p: 1 })).toBe('#1f9d55')
  })
  it('时间说明相对播放头', () => {
    const e = event()
    expect(glowWhen(e, glowAt(e, at('2026-10-16T14:35'))!, at('2026-10-16T14:35'))).toBe('25 分钟后')
    expect(glowWhen(e, glowAt(e, at('2026-10-15T20:00'))!, at('2026-10-15T20:00'))).toBe('明天 15:00')
    expect(glowWhen(e, glowAt(e, at('2026-10-16T16:00'))!, at('2026-10-16T16:00'))).toBe('进行中 · 还剩 30 分钟')
    expect(glowWhen(e, glowAt(e, at('2026-10-16T15:05'))!, at('2026-10-16T15:05'))).toBe('刚刚开始')
  })
  it('开始前后慢放，空档快进，长期展览不影响速度', () => {
    const events = [event(), event({ id: 'expo', start: '2026-10-12T10:00', end: '2026-10-23T18:00' })]
    expect(rateAt(events, at('2026-10-16T14:50'))).toBe(SLOW_RATE)
    expect(rateAt(events, at('2026-10-16T15:20'))).toBe(SLOW_RATE)
    expect(rateAt(events, at('2026-10-16T16:00'))).toBe(1)
    expect(rateAt(events, at('2026-10-16T13:30'))).toBe(1)
    expect(rateAt(events, at('2026-10-16T03:00'))).toBe(FAST_RATE)
    expect(rateAt(events, at('2026-10-16T17:00'))).toBe(FAST_RATE)
  })
  it('按校园时间昼夜渐变', () => {
    expect(nightAt(at('2026-10-16T12:00'))).toBe(0)
    expect(nightAt(at('2026-10-16T23:00'))).toBe(1)
    expect(nightAt(at('2026-10-17T03:00'))).toBe(1)
    const dusk = nightAt(at('2026-10-16T18:15'))
    expect(dusk).toBeGreaterThan(0)
    expect(dusk).toBeLessThan(1)
  })
  it('窗口只取有交集、没有取消的活动', () => {
    const events = [
      event({ id: 'a' }), event({ id: 'cancel', status: 'cancelled' }),
      event({ id: 'before', start: '2026-10-14T10:00', end: '2026-10-14T11:00' }),
      event({ id: 'after', start: '2026-10-18T10:00', end: '2026-10-18T11:00' }),
      event({ id: 'expo', start: '2026-10-12T10:00', end: '2026-10-23T18:00' }),
    ]
    expect(eventsInWindow(events, at('2026-10-16T00:00')).map((e) => e.id)).toEqual(['expo', 'a'])
  })
  it('找出活动最多的 48 小时，并解析窗口起点', () => {
    const events = [
      event({ id: '1', start: '2026-10-10T10:00', end: '2026-10-10T11:00' }),
      event({ id: '2', start: '2026-10-14T10:00', end: '2026-10-14T11:00' }),
      event({ id: '3', start: '2026-10-15T14:00', end: '2026-10-15T15:00' }),
      event({ id: '4', start: '2026-10-15T18:00', end: '2026-10-15T19:00', place: null }),
    ]
    expect(busiestWindow(events)).toBe(at('2026-10-14'))
    expect(busiestWindow([])).toBeNull()
    const now = at('2026-10-16T09:41')
    expect(windowStart(undefined, events, now)).toBe(at('2026-10-16T09:00'))
    expect(windowStart('best', events, now)).toBe(at('2026-10-14'))
    expect(windowStart('2026-10-15T08:00', events, now)).toBe(at('2026-10-15T08:00'))
    expect(windowStart('not-a-date', events, now)).toBe(at('2026-10-16T09:00'))
  })
  it('时间轴分道互不重叠，长期活动不占道', () => {
    const from = at('2026-10-16T00:00')
    const lanes = packLanes([
      event({ id: 'a', start: '2026-10-16T15:00', end: '2026-10-16T16:00' }),
      event({ id: 'b', start: '2026-10-16T15:30', end: '2026-10-16T17:00' }),
      event({ id: 'c', start: '2026-10-16T18:00', end: '2026-10-16T19:00' }),
      event({ id: 'expo', start: '2026-10-12T10:00', end: '2026-10-23T18:00' }),
    ], from, from + 48 * 3_600_000)
    expect(lanes.map((l) => [l.e.id, l.lane])).toEqual([['a', 0], ['b', 1], ['c', 0]])
    expect(lanes[0].left).toBeCloseTo(15 / 48)
  })
  it('此刻列表：正在进行的排前面，只列 3 小时内开始的', () => {
    const events = [
      event({ id: 'later', start: '2026-10-16T20:00', end: '2026-10-16T21:00' }),
      event({ id: 'soon', start: '2026-10-16T16:00', end: '2026-10-16T17:00' }),
      event({ id: 'live', start: '2026-10-16T14:00', end: '2026-10-16T16:00' }),
    ]
    expect(momentAt(events, at('2026-10-16T15:30')).map(({ e }) => e.id)).toEqual(['live', 'soon'])
  })
})
