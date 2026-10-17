import { dateKey, evEnd, evStart, clockText } from './campusTime'
import type { Crowd } from './crowd'
import type { CampusEvent, Canteen, Meal, Outlet } from './discoveryTypes'
import { atMinute, endMin, itemsOn, nowMinute, overlaps, startMin, toMin, type PlanItem } from './today'

/**
 * 「我的今天」的建议：按下课时间和步行时间推荐吃饭的食堂和时段，只推荐放得进空档的活动，
 * 告诉用户下一项什么时候该出发。纯函数，时间、路网和排队都由调用方传入，方便测试。
 */
export interface PlanContext {
  date: string
  now: number
  items: PlanItem[]
  canteens: Canteen[]
  events: CampusEvent[]
  /** 两地步行分钟数，地点不明时返回 null */
  walk: (from?: string, to?: string) => number | null
  crowd: (canteen: string, t: number) => Crowd
}

const MEAL_WINDOWS: [Extract<Meal, 'lunch' | 'dinner'>, number, number][] = [['lunch', 11 * 60, 13 * 60 + 30], ['dinner', 16 * 60 + 30, 19 * 60]]
/** 吃饭本身按 20 分钟算，至少要在停止点餐前 5 分钟到 */
const EAT = 20
const ORDER_MARGIN = 5
/** 为了避开高峰可以晚点出发：每 5 分钟试一次，空等的时间只算一点代价 */
const DELAY_STEP = 5
/** 吃完饭回到下一项至少提前 5 分钟 */
const BUFFER = 5
const IDLE_COST = 0.1
/** 活动太长（展览、全天）不当作「空档里去一趟」 */
const MAX_EVENT = 4 * 60

interface Gap { prev?: PlanItem; next?: PlanItem; from: number; to: number }
/** 当天各项之间的空档（包含第一项之前、最后一项之后） */
function gaps(day: PlanItem[]): Gap[] {
  const out: Gap[] = []
  let prev: PlanItem | undefined
  let from = 0
  for (const item of day) {
    if (startMin(item) > from) out.push({ prev, next: item, from, to: startMin(item) })
    if (endMin(item) >= from) { from = endMin(item); prev = item }
  }
  out.push({ prev, from, to: 24 * 60 })
  return out
}

export interface MealSuggestion {
  meal: 'lunch' | 'dinner'
  canteen: Canteen
  outlet: Outlet
  /** 以下都是当天的分钟数 */
  leave: number
  arrive: number
  done: number
  back?: number
  walkIn: number
  walkOut: number
  crowd: Crowd
  /** 下课后先等几分钟再出发（避开高峰） */
  delay: number
  prev?: PlanItem
  next?: PlanItem
}

/** 窗口在某时刻之后、本餐次内最早能点餐的时间；停止点餐前 5 分钟以内到就不算 */
function openAt(o: Outlet, meal: Meal, date: string, minute: number): number | null {
  if (!o.hours || o.closures.some(([a, b]) => date >= a && date <= b)) return null
  let best: number | null = null
  for (const [from, until, m] of o.hours) {
    if (m !== meal && m !== 'allday') continue
    const at = Math.max(minute, toMin(from))
    if (at + ORDER_MARGIN <= toMin(o.lastOrder?.[m] ?? until) && (best == null || at < best)) best = at
  }
  return best
}

export function suggestMeals(ctx: PlanContext): MealSuggestion[] {
  const day = itemsOn(ctx.items, ctx.date)
  const now = nowMinute(ctx.date, ctx.now)
  const out: MealSuggestion[] = []
  for (const [meal, windowStart, windowEnd] of MEAL_WINDOWS) {
    if (now >= windowEnd) continue
    // 已经安排了这顿饭就不再推荐
    if (day.some((i) => i.kind === 'meal' && startMin(i) < windowEnd && endMin(i) > windowStart)) continue
    let best: (MealSuggestion & { score: number }) | undefined
    for (const gap of gaps(day)) {
      const start = Math.max(gap.from, now)
      if (start >= windowEnd || gap.to <= windowStart) continue
      for (const canteen of ctx.canteens) {
        const walkIn = gap.prev?.place ? ctx.walk(gap.prev.place, canteen.place) : 0
        const walkOut = gap.next?.place ? ctx.walk(canteen.place, gap.next.place) : 0
        if (walkIn == null || walkOut == null) continue
        for (const outlet of canteen.outlets) for (let delay = 0; start + delay < windowEnd; delay += DELAY_STEP) {
          const arrive = openAt(outlet, meal, ctx.date, Math.max(start + delay + walkIn, windowStart))
          if (arrive == null || arrive > windowEnd) continue
          const crowd = ctx.crowd(canteen.id, atMinute(ctx.date, arrive))
          const done = arrive + crowd.waitMin + EAT
          if (gap.next && done + walkOut + BUFFER > gap.to) break
          // 路上和排队的时间越少越好；为避开高峰或等开门多出来的空闲只算一点代价
          const score = walkIn + crowd.waitMin + walkOut + (arrive - start - walkIn) * IDLE_COST
          if (!best || score < best.score)
            best = { meal, canteen, outlet, leave: arrive - walkIn, arrive, done, back: gap.next ? done + walkOut : undefined, walkIn, walkOut, crowd, delay: arrive - walkIn - start, prev: gap.prev, next: gap.next, score }
        }
      }
    }
    if (best) {
      const { score: _score, ...suggestion } = best
      out.push(suggestion)
    }
  }
  return out
}

