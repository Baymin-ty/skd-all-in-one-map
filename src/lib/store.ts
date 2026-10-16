import { reactive, toRaw } from 'vue'
import { findRoute, initRouting, type RouteResult, type Target } from './route'
import type { Building, Campus, I18nText, LngLat, PlaceCat, Poi, PoiCat } from './types'

export const POI_CATS: Record<PoiCat, { zh: string; icon: string; color: string }> = {
  life: { zh: '生活服务', icon: '🛎️', color: '#16a2a8' },
  dining: { zh: '餐饮', icon: '🍜', color: '#e07a1f' },
  sports: { zh: '运动', icon: '🏃', color: '#d64545' },
  parking: { zh: '停车', icon: '🅿️', color: '#4a4a4f' },
  transit: { zh: '交通', icon: '🚌', color: '#2f6fd6' },
}
export const PLACE_COLORS: Record<PlaceCat, string> = {
  academic: '#527da3', dining: '#bd8046', housing: '#64937a', sports: '#b86b67', service: '#528f92', gate: '#8c7ba5',
}
export const WALKWAY_COLOR = '#0e8fa8'

export type Selection = { kind: 'building'; id: string } | { kind: 'poi'; id: string }
/** 导航的一端：一栋楼、一个点位，或者地图上随手点的位置 */
export interface RouteEnd extends Target {
  name: string
}

export const state = reactive({
  ready: false,
  error: '',
  categories: {} as Record<PlaceCat, I18nText>,
  buildings: [] as Building[],
  pois: [] as Poi[],
  campus: null as Campus | null,
  /** 后端连不上时只读，用打包进来的静态点位 */
  readonly: false,
  selected: null as Selection | null,
  showRoads: false,
  /** 编辑点位：口令验证过才为 true */
  editing: false,
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
  /** 让地图飞过去：每次赋新对象 */
  flyTo: null as { pos: LngLat; poly?: LngLat[] } | null,
  toast: '',
})

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

export function select(sel: Selection | null, fly = true) {
  state.selected = sel
  if (!sel || !fly) return
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    if (b) state.flyTo = { pos: b.center, poly: b.poly }
  } else {
    const p = poiById(sel.id)
    if (p) state.flyTo = { pos: p.pos }
  }
}

// ---------- 搜索：名称、简称、别名里包含关键字就算 ----------
export type SearchHit = { sel: Selection; name: string; sub: string }
export function search(q: string): SearchHit[] {
  const k = q.trim().toLowerCase()
  if (!k) return []
  const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(k))
  const hits: SearchHit[] = []
  for (const b of state.buildings)
    if (has(b.name.zh, b.name.en, b.short.zh, b.short.en, ...b.aliases))
      hits.push({ sel: { kind: 'building', id: b.id }, name: b.name.zh, sub: b.walkway ? '风雨长廊' : state.categories[b.cat]?.zh ?? '' })
  for (const p of state.pois)
    if (has(p.name.zh, p.name.en, p.desc?.zh)) hits.push({ sel: { kind: 'poi', id: p.id }, name: p.name.zh, sub: POI_CATS[p.cat]?.zh ?? '' })
  return hits.slice(0, 20)
}

// ---------- 导航 ----------
export function endFor(sel: Selection): RouteEnd | null {
  if (sel.kind === 'building') {
    const b = buildingById(sel.id)
    return b ? { name: b.short.zh || b.name.zh, point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) } : null
  }
  const p = poiById(sel.id)
  return p ? { name: p.name.zh, point: p.pos } : null
}

export function setEnd(which: 'from' | 'to', end: RouteEnd | null) {
  state.route.open = true
  state.route[which] = end
  state.route.picking = null
  // 只选了终点时，接着让用户在地图上点起点
  if (which === 'to' && end && !state.route.from) state.route.picking = 'from'
  computeRoute()
}

export function computeRoute() {
  const r = state.route
  r.result = null
  r.failed = false
  if (!r.from || !r.to) return
  r.result = findRoute(r.from, r.to, r.rain)
  r.failed = !r.result
  if (r.result) {
    const pts = r.result.segments.flatMap((s) => s.path)
    state.flyTo = { pos: pts[0], poly: pts }
  }
}

export function closeRoute() {
  Object.assign(state.route, { open: false, from: null, to: null, picking: null, result: null, failed: false })
}

// ---------- 点位管理 ----------
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${state.password}` })

export async function login(password: string) {
  await getJson('api/auth', { method: 'POST', headers: { Authorization: `Bearer ${password}` } })
  state.password = password
  state.editing = true
  try {
    sessionStorage.setItem('map.pw', password)
  } catch {
    /* 隐私模式下存不了，刷新后重新输入即可 */
  }
}

export function logout() {
  Object.assign(state, { editing: false, password: '', draft: null, placing: false })
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

export function newDraft(pos: LngLat) {
  state.placing = false
  state.draft = { id: '', name: { zh: '', en: '' }, cat: 'life', pos, desc: { zh: '', en: '' }, hours: { zh: '', en: '' } }
}

export function editDraft(p: Poi) {
  // 复制一份再改：取消编辑时地图上的点位不受影响（structuredClone 不能直接克隆响应式代理）
  const raw = structuredClone(toRaw(p))
  state.draft = { ...raw, desc: raw.desc ?? { zh: '', en: '' }, hours: raw.hours ?? { zh: '', en: '' } }
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
  select({ kind: 'poi', id: saved.id }, false)
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
