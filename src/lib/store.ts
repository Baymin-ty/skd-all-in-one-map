import { computed, reactive } from 'vue'
import type { IconName } from './icons'
import { groupBuildings, type BuildingGroup } from './groups'
import { initRouting, type RouteResult, type Target } from './route'
import { copyGrid, validSurfaceGrid, type SurfaceGrid } from './network'
import { findIntegratedRoute } from './integratedRoute'
import type { UndergroundRouteResult } from './undergroundRoute'
import { openSheet, ui } from './ui'
import type { Building, Campus, I18nText, LngLat, PlaceCat, Places, Poi } from './types'

import { poiIcon, poiKindLabel } from './catalog'
import { DEFAULT_MAP_SETTINGS } from './mapSettings'
import { discovery, eventsIn, type DayScope, type EventRange } from './discoveryData'
import { dateKey, dayLabel, evStart, nowTick, outletState } from './campusTime'
import { defaultMenuDay, menuMeals } from './canteenMenu'
import { menuItems, priceShort, searchMenu, type MenuSort } from './menu'
import type { Meal } from './discoveryTypes'
import { defaultMapPrefs, type MapPrefs } from './mapPrefs'
import { outlinePoints } from './outlineGeometry'
import { mergedPlace } from './placeCuration'
import { defaultMapLabels } from './mapLabelCategories'
import { buildRoomIndex, findRooms, floorFromCode, resolveRoomPlace, type RoomHit } from './roomSearch'
import { floorLabel } from './rooms'
import { plan, type PlanItem, updateItem, withDiscoveryEvents } from './today'
import { agendaEntries, agendaStops, myMap, weekDates } from './myMap'
import { validateUndergroundMap, type UndergroundMap } from './underground'
import { mergeUndergroundSketch } from './undergroundSketch'
import { streetViewPointPosition } from './undergroundGraph'
import { streetViewUrl } from './streetview'
import { meters } from './measure'

/** 当前地下地图中连通地面的车辆坡道（ramp）位置；在“我要避雨！”强制走地下时，把这些位置也视为地面可走，以便步行导航能走到车辆出入口。 */
function rampConnectorPositions(underground: UndergroundMap | null): LngLat[] {
  if (!underground) return []
  return underground.connectors
    .filter((c) => c.kind === 'ramp' && ((c.floorFrom === 0 && c.floorTo === underground.floor) || (c.floorTo === 0 && c.floorFrom === underground.floor)))
    .map((c) => c.pos)
}
import { isParcelStation, openParcelPlan, parcelSearchHint } from './parcelStation'
export { POI_CATS, PLACE_COLORS } from './catalog'
/** 顶部分类条：每个分类对应哪些楼、哪些点位 */
export type Chip = 'dining' | 'academic' | 'housing' | 'sports' | 'service' | 'gate' | 'parking'
export const CHIPS: { id: Chip; zh: string; icon: IconName }[] = [
  { id: 'dining', zh: '食堂', icon: 'dining' },
  { id: 'academic', zh: '教学科研', icon: 'academic' },
  { id: 'housing', zh: '住宿', icon: 'housing' },
  { id: 'sports', zh: '运动', icon: 'sports' },
  { id: 'service', zh: '服务', icon: 'service' },
  { id: 'gate', zh: '校门', icon: 'gate' },
  { id: 'parking', zh: '停车', icon: 'parking' },
]
export function chipHasBuilding(c: Chip, b: Building) {
  return b.cat === c
}
export function chipHasPoi(c: Chip, p: Poi) {
  if (c === 'service') return p.cat === 'life'
  return p.cat === c
}

export type Selection = { kind: 'building' | 'poi' | 'group'; id: string }
/** 导航的一端：一栋楼、一个点位，或者地图上随手点的位置 */
export interface RouteEnd extends Target {
  name: string
  place?: Selection
  /** 实时定位的「我的位置」，走动时跟着更新 */
  live?: boolean
  /** 地下导航的 B1 连接点；地面端点不设置此字段。 */
  undergroundConnectorId?: string
}

