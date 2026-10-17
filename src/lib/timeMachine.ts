import { computed, reactive } from 'vue'
import { clockText, dateKey, dayName, dayStart, evEnd, evStart, nowTick, timestamp, weekdayText } from './campusTime'
import { discovery } from './discoveryData'
import type { CampusEvent } from './discoveryTypes'

/**
 * 活动时光机：在地图上回放一段 48 小时里的活动。播放头经过时，越临近开始的活动越醒目，
 * 进行中最亮，结束后逐渐淡出；活动开始前后自动慢放，没有活动的时段自动快进。
 * 这里只有不依赖 Leaflet 的时间计算和播放状态，地图图层见 timeMachineLayer.ts。
 */
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
export const WINDOW_HOURS = 48
export const WINDOW_MS = WINDOW_HOURS * HOUR
/** 超过 12 小时的展览、会议等长期活动：只淡淡标出，不和普通活动抢颜色 */
export const LONG_EVENT = 12 * HOUR
/** 每秒播放多少模拟小时 */
export const SPEEDS = [0.5, 1, 2, 4] as const
/** 活动开始前 15 分钟到开始后 30 分钟慢放；开始后 30 分钟内地图上弹出标注卡 */
const SLOW_BEFORE = 15 * MIN
const SPOT_AFTER = 30 * MIN
export const SLOW_RATE = 0.3
export const FAST_RATE = 4
/** 往后 2 小时内没有活动、也没有正在进行的活动时算空档，快进 */
const QUIET_AHEAD = 2 * HOUR

export const isLong = (e: CampusEvent) => evEnd(e) - evStart(e) > LONG_EVENT

export const tm = reactive({
  open: false,
  /** 窗口起点（毫秒），窗口长度固定 48 小时 */
  from: 0,
  /** 播放头 */
  t: 0,
  playing: false,
  speed: 1 as (typeof SPEEDS)[number],
  /** 开始前后慢放、空档快进 */
  adaptive: true,
  /** 镜头跟随刚开始的活动 */
  follow: true,
  loop: true,
  /** 自适应速度当前倍率，平滑过渡，界面上显示「慢放 / 快进」 */
  rate: 1,
  /** 点开查看的活动 */
  focus: '',
})

export const windowEnd = () => tm.from + WINDOW_MS

/** 和窗口有交集、没有取消的活动，按开始时间排序 */
export function eventsInWindow(events: CampusEvent[], from: number, ms = WINDOW_MS) {
  return events.filter((e) => e.status !== 'cancelled' && evEnd(e) > from && evStart(e) < from + ms).sort((a, b) => evStart(a) - evStart(b))
}
export const windowEvents = computed(() => eventsInWindow(discovery.events, tm.from))

export type Phase = 'spot' | 'live' | 'ongoing' | 'soon' | 'upcoming' | 'past'
export interface Glow {
  phase: Phase
  /** 显著度 0–1：决定地图钉大小、颜色深浅、光晕和是否显示标签 */
  p: number
}

/**
 * 播放头 t 时这场活动有多醒目。还没开始的按距开始的时间指数衰减（1 小时内约 0.7，3 小时约 0.4），
 * 进行中为 1，结束后 45 分钟内淡出，返回 null 表示不显示。
 */
export function glowAt(e: CampusEvent, t: number): Glow | null {
  const start = evStart(e)
  const end = evEnd(e)
  if (t >= start && t < end) {
    if (isLong(e)) return { phase: 'ongoing', p: 0.3 }
    return { phase: t - start < SPOT_AFTER ? 'spot' : 'live', p: 1 }
  }
  if (t < start) {
    const d = start - t
    return { phase: d <= HOUR ? 'soon' : 'upcoming', p: 0.12 + 0.86 * Math.exp(-d / (2.5 * HOUR)) }
  }
  const p = 0.5 * Math.exp(-(t - end) / (20 * MIN))
  return p < 0.04 ? null : { phase: 'past', p }
}

/** 有颜色的显著度：远处淡紫灰 → 3 小时内校徽紫 → 临近开始橙色；进行中绿色 */
const FAR = [157, 143, 184]
const MID = [155, 79, 114]
const NEAR = [224, 138, 30]
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k))
const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
export function glowColor(g: Glow) {
  if (g.phase === 'spot' || g.phase === 'live') return '#1f9d55'
  if (g.phase === 'ongoing') return '#c07c9a'
  if (g.phase === 'past') return '#9a9aa3'
  const q = Math.min(1, Math.max(0, (g.p - 0.12) / 0.86))
  return hex(q < 0.5 ? mix(FAR, MID, q * 2) : mix(MID, NEAR, (q - 0.5) * 2))
}

/** 相对播放头的时间说明：「25 分钟后」「明天 14:00」「进行中 · 还剩 40 分钟」 */
export function glowWhen(e: CampusEvent, g: Glow, t: number) {
  const start = evStart(e)
  if (g.phase === 'spot') return '刚刚开始'
  if (g.phase === 'live') {
    const left = Math.max(1, Math.round((evEnd(e) - t) / MIN))
    return left < 60 ? `进行中 · 还剩 ${left} 分钟` : '进行中'
  }
  if (g.phase === 'ongoing') return '展览进行中'
  if (g.phase === 'past') return '已结束'
  const d = start - t
  if (d < HOUR) return `${Math.max(1, Math.ceil(d / MIN))} 分钟后`
  const day = dayStart(start) - dayStart(t)
  const prefix = day === 0 ? '' : day === DAY ? '明天 ' : day === 2 * DAY ? '后天 ' : weekdayText(dateKey(start)) + ' '
  return `${prefix}${e.allDay ? '全天' : clockText(start)}`
}

