import { computed, nextTick, reactive, toRaw } from 'vue'
import type { Building, Campus, Places, Poi, LngLat, Entrance } from '../lib/types'
import { PLACE_COLORS, POI_CATS } from '../lib/catalog'
import type { IconName } from '../lib/icons'
import { DEFAULT_MAP_SETTINGS, validMapSettings } from '../lib/mapSettings'
export type Kind = 'building' | 'poi'
export type View = 'overview' | 'appearance' | 'data' | 'events'
export type Asset = { kind: Kind; data: Building | Poi }
export const admin = reactive({
  ready: false, loading: false, error: '', offline: false, loggedIn: false, token: '',
  view: (['overview', 'appearance', 'data', 'events'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview') as View,
  places: { categories: {} as Places['categories'], buildings: [], pois: [] } as Places, campus: null as Campus | null,
  search: '', category: '', kind: (location.hash === '#buildings' ? 'building' : location.hash === '#pois' ? 'poi' : '') as Kind | '',
  selected: null as Asset | null, draft: null as Asset | null,
  deleteTarget: null as Asset | null, deleteError: '',
  mode: '' as '' | 'position' | 'polygon' | 'vertices' | 'entrance', showBuildings: true, showPois: true, labels: true,
  loginOpen: false, notice: '', noticeTone: 'ok' as 'ok' | 'error', saving: false, savedAt: '',
  draftBaseline: '', draftVersion: 0, editError: '', positionSet: true, selectedVertex: null as number | null, outlinePart: 0,
  geometryPast: [] as Geometry[], geometryFuture: [] as Geometry[],
  mapSettings: { ...DEFAULT_MAP_SETTINGS }, mapSettingsDraft: { ...DEFAULT_MAP_SETTINGS },
  settingsReady: false, settingsSaving: false, settingsError: '',
})
interface Geometry {
  positionSet: boolean
  outlinePart: number
  mode: typeof admin.mode
  pos?: LngLat
  center?: LngLat
  poly?: LngLat[]
  parts?: LngLat[][]
  entrances?: Entrance[]
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export const draftDirty = computed(() => !!admin.draft && JSON.stringify(admin.draft) !== admin.draftBaseline)
export const canUndo = computed(() => admin.geometryPast.length > 0 && !admin.saving)
export const canRedo = computed(() => admin.geometryFuture.length > 0 && !admin.saving)
export const draftOutline = computed(() => {
  const b = admin.draft?.kind === 'building' ? admin.draft.data as Building : null
  return (admin.outlinePart ? b?.parts?.[admin.outlinePart - 1] : b?.poly) ?? []
})
export const draftIssue = computed(() => {
  const d = admin.draft
  if (!d) return ''
  if (!d.data.name.zh.trim()) return '请填写名称'
  if (d.kind === 'poi' && !admin.positionSet) return '请先在地图上选择位置'
  if (d.kind === 'building' && [(d.data as Building).poly, ...((d.data as Building).parts ?? [])].some((ring) => ring.length < 3)) return '每个轮廓都至少需要 3 个点'
  return ''
})
let pendingEditorAction: (() => void) | null = null
function beginDraft(asset: Asset, positionSet = true) {
  const d = copy(toRaw(asset))
  d.data.hours ??= { zh: '', en: '' }
  if (d.kind === 'building') {
    const b = d.data as Building
    b.info ??= { zh: '', en: '' }; b.note ??= { zh: '', en: '' }; b.entrances ??= []
  } else (d.data as Poi).desc ??= { zh: '', en: '' }
  admin.draft = d; admin.draftBaseline = JSON.stringify(d); admin.positionSet = positionSet
  admin.draftVersion++
  admin.outlinePart = 0
  admin.editError = ''; admin.selectedVertex = null; admin.geometryPast = []; admin.geometryFuture = []
}
function closeDraft() {
  admin.draft = null; admin.mode = ''; admin.draftBaseline = ''; admin.editError = ''
  admin.geometryPast = []; admin.geometryFuture = []; admin.selectedVertex = null
}
function editorAuthorized(action: () => void) {
  if (admin.offline) { notify('数据服务未连接，暂时无法编辑'); return false }
  if (!admin.loggedIn) { pendingEditorAction = action; admin.loginOpen = true; return false }
  return true
}
export function closeLogin() { pendingEditorAction = null; admin.loginOpen = false }

export const settingsDirty = computed(() => (Object.keys(DEFAULT_MAP_SETTINGS) as (keyof typeof DEFAULT_MAP_SETTINGS)[])
  .some((key) => admin.mapSettingsDraft[key] !== admin.mapSettings[key]))
export const assets = computed<Asset[]>(() => [
  ...admin.places.buildings.map((data) => ({ kind: 'building' as const, data })),
  ...admin.places.pois.map((data) => ({ kind: 'poi' as const, data })),
])
export function category(a: Asset) {
  if (a.kind === 'poi') { const c = POI_CATS[(a.data as Poi).cat]; return { ...c, key: `poi:${a.data.cat}` } }
  const b = a.data as Building
  return { zh: b.walkway ? '风雨长廊' : admin.places.categories[b.cat]?.zh || b.cat, color: b.walkway ? '#0e8fa8' : PLACE_COLORS[b.cat], icon: (b.walkway ? 'walkway' : b.cat) as IconName, key: b.walkway ? 'walkway' : `building:${b.cat}` }
}
export const filtered = computed(() => assets.value.filter((a) => {
  if (admin.kind && a.kind !== admin.kind) return false
  if (admin.category && category(a).key !== admin.category) return false
  const q = admin.search.trim().toLowerCase()
  return !q || [a.data.name.zh, a.data.name.en, a.data.id, ...(a.data.aliases ?? []), ...(a.kind === 'building' ? [(a.data as Building).short.zh, ...(a.data as Building).orgs.map((o) => o.zh)] : [(a.data as Poi).desc?.zh])].join(' ').toLowerCase().includes(q)
}))
export const categoryOptions = computed(() => {
  const all = assets.value.filter((a) => !admin.kind || a.kind === admin.kind)
  return [...new Map(all.map((a) => { const c = category(a); return [c.key, c] })).values()]
})
export const entrances = computed(() => admin.places.buildings.reduce((n, b) => n + (b.entrances?.length || 0), 0))
export const missingEntrances = computed(() => admin.places.buildings.filter((b) => !b.walkway && b.cat !== 'gate' && !b.entrances?.length))
export const mapControl = { focus: (_a: Asset) => {}, home: () => {} }
let timer = 0
export function notify(message: string, tone: 'ok' | 'error' = 'ok') { admin.notice = message; admin.noticeTone = tone; clearTimeout(timer); timer = window.setTimeout(() => admin.notice = '', tone === 'error' ? 6000 : 3800) }
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController(); const timeout = setTimeout(() => ctl.abort(), 7000)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}`, ...init?.headers } })
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && admin.loggedIn) { logout(); admin.loginOpen = true }
      throw new Error(data.error || `请求失败（${res.status}）`)
    }
    return data
  } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') throw new Error('连接超时，请检查服务后重试'); if (e instanceof TypeError) throw new Error('无法连接数据服务，请检查服务后重试'); throw e }
  finally { clearTimeout(timeout) }
}
export async function load() {
  if (admin.loading) return
  admin.loading = true; admin.error = ''
  try {
    admin.campus = await request<Campus>('/data/campus.json')
    try { admin.places = await request<Places>('/api/places'); admin.offline = false }
    catch { admin.places = await request<Places>('/data/places.json'); admin.offline = true }
    if (admin.selected) {
      const selected = admin.selected
      const data = (selected.kind === 'building' ? admin.places.buildings : admin.places.pois).find((item) => item.id === selected.data.id)
      admin.selected = data ? { kind: selected.kind, data } : null
    }
    await loadMapSettings()
    admin.ready = true; admin.savedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) { admin.error = (e as Error).message }
  finally { admin.loading = false }
}
export async function loadMapSettings() {
  admin.settingsError = ''; admin.settingsReady = false
  try {
    const settings = await request<unknown>('/api/map-settings')
    if (!validMapSettings(settings)) throw new Error('地图显示设置格式不正确')
    admin.mapSettings = { ...settings }; admin.mapSettingsDraft = { ...settings }; admin.settingsReady = true
  } catch (e) { admin.settingsError = `无法读取显示设置：${(e as Error).message}` }
}
export async function saveMapSettings() {
  if (admin.settingsSaving || !admin.settingsReady || !authorized()) return
  if (!validMapSettings(admin.mapSettingsDraft)) { admin.settingsError = '请输入 0–100 之间的百分比'; return }
  admin.settingsSaving = true; admin.settingsError = ''
  try {
    const settings = await request<unknown>('/api/map-settings', { method: 'PUT', body: JSON.stringify(admin.mapSettingsDraft) })
    if (!validMapSettings(settings)) throw new Error('服务器返回的设置格式不正确')
    admin.mapSettings = { ...settings }; admin.mapSettingsDraft = { ...settings }
    notify('显示设置已保存，前台刷新后生效')
  } catch (e) { admin.settingsError = `保存失败：${(e as Error).message}` }
  finally { admin.settingsSaving = false }
}
export async function login(token: string) {
  await request('/api/auth', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  admin.token = token; admin.loggedIn = true; admin.loginOpen = false
  try { sessionStorage.setItem('campus.admin.token', token) } catch { /* 无存储时仅本次有效 */ }
  const action = pendingEditorAction; pendingEditorAction = null; action?.()
}
export function logout() {
  admin.token = ''; admin.loggedIn = false
  try { sessionStorage.removeItem('campus.admin.token') } catch { /* 无存储 */ }
}
export async function restore() {
  try { const token = sessionStorage.getItem('campus.admin.token'); if (token && !admin.offline) await login(token) } catch { logout() }
}
export function authorized() {
  if (admin.offline) { notify('服务未连接，请启动后端并刷新数据'); return false }
  if (!admin.loggedIn) { admin.loginOpen = true; return false }
  return true
}

export function discard() {
  if (admin.saving) return false
  if (draftDirty.value && !confirm('放弃当前未保存的修改？')) return false
  closeDraft(); return true
}
export function navigate(view: View) {
  if (!discard()) return
  if (admin.settingsSaving) return
  if (settingsDirty.value && !confirm('地图显示设置还未保存，放弃这些修改？')) return
  admin.mapSettingsDraft = { ...admin.mapSettings }
  admin.view = view; location.hash = view
}
export function selectAsset(a: Asset) {
  if (admin.draft?.data.id === a.data.id && admin.draft.kind === a.kind) { mapControl.focus(admin.draft); return }
  if (!discard()) return
  admin.selected = a; void nextTick(() => mapControl.focus(a))
}
export function setKind(kind: Kind | '') { admin.kind = kind; admin.category = '' }
export function clearFilters() { admin.search = ''; admin.category = ''; admin.kind = '' }
export function edit(a: Asset) {
  if (!editorAuthorized(() => edit(a)) || !discard()) return
  beginDraft(a)
  admin.view = 'overview'; location.hash = 'overview'
  admin.selected = a; admin.mode = ''
  void nextTick(() => mapControl.focus(a))
}
export function create(kind: Kind) {
  if (!editorAuthorized(() => create(kind)) || !discard()) return
  const center: LngLat = [121.6014, 31.183]
  beginDraft({ kind, data: kind === 'poi'
    ? { id: '', name: { zh: '', en: '' }, cat: 'life', pos: center, desc: { zh: '', en: '' }, hours: { zh: '', en: '' } } as Poi
    : { id: '', name: { zh: '', en: '' }, short: { zh: '', en: '' }, cat: 'academic', center, poly: [], aliases: [], orgs: [], rooms: [], entrances: [], info: { zh: '', en: '' }, hours: { zh: '', en: '' }, note: { zh: '', en: '' } } as Building }, false)
  admin.selected = null
  admin.mode = kind === 'poi' ? 'position' : 'polygon'
}
export async function save(keepCreating = false) {
  const d = admin.draft
  if (!d || admin.saving || !authorized()) return
  if (draftIssue.value) { admin.editError = draftIssue.value; return }
  admin.saving = true; admin.editError = ''
  try {
    const url = `/api/${d.kind === 'poi' ? 'pois' : 'buildings'}`
    const saved = await request<Building | Poi>(url + (d.data.id ? `/${d.data.id}` : ''), { method: d.data.id ? 'PUT' : 'POST', body: JSON.stringify(d.data) })
    if (d.kind === 'poi') { const i = admin.places.pois.findIndex((x) => x.id === saved.id); if (i < 0) admin.places.pois.push(saved as Poi); else admin.places.pois.splice(i, 1, saved as Poi) }
    else { const i = admin.places.buildings.findIndex((x) => x.id === saved.id); if (i < 0) admin.places.buildings.push(saved as Building); else admin.places.buildings.splice(i, 1, saved as Building) }
    admin.selected = { kind: d.kind, data: saved }; closeDraft(); admin.savedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false }); notify(`「${saved.name.zh}」已保存，前台刷新后可见`)
    if (keepCreating) {
      // Release the save lock before creating the next draft; preserve the chosen category.
      admin.saving = false
      create(d.kind)
      if (admin.draft) { admin.draft.data.cat = saved.cat; admin.draftBaseline = JSON.stringify(admin.draft) }
    }
  } catch (e) { admin.editError = `保存失败：${(e as Error).message}` }
  finally { admin.saving = false }
}
export function remove(a: Asset) {
  if (admin.saving || !a.data.id || !editorAuthorized(() => remove(a))) return
  admin.deleteTarget = copy(a); admin.deleteError = ''
}
export function cancelRemove() { if (!admin.saving) { admin.deleteTarget = null; admin.deleteError = '' } }
export async function confirmRemove() {
  const a = admin.deleteTarget
  if (!a || admin.saving || !authorized()) return
  admin.saving = true
  admin.deleteError = ''
  try {
    await request(`/api/${a.kind === 'poi' ? 'pois' : 'buildings'}/${a.data.id}`, { method: 'DELETE' })
    if (a.kind === 'poi') admin.places.pois = admin.places.pois.filter((p) => p.id !== a.data.id)
    else admin.places.buildings = admin.places.buildings.filter((b) => b.id !== a.data.id)
    if (admin.selected?.data.id === a.data.id && admin.selected.kind === a.kind) admin.selected = null
    if (admin.draft?.data.id === a.data.id && admin.draft.kind === a.kind) closeDraft()
    admin.deleteTarget = null
    notify('已删除，前台刷新后可见')
  } catch (e) { admin.deleteError = `删除失败：${(e as Error).message}` }
  finally { admin.saving = false }
}
export function exportData() {
  const blob = new Blob([JSON.stringify({ ...admin.places, exportedAt: new Date().toISOString(), coordinateSystem: 'BD-09' }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `campus-places-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify(admin.offline ? '已导出离线数据副本' : '已导出当前校园数据')
}
function geometry(): Geometry {
  const d = admin.draft!
  const context = { positionSet: admin.positionSet, outlinePart: admin.outlinePart, mode: admin.mode }
  return copy(d.kind === 'poi' ? { ...context, pos: (d.data as Poi).pos }
    : { ...context, center: (d.data as Building).center, poly: (d.data as Building).poly, parts: (d.data as Building).parts, entrances: (d.data as Building).entrances })
}
function restoreGeometry(g: Geometry) {
  const d = admin.draft
  if (!d) return
  const value = copy(g)
  admin.positionSet = value.positionSet
  admin.outlinePart = value.outlinePart; admin.mode = value.mode
  if (d.kind === 'poi') (d.data as Poi).pos = value.pos!
  else Object.assign(d.data, { center: value.center, poly: value.poly, parts: value.parts, entrances: value.entrances })
  if (admin.outlinePart > ((d.data as Building).parts?.length ?? 0)) admin.outlinePart = 0
  admin.selectedVertex = null; admin.editError = ''
}
export function changeGeometry(change: () => void) {
  if (!admin.draft || admin.saving) return
  const before = geometry()
  change()
  if (JSON.stringify(before) !== JSON.stringify(geometry())) {
    admin.geometryPast.push(before)
    if (admin.geometryPast.length > 100) admin.geometryPast.shift()
    admin.geometryFuture = []; admin.editError = ''
  }
}
export function undoGeometry() {
  if (!canUndo.value) return
  admin.geometryFuture.push(geometry()); restoreGeometry(admin.geometryPast.pop()!)
}
export function redoGeometry() {
  if (!canRedo.value) return
  admin.geometryPast.push(geometry()); restoreGeometry(admin.geometryFuture.pop()!)
}
export function setMode(mode: typeof admin.mode) {
  if (admin.saving) return
  admin.mode = admin.mode === mode ? '' : mode
  admin.selectedVertex = null; admin.editError = ''
}
export function redrawOutline() {
  if (admin.draft?.kind !== 'building') return
  changeGeometry(() => { draftOutline.value.splice(0) })
  admin.mode = 'polygon'; admin.selectedVertex = null
}
export function addOutlinePart() {
  if (admin.draft?.kind !== 'building' || admin.saving) return
  if (draftOutline.value.length < 3) { admin.editError = '请先完成当前轮廓，再添加附属轮廓'; return }
  const b = admin.draft.data as Building
  changeGeometry(() => (b.parts ??= []).push([]))
  admin.outlinePart = b.parts!.length; admin.mode = 'polygon'; admin.selectedVertex = null
}
export function removeOutlinePart() {
  if (admin.draft?.kind !== 'building' || !admin.outlinePart || admin.saving) return
  changeGeometry(() => (admin.draft!.data as Building).parts!.splice(admin.outlinePart - 1, 1))
  admin.outlinePart = 0; admin.mode = ''; admin.selectedVertex = null
}
export function deleteVertex() {
  const d = admin.draft, i = admin.selectedVertex
  if (d?.kind !== 'building' || i === null) return
  if (draftOutline.value.length <= 3) { admin.editError = '轮廓至少需要 3 个点'; return }
  changeGeometry(() => draftOutline.value.splice(i, 1)); admin.selectedVertex = null
}
export function setPosition(pos: LngLat) {
  const d = admin.draft
  if (!d) return
  changeGeometry(() => {
    if (d.kind === 'poi') (d.data as Poi).pos = pos
    else (d.data as Building).center = pos
    admin.positionSet = true
  })
}
export function mapPick(pos: LngLat) {
  const d = admin.draft
  if (!d || admin.saving || !['position', 'polygon', 'entrance'].includes(admin.mode)) return
  const bounds = admin.campus?.bounds
  if (bounds && (pos[0] < bounds[0][0] || pos[0] > bounds[1][0] || pos[1] < bounds[0][1] || pos[1] > bounds[1][1])) {
    admin.editError = '请在校园地图范围内选点'; return
  }
  if (admin.mode === 'position') { setPosition(pos); admin.mode = '' }
  else if (admin.mode === 'polygon' && d.kind === 'building') {
    const b = d.data as Building
    changeGeometry(() => {
      draftOutline.value.push(pos)
      if (!admin.outlinePart) b.center = [+(b.poly.reduce((s, p) => s + p[0], 0) / b.poly.length).toFixed(6), +(b.poly.reduce((s, p) => s + p[1], 0) / b.poly.length).toFixed(6)]
    })
  } else if (admin.mode === 'entrance' && d.kind === 'building') {
    const b = d.data as Building
    changeGeometry(() => (b.entrances ??= []).push({ pos, zh: `入口 ${b.entrances!.length + 1}`, en: '' }))
    admin.mode = ''
  }
}
