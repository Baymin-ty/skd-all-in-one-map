import { beforeEach, describe, expect, it } from 'vitest'
import { nowTick, timestamp } from './campusTime'
import type { CampusEvent } from './discoveryTypes'
import { EVENT_PRIO, eventsByPlace, eventShortTitle, eventTier, eventWhen } from './mapEvents'

const event = (patch: Partial<CampusEvent> = {}): CampusEvent => ({ id: 'e', title: '测试讲座', start: '2026-10-17T14:00', end: '2026-10-17T15:30', allDay: false, venueRaw: '', place: 'lib', room: '', floor: null, organizer: '', category: 'lecture', source: 'official', ...patch })
const NOW = timestamp('2026-10-17T12:00')
beforeEach(() => { nowTick.value = NOW })

describe('地图活动短标题', () => {
  it.each([
    ['【第六届人文季】思想的星海——人文社科新著对谈系列：人的处境', '思想的星海'],
    ['【SIST】UCloud分布式块存储架构演进之路', 'UCloud分布式块存储架构演进之路'],
    ['【形势与政策】天堑变通途——中国大桥自主首创技术与大国建造风采', '天堑变通途'],
    ['活动报名 | 上道书院学长学姐面对面：对话先行者，探寻国内升学的多样答卷', '上道书院学长学姐面对面'],
    ['Seminar: HCMU 曲面的几何分解、形变与模空间(3)(4)', 'HCMU 曲面的几何分解、形变与模空间(3)(4)'],
    ['【SIST】Beyond the Interface: Towards Situated Human–AI Interaction', 'Beyond the Interface'],
    ['从代码到任务:主流AI智能体应用', '从代码到任务'],
  ])('%s → %s', (title, short) => expect(eventShortTitle(title)).toBe(short))

  it('书名号和引号里的分隔符不拆，主标题太短时保留整句', () => {
    expect(eventShortTitle('《穿越商周——王受之钢笔画绘本展》')).toBe('《穿越商周——王受之钢笔画绘本展》')
    expect(eventShortTitle('【第六届人文季】黄晓丹：中国古典文学的“幽灵”')).toBe('黄晓丹：中国古典文学的“幽灵”')
    expect(eventShortTitle('会议 10:30 开始')).toBe('会议 10:30 开始')
  })

  it('只有栏目标记或没有可拆的内容时退回原标题', () => {
    expect(eventShortTitle('【通知】')).toBe('【通知】')
    expect(eventShortTitle('细胞感应力学信号的机制')).toBe('细胞感应力学信号的机制')
  })
})

describe('地图活动分档与时间', () => {
  it('进行中、一小时内、24 小时内、长期、更晚依次分档，标签写出对应的时间', () => {
    const live = event({ start: '2026-10-17T11:30', end: '2026-10-17T13:00' })
    const soon = event({ start: '2026-10-17T12:35' })
    const next = event({ start: '2026-10-18T09:00', end: null })
    const ongoing = event({ start: '2026-09-20T09:00', end: '2026-11-15T17:00' })
    const later = event({ start: '2026-10-20T16:00' })
    const farther = event({ start: '2026-10-30T16:00' })
    expect([live, soon, next, ongoing, later].map((e) => eventTier(e))).toEqual(['live', 'soon', 'next', 'ongoing', 'later'])
    expect(eventWhen(live)).toBe('进行中')
    expect(eventWhen(soon)).toBe('35 分钟后')
    expect(eventWhen(event())).toBe('14:00')
    expect(eventWhen(next)).toBe('明天 09:00')
    expect(eventWhen(ongoing)).toBe('至11月15日')
    expect(eventWhen(later)).toBe('周二')
    expect(eventWhen(farther)).toBe('10月30日')
  })

  it('临近的活动排布优先级更高，长期展览不抢地标的位置', () => {
    expect(EVENT_PRIO.live).toBeGreaterThan(EVENT_PRIO.soon)
    expect(EVENT_PRIO.soon).toBeGreaterThan(EVENT_PRIO.next)
    expect(EVENT_PRIO.next).toBeGreaterThan(EVENT_PRIO.later)
    // 选中（140）、今日编号（135）等固定标签必须更高
    expect(Math.max(...Object.values(EVENT_PRIO))).toBeLessThan(130)
    // 地标 90：长期展览排在后面
    expect(EVENT_PRIO.ongoing).toBeLessThanOrEqual(92)
  })
})

describe('同一地点的活动合成一个标签', () => {
  it('按地点分组，领头的是最紧迫的一场，没有地点的活动不上图', () => {
    const exhibit = event({ id: 'x', start: '2026-09-20T09:00', end: '2026-11-15T17:00' })
    const talk = event({ id: 't', start: '2026-10-17T14:00' })
    const tomorrow = event({ id: 'm', start: '2026-10-18T10:00' })
    const elsewhere = event({ id: 'o', place: 'gym', start: '2026-10-17T19:00' })
    const unmapped = event({ id: 'u', place: null })
    const byPlace = eventsByPlace([tomorrow, exhibit, talk, elsewhere, unmapped])
    expect([...byPlace.keys()]).toEqual(['lib', 'gym'])
    const lib = byPlace.get('lib')!
    expect(lib.lead.id).toBe('t')
    expect(lib.tier).toBe('next')
    expect(lib.events.map((e) => e.id)).toEqual(['t', 'm', 'x'])
    expect(byPlace.get('gym')!.events).toHaveLength(1)
  })
})
