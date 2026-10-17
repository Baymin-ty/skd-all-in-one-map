import { reactive } from 'vue'
import { admin, notify, request } from './store'

export type RunStatus = 'running' | 'ok' | 'error' | 'skipped'
export interface PipelineRun {
  id: number
  source: string
  trigger: 'schedule' | 'manual'
  startedAt: number
  finishedAt: number | null
  status: RunStatus
  added: number
  updated: number
  cancelled: number
  review: number
  skipped: number
  scanned: number
  error: string
  warnings: string[]
}
export interface PipelineSource {
  id: string
  label: string
  kind: 'web' | 'email'
  target: string
  description: string
  configured: boolean
  hint: string
  intervalMinutes: number
  running: boolean
  nextRunAt: number | null
  lastRun: PipelineRun | null
  lastSuccessAt: number | null
}
export interface PipelineStatus {
  schedule: boolean
  sources: PipelineSource[]
  runs: PipelineRun[]
  review: { pending: number; approved: number; rejected: number }
  catalog: { total: number; bySource: Record<string, number> }
}
export interface ReviewEvent {
  id: string
  title: string
  start: string
  end: string | null
  allDay: boolean
  venueRaw: string
  place: string | null
  room: string
  floor?: number | null
  organizer: string
  category: string
  source: string
  url?: string
}
export interface ReviewItem {
  id: string
  source: string
  status: 'pending' | 'approved' | 'rejected'
  reasons: string[]
  event: ReviewEvent
  context: { kind: 'email'; subject: string; from: string; date: number; excerpt: string } | { kind: 'official'; fields: Record<string, string | undefined> }
  createdAt: number
  decidedAt: number | null
}

export const pipeline = reactive({
  status: null as PipelineStatus | null, loading: false, error: '', starting: '' as string,
  reviewState: 'pending' as ReviewItem['status'], review: [] as ReviewItem[], reviewLoading: false,
})
let poll = 0

export const running = () => !!pipeline.status?.sources.some((source) => source.running)
function schedulePoll() {
  window.clearTimeout(poll)
  if (running()) poll = window.setTimeout(() => { void loadPipeline(true) }, 2000)
}
export function stopPipelinePoll() { window.clearTimeout(poll) }

export async function loadPipeline(quiet = false) {
  if (!admin.loggedIn) return
  const wasRunning = running()
  if (!quiet) pipeline.loading = true
  try {
    pipeline.status = await request<PipelineStatus>('/api/events/pipeline')
    pipeline.error = ''
    if (wasRunning && !running()) {
      const failed = pipeline.status.sources.filter((s) => s.lastRun?.status === 'error')
      if (failed.length) notify(`${failed.map((s) => s.label).join('、')}运行失败，请查看错误信息`, 'error')
      else notify('活动数据已更新')
      if (pipeline.reviewState === 'pending') void loadReview()
    }
  } catch (e) { pipeline.error = (e as Error).message }
  finally { pipeline.loading = false; schedulePoll() }
}

export async function runPipeline(source?: string) {
  pipeline.starting = source || 'all'
  try {
    pipeline.status = await request<PipelineStatus>('/api/events/pipeline/run', { method: 'POST', body: JSON.stringify(source ? { source } : {}) })
    notify('已开始运行，完成后会自动刷新')
  } catch (e) { notify((e as Error).message, 'error') }
  finally { pipeline.starting = ''; schedulePoll() }
}

export async function loadReview(state = pipeline.reviewState) {
  if (!admin.loggedIn) return
  pipeline.reviewState = state
  pipeline.reviewLoading = true
  try { pipeline.review = await request<ReviewItem[]>(`/api/events/review?status=${state}`) }
  catch (e) { notify((e as Error).message, 'error') }
  finally { pipeline.reviewLoading = false }
}

export async function decideReview(item: ReviewItem, decision: 'approve' | 'reject', event?: Partial<ReviewEvent>) {
  await request(`/api/events/review/${encodeURIComponent(item.id)}/${decision}`, { method: 'POST', body: JSON.stringify(event ? { event } : {}) })
  pipeline.review = pipeline.review.filter((other) => other.id !== item.id)
  if (pipeline.status) {
    pipeline.status.review.pending = Math.max(0, pipeline.status.review.pending - 1)
    pipeline.status.review[decision === 'approve' ? 'approved' : 'rejected']++
  }
  notify(decision === 'approve' ? '已通过，活动已上线' : '已拒绝，这条不会再出现')
}

const zhTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export function formatTime(value: number | string | null | undefined) {
  if (value == null || value === '') return '—'
  const time = typeof value === 'number' ? value : Date.parse(/[+-]\d\d:\d\d$|Z$/.test(value) ? value : `${value}+08:00`)
  return Number.isFinite(time) ? zhTime.format(time) : String(value)
}
export function relativeTime(value: number | null | undefined, now = Date.now()) {
  if (!value) return '从未'
  const diff = value - now, abs = Math.abs(diff)
  const text = abs < 60_000 ? '不到 1 分钟' : abs < 3_600_000 ? `${Math.round(abs / 60_000)} 分钟` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)} 小时` : `${Math.round(abs / 86_400_000)} 天`
  return diff > 0 ? `${text}后` : `${text}前`
}
/** ISO 时间 → datetime-local 输入框的值（上海时间）。 */
export function toLocalInput(value: string | null | undefined) {
  if (!value) return ''
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(0, 16) : ''
}
export const CATEGORY_LABELS: Record<string, string> = {
  lecture: '讲座', conference: '会议', culture: '文化艺术', student: '学生活动', career: '就业', library: '图书馆',
  international: '国际交流', wellbeing: '身心健康', campus: '校园事务', other: '其他',
}
export const SOURCE_LABELS: Record<string, string> = { official: '官网', email: '邮件', organizer: '主办方' }
