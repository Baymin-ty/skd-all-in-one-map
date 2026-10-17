import { computed, reactive } from 'vue'
import type { Campus } from '../lib/types'
import type { SurfaceGrid } from '../lib/network'
import { copyGrid, paintGrid } from '../lib/network'
import { admin, request, notify } from './store'
export const rain = reactive({ grid: null as SurfaceGrid | null, baseGrid: null as SurfaceGrid | null, campus: null as Campus | null, baseline: '', loading: false, saving: false, error: '', past: [] as SurfaceGrid[], future: [] as SurfaceGrid[], brushSize: 1 })
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
    rain.baseGrid = clone(base.grid); rain.grid = clone(saved.grid || base.grid); rain.baseline = JSON.stringify(rain.grid); rain.past = []; rain.future = []; rain.campus = campus
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
export async function saveRain() {
  if (!rain.grid || rain.saving || !admin.loggedIn) return
  rain.saving = true; rain.error = ''
  try { const saved = await request<{ grid: SurfaceGrid }>('/api/surface-networks/rain', { method: 'PUT', body: JSON.stringify({ grid: rain.grid }) }); rain.grid = clone(saved.grid); rain.baseline = JSON.stringify(rain.grid); rain.past = []; rain.future = []; notify('避雨路网已保存，前台刷新后可用') }
  catch (e) { rain.error = `保存失败：${(e as Error).message}` }
  finally { rain.saving = false }
}
