import { reactive } from 'vue'
import { dateKey, timestamp } from './campusTime'
import type { IconName } from './icons'
import { endMin, itemsOn, nowMinute, startMin, weekdayOf, type PlanItem, type PlanKind } from './today'

/**
 * 「我的地图」：登录后（或这台设备上已有课表）地图默认只突出自己的课、活动和常用地点，
 * 其余地点淡下去；随时可以切回全校地图。这里只放纯计算，地图图层在 todayLayer，面板在 MyMapPanel。
 */
export type MyScope = 'day' | 'week'
/** day 跟「我的今天」共用 plan.date（今天 / 明天）；week 是本周一到周日 */
/** day：本周视图里单独看某一天（YYYY-MM-DD），空串表示整周都标在地图上 */
export const myMap = reactive({ scope: 'day' as MyScope, day: '' })

/** 课、活动、吃饭、待办在地图和列表里用不同颜色和图标区分 */
export const KIND_STYLE: Record<PlanKind, { zh: string; icon: IconName; color: string; soft: string }> = {
  class: { zh: '课程', icon: 'academic', color: '#2f5fc4', soft: '#e9effb' },
  event: { zh: '活动', icon: 'calendar', color: '#d4561c', soft: '#fdefe7' },
  meal: { zh: '吃饭', icon: 'dining', color: '#b97a10', soft: '#fcf3e2' },
  todo: { zh: '待办', icon: 'check', color: '#5b6b7a', soft: '#eef1f4' },
}
export const KIND_ORDER: PlanKind[] = ['class', 'event', 'meal', 'todo']

const DAY = 86_400_000
const addDays = (date: string, n: number) => dateKey(timestamp(date) + n * DAY)

/** 包含 today 的这一周，周一到周日 */
export function weekDates(today: string): string[] {
  const monday = addDays(today, 1 - weekdayOf(today))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export type StopStatus = 'past' | 'now' | 'upnext' | 'later'
export interface AgendaEntry { item: PlanItem; date: string; status: StopStatus }

/** 这几天的安排按时间排好，标出已结束、正在进行和接下来的第一项 */
export function agendaEntries(items: PlanItem[], dates: string[], now: number): AgendaEntry[] {
  const out: AgendaEntry[] = []
  for (const date of [...dates].sort()) {
    const minute = nowMinute(date, now)
    for (const item of itemsOn(items, date))
      out.push({ item, date, status: endMin(item) <= minute ? 'past' : startMin(item) <= minute ? 'now' : 'later' })
  }
  const next = out.find((e) => e.status === 'later')
  if (next) next.status = 'upnext'
  return out
}

export interface AgendaStop {
  /** 地图上的地点 id（楼或点位） */
  place: string
  entries: AgendaEntry[]
  /** 标注上显示的那一项：正在进行 > 接下来 > 之后最早的 > 最近结束的 */
  lead: AgendaEntry
  kinds: PlanKind[]
}
const RANK: Record<StopStatus, number> = { now: 0, upnext: 1, later: 2, past: 3 }

/** 同一地点的几项合成一站；canon 把地点换成地图上实际显示的 id，找不到的地点返回 null 跳过 */
export function agendaStops(entries: AgendaEntry[], canon: (id: string) => string | null): AgendaStop[] {
  const byPlace = new Map<string, AgendaEntry[]>()
  for (const entry of entries) {
    const place = entry.item.place ? canon(entry.item.place) : null
    if (!place) continue
    const list = byPlace.get(place)
    if (list) list.push(entry)
    else byPlace.set(place, [entry])
  }
  return [...byPlace].map(([place, list]) => {
    const live = list.filter((e) => e.status !== 'past').sort((a, b) => RANK[a.status] - RANK[b.status])
    return { place, entries: list, lead: live[0] ?? list.at(-1)!, kinds: KIND_ORDER.filter((k) => list.some((e) => e.item.kind === k)) }
  })
}

/** 首页卡片用：正在进行的一项，和接下来的一项（今天没有就往后找，最多看 days 天） */
export function upNext(items: PlanItem[], now: number, days = 7) {
  const today = dateKey(now)
  const entries = agendaEntries(items, Array.from({ length: days }, (_, i) => addDays(today, i)), now)
  return { current: entries.find((e) => e.status === 'now'), next: entries.find((e) => e.status === 'upnext') }
}

/** 离这一项开始还有几分钟（负数表示已经开始） */
export const minutesUntil = (entry: AgendaEntry, now: number) => Math.round((timestamp(entry.date) + startMin(entry.item) * 60_000 - now) / 60_000)

/** 「还有 25 分钟」「明天 08:15」这类相对时间 */
export function startsInText(entry: AgendaEntry, now: number) {
  const min = minutesUntil(entry, now)
  const today = dateKey(now)
  if (entry.date === today) {
    if (min <= 0) return '进行中'
    if (min < 60) return `${min} 分钟后`
    return `今天 ${entry.item.start}`
  }
  if (entry.date === addDays(today, 1)) return `明天 ${entry.item.start}`
  return `${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][weekdayOf(entry.date) - 1]} ${entry.item.start}`
}
