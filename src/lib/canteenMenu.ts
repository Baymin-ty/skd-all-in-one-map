import { clockText, dateKey, nowTick, outletState, outletText, timestamp } from './campusTime'
import type { Canteen, Dish, Meal, Outlet, Stall } from './discoveryTypes'
import { mealsOn, servedOn } from './menu'

export function outletTone(o: Outlet) {
  const s = outletState(o)
  if (s.kind === 'open' && s.lastOrder && clockText(nowTick.value) >= s.lastOrder) return 'closed'
  return s.kind === 'open' ? 'open' : s.kind === 'later' ? 'later' : s.kind === 'unknown' ? 'unknown' : 'closed'
}
export function outletSummary(o: Outlet) {
  const s = outletState(o)
  return s.kind === 'open' && s.lastOrder && clockText(nowTick.value) >= s.lastOrder ? `已停止点餐 · ${s.until} 结束营业` : outletText(o)
}
export function canteenSummary(c: Canteen) {
  const rank = { open: 0, later: 1, closed: 2, unknown: 3 }
  const best = [...c.outlets].sort((a, b) => rank[outletTone(a)] - rank[outletTone(b)])[0]
  return { best, tone: best ? outletTone(best) : 'unknown', dishes: c.outlets.reduce((n, o) => n + o.dishes.length, 0), stalls: c.outlets.reduce((n, o) => n + o.stalls.length, 0) }
}
/** Union of actual recorded weekly-menu dates. Never fill gaps with invented menus. */
export function weekDates(o: Outlet) {
  const days = new Set<string>()
  for (const s of o.stalls) if (s.week) {
    for (let t = timestamp(s.week[0]), i = 0; i < 31 && t <= timestamp(s.week[1]); t += 86_400_000, i++) days.add(dateKey(t))
  }
  return [...days].sort()
}
export function menuMeals(o: Outlet): Meal[] {
  return [...new Set([...(o.hours || []).map((h) => h[2]), ...o.dishes.flatMap((d) => [...d.meals || [], ...Object.values(d.days || {}).flat()])])].filter((m) => m !== 'allday')
}
export function defaultMenuDay(o: Outlet) {
  const days = weekDates(o), today = dateKey()
  return days.includes(today) ? today : days.length && today < days[0] ? days[0] : ''
}
export function dishOnMenu(d: Dish, o: Outlet, day = '', meal: Meal | '' = '') {
  const s = o.stalls.find((s) => s.zh === d.stall)
  if (day && servedOn(d, day, s) !== 'yes') return false
  if (!meal) return true
  // In whole-week mode a dish qualifies when served at this meal on any recorded day.
  if (!day && d.days) return Object.values(d.days).some((ms) => !ms.length || ms.includes(meal) || ms.includes('allday'))
  const meals = day ? mealsOn(d, day) : d.meals || []
  return !meals.length || meals.includes(meal) || meals.includes('allday')
}
export function menuGroups(o: Outlet, options: { day?: string; meal?: Meal | ''; query?: string; stall?: string } = {}) {
  const q = options.query?.trim().toLowerCase() || ''
  const groups = new Map<string, { stall: Stall | null; dishes: Dish[]; total: number }>()
  for (const s of o.stalls) groups.set(s.zh, { stall: s, dishes: [], total: 0 })
  for (const d of o.dishes) {
    const key = d.stall || ''
    if (!groups.has(key)) groups.set(key, { stall: key ? { id: key, zh: key } : null, dishes: [], total: 0 })
    const group = groups.get(key)!
    group.total++
    const text = [d.zh, d.en, d.stall, d.desc?.zh, ...group.stall?.aliases || []].join(' ').toLowerCase()
    if (dishOnMenu(d, o, options.day, options.meal) && (!q || text.includes(q))) group.dishes.push(d)
  }
  return [...groups.values()].filter((g) => (!options.stall || g.stall?.id === options.stall) && (g.dishes.length || !q))
}