export interface EventSuggestion { event: CampusEvent; start: number; end: number; walkIn: number; walkOut: number; prev?: PlanItem; next?: PlanItem }

/** 当天还没开始、时间完全放得进空档的活动（来得及走过去，结束后也赶得上下一项） */
export function suggestEvents(ctx: PlanContext, limit = 3): EventSuggestion[] {
  const day = itemsOn(ctx.items, ctx.date)
  const now = nowMinute(ctx.date, ctx.now)
  const taken = new Set(day.map((i) => i.eventId).filter(Boolean))
  const out: EventSuggestion[] = []
  for (const event of ctx.events) {
    if (!event.place || event.allDay || taken.has(event.id) || dateKey(evStart(event)) !== ctx.date || dateKey(evEnd(event) - 1) !== ctx.date) continue
    const start = toMin(clockText(evStart(event)))
    const end = start + Math.round((evEnd(event) - evStart(event)) / 60_000)
    if (start < now || end - start > MAX_EVENT) continue
    const probe: PlanItem = { id: '', kind: 'event', title: '', start: clockText(evStart(event)), end: clockText(evEnd(event)), source: 'planner' }
    if (day.some((i) => overlaps(i, probe))) continue
    const prev = day.filter((i) => endMin(i) <= start).at(-1)
    const next = day.find((i) => startMin(i) >= end)
    const walkIn = prev?.place ? ctx.walk(prev.place, event.place) : 0
    const walkOut = next?.place ? ctx.walk(event.place, next.place) : 0
    if (walkIn == null || walkOut == null) continue
    if (prev && endMin(prev) + walkIn > start || next && end + walkOut > startMin(next)) continue
    out.push({ event, start, end, walkIn, walkOut, prev, next })
  }
  return out.sort((a, b) => a.start - b.start || a.walkIn - b.walkIn).slice(0, limit)
}

export interface NextStep {
  current?: PlanItem
  next?: PlanItem
  /** 从上一站走到下一项的分钟数，地点不明时为 null */
  walk: number | null
  /** 建议出发时间（当天分钟数），留 2 分钟余量 */
  leaveAt?: number
  /** 离建议出发还有几分钟，负数表示已经晚了 */
  leaveIn?: number
}
export function nextStep(ctx: PlanContext): NextStep | null {
  if (ctx.date !== dateKey(ctx.now)) return null
  const day = itemsOn(ctx.items, ctx.date)
  const now = nowMinute(ctx.date, ctx.now)
  const current = day.find((i) => startMin(i) <= now && now < endMin(i))
  const next = day.find((i) => startMin(i) > now)
  if (!current && !next) return null
  if (!next) return { current, walk: null }
  const from = current ?? day.filter((i) => endMin(i) <= now).at(-1)
  const walk = from?.place && next.place ? ctx.walk(from.place, next.place) : null
  const leaveAt = startMin(next) - (walk ?? 0) - 2
  return { current, next, walk, leaveAt, leaveIn: leaveAt - now }
}

/** 相邻两项之间来不及走过去的分钟数（键是后一项的 id） */
export function lateLegs(ctx: PlanContext): Map<string, { walk: number | null; late: number }> {
  const day = itemsOn(ctx.items, ctx.date)
  const out = new Map<string, { walk: number | null; late: number }>()
  for (let i = 1; i < day.length; i++) {
    const a = day[i - 1]
    const b = day[i]
    const walk = a.place && b.place ? ctx.walk(a.place, b.place) : null
    out.set(b.id, { walk, late: Math.max(0, endMin(a) + (walk ?? 0) - startMin(b)) })
  }
  return out
}