export const state = reactive({
  ready: false,
  error: '',
  categories: {} as Record<PlaceCat, I18nText>,
  buildings: [] as Building[],
  groups: [] as BuildingGroup[],
  pois: [] as Poi[],
  campus: null as Campus | null,
  rainGrid: null as SurfaceGrid | null,
  rainAvailable: false,
  rainMode: false,
  underground: null as UndergroundMap | null,
  undergroundErrors: [] as string[],
  mapSettings: { ...DEFAULT_MAP_SETTINGS },
  /** 后端连不上时只读，用打包进来的静态点位 */
  readonly: false,
  selected: null as Selection | null,
  entranceBuilding: '',
  /** 从教室号搜索进来时要定位的房间，只在选中同一栋楼时生效 */
  room: null as RoomHit | null,
  chip: null as Chip | null,
  panel: 'home' as 'home' | 'events' | 'dining' | 'canteen' | 'today' | 'me',
  canteen: { id: '', outlet: '', stall: '', day: '', meal: '' as Meal | '', query: '', dish: '' },
  radar: { range: 'week' as EventRange, cat: 'all', place: '' },
  /** 全校地图上显示哪天的活动 */
  allScope: 'today' as DayScope,
  eventId: '',
  /** Query currently highlighted on the map as a campus-wide dish distribution. */
  dishFocus: '',
  menu: { query: '', canteen: '', outlet: '', stall: '', dish: '', tags: [] as string[], price: '', sort: 'best' as MenuSort, openNow: false },
  /** Personal map settings; the visible label map remains exposed for existing controls. */
  mapPrefs: defaultMapPrefs() as MapPrefs,
  /** 地图标签按类型独立显示；悬停或选中的地点临时显示标签。 */
  labelVisibility: defaultMapLabels(),
  showRoads: false,
  showUnderground: false,
  /** 地下图纸线已从地图撤下，先保留一个可手绘的空白草稿区。 */
  undergroundSketch: {
    active: false,
    paths: [] as LngLat[][],
    current: [] as LngLat[],
  },
  route: {
    open: false,
    network: 'surface' as 'surface' | 'underground',
    from: null as RouteEnd | null,
    to: null as RouteEnd | null,
    /** 下一次点地图 = 设起点/终点 */
    picking: null as 'from' | 'to' | null,
    result: null as RouteResult | null,
    undergroundResult: null as UndergroundRouteResult | null,
    /** Underground street-view navigation session. */
    streetView: { active: false, open: false, pending: false, index: 0, points: [] as { id: string; pos: LngLat; imageUrl: string }[] },
    failed: false,
  },
  toast: '',
})

const UNDERGROUND_SKETCH_KEY = 'campus.underground.sketch'
export function persistUndergroundSketchNow() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(UNDERGROUND_SKETCH_KEY, JSON.stringify({ paths: state.undergroundSketch.paths, current: state.undergroundSketch.current }))
  } catch { /* 浏览器禁用存储时仍可继续手绘 */ }
}
const persistUndergroundSketch = persistUndergroundSketchNow
function restoreUndergroundSketch() {
  try {
    if (typeof localStorage === 'undefined') return
    const value = JSON.parse(localStorage.getItem(UNDERGROUND_SKETCH_KEY) || 'null')
    if (!value || !Array.isArray(value.paths) || !Array.isArray(value.current)) return
    state.undergroundSketch.paths = value.paths.filter((path: unknown) => Array.isArray(path) && path.length >= 2) as LngLat[][]
    state.undergroundSketch.current = value.current as LngLat[]
  } catch { /* 损坏或禁用的本地草稿忽略 */ }
}
// 模块加载时立即恢复：每次改动都已即时写入，所以不在 beforeunload 里再存一遍——
// 那会让数据还没加载完、或另一个没画过的标签页关闭时，用空草稿覆盖掉已经画好的线
restoreUndergroundSketch()

/** 地图正在显示「我的」内容：我的地图模式下的首页，或者「我的今天」 */
export const mineFocus = computed(() => !state.route.open && !state.chip
  && (state.panel === 'today' || state.panel === 'home' && state.mapPrefs.mode === 'mine'))

/** 我的地图：当前范围内（某一天或本周）的安排，按地点合成一站一站 */
export const myAgenda = computed(() => {
  const week = state.panel === 'home' && myMap.scope === 'week'
  const dates = week ? weekDates(dateKey(nowTick.value)) : [plan.date]
  const entries = agendaEntries(withDiscoveryEvents(plan.items, discovery.events), dates, nowTick.value)
  const canon = (id: string) => { const sel = placeSelection(id); return sel && sel.kind !== 'group' ? sel.id : null }
  return { week, dates, entries, stops: agendaStops(entries, canon) }
})
/** 点一项安排：活动打开活动详情；课程打开那栋楼并定位到教室 */
export function openPlanItem(i: PlanItem) {
  if (i.eventId) return openEvent(i.eventId)
  const sel = placeSelection(i.place)
  if (sel?.kind === 'building' && i.room) openRoom(sel.id, i.room)
  else if (sel) select(sel)
}

/** 分类与活动/菜单面板共用地图的批量选中集合，不依赖侧栏是否显示分类列表。 */
export const mapHighlights = computed(() => {
  const ids = new Set<string>()
  if (mineFocus.value) {
    for (const stop of myAgenda.value.stops) ids.add(stop.place)
    if (state.panel === 'home') for (const place of state.mapPrefs.places) {
      const sel = placeSelection(place.place)
      if (sel) ids.add(sel.id)
    }
  }
  const dining = !state.route.open && (state.panel === 'dining' || state.panel === 'canteen')
  const chip = state.chip || (dining ? 'dining' : null)
  if (chip) {
    for (const b of state.buildings) if (chipHasBuilding(chip, b)) ids.add(b.id)
    for (const p of state.pois) if (chipHasPoi(chip, p)) ids.add(p.id)
  }
  if (dining) {
    const focused = state.dishFocus ? new Set(searchMenu(state.dishFocus).items.map((item) => item.c.place)) : null
    for (const c of discovery.canteens) if (!focused || focused.has(c.place)) ids.add(c.place)
  }
  if (!state.route.open && state.panel === 'events') {
    for (const event of eventsIn(state.radar.range, state.radar.cat, state.radar.place)) if (event.place) ids.add(event.place)
    const selected = discovery.events.find((e) => e.id === state.eventId)
    if (selected?.place) ids.add(selected.place)
  }
  const known = new Set([...state.buildings, ...state.pois].map((p) => p.id))
  return new Set([...ids].filter((id) => known.has(id)))
})

