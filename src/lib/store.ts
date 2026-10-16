import { reactive, toRaw } from 'vue'
import { groupBuildings, type BuildingGroup } from './groups'
import type { IconName } from './icons'
import { findRoute, initRouting, type RouteResult, type Target } from './route'
import { openSheet } from './ui'
import type { Building, Campus, I18nText, LngLat, PlaceCat, Poi, PoiCat } from './types'

export const POI_CATS: Record<PoiCat, { zh: string; icon: IconName; color: string }> = {
  life: { zh: '生活服务', icon: 'life', color: '#16a2a8' },
  dining: { zh: '餐饮', icon: 'dining', color: '#e07a1f' },
  sports: { zh: '运动', icon: 'sports', color: '#d64545' },
  parking: { zh: '停车', icon: 'parking', color: '#4a4a4f' },
  transit: { zh: '交通', icon: 'transit', color: '#2f6fd6' },
}
export const PLACE_COLORS: Record<PlaceCat, string> = {
  academic: '#527da3', dining: '#bd8046', housing: '#64937a', sports: '#b86b67', service: '#528f92', gate: '#8c7ba5',
}
export const WALKWAY_COLOR = '#0e8fa8'

/** 顶部分类条：每个分类对应哪些楼、哪些点位 */
export type Chip = 'dining' | 'academic' | 'housing' | 'sports' | 'service' | 'gate' | 'walkway' | 'parking'
export const CHIPS: { id: Chip; zh: string; icon: IconName }[] = [
  { id: 'dining', zh: '餐饮', icon: 'dining' },
  { id: 'academic', zh: '教学科研', icon: 'academic' },
  { id: 'housing', zh: '住宿', icon: 'housing' },
  { id: 'walkway', zh: '风雨长廊', icon: 'walkway' },
  { id: 'sports', zh: '运动', icon: 'sports' },
  { id: 'service', zh: '服务', icon: 'service' },
  { id: 'gate', zh: '校门', icon: 'gate' },
  { id: 'parking', zh: '停车', icon: 'parking' },
]
export function chipHasBuilding(c: Chip, b: Building) {
  if (c === 'walkway') return !!b.walkway
  return !b.walkway && b.cat === c
}
export function chipHasPoi(c: Chip, p: Poi) {
  if (c === 'service') return p.cat === 'life'
  return p.cat === c
}

export type Selection = { kind: 'building' | 'poi' | 'group'; id: string }
/** 导航的一端：一栋楼、一个点位，或者地图上随手点的位置 */
export interface RouteEnd extends Target {
  name: string
}

export const state = reactive({
  ready: false,
  error: '',
  categories: {} as Record<PlaceCat, I18nText>,
  buildings: [] as Building[],
  groups: [] as BuildingGroup[],
  pois: [] as Poi[],
  campus: null as Campus | null,
  /** 后端连不上时只读，用打包进来的静态点位 */
  readonly: false,
  selected: null as Selection | null,
  chip: null as Chip | null,
  /** 地图上显示普通地点名称（选中的、导航的始终显示） */
  labels: true,
  showRoads: false,
  /** 管理后台（地址带 #admin） */
  admin: location.hash === '#admin',
  /** 口令验证过 */
  loggedIn: false,
  password: '',
  /** 正在编辑的点位表单；id 为空 = 新建 */
  draft: null as Poi | null,
  /** 下一次点地图 = 放新点位 */
  placing: false,
  route: {
    open: false,
    from: null as RouteEnd | null,
    to: null as RouteEnd | null,
    rain: false,
    /** 下一次点地图 = 设起点/终点 */
    picking: null as 'from' | 'to' | null,
    result: null as RouteResult | null,
    failed: false,
  },
  toast: '',
})

/** 能拖动、编辑点位：在后台并且登录了 */
export const canEdit = () => state.admin && state.loggedIn

/** 地图相机，由 MapView 实现；地图还没建好时调用就什么也不做 */
export const mapApi = {
  fit: (_pts: LngLat[], _maxZoom?: number) => {},
  focus: (_p: LngLat, _zoom?: number) => {},
  home: () => {},
}

let toastTimer = 0
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
      getJson<{ categories: Record<PlaceCat, I18nText>; buildings: Building[]; pois: Poi[] }>('data/places.json'),
      getJson<Campus>('data/campus.json'),
    ])
    state.categories = places.categories
    state.buildings = places.buildings
    state.groups = groupBuildings(places.buildings)
    state.campus = campus
    initRouting(campus, places.buildings.filter((b) => b.walkway).map((b) => b.poly))
    try {
      state.pois = await getJson<Poi[]>('api/pois', undefined, 4000)
    } catch {
      state.pois = places.pois
      state.readonly = true
    }
    state.ready = true
  } catch (e) {
    state.error = `地图数据加载失败：${(e as Error).message}`
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
  state.selected = sel
  if (!sel) return
  state.chip = null
  openSheet(1)
  if (!fly) return
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    if (b) mapApi.fit(b.poly, 19)
  } else if (sel.kind === 'group') {
    const g = groupById(sel.id)
    if (g) mapApi.fit(g.points, 18)
  } else {
    const p = poiById(sel.id)
    if (p) mapApi.focus(p.pos, 19)
  }
}

export function setChip(c: Chip | null) {
  state.chip = state.chip === c ? null : c
  state.selected = null
  if (!state.chip) return
  openSheet(1)
  const chip = state.chip
  const pts = [
    ...state.buildings.filter((b) => chipHasBuilding(chip, b)).flatMap((b) => b.poly),
    ...state.pois.filter((p) => chipHasPoi(chip, p)).map((p) => p.pos),
  ]
  if (pts.length) mapApi.fit(pts, 18)
}

