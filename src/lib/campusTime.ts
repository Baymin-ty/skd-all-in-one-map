import { ref } from 'vue'
import type { CampusEvent, Meal, Outlet } from './discoveryTypes'

const DAY = 86_400_000
const OFFSET = 8 * 3_600_000
/** All dates use campus time, independent of the visitor's device timezone. */
export const timestamp = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00+08:00` : /(?:Z|[+-]\d\d:\d\d)$/i.test(s) ? s : `${s}+08:00`)
export const nowTick = ref(Date.now())

/**
 * The demo clock is deliberately kept in this module so every feature that
 * reads `nowTick` observes the same clock. `clockOffset` is measured against
 * the browser wall clock and `speed` is the number of campus milliseconds
 * that pass for one wall-clock millisecond.
 */
export const clockOffset = ref(0)
export const speed = ref(1)
export const demoClockEnabled = ref(false)
let clockWallStart = Date.now()

/** Return the current demo time, or the real wall-clock time when disabled. */
export function demoNow(wallNow = Date.now()) {
  // The explicit flag is set by configureDemoClock; also honor manually
  // assigned offset/speed values, which is useful for small unit tests.
  if (!demoClockEnabled.value && clockOffset.value === 0 && speed.value === 1) return wallNow
  return wallNow + clockOffset.value + (wallNow - clockWallStart) * (speed.value - 1)
}

/**
 * Configure the clock from a query string such as
 * `?now=2026-10-20T11:50&speed=60`. Invalid values are ignored and leave the
 * real clock enabled. The optional wall time keeps this function deterministic
 * in tests and avoids depending on the device timezone.
 */
export function configureDemoClock(search = '', wallNow = Date.now()) {
  const query = new URLSearchParams(search)
  const raw = query.get('now')
  const target = raw ? timestamp(raw) : NaN
  if (!raw || !Number.isFinite(target)) {
    clockOffset.value = 0
    speed.value = 1
    demoClockEnabled.value = false
    clockWallStart = wallNow
    return false
  }
  const parsedSpeed = Number(query.get('speed') ?? '1')
  // Keep accidental values from producing an unusable or backwards clock.
  const nextSpeed = Number.isFinite(parsedSpeed) && parsedSpeed > 0 ? parsedSpeed : 1
  clockOffset.value = target - wallNow
  speed.value = nextSpeed
  clockWallStart = wallNow
  demoClockEnabled.value = true
  return true
}

export function resetDemoClock(wallNow = Date.now()) {
  clockOffset.value = 0
  speed.value = 1
  demoClockEnabled.value = false
  clockWallStart = wallNow
}
export const dateKey = (t = nowTick.value) => new Date(t + OFFSET).toISOString().slice(0, 10)
export const clockText = (t: number) => new Date(t + OFFSET).toISOString().slice(11, 16)
export const dayStart = (t: number) => timestamp(dateKey(t))
export const evStart = (e: CampusEvent) => timestamp(e.start)
export const evEnd = (e: CampusEvent) => e.end ? timestamp(e.end) : e.allDay ? dayStart(evStart(e)) + DAY : evStart(e) + 90 * 60_000
export const STATUS_LABELS = { live: '进行中', soon: '即将开始', today: '今天', upcoming: '即将举行', past: '已结束' }
export function eventStatus(e: CampusEvent, t = nowTick.value): keyof typeof STATUS_LABELS {
  if (t >= evEnd(e)) return 'past'
  if (t >= evStart(e)) return 'live'
  if (evStart(e) - t <= 3_600_000) return 'soon'
  return dateKey(evStart(e)) === dateKey(t) ? 'today' : 'upcoming'
}
export const weekdayText = (date: string) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(timestamp(date) + OFFSET).getUTCDay()]
export function dayName(date: string) {
  const diff = (timestamp(date) - dayStart(nowTick.value)) / DAY
  return diff === 0 ? '今天' : diff === 1 ? '明天' : weekdayText(date)
}
export function dayLabel(t: number) {
  const d = dateKey(t)
  const diff = (dayStart(t) - dayStart(nowTick.value)) / DAY
  const relative = diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : weekdayText(d)
  return `${d.slice(0, 4) === dateKey().slice(0, 4) ? '' : d.slice(0, 4) + '年'}${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 ${relative}`
}
export function timeRange(e: CampusEvent) {
  if (e.end && dateKey(evStart(e)) !== dateKey(evEnd(e))) return `${dateKey(evStart(e)).slice(5)} – ${dateKey(evEnd(e)).slice(5)}`
  if (e.allDay) return '全天'
  return clockText(evStart(e)) + (e.end ? `–${clockText(evEnd(e))}` : '')
}

export const MEAL_LABELS: Record<Meal, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', allday: '全天', night: '夜宵' }
type OutletState = { kind: 'open'; until: string; meal: Meal; lastOrder?: string } | { kind: 'later'; from: string; meal: Meal } | { kind: 'closedToday' } | { kind: 'suspended'; until: string } | { kind: 'unknown' }
export function outletState(o: Outlet, t = nowTick.value): OutletState {
  const date = dateKey(t)
  const closure = o.closures.find(([a, b]) => date >= a && date <= b)
  if (closure) return { kind: 'suspended', until: closure[1] }
  if (!o.hours) return { kind: 'unknown' }
  const hm = clockText(t)
  for (const [from, until, meal] of o.hours) {
    if (hm >= from && hm < until) return { kind: 'open', until, meal, lastOrder: o.lastOrder?.[meal] }
  }
  const next = o.hours.find(([from]) => from > hm)
  return next ? { kind: 'later', from: next[0], meal: next[2] } : { kind: 'closedToday' }
}
export function outletText(o: Outlet) {
  const s = outletState(o)
  if (s.kind === 'open') return `供餐时段 · ${s.lastOrder ? s.lastOrder + ' 停止点餐' : s.until + ' 结束'}`
  if (s.kind === 'later') return `${s.from} 开始${MEAL_LABELS[s.meal]}`
  if (s.kind === 'suspended') return `暂停营业至 ${s.until}`
  return s.kind === 'closedToday' ? '今日供餐已结束' : '营业时间待确认'
}

/** Download only: no calendar account or backend writes. */
export function icsFor(e: CampusEvent) {
  const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n')
  const endDate = dateKey(evEnd(e) - 1)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ShanghaiTech Map//CN', 'BEGIN:VEVENT',
    `UID:${e.id}@shanghaitech-map`, `DTSTAMP:${utc(nowTick.value)}`,
    e.allDay ? `DTSTART;VALUE=DATE:${dateKey(evStart(e)).replace(/-/g, '')}` : `DTSTART:${utc(evStart(e))}`,
    e.allDay ? `DTEND;VALUE=DATE:${dateKey(timestamp(endDate) + DAY).replace(/-/g, '')}` : `DTEND:${utc(evEnd(e))}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.venueRaw || e.unmapped || '')}`,
    `DESCRIPTION:${esc([e.organizer, e.speaker, e.url].filter(Boolean).join('\n'))}`, 'END:VEVENT', 'END:VCALENDAR']
  // Fold long UTF-8 lines so Chinese event titles remain valid in calendar clients.
  return lines.flatMap((line) => {
    const parts: string[] = []
    let part = ''
    let bytes = 0
    for (const ch of line) {
      const size = new TextEncoder().encode(ch).length
      if (bytes + size > 75) { parts.push(part); part = ' '; bytes = 1 }
      part += ch; bytes += size
    }
    return [...parts, part]
  }).join('\r\n') + '\r\n'
}