/** 地图相机，由 MapView 实现；地图还没建好时调用就什么也不做 */
export const mapApi = {
  fit: (_pts: LngLat[], _maxZoom?: number) => {},
  focus: (_p: LngLat, _zoom?: number, _dy?: number) => {},
  /** 街景模式专用相机：小地图不应使用侧栏/底部面板的 padding。 */
  fitStreetView: (_pts: LngLat[]) => {},
  focusStreetView: (_p: LngLat) => {},
  /** 回到全校（手机上铺满屏幕的那一级） */
  home: () => {},
  /** 其他图层画了参与避让的标记后，请地图重新排一次标签 */
  relayout: () => {},
}

let toastTimer = 0
function projectOnPath(p: LngLat, path: LngLat[]) {
  let travelled = 0
  let best = { distance: Infinity, along: 0 }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    const k = Math.cos(((a[1] + b[1] + p[1]) / 3) * Math.PI / 180)
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1]
    const px = (p[0] - a[0]) * k, py = p[1] - a[1]
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)))
    const projected: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const distance = meters(p, projected)
    if (distance < best.distance) best = { distance, along: travelled + meters(a, b) * t }
    travelled += meters(a, b)
  }
  return best
}

function streetViewPointsForRoute() {
  const map = state.underground
  const result = state.route.result
  // 只取地下段；segment.path 已经是从当前起点到终点的有向路径，
  // 因而按它的累计距离排序天然支持反向导航。
  const segment = result?.segments.find((s) => s.layer === 'underground')
  if (!map?.points?.length || !segment?.path.length) return []
  const graph = { nodes: map.nodes, edges: map.edges, points: map.points, entrances: map.connectors }
  return map.points.map((point) => {
    const pos = streetViewPointPosition(graph, point)
    if (!pos) return null
    const projection = projectOnPath(pos, segment.path)
    return { id: point.id, pos, imageUrl: streetViewUrl(point.imageId), ...projection }
  }).filter((point): point is { id: string; pos: LngLat; imageUrl: string; distance: number; along: number } => !!point && point.distance <= 30)
    .sort((a, b) => a.along - b.along)
    .map(({ id, pos, imageUrl }) => ({ id, pos, imageUrl }))
}
export function openUndergroundStreetView() {
  const points = streetViewPointsForRoute()
  if (!points.length) {
    state.route.streetView.pending = false
    return toast('这段地下路线暂无街景图片')
  }
  state.route.streetView = { active: true, open: true, pending: false, index: 0, points }
  const undergroundPath = state.route.result?.segments.find((segment) => segment.layer === 'underground')?.path ?? []
  mapApi.fitStreetView(undergroundPath.length ? undergroundPath : points.map((p) => p.pos))
}
export function startStreetViewNavigation() { openUndergroundStreetView() }
export function requestUndergroundStreetView() { state.route.streetView.pending = true }
export function cancelUndergroundStreetView() {
  state.route.streetView.pending = false
  if (!state.route.streetView.open) return
  stopStreetViewNavigation()
}
export function stopStreetViewNavigation() {
  const s = state.route.streetView
  s.active = false
  s.open = false
  s.pending = false
  const path = state.route.result?.segments.flatMap((x) => x.path) || []
  if (path.length) mapApi.fit(path, 19)
}
export function nextStreetViewPoint() {
  const s = state.route.streetView
  if (!s.open) return
  if (s.index >= s.points.length - 1) return stopStreetViewNavigation()
  s.index++
  mapApi.focusStreetView(s.points[s.index].pos)
}
export function advanceUndergroundStreetView() { nextStreetViewPoint() }
export function previousStreetViewPoint() {
  const s = state.route.streetView
  if (!s.open) return
  s.index = Math.max(0, s.index - 1)
  mapApi.focusStreetView(s.points[s.index].pos)
}
export function previousUndergroundStreetView() { previousStreetViewPoint() }

export function toast(msg: string) {
  state.toast = msg
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (state.toast = ''), 2600)
}

async function getJson<T>(url: string, init?: RequestInit, ms = 6000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (res.status === 204) return undefined as T
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `请求失败（${res.status}）`)
    return body as T
  } catch (e) {
    throw e instanceof DOMException && e.name === 'AbortError' ? new Error('请求超时') : e
  } finally {
    clearTimeout(timer)
  }
}

