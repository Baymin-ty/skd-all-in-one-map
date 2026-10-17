import { ref } from 'vue'
import { clockText, demoClockEnabled, nowTick } from './campusTime'
import { discovery } from './discoveryData'

export interface Crowd {
  level: 0 | 1 | 2
  waitMin: number
  source: 'live' | 'history' | 'guess'
}
export interface CrowdSnapshot {
  level: 0 | 1 | 2
  waitMin: number
  reports: number
  updatedAt: number
}
export type CrowdResponse = Record<string, CrowdSnapshot>
export const CROWD_LABELS = ['人少', '要排一会儿', '人很多'] as const
export const crowdRevision = ref(0)

const MAX_AGE = 30 * 60_000
let live: CrowdResponse = {}

/** 下课集中在 11:50 和 17:30 前后，高峰稍晚几分钟 */
const PEAKS = [
  { at: 7 * 60 + 50, size: 3, width: 15 },
  { at: 12 * 60 + 5, size: 12, width: 18 },
  { at: 17 * 60 + 50, size: 8, width: 20 },
]
function estimate(t: number): Crowd {
  const [h, m] = clockText(t).split(':').map(Number)
  const minute = h * 60 + m
  const waitMin = Math.round(1 + PEAKS.reduce((sum, p) => sum + p.size * Math.exp(-(((minute - p.at) / p.width) ** 2)), 0))
  return { level: waitMin < 4 ? 0 : waitMin < 9 ? 1 : 2, waitMin, source: 'guess' }
}
function validSnapshot(value: unknown): value is CrowdSnapshot {
  const x = value as CrowdSnapshot
  return !!x && (x.level === 0 || x.level === 1 || x.level === 2)
    && Number.isFinite(x.waitMin) && x.waitMin >= 0
    && Number.isFinite(x.reports) && x.reports > 0
    && Number.isFinite(x.updatedAt)
}
function fresh(value: CrowdSnapshot, t: number) { return validSnapshot(value) && t - value.updatedAt <= MAX_AGE }

export function setLiveCrowd(data: CrowdResponse) {
  const next: CrowdResponse = {}
  for (const [id, value] of Object.entries(data || {})) if (validSnapshot(value)) {
    next[id] = { level: value.level, waitMin: Math.round(value.waitMin), reports: Math.round(value.reports), updatedAt: value.updatedAt }
  }
  live = next
  crowdRevision.value++
}
export function clearLiveCrowd() { live = {}; crowdRevision.value++ }
function outletsFor(canteenId: string) { return discovery.canteens.find((c) => c.id === canteenId)?.outlets.map((o) => o.id) || [] }
function aggregate(values: CrowdSnapshot[], t: number): Crowd | null {
  const freshValues = values.filter((x) => fresh(x, t))
  if (!freshValues.length) return null
  const total = freshValues.reduce((n, x) => n + x.reports, 0)
  if (!total) return null
  const waitMin = Math.round(freshValues.reduce((n, x) => n + x.waitMin * x.reports, 0) / total)
  return { level: waitMin < 4 ? 0 : waitMin < 9 ? 1 : 2, waitMin, source: 'live' }
}

/** 读取实时窗口反馈；没有足够新数据时保持原来的估算行为。 */
export function crowdAt(canteen: string, t: number): Crowd {
  const keys = outletsFor(canteen)
  const liveCrowd = aggregate((keys.length ? keys : [canteen]).map((id) => live[id]).filter(Boolean), t)
  return liveCrowd || estimate(t)
}

export async function loadCrowd(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const at = demoClockEnabled.value ? `?at=${encodeURIComponent(String(nowTick.value))}` : ''
    const response = await fetcher(`/api/crowd${at}`, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('crowd response')
    setLiveCrowd(data as CrowdResponse)
    return true
  } catch { return false }
}

export async function submitCrowd(outlet: string, level: 0 | 1 | 2, waitMin?: number) {
  const headers = { 'Content-Type': 'application/json', 'X-Community-Request': '1' }
  const session = await fetch('/api/community/session', { method: 'POST', credentials: 'same-origin', headers })
  if (!session.ok) throw new Error('匿名会话暂时不可用，请稍后重试')
  const response = await fetch(`/api/crowd/${encodeURIComponent(outlet)}`, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ level, ...(waitMin == null ? {} : { waitMin }) }) })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error || '反馈暂时提交失败，请稍后重试')
  await loadCrowd()
  return data as CrowdSnapshot
}
