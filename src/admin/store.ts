import { computed, nextTick, reactive, toRaw } from 'vue'
import type { Building, Campus, Places, Poi, LngLat, Entrance, UndergroundConnector, UndergroundMap, UndergroundConnectorKind } from '../lib/types'
import { PLACE_COLORS, POI_CATS } from '../lib/catalog'
import type { IconName } from '../lib/icons'
import { DEFAULT_MAP_SETTINGS } from '../lib/mapSettings'
import {
  addNode, autoBindEntrances, bindEntrance, connect, createStreetViewPoint, graphFromMap, graphToMap, importSketch, planStreetViewPathInterpolation, mergeNodes, moveNode, removeEdge, removeNode,
  roundPos, splitEdge, ugId, unbindEntrance, type UgStreetViewPoint, type UndergroundGraph,
} from '../lib/undergroundGraph'
export type Kind = 'building' | 'poi'
/** overview / underground / rain 是「地图数据」的地上、地下、遮雨三层 */
export type View = 'overview' | 'underground' | 'rain' | 'events' | 'dishes' | 'data'
export const VIEWS: View[] = ['overview', 'underground', 'rain', 'events', 'dishes', 'data']
export type Asset = { kind: Kind; data: Building | Poi }
export type UndergroundSelection = { kind: 'node' | 'edge' | 'entrance' | 'point'; id: string }
/** 选择/拖动、画道路、放出入口、点哪删哪 */
export type UndergroundTool = 'select' | 'road' | 'entrance' | 'point' | 'interpolate' | 'erase'
interface UndergroundHistory { graph: UndergroundGraph; active: string | null }
export const admin = reactive({
  ready: false, loading: false, error: '', offline: false, loggedIn: false, token: '',
  view: ((VIEWS as string[]).includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview') as View,
  places: { categories: {} as Places['categories'], buildings: [], pois: [] } as Places, campus: null as Campus | null,
  search: '', category: '', kind: (location.hash === '#buildings' ? 'building' : location.hash === '#pois' ? 'poi' : '') as Kind | '',
  selected: null as Asset | null, draft: null as Asset | null,
  deleteTarget: null as Asset | null, deleteError: '',
  mode: '' as '' | 'position' | 'polygon' | 'vertices' | 'entrance', showBuildings: true, showPois: true, labels: true,
  loginOpen: false, notice: '', noticeTone: 'ok' as 'ok' | 'error', saving: false, savedAt: '',
  draftBaseline: '', draftVersion: 0, editError: '', positionSet: true, selectedVertex: null as number | null, outlinePart: 0,
  geometryPast: [] as Geometry[], geometryFuture: [] as Geometry[],
  /** 地图显示是固定配置（public/data/map-settings.json），后台只读 */
  mapSettings: { ...DEFAULT_MAP_SETTINGS }, mapSettingsDraft: { ...DEFAULT_MAP_SETTINGS },
  settingsReady: true, settingsSaving: false, settingsError: '',
  underground: null as UndergroundMap | null, undergroundGraph: null as UndergroundGraph | null,
  undergroundBaseline: '', undergroundSelected: null as UndergroundSelection | null,
  undergroundTool: 'select' as UndergroundTool, undergroundEntranceKind: 'ramp' as UndergroundConnectorKind,
  /** 正在画的道路末端节点；下一次点击从这里连出去 */
  undergroundActive: null as string | null,
  undergroundPast: [] as UndergroundHistory[], undergroundFuture: [] as UndergroundHistory[],
  undergroundLoading: false, undergroundSaving: false, undergroundError: '', undergroundImported: 0, undergroundVersion: 0,
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
export const undergroundDirty = computed(() => !!admin.undergroundGraph && JSON.stringify(admin.undergroundGraph) !== admin.undergroundBaseline)
export const undergroundCanUndo = computed(() => admin.undergroundPast.length > 0 && !admin.undergroundSaving)
export const undergroundCanRedo = computed(() => admin.undergroundFuture.length > 0 && !admin.undergroundSaving)
export const settingsDirty = computed(() => (Object.keys(DEFAULT_MAP_SETTINGS) as (keyof typeof DEFAULT_MAP_SETTINGS)[])
  .some((key) => admin.mapSettingsDraft[key] !== admin.mapSettings[key]))
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

export const assets = computed<Asset[]>(() => [
  ...admin.places.buildings.map((data) => ({ kind: 'building' as const, data })),
  ...admin.places.pois.map((data) => ({ kind: 'poi' as const, data })),
])
export function category(a: Asset) {
  if (a.kind === 'poi') { const c = POI_CATS[(a.data as Poi).cat]; return { ...c, key: `poi:${a.data.cat}` } }
  const b = a.data as Building
  return { zh: admin.places.categories[b.cat]?.zh || b.cat, color: PLACE_COLORS[b.cat], icon: b.cat as IconName, key: `building:${b.cat}` }
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
export const missingEntrances = computed(() => admin.places.buildings.filter((b) => b.cat !== 'gate' && !b.entrances?.length))
export const mapControl = { focus: (_a: Asset) => {}, home: () => {} }
let timer = 0
/** 请求失败原因：调用方（如 saveRain）需要区分「可重试的超时/断网/503」与「重试也没用的 4xx」 */
export class ApiError extends Error {
  readonly kind: 'timeout' | 'network' | 'http'
  readonly status: number
  readonly timeoutMs: number
  constructor(message: string, kind: ApiError['kind'], status = 0, timeoutMs = 0) {
    super(message)
    this.name = 'ApiError'; this.kind = kind; this.status = status; this.timeoutMs = timeoutMs
  }
}
const elapsedSeconds = (startedAt: number) => ((Date.now() - startedAt) / 1000).toFixed(1)
export function notify(message: string, tone: 'ok' | 'error' = 'ok') { admin.notice = message; admin.noticeTone = tone; clearTimeout(timer); timer = window.setTimeout(() => admin.notice = '', tone === 'error' ? 6000 : 3800) }
export async function request<T>(url: string, init?: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  // 默认 7000ms 不变；只有避雨路网保存这类可能卡在数据库写锁上的请求会传更大的超时。
  const timeoutMs = options?.timeoutMs ?? 7000
  const startedAt = Date.now()
  const ctl = new AbortController(); const timeout = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}`, ...init?.headers } })
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && admin.loggedIn) { logout(); admin.loginOpen = true }
      throw new ApiError(data.error || `请求失败（${res.status}）`, 'http', res.status)
    }
    return data
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError(`连接超时（等待 ${elapsedSeconds(startedAt)} 秒），请检查服务后重试`, 'timeout', 0, timeoutMs)
    if (e instanceof TypeError) throw new ApiError(`无法连接数据服务（等待 ${elapsedSeconds(startedAt)} 秒），请检查服务后重试`, 'network', 0, timeoutMs)
    throw e
  }
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
    admin.ready = true; admin.savedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) { admin.error = (e as Error).message }
  finally { admin.loading = false }
}

const SKETCH_KEY = 'campus.underground.sketch'
let loadedSketchPaths: LngLat[][] = []
function frontSketchPaths(): LngLat[][] {
  try {
    const value = JSON.parse(localStorage.getItem(SKETCH_KEY) || 'null')
    return Array.isArray(value?.paths) ? value.paths.filter((path: unknown) => Array.isArray(path) && path.length >= 2) as LngLat[][] : []
  } catch { return [] }
}
function resetUnderground(map: UndergroundMap) {
  admin.underground = map; admin.undergroundGraph = graphFromMap(map); admin.undergroundBaseline = JSON.stringify(admin.undergroundGraph)
  admin.undergroundSelected = null; admin.undergroundActive = null; admin.undergroundTool = 'select'
  admin.undergroundPast = []; admin.undergroundFuture = []; admin.undergroundImported = 0; admin.undergroundVersion++
  // 前台手绘草稿只存在浏览器里：导入成一步可撤销的修改，保存后才写进后台
  const paths = frontSketchPaths()
  loadedSketchPaths = copy(paths)
  if (paths.length) changeUnderground((g) => { admin.undergroundImported = importSketch(g, paths) })
}
export async function loadUnderground() {
  admin.undergroundLoading = true; admin.undergroundError = ''
  try {
    const map = await request<UndergroundMap>('/api/underground').catch(() => request<UndergroundMap>('/data/underground.json'))
    resetUnderground(map)
  } catch (e) { admin.undergroundError = (e as Error).message }
  finally { admin.undergroundLoading = false }
}
const snapshot = (): UndergroundHistory => ({ graph: copy(admin.undergroundGraph!), active: admin.undergroundActive })
/** 所有改动都走这里：记一步撤销，并通知地图重绘。 */
export function changeUnderground(change: (g: UndergroundGraph) => void) {
  const g = admin.undergroundGraph
  if (!g || admin.undergroundSaving) return
  const before = snapshot(); change(g)
  if (JSON.stringify(before.graph) !== JSON.stringify(g)) {
    admin.undergroundPast.push(before); if (admin.undergroundPast.length > 200) admin.undergroundPast.shift()
    admin.undergroundFuture = []; admin.undergroundError = ''
  }
  const sel = admin.undergroundSelected
  if (sel && !(sel.kind === 'node' ? g.nodes : sel.kind === 'edge' ? g.edges : sel.kind === 'entrance' ? g.entrances : g.points).some((item) => item.id === sel.id)) admin.undergroundSelected = null
  if (admin.undergroundActive && !g.nodes.some((n) => n.id === admin.undergroundActive)) admin.undergroundActive = null
  admin.undergroundVersion++
}
function restoreHistory(from: UndergroundHistory[], to: UndergroundHistory[]) {
  if (!admin.undergroundGraph || admin.undergroundSaving || !from.length) return
  to.push(snapshot())
  const { graph, active } = from.pop()!
  admin.undergroundGraph = graph
  admin.undergroundActive = admin.undergroundTool === 'road' ? active : null
  changeUnderground(() => {})
}
export function undoUnderground() { restoreHistory(admin.undergroundPast, admin.undergroundFuture) }
export function redoUnderground() { restoreHistory(admin.undergroundFuture, admin.undergroundPast) }
export function selectUnderground(selection: UndergroundSelection | null) {
  admin.undergroundSelected = selection; admin.undergroundVersion++
}
export function setUndergroundTool(tool: UndergroundTool) {
  if (admin.undergroundSaving) return
  // 选中一个节点再切到画道路，直接从这个节点接着画
  const sel = admin.undergroundSelected
  admin.undergroundActive = tool === 'road' && sel?.kind === 'node' ? sel.id : null
  admin.undergroundTool = tool; admin.undergroundVersion++
}
export function finishUndergroundRoad() { admin.undergroundActive = null; admin.undergroundVersion++ }
function inCampus(pos: LngLat) {
  const bounds = admin.campus?.bounds
  if (!bounds) return true
  const [[x0, y0], [x1, y1]] = bounds
  if (pos[0] >= x0 && pos[0] <= x1 && pos[1] >= y0 && pos[1] <= y1) return true
  notify('这个位置在校园地图范围外', 'error'); return false
}
/** 画道路：从当前末端连到 target（新建点、已有节点或路段上的插点），并把末端移过去。 */
function drawTo(target: (g: UndergroundGraph) => string | null) {
  changeUnderground((g) => {
    const id = target(g); if (!id) return
    if (admin.undergroundActive) connect(g, admin.undergroundActive, id)
    admin.undergroundActive = id
    admin.undergroundSelected = { kind: 'node', id }
  })
}
export function drawUndergroundAt(pos: LngLat) {
  if (inCampus(pos)) drawTo((g) => addNode(g, pos))
}
export function drawUndergroundToNode(id: string) {
  if (admin.undergroundActive === id) return finishUndergroundRoad()
  drawTo(() => id)
}
export function drawUndergroundOnEdge(edgeId: string, pos: LngLat) {
  drawTo((g) => splitEdge(g, edgeId, pos))
}
/** 选择工具里双击路段：插入一个可拖的节点 */
export function insertUndergroundNode(edgeId: string, pos: LngLat) {
  changeUnderground((g) => { const id = splitEdge(g, edgeId, pos); if (id) admin.undergroundSelected = { kind: 'node', id } })
}
/** 在线段上创建街景点；位置会被投影回线段，保存时只写端点、权重和随机 GUID。 */
export function addUndergroundStreetViewPoint(edgeId: string, pos: LngLat) {
  let point: UgStreetViewPoint | null = null
  changeUnderground((g) => {
    point = createStreetViewPoint(g, edgeId, pos)
    if (point) admin.undergroundSelected = { kind: 'point', id: point.id }
  })
  return point
}
const STREETVIEW_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const streetViewFileIssue = (file: File) => !STREETVIEW_TYPES.includes(file.type) ? '只支持 JPG、PNG 或 WebP 图片' : file.size > 20 * 1024 * 1024 ? '图片不能超过 20 MB' : ''
async function putStreetViewImage(imageId: string, file: File) {
  const issue = streetViewFileIssue(file)
  if (issue) throw new Error(issue)
  const ctl = new AbortController(), timeout = setTimeout(() => ctl.abort(), 60_000)
  try {
    const res = await fetch(`/api/underground/streetview/${encodeURIComponent(imageId)}`, {
      method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${admin.token}` }, body: file, signal: ctl.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 401 && admin.loggedIn) { logout(); admin.loginOpen = true }
      throw new Error(data.error || `上传失败（${res.status}）`)
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('上传超时，请重试')
    throw e
  } finally { clearTimeout(timeout) }
}
/** 上传街景图：服务端按 imageId（GUID）改名后写入 data/streetview。 */
export async function uploadUndergroundStreetViewImage(imageId: string, file: File) {
  if (!authorized()) return false
  try {
    await putStreetViewImage(imageId, file)
    notify('街景图片已上传')
    return true
  } catch (e) {
    notify(`上传失败：${(e as Error).message}`, 'error')
    return false
  }
}
/**
 * 插值并批量上传：图片先按文件名排序，再依次写入每个插值点的 GUID；
 * 只有全部上传成功后才把新街景点提交到路网。
 */