export async function loadData() {
  try {
    const [places, campus] = await Promise.all([
      getJson<{ categories: Record<PlaceCat, I18nText>; buildings: Building[]; pois: Poi[] }>('/data/places.json'),
      getJson<Campus>('/data/campus.json'),
    ])
    const underground = await getJson<UndergroundMap>('/api/underground', undefined, 4000).catch(() => getJson<UndergroundMap>('/data/underground.json').catch(() => null))
    state.categories = places.categories
    state.campus = campus
    try {
      const rain = await getJson<{ grid: SurfaceGrid | null; available: boolean }>('/api/surface-networks/rain', undefined, 4000)
      if (rain.grid && validSurfaceGrid(rain.grid, campus.grid)) { state.rainGrid = copyGrid(rain.grid); state.rainAvailable = true }
    } catch { /* 静态/离线运行时没有 rain 版本 */ }
    state.undergroundErrors = underground ? validateUndergroundMap(underground, campus) : []
    state.underground = underground && !state.undergroundErrors.length ? mergeUndergroundSketch(underground, state.undergroundSketch.paths) : null
    try {
      const live = await getJson<Places>('/api/places', undefined, 4000)
      state.buildings = live.buildings
      state.pois = live.pois
    } catch {
      state.buildings = places.buildings
      state.pois = places.pois
      state.readonly = true
    }
    state.groups = groupBuildings(state.buildings)
    initRouting(campus, state.rainMode ? rampConnectorPositions(state.underground) : [])
    state.ready = true
  } catch (e) {
    state.error = `地图数据加载失败：${(e as Error).message}`
  }
}

/** 给旧版导入的课程补上可导航楼栋；新导入会在预览确认时直接写入。 */
export function hydratePlanPlaces() {
  const index = buildRoomIndex(state.buildings, state.groups, discovery.events)
  for (const item of plan.items) {
    if (item.deleted || item.place || !item.room) continue
    const hit = resolveRoomPlace(item.room, index)
    if (hit) updateItem(item.id, { place: hit.building })
  }
}

export const buildingById = (id: string) => state.buildings.find((b) => b.id === id)
export const poiById = (id: string) => state.pois.find((p) => p.id === id)
export const groupById = (id: string) => state.groups.find((g) => g.id === id)
export const groupOf = (buildingId: string) => state.groups.find((g) => g.members.includes(buildingId))

/** 现在展开显示各栋的楼群：选中的楼群、选中楼所在的楼群、分类条选中的那类 */
export function expandedGroups(): Set<string> {
  const out = new Set<string>()
  const s = state.selected
  if (s?.kind === 'group') out.add(s.id)
  if (s?.kind === 'building') {
    const g = groupOf(s.id)
    if (g) out.add(g.id)
  }
  if (state.chip) for (const g of state.groups) if (g.cat === state.chip) out.add(g.id)
  return out
}

export function placeName(sel: Selection) {
  if (sel.kind === 'building') return buildingById(sel.id)?.name.zh ?? ''
  if (sel.kind === 'group') return groupById(sel.id)?.name.zh ?? ''
  return poiById(sel.id)?.name.zh ?? ''
}

export function select(sel: Selection | null, fly = true) {
  if (sel?.kind === 'poi') sel = mergedPlace(sel.id) ?? sel
  state.panel = 'home'
  state.eventId = ''
  state.room = null
  state.selected = sel
  state.entranceBuilding = ''
  if (!sel) return
  state.chip = null
  openSheet(1)
  if (!fly) return
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    if (b) mapApi.fit(outlinePoints(b), 19)
  } else if (sel.kind === 'group') {
    const g = groupById(sel.id)
    if (g) mapApi.fit(g.points, 18)
  } else {
    const p = poiById(sel.id)
    if (p) mapApi.focus(p.pos, 19)
  }
}

export function setChip(c: Chip | null) {
  if (c === 'dining' && !state.route.open) {
    if (state.panel === 'dining' || state.panel === 'canteen') showPanel('home')
    else openDining()
    return
  }
  state.panel = 'home'
  state.eventId = ''
  state.chip = state.chip === c ? null : c
  state.selected = null
  if (!state.chip) return
  openSheet(1)
  const chip = state.chip
  const pts = [
    ...state.buildings.filter((b) => chipHasBuilding(chip, b)).flatMap(outlinePoints),
    ...state.pois.filter((p) => chipHasPoi(chip, p)).map((p) => p.pos),
  ]
  if (pts.length) mapApi.fit(pts, 18)
}

// ---------- 搜索：名称、简称、别名里包含关键字就算；楼群排最前 ----------
export type SearchTarget = Selection | { kind: 'event'; id: string } | { kind: 'dish'; id: string; outlet: string } | { kind: 'dishGroup'; query: string } | { kind: 'canteen'; id: string; outlet?: string; stall?: string }
  | { kind: 'room'; id: string; room: RoomHit }
  /** 取件码 / 货架号：打开快递站的货架平面图 */
  | { kind: 'parcel'; id: string; query: string }
