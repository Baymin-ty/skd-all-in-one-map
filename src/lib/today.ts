import { reactive } from 'vue'
import { clockText, dateKey, evEnd, evStart, timestamp } from './campusTime'
import type { CampusEvent } from './discoveryTypes'
import type { IconName } from './icons'
import { readUserData, setUserData } from './userData'
import { account } from './account'

/**
 * 「我的今天」：课、活动、吃饭和待办排成一条时间线。匿名访客保存在本机，
 * 登录校园账号后通过 userData 同步；浏览器禁用存储时退回内存（刷新后丢失）。
 */
export type PlanKind = 'class' | 'event' | 'meal' | 'todo'
export interface PlanItem {
  id: string
  kind: PlanKind
  title: string
  /** 楼或点位 id */
  place?: string
  /** 教室号 */
  room?: string
  /** HH:MM */
  start: string
  end?: string
  /** 一次性安排的日期 YYYY-MM-DD */
  date?: string
  /** 每周重复（课程），1 = 周一 … 7 = 周日 */
  weekdays?: number[]
  eventId?: string
  note?: string
  source: 'manual' | 'event' | 'ai' | 'planner'
  updatedAt?: number
  deleted?: boolean
}

export const PLAN_KINDS: Record<PlanKind, { zh: string; icon: IconName }> = {
  class: { zh: '课程', icon: 'academic' },
  event: { zh: '活动', icon: 'calendar' },
  meal: { zh: '吃饭', icon: 'dining' },
  todo: { zh: '待办', icon: 'check' },
}
/** 没填结束时间时按类型估算时长（分钟） */
const DEFAULT_LENGTH: Record<PlanKind, number> = { class: 90, event: 90, meal: 30, todo: 30 }

export const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`
export const startMin = (i: PlanItem) => toMin(i.start)
export const endMin = (i: PlanItem) => i.end && toMin(i.end) > toMin(i.start) ? toMin(i.end) : toMin(i.start) + DEFAULT_LENGTH[i.kind]
/** 1 = 周一 … 7 = 周日（校园时区） */
export const weekdayOf = (date: string) => new Date(timestamp(date) + 8 * 3_600_000).getUTCDay() || 7
/** 某天某个时刻（分钟）对应的时间戳 */
export const atMinute = (date: string, minute: number) => timestamp(date) + minute * 60_000
/** 今天的「现在」是几点几分；以前的日子算全天已过，以后的日子算还没开始 */
export function nowMinute(date: string, now: number) {
  const today = dateKey(now)
  return date === today ? toMin(clockText(now)) : date < today ? Infinity : -Infinity
}

export function itemsOn(items: PlanItem[], date: string) {
  const weekday = weekdayOf(date)
  return items.filter((i) => !i.deleted && (i.date ? i.date === date : !!i.weekdays?.includes(weekday)))
    .sort((a, b) => startMin(a) - startMin(b) || endMin(a) - endMin(b))
}
export const overlaps = (a: PlanItem, b: PlanItem) => startMin(a) < endMin(b) && startMin(b) < endMin(a)

/** 从活动雷达加进来：跨天和全天的活动只取开始那天，按 90 分钟估算 */
export function itemFromEvent(e: CampusEvent): Omit<PlanItem, 'id'> {
  const date = dateKey(evStart(e))
  const sameDay = !!e.end && dateKey(evEnd(e)) === date
  return {
    kind: 'event', title: e.title, place: e.place ?? undefined, room: e.room || undefined, date, eventId: e.id, source: 'event',
    start: e.allDay ? '09:00' : clockText(evStart(e)), end: e.allDay ? undefined : sameDay ? clockText(evEnd(e)) : undefined,
    note: e.allDay ? '全天活动' : undefined,
  }
}

// ---------- 存储 ----------
const KEY = 'stmap.today.v1'
export const plan = reactive({ items: [] as PlanItem[], date: dateKey(), persisted: true })

const valid = (x: unknown): x is PlanItem => {
  const i = x as PlanItem
  return !!i && typeof i.id === 'string' && typeof i.title === 'string' && i.kind in PLAN_KINDS && /^\d\d:\d\d$/.test(i.start)
}
export function initPlan() {
  plan.date = dateKey()
  try {
    const data = readUserData<{ items?: PlanItem[] }>('today', (() => {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
    })())
    plan.items = Array.isArray(data?.items) ? data.items.filter(valid) : []
    plan.persisted = true
  } catch {
    plan.items = []
    plan.persisted = false
  }
}
function save() {
  try {
    // Keep the legacy anonymous copy device-local; account sessions use the
    // namespaced userData envelope and must not leak into the next anonymous session.
    if (!account.me) localStorage.setItem(KEY, JSON.stringify({ items: plan.items }))
    setUserData('today', { items: plan.items })
    plan.persisted = true
  } catch {
    plan.persisted = false
  }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
export function addItem(item: Omit<PlanItem, 'id'>) {
  const added = { ...item, id: newId(), updatedAt: Date.now(), deleted: false }
  plan.items.push(added)
  save()
  return added
}
export function updateItem(id: string, patch: Partial<PlanItem>) {
  const i = plan.items.findIndex((x) => x.id === id)
  if (i < 0) return
  plan.items[i] = { ...plan.items[i], ...patch, id, updatedAt: Date.now(), deleted: false }
  save()
}
export function removeItem(id: string) {
  const item = plan.items.find((x) => x.id === id)
  if (!item) return
  item.deleted = true
  item.updatedAt = Date.now()
  save()
}
/** ③ 课表截图解析等批量导入：调用方先给用户预览，确认后再写入 */
export function importItems(items: Omit<PlanItem, 'id'>[]) {
  for (const item of items) plan.items.push({ ...item, id: newId(), updatedAt: Date.now(), deleted: false })
  save()
}