export async function interpolateUndergroundStreetViewPathWithImages(
  nodeIds: string[], count: number, files: File[], onProgress?: (done: number, total: number) => void,
): Promise<ReturnType<typeof planStreetViewPathInterpolation>> {
  if (!authorized()) return { points: [], error: '请先登录后台' }
  if (admin.undergroundSaving) return { points: [], error: '正在保存，请稍后再试' }
  const g = admin.undergroundGraph
  if (!g) return { points: [], error: '地下路网尚未加载' }
  const planned = planStreetViewPathInterpolation(g, nodeIds, count)
  if (planned.error) return planned
  if (files.length !== count) return { points: [], error: `需要选择 ${count} 张图片，当前选中 ${files.length} 张` }
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  for (const file of sorted) {
    const issue = streetViewFileIssue(file)
    if (issue) return { points: [], error: `${file.name}：${issue}` }
  }
  let done = 0
  const failures: (string | undefined)[] = []
  await Promise.all(planned.points.map(async (point, i) => {
    try {
      await putStreetViewImage(point.imageId, sorted[i])
      onProgress?.(++done, sorted.length)
    } catch (e) {
      failures[i] = `第 ${i + 1} 张（${sorted[i].name}）上传失败：${(e as Error).message}`
    }
  }))
  const failure = failures.find(Boolean)
  if (failure) return { points: [], error: failure }
  if (admin.undergroundGraph !== g || nodeIds.some((id) => !g.nodes.some((node) => node.id === id)))
    return { points: [], error: '折线节点已变化，图片已上传但新街景点没有写入，请重试' }
  if (admin.undergroundSaving) return { points: [], error: '正在保存，图片已上传但新街景点没有写入，请稍后重试' }
  changeUnderground((next) => {
    next.points.push(...planned.points)
    admin.undergroundSelected = { kind: 'point', id: planned.points[0].id }
  })
  notify(`沿折线添加 ${count} 个街景点，并按文件名顺序绑定图片`)
  return planned
}
/** 拖动或放置时吸附到的目标：节点、路段上的一点，或还没绑定的出入口 */
export type UndergroundSnap = { node: string } | { edge: string; pos: LngLat } | { entrance: string }
/** 吸附目标对应的节点；落在路段上时先在路段上插一个节点 */
function snapNode(g: UndergroundGraph, snap?: UndergroundSnap) {
  if (!snap || 'entrance' in snap) return null
  return 'node' in snap ? snap.node : splitEdge(g, snap.edge, snap.pos)
}
/** 画路画到出入口上：已绑定就接到它的节点，没绑定就在出入口处落点并绑上 */
export function drawUndergroundToEntrance(entranceId: string) {
  const entrance = admin.undergroundGraph?.entrances.find((e) => e.id === entranceId)
  if (!entrance) return
  if (entrance.node) return drawUndergroundToNode(entrance.node)
  drawTo((g) => { const id = addNode(g, entrance.pos); bindEntrance(g, entranceId, id); return id })
}
/** 放置出入口；点在节点或路段上时直接绑定到路网 */
export function addUndergroundEntrance(pos: LngLat, snap?: UndergroundSnap) {
  if (!snap && !inCampus(pos)) return
  const id = ugId('ug-entrance')
  changeUnderground((g) => {
    g.entrances.push({ id, floorFrom: 0, floorTo: admin.underground?.floor ?? -1, kind: admin.undergroundEntranceKind, pos: roundPos(pos), source: 'admin' })
    const target = snapNode(g, snap)
    if (target) bindEntrance(g, id, target)
    admin.undergroundSelected = { kind: 'entrance', id }
  })
}
/** 把节点挪到 pos：落在别的节点或路段上就合成路口，落在没绑定的出入口上就把它绑上。返回挪完后的节点 id。 */
function relocateNode(g: UndergroundGraph, id: string, pos: LngLat, snap?: UndergroundSnap) {
  if (snap && 'entrance' in snap) {
    const entrance = g.entrances.find((e) => e.id === snap.entrance)
    if (entrance && !entrance.node) { moveNode(g, id, entrance.pos); bindEntrance(g, entrance.id, id); return id }
  }
  const target = snapNode(g, snap)
  if (target && target !== id) { mergeNodes(g, id, target); return target }
  moveNode(g, id, pos); return id
}
/** 拖动节点；绑定在上面的出入口一起走。 */
export function moveUndergroundNode(id: string, pos: LngLat, snap?: UndergroundSnap) {
  if (!snap && !inCampus(pos)) return changeUnderground(() => {})
  changeUnderground((g) => {
    const result = relocateNode(g, id, pos, snap)
    if (admin.undergroundActive === id) admin.undergroundActive = result
    admin.undergroundSelected = { kind: 'node', id: result }
  })
}
/**
 * 拖动出入口：已绑定时连同节点和相连的路一起移动（detach 为真时先拆开再单独移动）；
 * 没绑定时落到节点或路段上就绑上。
 */