const roomIndex = computed(() => buildRoomIndex(state.buildings, state.groups, discovery.events))
const ROOM_HINT = { exact: '', rule: ' · 按房间号推测', history: ' · 按往期活动推测' }
export type SearchHit = { sel: SearchTarget; name: string; sub: string; icon: IconName }
const targetId = (target: SearchTarget) => 'id' in target ? target.id : ''
export function search(q: string): SearchHit[] {
  const k = q.trim().toLowerCase()
  if (!k) return []
  const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(k))
  const hits: SearchHit[] = []
  for (const g of state.groups)
    if (has(g.name.zh, g.name.en)) hits.push({ sel: { kind: 'group', id: g.id }, name: g.name.zh, sub: `${g.members.length} 栋楼`, icon: g.cat })
  for (const b of state.buildings)
    if (has(b.name.zh, b.name.en, b.short.zh, b.short.en, ...b.aliases))
      hits.push({
        sel: { kind: 'building', id: b.id },
        name: b.name.zh,
        sub: state.categories[b.cat]?.zh ?? '',
        icon: b.cat,
      })
  for (const p of state.pois)
    if (has(p.name.zh, p.name.en, p.desc?.zh, ...p.kind ? [poiKindLabel(p), '地下车库', '地库'] : [], ...(p.aliases ?? [])))
      hits.push({ sel: { kind: 'poi', id: p.id }, name: p.name.zh, sub: poiKindLabel(p), icon: poiIcon(p) })
  const rooms = findRooms(q, roomIndex.value).map((r): SearchHit => {
    const b = buildingById(r.building)
    return { sel: { kind: 'room', id: r.building, room: r }, name: r.code, icon: 'door',
      sub: `${b?.short.zh || b?.name.zh} · ${floorLabel(r.floor)}${r.label ? ' · ' + r.label : ''}${ROOM_HINT[r.confidence]}` }
  })
  let places = hits.slice(0, 8)
  const events = [...eventsIn('upcoming'), ...eventsIn('past')].filter((e) => has(e.title, e.organizer, e.speaker, e.venueRaw)).slice(0, 5)
    .map((e): SearchHit => ({ sel: { kind: 'event', id: e.id }, name: e.title, sub: `活动 · ${dayLabel(evStart(e))}`, icon: 'calendar' }))
  const dining: SearchHit[] = []
  for (const c of discovery.canteens) {
    const matchesPlace = hits.some((hit) => targetId(hit.sel) === c.place)
    if (has(c.zh, c.en, ...c.aliases ?? []) || matchesPlace) {
      dining.push({ sel: { kind: 'canteen', id: c.id }, name: c.zh, sub: '食堂 · 查看菜单', icon: 'dining' })
      continue // 查餐厅名称时只展示一个入口，楼层和窗口在详情中展开。
    }
    for (const o of c.outlets) {
      if (has(o.zh, ...o.aliases ?? []) && o.zh !== c.zh) dining.push({ sel: { kind: 'canteen', id: c.id, outlet: o.id }, name: `${c.zh} · ${o.zh}`, sub: '餐厅 · 查看菜单', icon: 'dining' })
      for (const s of o.stalls) if (has(s.zh, s.en, ...s.aliases ?? [])) dining.push({ sel: { kind: 'canteen', id: c.id, outlet: o.id, stall: s.id }, name: s.zh, sub: `${c.zh} · ${o.zh}`, icon: 'dining' })
    }
  }
  const dishResults = searchMenu(q).items
  const dishes = dishResults.slice(0, 8).map((x): SearchHit => ({ sel: { kind: 'dish', id: x.d.id, outlet: x.o.id }, name: x.d.zh, sub: `${x.c.zh} · ${x.d.stall || x.o.zh} · ${priceShort(x.d)}`, icon: 'dining' }))
  const dishGroups = [...new Set(dishResults.map((x) => x.c.id))]
  const distribution: SearchHit[] = dishGroups.length >= 2 ? [{ sel: { kind: 'dishGroup', query: q }, name: `全校 ${dishGroups.length} 家食堂有「${q}」`, sub: '查看全校分布、价格和排队情况', icon: 'dining' }] : []
  if (!state.route.picking) {
    const diningPlaces = new Set(dining.filter((hit) => hit.sel.kind === 'canteen').map((hit) => discovery.canteens.find((c) => c.id === targetId(hit.sel))?.place))
    places = places.filter((hit) => !diningPlaces.has(targetId(hit.sel)))
  }
  const station = state.buildings.find(isParcelStation) ?? state.pois.find(isParcelStation)
  const shelf = station && parcelSearchHint(q)
  const parcel: SearchHit[] = shelf ? [{ sel: { kind: 'parcel', id: station.id, query: q.trim() }, name: shelf.name, sub: shelf.sub, icon: 'grid' }] : []
  // 快递货架权重最高：只要命中货架号或货架关键词，就永远排在其他类型之前。
  return [...parcel, ...rooms, ...places, ...events, ...dining.slice(0, 5), ...distribution, ...dishes]
}