/** 自适应速度：活动开始前后慢放，没有活动的时段快进，其余正常 */
export function rateAt(events: CampusEvent[], t: number) {
  let quiet = true
  for (const e of events) {
    if (isLong(e)) continue
    const start = evStart(e)
    if (t >= start - SLOW_BEFORE && t < start + SPOT_AFTER) return SLOW_RATE
    if (t >= start - QUIET_AHEAD && t < evEnd(e)) quiet = false
  }
  return quiet ? FAST_RATE : 1
}

/** 夜色 0–1：17:00 起渐暗，19:30 到 5:00 为夜间，7:00 天亮 */
export function nightAt(t: number) {
  const h = ((t + 8 * HOUR) % DAY) / HOUR
  const ease = (x: number) => x * x * (3 - 2 * x)
  if (h >= 7 && h < 17) return 0
  if (h >= 17 && h < 19.5) return ease((h - 17) / 2.5)
  if (h >= 5 && h < 7) return 1 - ease((h - 5) / 2)
  return 1
}

/** 活动最多的 48 小时（从某天 0 点算起，只数有地点的普通活动）；一样多时取较近的 */
export function busiestWindow(events: CampusEvent[], ms = WINDOW_MS): number | null {
  const counted = events.filter((e) => e.place && e.status !== 'cancelled' && !isLong(e)).map(evStart)
  let best: number | null = null
  let most = 0
  for (const day of new Set(counted.map(dayStart))) {
    const n = counted.filter((s) => s >= day && s < day + ms).length
    if (n > most || n === most && best !== null && day > best) { most = n; best = day }
  }
  return best
}

/** 时间轴上的活动条：贪心分道，放不下时压在最后一道 */
export function packLanes(events: CampusEvent[], from: number, to: number, lanes = 4) {
  const ends: number[] = []
  return events.filter((e) => !isLong(e)).map((e) => {
    const a = Math.max(from, evStart(e))
    const b = Math.min(to, Math.max(evEnd(e), a + 30 * MIN))
    let lane = ends.findIndex((end) => end <= a)
    if (lane < 0) lane = ends.length < lanes ? ends.length : lanes - 1
    ends[lane] = Math.max(ends[lane] ?? 0, b + 10 * MIN)
    return { e, lane, left: (a - from) / (to - from), width: (b - a) / (to - from) }
  })
}

/** 播放头所在的那一刻：进行中和 3 小时内开始的活动，正在发生的排前面 */
export function momentAt(events: CampusEvent[], t: number) {
  const rank: Record<Phase, number> = { spot: 0, live: 1, soon: 2, upcoming: 3, ongoing: 4, past: 5 }
  return events.flatMap((e) => {
    const g = glowAt(e, t)
    return g && (g.phase === 'spot' || g.phase === 'live' || g.phase === 'soon' || g.phase === 'upcoming' && evStart(e) - t <= 3 * HOUR)
      ? [{ e, g }] : []
  }).sort((a, b) => rank[a.g.phase] - rank[b.g.phase] || evStart(a.e) - evStart(b.e))
}

export const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR

/** 窗口起点：now = 当前整点；best = 活动最多的 48 小时；也可以是 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM */
export function windowStart(start: string | undefined, events: CampusEvent[], now: number) {
  if (start === 'best') return busiestWindow(events) ?? floorHour(now)
  if (start && /^\d{4}-\d\d-\d\d(T\d\d:\d\d)?$/.test(start)) {
    const t = timestamp(start)
    if (Number.isFinite(t)) return t
  }
  return floorHour(now)
}

export function windowLabel(from: number) {
  const day = dateKey(from)
  return `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 ${dayName(day)} ${clockText(from)} 起`
}

// ---------- 播放 ----------
let frame = 0
let last = 0
let holdUntil = 0

function step(now: number) {
  const dt = Math.min(100, now - (last || now))
  last = now
  if (holdUntil) {
    if (now < holdUntil) { frame = requestAnimationFrame(step); return }
    holdUntil = 0
    tm.t = tm.from
  }
  const target = tm.adaptive ? rateAt(windowEvents.value, tm.t) : 1
  tm.rate += (target - tm.rate) * Math.min(1, dt / 350)
  const t = tm.t + dt * tm.speed * (HOUR / 1000) * tm.rate
  if (t >= windowEnd()) {
    tm.t = windowEnd()
    // 循环播放：在结尾停一下再从头开始
    if (tm.loop) holdUntil = now + 1500
    else { pause(); return }
  } else tm.t = t
  frame = requestAnimationFrame(step)
}

export function play() {
  if (tm.playing) return
  if (tm.t >= windowEnd()) tm.t = tm.from
  tm.playing = true
  tm.focus = ''
  last = 0
  frame = requestAnimationFrame(step)
}
export function pause() {
  tm.playing = false
  holdUntil = 0
  cancelAnimationFrame(frame)
}
export const togglePlay = () => (tm.playing ? pause() : play())
export function seek(t: number) {
  holdUntil = 0
  tm.t = Math.min(windowEnd(), Math.max(tm.from, t))
}

export function setWindow(from: number) {
  tm.from = from
  tm.t = from
  tm.focus = ''
  holdUntil = 0
}
export const shiftWindow = (days: number) => setWindow(tm.from + days * DAY)

/** 打开时光机；start 见 windowStart */
export function openTimeMachine(start?: string, autoplay = true) {
  setWindow(windowStart(start, discovery.events, nowTick.value))
  tm.rate = 1
  tm.open = true
  if (autoplay) play()
}
export function closeTimeMachine() {
  pause()
  tm.open = false
  tm.focus = ''
}