// ---------- 搜索：名称、简称、别名里包含关键字就算；楼群排最前 ----------
export type SearchHit = { sel: Selection; name: string; sub: string; icon: IconName }
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
        sub: b.walkway ? '风雨长廊' : state.categories[b.cat]?.zh ?? '',
        icon: b.walkway ? 'walkway' : b.cat,
      })
  for (const p of state.pois)
    if (has(p.name.zh, p.name.en, p.desc?.zh))
      hits.push({ sel: { kind: 'poi', id: p.id }, name: p.name.zh, sub: POI_CATS[p.cat]?.zh ?? '', icon: POI_CATS[p.cat]?.icon ?? 'pin' })
  return hits.slice(0, 20)
}

// ---------- 导航 ----------
export function endFor(sel: Selection): RouteEnd | null {
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    return b ? { name: b.short.zh || b.name.zh, point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) } : null
  }
  if (sel.kind === 'poi') {
    const p = poiById(sel.id)
    return p ? { name: p.name.zh, point: p.pos } : null
  }
  return null
}

export function openRoute(rain = false) {
  state.route.open = true
  if (rain) state.route.rain = true
  if (!state.route.from) state.route.picking = 'from'
  else if (!state.route.to) state.route.picking = 'to'
  openSheet(1)
  computeRoute()
}

export function setEnd(which: 'from' | 'to', end: RouteEnd | null) {
  state.route.open = true
  state.route[which] = end
  state.route.picking = null
  // 只选了一端时，接着让用户在地图上点另一端
  if (end && which === 'to' && !state.route.from) state.route.picking = 'from'
  if (end && which === 'from' && !state.route.to) state.route.picking = 'to'
  openSheet(1)
  computeRoute()
}

export function computeRoute() {
  const r = state.route
  r.result = null
  r.failed = false
  if (!r.from || !r.to) return
  r.result = findRoute(r.from, r.to, r.rain)
  r.failed = !r.result
  if (r.result) mapApi.fit(r.result.segments.flatMap((s) => s.path), 19)
}

export function closeRoute() {
  Object.assign(state.route, { open: false, from: null, to: null, picking: null, result: null, failed: false })
}

// ---------- 管理后台：点位 ----------
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${state.password}` })

export async function login(password: string) {
  await getJson('api/auth', { method: 'POST', headers: { Authorization: `Bearer ${password}` } })
  state.password = password
  state.loggedIn = true
  try {
    sessionStorage.setItem('map.pw', password)
  } catch {
    /* 隐私模式下存不了，刷新后重新输入即可 */
  }
}

export function logout() {
  Object.assign(state, { loggedIn: false, password: '', draft: null, placing: false })
  try {
    sessionStorage.removeItem('map.pw')
  } catch {
    /* 同上 */
  }
}

export async function restoreLogin() {
  let pw: string | null = null
  try {
    pw = sessionStorage.getItem('map.pw')
  } catch {
    return
  }
  if (pw && !state.readonly) await login(pw).catch(() => logout())
}

/** 进出后台跟着地址栏的 #admin 走，前进后退也对 */
export function syncAdminFromHash() {
  state.admin = location.hash === '#admin'
  if (!state.admin) Object.assign(state, { draft: null, placing: false })
  else closeRoute()
  openSheet(1)
}

export function newDraft(pos: LngLat) {
  state.placing = false
  state.draft = { id: '', name: { zh: '', en: '' }, cat: 'life', pos, desc: { zh: '', en: '' }, hours: { zh: '', en: '' } }
  openSheet(1)
}

export function editDraft(p: Poi) {
  // 复制一份再改：取消编辑时地图上的点位不受影响（structuredClone 不能直接克隆响应式代理）
  const raw = structuredClone(toRaw(p))
  state.draft = { ...raw, desc: raw.desc ?? { zh: '', en: '' }, hours: raw.hours ?? { zh: '', en: '' } }
  state.selected = { kind: 'poi', id: p.id }
  openSheet(1)
}

export async function saveDraft() {
  const d = state.draft
  if (!d) return
  const body = JSON.stringify({ name: d.name, cat: d.cat, pos: d.pos, desc: d.desc, hours: d.hours })
  const saved = d.id
    ? await getJson<Poi>(`api/pois/${d.id}`, { method: 'PUT', headers: authHeaders(), body })
    : await getJson<Poi>('api/pois', { method: 'POST', headers: authHeaders(), body })
  upsert(saved)
  state.draft = null
  state.selected = { kind: 'poi', id: saved.id }
  toast(d.id ? '已保存' : '已添加点位')
}

export async function movePoi(id: string, pos: LngLat) {
  const saved = await getJson<Poi>(`api/pois/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ pos }) })
  upsert(saved)
  if (state.draft?.id === id) state.draft.pos = saved.pos
  toast('位置已更新')
}

export async function deletePoi(id: string) {
  await getJson(`api/pois/${id}`, { method: 'DELETE', headers: authHeaders() })
  state.pois = state.pois.filter((p) => p.id !== id)
  if (state.selected?.id === id) state.selected = null
  state.draft = null
  toast('已删除')
}

function upsert(p: Poi) {
  const i = state.pois.findIndex((x) => x.id === p.id)
  if (i >= 0) state.pois.splice(i, 1, p)
  else state.pois.push(p)
}