/** 打开某栋楼并定位到房间（分享链接的 room 参数） */
export function openRoom(building: string, code: string) {
  select({ kind: 'building', id: building })
  state.room = findRooms(code, roomIndex.value, 20).find((h) => h.building === building)
    ?? { building, code, floor: floorFromCode(code), confidence: 'rule' }
}

export function placeSelection(id?: string | null): Selection | null {
  if (id) {
    const merged = mergedPlace(id)
    if (merged && (merged.kind === 'building' ? buildingById(merged.id) : merged.kind === 'poi' ? poiById(merged.id) : groupById(merged.id))) return merged
  }
  return id && buildingById(id) ? { kind: 'building', id } : id && poiById(id) ? { kind: 'poi', id } : null
}
export function showEntrances(id: string, point?: LngLat) {
  const building = buildingById(id)
  if (!building?.entrances?.length) return
  state.entranceBuilding = id
  if (point) mapApi.focus(point, 19)
  else mapApi.fit(outlinePoints(building), 19)
}
export function showPanel(panel: 'home' | 'events' | 'dining' | 'today' | 'me') {
  closeRoute()
  state.panel = panel
  state.selected = null
  state.room = null
  state.chip = null
  state.eventId = ''
  state.dishFocus = ''
  state.menu.dish = ''
  openSheet(1)
  if (panel === 'events') fitEvents()
  if (panel === 'dining') mapApi.fit(discovery.canteens.map((c) => c.pos), 18)
  if (panel === 'today' || panel === 'home' && state.mapPrefs.mode === 'mine') fitToday()
}
/** 「我的今天」和我的地图：缩放到当前范围内的各站（我的地图再加上寝室等常用地点）；什么都没有就看全校 */
export function fitToday() {
  const ids = new Set(myAgenda.value.stops.map((s) => s.place))
  if (state.panel === 'home') for (const p of state.mapPrefs.places) ids.add(p.place)
  const points = [...ids].flatMap((id) => {
    const sel = placeSelection(id)
    const end = sel && endFor(sel)
    return end ? [end.point] : []
  })
  if (points.length) mapApi.fit(points, 18)
  else if (state.panel === 'home') mapApi.home()
}
/** 切换我的地图 / 全校地图；标签显示按模式各自记住 */
export function setMapView(mode: MapPrefs['mode']) {
  if (state.mapPrefs.mode !== mode) {
    state.mapPrefs = { ...state.mapPrefs, mode }
    state.labelVisibility = { ...state.mapPrefs.labels[mode] }
  }
  // 回到首页时 showPanel 会顺便缩放到我的各站
  if (state.panel !== 'home' || state.selected || state.route.open || state.chip) showPanel('home')
  else if (mode === 'mine') fitToday()
  if (mode === 'all') mapApi.home()
}
/** 全校地图看哪天的活动 */
export function setAllScope(scope: DayScope) {
  state.allScope = scope
  if (state.panel !== 'home' || state.selected || state.route.open) showPanel('home')
}
/** 我的地图看哪天：今天、明天或本周 */
export function setMyScope(scope: 'today' | 'tomorrow' | 'week') {
  myMap.scope = scope === 'week' ? 'week' : 'day'
  if (scope !== 'week') plan.date = dateKey(nowTick.value + (scope === 'tomorrow' ? 86_400_000 : 0))
  if (state.mapPrefs.mode !== 'mine' || state.panel !== 'home') setMapView('mine')
  else fitToday()
}
export function fitEvents() {
  const points = eventsIn(state.radar.range, state.radar.cat, state.radar.place).flatMap((e) => {
    const sel = placeSelection(e.place)
    const end = sel && endFor(sel)
    return end ? [end.point] : []
  })
  if (points.length) mapApi.fit(points, 18)
}
export function showEventsAt(id: string) {
  state.radar.place = id
  showPanel('events')
}
export function openEvent(id: string) {
  const event = discovery.events.find((e) => e.id === id)
  if (!event) return
  showPanel('events')
  state.eventId = id
  const sel = placeSelection(event.place)
  state.selected = sel
  const end = sel && endFor(sel)
  // 地点往下挪一点，上方留给活动标注卡片
  if (end) mapApi.focus(end.point, 19, 90)
}
export function openDining(canteen = '', outlet = '', stall = '', dish = '') {
  showPanel('dining')
  state.dishFocus = ''
  Object.assign(state.menu, { canteen, outlet, stall, dish, query: '', tags: [], price: '', sort: 'best', openNow: false })
  const c = discovery.canteens.find((c) => c.id === canteen)
  if (c) {
    state.selected = placeSelection(c.place)
    mapApi.focus(c.pos, 19)
  }
}
/** A canteen has its own floor, opening-hours and weekly-menu view. Search filters stay intact. */
export function openCanteen(id: string, outlet = '', stall = '') {
  const c = discovery.canteens.find((c) => c.id === id)
  if (!c) return
  closeRoute()
  state.panel = 'canteen'
  state.chip = null
  state.eventId = ''
  state.dishFocus = ''
  state.selected = placeSelection(c.place)
  const o = c.outlets.find((o) => o.id === outlet) || c.outlets[0]
  Object.assign(state.canteen, { id, outlet: '', stall: '', query: '', dish: '', day: '', meal: '' })
  if (o) selectCanteenOutlet(o.id)
  state.canteen.stall = stall
  openSheet(stall ? 2 : 1)
  mapApi.focus(c.pos, 19)
}
/** Initialize on entry or a floor change, never when the responsive panel remounts. */
export function selectCanteenOutlet(id: string) {
  if (state.canteen.outlet === id) return
  const o = discovery.canteens.find((c) => c.id === state.canteen.id)?.outlets.find((o) => o.id === id)
  if (!o) return
  const day = defaultMenuDay(o), status = outletState(o)
  const meal = day === dateKey() && (status.kind === 'open' || status.kind === 'later') && menuMeals(o).includes(status.meal) ? status.meal : ''
  Object.assign(state.canteen, { outlet: id, stall: '', day, meal, query: '', dish: '' })
}
export function chooseSearch(hit: SearchHit) {
  const sel = hit.sel
  if (sel.kind === 'event') {
    const event = discovery.events.find((e) => e.id === sel.id)
    const place = placeSelection(event?.place)
    const end = place && endFor(place)
    if (state.route.picking && end) setEnd(state.route.picking, end)
    else openEvent(sel.id)
  } else if (sel.kind === 'dishGroup') {
    if (state.route.picking) return
    state.panel = 'dining'; state.selected = null; state.eventId = ''; state.chip = null; state.dishFocus = sel.query; state.menu.query = sel.query; openSheet(1)
  } else if (sel.kind === 'dish' || sel.kind === 'canteen') {
    const item = sel.kind === 'dish' ? menuItems.value.find((x) => x.d.id === sel.id && x.o.id === sel.outlet) : undefined
    const c = item?.c ?? discovery.canteens.find((c) => c.id === sel.id)
    const place = placeSelection(c?.place)
    const end = place && endFor(place)
    if (state.route.picking && end) setEnd(state.route.picking, end)
    else if (c && sel.kind === 'canteen') openCanteen(c.id, sel.outlet, sel.stall)
    else if (c) openDining(c.id, sel.outlet, '', item?.d.id)
  } else if (sel.kind === 'room') {
    const end = endFor({ kind: 'building', id: sel.id })
    if (state.route.picking && end) setEnd(state.route.picking, { ...end, name: `${end.name} ${sel.room.code}` })
    else {
      select({ kind: 'building', id: sel.id })
      state.room = sel.room
    }
  } else if (sel.kind === 'parcel') {
    const station = placeSelection(sel.id)
    if (!station) return
    const end = state.route.picking && endFor(station)
    if (end) setEnd(state.route.picking!, end)
    else {
      select(station)
      openParcelPlan(sel.query, sel.id)
    }
  } else {
    const end = state.route.picking && endFor(sel)
    if (end) setEnd(state.route.picking!, end)
    else select(sel)
  }
}

