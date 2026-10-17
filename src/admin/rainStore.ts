import { computed, reactive } from 'vue'
import type { Campus } from '../lib/types'
import type { SurfaceGrid } from '../lib/network'
import { copyGrid, paintGrid, toRainDraft } from '../lib/network'
import { admin, request, notify, ApiError } from './store'
export const rain = reactive({ grid: null as SurfaceGrid | null, baseGrid: null as SurfaceGrid | null, campus: null as Campus | null, baseline: '', loading: false, saving: false, error: '', past: [] as SurfaceGrid[], future: [] as SurfaceGrid[], brushSize: 1, attempt: 0 })
export const rainDirty = computed(() => !!rain.grid && JSON.stringify(rain.grid) !== rain.baseline)
export const rainCanUndo = computed(() => rain.past.length > 0 && !rain.saving)
export const rainCanRedo = computed(() => rain.future.length > 0 && !rain.saving)
const clone = copyGrid
export async function loadRain() {
  rain.loading = true; rain.error = ''
  try {
    const [base, saved, campus] = await Promise.all([
      request<{ grid: SurfaceGrid }>('/api/surface-networks/default'),
      request<{ grid: SurfaceGrid | null }>('/api/surface-networks/rain'),
      request<Campus>('/data/campus.json'),
    ])
    rain.baseGrid = clone(base.grid); rain.grid = toRainDraft(saved.grid || base.grid); rain.baseline = JSON.stringify(rain.grid); rain.past = []; rain.future = []; rain.campus = campus
  } catch (e) { rain.error = `避雨路网加载失败：${(e as Error).message}` }
  finally { rain.loading = false }
}
export function paint(row: number, col: number, walkable: boolean, brushSize = 1) {
  if (!rain.grid || rain.saving) return
  const next = paintGrid(rain.grid, row, col, walkable, brushSize, rain.baseGrid ?? undefined)
  if (next === rain.grid) return
  rain.past.push(clone(rain.grid)); rain.future = []; rain.grid = next
}
export function undoRain() { if (rainCanUndo.value && rain.grid) { rain.future.push(clone(rain.grid)); rain.grid = rain.past.pop()! } }
export function redoRain() { if (rainCanRedo.value && rain.grid) { rain.past.push(clone(rain.grid)); rain.grid = rain.future.pop()! } }
export function discardRain() { if (rain.grid) { rain.grid = JSON.parse(rain.baseline); rain.past = []; rain.future = [] } }
/** 避雨保存可能卡在 static.db 写锁上，给它比默认 7 秒更宽的超时（服务端 busy 重试约 2 秒就会给 503） */
const SAVE_TIMEOUT_MS = 20_000
/** 超时/断网/503（写锁被占用）都可重试：这个 PUT 是幂等 upsert。4xx（400/401/413）是数据或权限问题，重试没意义。 */
const retryable = (e: unknown) => e instanceof ApiError && (e.kind !== 'http' || e.status === 503)
const seconds = (ms: number) => (ms / 1000).toFixed(1)
async function putRain(grid: SurfaceGrid) {
  for (let attempt = 1; ; attempt++) {
    rain.attempt = attempt // >1 时按钮显示「重试中…」，saving 全程为 true
    try {
      return await request<{ grid: SurfaceGrid }>('/api/surface-networks/rain', { method: 'PUT', body: JSON.stringify({ grid }) }, { timeoutMs: SAVE_TIMEOUT_MS })
    } catch (e) { if (attempt > 1 || !retryable(e)) throw e }
  }
}
function saveFailure(e: unknown, retried: boolean): string {
  const suffix = retried ? '（已自动重试 1 次）' : ''
  // 503 直接把服务端 error 原文透出，别吞掉「可能有另一个实例在写」这类可操作信息。
  if (e instanceof ApiError && e.kind === 'timeout') return `等待 ${seconds(e.timeoutMs)} 秒后超时（服务可能刚重启，或数据库正被其他连接占用）${suffix}`
  return `${(e as Error).message}${suffix}`
}
export async function saveRain() {
  if (!rain.grid || rain.saving || !admin.loggedIn) return
  rain.saving = true; rain.error = ''; rain.attempt = 1
  try { const saved = await putRain(rain.grid); rain.grid = clone(saved.grid); rain.baseline = JSON.stringify(rain.grid); rain.past = []; rain.future = []; notify('避雨路网已保存，前台刷新后可用') }
  catch (e) { rain.error = `保存失败：${saveFailure(e, rain.attempt > 1)}` }
  finally { rain.saving = false; rain.attempt = 0 }
}