export function moveUndergroundEntrance(id: string, pos: LngLat, snap?: UndergroundSnap, detach = false) {
  if (!snap && !inCampus(pos)) return changeUnderground(() => {})
  changeUnderground((g) => {
    const entrance = g.entrances.find((e) => e.id === id); if (!entrance) return
    if (detach) unbindEntrance(g, id)
    const bound = entrance.node
    if (bound) {
      const result = relocateNode(g, bound, pos, snap && !('entrance' in snap) ? snap : undefined)
      if (admin.undergroundActive === bound) admin.undergroundActive = result
    } else {
      const target = snapNode(g, snap)
      if (target) bindEntrance(g, id, target)
      else entrance.pos = roundPos(pos)
    }
    admin.undergroundSelected = { kind: 'entrance', id }
  })
}
/** 把还没绑定的出入口接到 maxMeters 内最近的道路上；不传 ids 就处理全部。 */
export function bindUndergroundEntrances(maxMeters: number, ids?: string[]) {
  let count = 0
  changeUnderground((g) => { count = autoBindEntrances(g, maxMeters, ids) })
  notify(count ? `已把 ${count} 个出入口绑定到道路` : `${maxMeters} 米内没有可以绑定的道路`, count ? 'ok' : 'error')
  return count
}
export function deleteUnderground(target: UndergroundSelection) {
  changeUnderground((g) => {
    if (target.kind === 'node') removeNode(g, target.id)
    else if (target.kind === 'edge') removeEdge(g, target.id)
    else if (target.kind === 'entrance') g.entrances = g.entrances.filter((e) => e.id !== target.id)
    else g.points = g.points.filter((point) => point.id !== target.id)
  })
}
export function deleteUndergroundSelection() {
  if (admin.undergroundSelected) deleteUnderground(admin.undergroundSelected)
}
export function updateUndergroundEntrance(id: string, patch: Partial<Pick<UndergroundConnector, 'kind' | 'note'>>) {
  changeUnderground((g) => {
    const e = g.entrances.find((item) => item.id === id); if (!e) return
    Object.assign(e, patch)
    if (patch.note === '') delete e.note
  })
}
export async function saveUnderground() {
  if (!admin.undergroundGraph || !admin.underground || admin.undergroundSaving || !authorized()) return
  admin.undergroundSaving = true; admin.undergroundError = ''
  try {
    const body = graphToMap(admin.undergroundGraph, admin.underground)
    const consumed = new Set(loadedSketchPaths.filter((path) => {
      const graph = graphFromMap(body), before = JSON.stringify(graph)
      importSketch(graph, [path])
      return JSON.stringify(graph) === before
    }).map((path) => JSON.stringify(path)))
    const saved = await request<UndergroundMap>('/api/underground', { method: 'PUT', body: JSON.stringify(body) })
    try {
      const draft = JSON.parse(localStorage.getItem(SKETCH_KEY) || 'null')
      if (Array.isArray(draft?.paths)) {
        draft.paths = draft.paths.filter((path: LngLat[]) => !consumed.has(JSON.stringify(path)))
        if (draft.paths.length || draft.current?.length) localStorage.setItem(SKETCH_KEY, JSON.stringify(draft))
        else localStorage.removeItem(SKETCH_KEY)
      }
    } catch { /* 无存储 */ }
    admin.undergroundSaving = false
    resetUnderground(saved)
    notify('地下标注已保存到后台')
  } catch (e) { admin.undergroundError = `保存失败：${(e as Error).message}` }
  finally { admin.undergroundSaving = false }
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
/** 其他页面（活动、菜品）登记的未保存检查；返回 false 表示用户选择留下 */
export const leaveGuards = new Set<() => boolean>()
export function navigate(view: View) {
  if (view === admin.view) return
  if (!discard()) return
  if (admin.undergroundSaving) return
  if (undergroundDirty.value && !confirm('地下标注还未保存，放弃这些修改？')) return
  if (undergroundDirty.value && admin.underground) resetUnderground(admin.underground)
  for (const guard of leaveGuards) if (!guard()) return
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