export function navigateToPlace(id: string, fallback?: RouteEnd) {
  const sel = placeSelection(id)
  const end = sel && endFor(sel) || fallback
  if (!end) return
  state.panel = 'home'
  state.selected = null
  state.eventId = ''
  state.dishFocus = ''
  state.menu.dish = ''
  if (!ui.desktop) ui.sheet = ui.anchors[1]
  setEnd('to', end)
}

// ---------- 导航 ----------
export function endFor(sel: Selection): RouteEnd | null {
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    return b ? { name: b.short.zh || b.name.zh, place: sel, point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) } : null
  }
  if (sel.kind === 'poi') {
    const p = poiById(sel.id)
    return p ? { name: p.name.zh, place: sel, point: p.pos } : null
  }
  return null
}

const undergroundKindLabels = { ramp: '车库坡道', stairs: '楼梯', elevator: '电梯', unknown: '上下连接点' } as const

/** 把地下图层上的上下连接点变成 B1 导航端点。 */
export function undergroundEndFor(id: string): RouteEnd | null {
  const connector = state.underground?.connectors.find((item) => item.id === id)
  if (!connector) return null
  return {
    name: `${undergroundKindLabels[connector.kind]} · B1`,
    point: connector.pos,
    undergroundConnectorId: connector.id,
  }
}

/** 切换地面/地下路网时清空旧端点，避免把不同楼层误拼成一条路线。 */
export function setRouteNetwork(network: 'surface' | 'underground') {
  const r = state.route
  r.network = network
  r.from = null
  r.to = null
  r.result = null
  r.undergroundResult = null
  r.failed = false
  r.picking = network === 'surface' ? 'from' : null
  r.open = true
  if (network === 'underground') {
    state.showUnderground = false
    state.undergroundSketch.active = false
    state.undergroundSketch.current = []
  }
  openSheet(1)
}

export function startUndergroundSketch() {
  state.route.network = 'underground'
  state.route.picking = null
  state.route.from = null
  state.route.to = null
  state.route.result = null
  state.route.undergroundResult = null
  state.route.failed = false
  state.undergroundSketch.active = true
  state.undergroundSketch.current = []
  state.showUnderground = false
  persistUndergroundSketch()
  openSheet(1)
}

export function addUndergroundSketchPoint(point: LngLat) {
  if (!state.undergroundSketch.active) return
  const last = state.undergroundSketch.current.at(-1)
  if (last && Math.abs(last[0] - point[0]) < 0.000001 && Math.abs(last[1] - point[1]) < 0.000001) return
  state.undergroundSketch.current.push(point)
  persistUndergroundSketch()
}

export function finishUndergroundSketch() {
  const current = state.undergroundSketch.current
  if (current.length >= 2) state.undergroundSketch.paths.push([...current])
  state.undergroundSketch.current = []
  state.undergroundSketch.active = false
  persistUndergroundSketch()
}

export function undoUndergroundSketch() {
  if (state.undergroundSketch.active && state.undergroundSketch.current.length) {
    state.undergroundSketch.current = state.undergroundSketch.current.slice(0, -1)
    persistUndergroundSketch()
    return
  }
  state.undergroundSketch.paths.pop()
  persistUndergroundSketch()
}

export function clearUndergroundSketch() {
  state.undergroundSketch.active = false
  state.undergroundSketch.current = []
  state.undergroundSketch.paths = []
  persistUndergroundSketch()
}

export function setRainMode(enabled: boolean) {
  if (!state.campus) return
  if (enabled && !state.rainGrid) { toast('暂无避雨路网，已继续使用普通路网'); state.rainMode = false; return }
  state.rainMode = enabled
  initRouting({ ...state.campus, grid: enabled ? state.rainGrid! : state.campus.grid }, rampConnectorPositions(state.underground))
  computeRoute(false)
}

/** 临时调试入口：直接复现教学中心 → 物质1的避雨街景路线。 */
export function startStreetViewDebugRoute() {
  const matches = (b: (typeof state.buildings)[number], text: string) => b.name.zh === text || b.short?.zh === text || b.aliases?.includes(text)
  const from = state.buildings.find((b) => matches(b, '教学中心'))
  const to = state.buildings.find((b) => matches(b, '物质1'))
  if (!from || !to) return toast('调试路线地点尚未加载')
  state.route.network = 'surface'
  state.route.open = true
  state.route.picking = null
  if (!state.rainMode) setRainMode(true)
  // 调试时把“教学中心”的起点向东偏移一点，落到图 1 所示的入口一侧；不改变正式入口选择逻辑。
  const debugFrom: LngLat = [from.center[0] + 0.00035, from.center[1]]
  setEnd('from', { name: from.name.zh, point: debugFrom })
  setEnd('to', { name: to.name.zh, point: to.center })
  toast('已启动：教学中心 → 物质1')
}

export function openRoute() {
  state.panel = 'home'
  state.route.open = true
  state.route.network = 'surface'
  state.rainMode = false
  if (state.campus) initRouting(state.campus)
  state.route.undergroundResult = null
  if (!state.route.from) state.route.picking = 'from'
  else if (!state.route.to) state.route.picking = 'to'
  openSheet(1)
  computeRoute()
}

export function setEnd(which: 'from' | 'to', end: RouteEnd | null) {
  state.panel = 'home'
  state.route.open = true
  state.route[which] = end
  state.route.picking = null
  // 只选了一端时，接着让用户在地图上点另一端
  if (end && which === 'to' && !state.route.from) state.route.picking = 'from'
  if (end && which === 'from' && !state.route.to) state.route.picking = 'to'
  openSheet(1)
  computeRoute()
}

/** fit = false：边走边重算时不动地图 */
export function computeRoute(fit = true) {
  const r = state.route
  if (r.network === 'underground') {
    r.result = null
    r.undergroundResult = null
    r.failed = false
    return
  }
  r.undergroundResult = null
  if (!r.from || !r.to) {
    r.result = null
    r.failed = false
    return
  }
  r.result = findIntegratedRoute(r.from, r.to, state.underground, state.rainMode ? { forceUnderground: true } : undefined)
  r.failed = !r.result
  if (r.result && fit) mapApi.fit(r.result.segments.flatMap((s) => s.path), 19)
}

export function closeRoute() {
  state.rainMode = false
  if (state.campus) initRouting(state.campus)
  state.route.streetView.active = false
  state.route.streetView.open = false
  state.route.streetView.pending = false
  Object.assign(state.route, { open: false, network: 'surface', from: null, to: null, picking: null, result: null, undergroundResult: null, failed: false })
}
