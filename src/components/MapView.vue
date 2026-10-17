<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCampusMap } from '../lib/campusMap'
import { clampToOutline, fillZoom, fromLatLng, limitPan, PAINTED_OUTLINE, toLatLng } from '../lib/geo'
import type { BuildingGroup } from '../lib/groups'
import { ICONS } from '../lib/icons'
import { buildingOutline, constructionOutline } from '../lib/buildingOutline'
import { outlineLatLngs } from '../lib/outlineGeometry'
import { createMapOpacity } from '../lib/mapOpacity'
import {
  collapsedLabelGroups, labelFits, labelLevels, labelPresentation, labelSlots, labelsOverlap, poiPresentation, shiftRect,
  type LabelLevel, type LabelRect, type LabelSlot,
} from '../lib/mapLabels'
import { EVENT_PRIO, eventsByPlace, eventShortTitle, eventTier, eventWhen, type PlaceEvents } from '../lib/mapEvents'
import { landmark, majorGate, facilityBuilding } from '../lib/placeCuration'
import { visibleEntrances } from '../lib/mapEntrances'
import { createLabelInteraction } from '../lib/mapLabelInteraction'
import { createLabelHover } from '../lib/mapLabelHover'
import { buildingLabelCategory, labelShown, mapLabelColor, poiLabelCategory } from '../lib/mapLabelCategories'
import { discovery, eventsIn } from '../lib/discoveryData'
import { clockText, dateKey, dayName, dayStart, eventStatus, evStart, nowTick, STATUS_LABELS, timeRange } from '../lib/campusTime'
import type { CampusEvent } from '../lib/discoveryTypes'
import { walkablePaths } from '../lib/route'
import {
  buildingById, endFor, expandedGroups, fitToday, groupById, groupOf, mapApi, mapHighlights, mineFocus,
  addUndergroundSketchPoint, openEvent, undergroundEndFor, PLACE_COLORS, select, setEnd, showEventsAt, state, toast, type Selection,
} from '../lib/store'
import type { Building, LngLat } from '../lib/types'
import { covered, ui } from '../lib/ui'
import Ico from './Ico.vue'
import { parcel } from '../lib/parcelStation'
import MapLabelControls from './MapLabelControls.vue'
import CampusMapToggle from './CampusMapToggle.vue'
import { mountTodayLayer } from '../lib/todayLayer'
import { poiIcon } from '../lib/catalog'
import { mountLocateLayer } from '../lib/locateLayer'
import { mountTimeMachineLayer } from '../lib/timeMachineLayer'
import { tm } from '../lib/timeMachine'
import { crowdAt, crowdRevision, CROWD_LABELS } from '../lib/crowd'
import LocateButton from './LocateButton.vue'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const el = ref<HTMLDivElement>()
let map: L.Map
const zoom = ref(17)
const minZoom = ref(16)
const mapTools = ref<HTMLDivElement>()
let labelInteraction: ReturnType<typeof createLabelInteraction> | undefined
/** 放大到这一级，楼群自动展开显示各栋（标签放得下了） */
const EXPAND_ALL_ZOOM = 19

const buildingLayer = L.layerGroup()
const labelLayer = L.layerGroup()
const poiLayer = L.layerGroup()
const poiTargetLayer = L.layerGroup()
const hoverLabelLayer = L.layerGroup()
const routeLayer = L.layerGroup()
const entranceLayer = L.layerGroup()
const crowdLayer = L.layerGroup()
const undergroundLayer = L.layerGroup()
const undergroundSketchLayer = L.layerGroup()
/** 选中活动的标注卡片和脉冲圈；内容不变时不重建，免得每次刷新都重播动画 */
const eventFocusLayer = L.layerGroup()
let eventFocusKey = ''
let roadLayer: L.LayerGroup | null = null
const polys = new Map<string, L.Polygon>()
let opacityLayer: ReturnType<typeof createMapOpacity>
let hovered: Selection | null = null

function includesBuilding(selection: Selection | null, b: { id: string }) {
  return selection?.kind === 'building' && selection.id === b.id
    || selection?.kind === 'group' && groupOf(b.id)?.id === selection.id
    || selection?.kind === 'poi' && facilityBuilding(selection.id) === b.id
}
function updateOpacity() {
  const settings = state.mapSettings
  const selectable = mapHighlights.value.size ? settings.selectable * 0.45 : settings.selectable
  opacityLayer?.update((b) => includesBuilding(state.selected, b) || includesBuilding(hovered, b) ? settings.selected
    : mapHighlights.value.has(b.id) ? settings.selected
    : selectable, settings.background)
  // 地点文字始终清晰；透明度设置继续控制底图建筑。
  el.value?.classList.toggle('has-highlights', mapHighlights.value.size > 0)
}
const hoverState = createLabelHover<Selection>((selection) => {
  hovered = selection
  restyle()
  // 悬停只更新当前标签，不参与全局排布，也不改动其他标签的位置。
  updateHoverLabel()
}, () => !!labelInteraction?.canHover)
const hover = (selection: Selection | null) => hoverState.set(selection)

/** 建筑、透明命中区和标签之间交接时保留当前对象，跨过小间隙也不会闪烁。 */
function leaveHover(selection: Selection, event: L.LeafletMouseEvent) {
  const next = event.originalEvent?.relatedTarget
  if (next instanceof Element && next.closest('[data-place]')?.getAttribute('data-place') === `${selection.kind}:${selection.id}`) return
  hoverState.leave(selection)
}

// ---------- 楼的多边形：底图上楼已经画好了，平时透明只接点击；风雨长廊常亮 ----------
const batchStyle = (): L.PathOptions => ({
  ...buildingOutline(true, false, state.mapSettings),
  weight: 3, fillColor: '#a8242b', fillOpacity: 0.1 * state.mapSettings.selected,
})
/** 展开的楼群：虚线圈出同组的楼 */
const memberStyle = (c: string): L.PathOptions => ({ stroke: true, color: c, weight: 1.5, opacity: 0.5, dashArray: '4 3', fillOpacity: 0 })


function styleFor(b: Building): L.PathOptions {
  const selected = includesBuilding(state.selected, b)
  const isHovered = includesBuilding(hovered, b)
  const matching = mapHighlights.value.has(b.id)
  if (selected) return { ...buildingOutline(true, isHovered, state.mapSettings), weight: 3.5, fillColor: '#a8242b', fillOpacity: 0.16 * state.mapSettings.selected }
  if (matching) return { ...batchStyle(), weight: isHovered ? 4 : 3 }
  if (isHovered) return buildingOutline(false, true, state.mapSettings)
  const g = groupOf(b.id)
  if (g && expandedGroups().has(g.id) && state.selected) return memberStyle(PLACE_COLORS[b.cat])
  return buildingOutline(false, false, state.mapSettings)
}
const restyle = () => {
  state.buildings.forEach((b) => polys.get(b.id)?.setStyle(styleFor(b)))
  for (const id of mapHighlights.value) polys.get(id)?.bringToFront()
  for (const b of state.buildings) if (includesBuilding(state.selected, b) || includesBuilding(hovered, b)) polys.get(b.id)?.bringToFront()
  updateOpacity()
}

/** 楼、楼群、点位被点到：在选导航端点就设端点，否则打开详情 */
function pick(sel: Selection) {
  // 时光机全屏时侧栏收起，点楼不打开详情
  if (tm.open) return
  const which = state.route.picking
  if (which && state.route.network === 'underground') {
    toast('请先在地下手绘窗口点击“开始手绘”')
    return
  }
  if (which && sel.kind !== 'group') {
    const end = endFor(sel)
    if (end) setEnd(which, end)
  } else select(sel, sel.kind === 'group')
}

function sketchPoint(event: L.LeafletMouseEvent) {
  if (state.route.network !== 'underground' || !state.undergroundSketch.active) return false
  addUndergroundSketchPoint(fromLatLng(event.latlng))
  return true
}

function drawBuildings() {
  buildingLayer.clearLayers()
  polys.clear()
  for (const b of state.buildings) {
    const p = L.polygon(outlineLatLngs(b), { ...styleFor(b), smoothFactor: 0, className: 'building-outline', bubblingMouseEvents: false })
    p.on('click', (event) => { if (!sketchPoint(event)) pick({ kind: 'building', id: b.id }) })
    p.on('mouseover', () => hover({ kind: 'building', id: b.id }))
    p.on('mouseout', (event) => leaveHover({ kind: 'building', id: b.id }, event))
    p.on('add', () => p.getElement()?.setAttribute('data-place', `building:${b.id}`))
    p.addTo(buildingLayer)
    polys.set(b.id, p)
  }
}

// ---------- 标签：优先级高的先占位置，放不下先挪位置、再精简内容，最后才藏起来（declutter） ----------
/** 校门在校园边缘、几乎不挡别人，排最前；地标（食堂、图书馆等）排在楼群前面：楼群标签有备选位置可挪，地标没有 */
function prioOf(b: Building, inGroup: boolean, focused: boolean) {
  if (state.selected?.kind === 'building' && state.selected.id === b.id) return 140
  if (focused) return 100 // 点开的楼群：各栋名字优先
  if (mapHighlights.value.has(b.id)) return 98 // 批量选中的建筑名称优先
  if (b.cat === 'gate') return 92
  if (landmark(b.id)) return 90
  if (b.cat === 'dining') return 78
  if (b.cat === 'service') return 70
  if (inGroup) return 60
  return b.cat === 'housing' ? 45 : 50
}
const GROUP_PRIO = 84
/** 重要地点放不下名称时先缩成图标，仍能看出这里有什么 */
const ICON_FALLBACK_PRIO = 70

const labelMarkers = new Map<string, L.Marker>()
const poiMarkers = new Map<string, L.Marker>()
const hoverMarkers = new Map<string, L.Marker>()
const markerHtml = new WeakMap<HTMLElement, string>()

interface MarkerSpec {
  html: string
  cls: string
  /** null：不参与避让（悬停标签） */
  prio: number | null
  color: string
  zIndexOffset?: number
  /** 楼群标签：避让时改用 groupMarkers 里的备选位置 */
  group?: string
  title?: string
  pane?: string
  /** 放不下时依次尝试的显示层级，见 labelLevels */
  levels?: string
  /** 允许在地点附近微移避让 */
  shift?: boolean
}

/** 点到某一场活动直接打开它；点「还有几场」或收起后的活动行，一场直接打开、多场先列出这里的活动；点名称照常打开地点 */
function pickLabel(selection: Selection, event: L.LeafletMouseEvent) {
  const target = event.originalEvent?.target
  const row = target instanceof Element ? target.closest<HTMLElement>('[data-ev]') : null
  if (row?.dataset.ev && !state.route.picking && !tm.open && row.closest('.lv-list')) { openEvent(row.dataset.ev); return }
  const events = selection.kind !== 'group' && target instanceof Element && target.closest('.evs') ? mapEvents.get(selection.id) : undefined
  if (events && !state.route.picking && !tm.open) openPlaceEvents(selection.id, events)
  else pick(selection)
}

/** 复用标签节点，选择变化时只改样式，让透明度能从当前值平滑过渡。 */
function syncMarker(cache: Map<string, L.Marker>, layer: L.LayerGroup, selection: Selection, pos: LngLat, spec: MarkerSpec) {
  const { html, cls, prio, color, zIndexOffset = 0, group = '', title = '', pane = 'markerPane', levels = '', shift = false } = spec
  const key = `${selection.kind}:${selection.id}`
  let marker = cache.get(key)
  let node = marker?.getElement()?.firstElementChild as HTMLElement | undefined
  if (!marker) {
    node = document.createElement('div')
    marker = L.marker(toLatLng(pos), {
      icon: L.divIcon({ className: '', html: node, iconSize: [0, 0] }), keyboard: false, title, pane, bubblingMouseEvents: false,
  }).on('click', (event) => { if (!sketchPoint(event)) pickLabel(selection, event) })
      .on('mouseover', () => hover(selection))
      .on('mouseout', (event) => leaveHover(selection, event))
      .addTo(layer)
    cache.set(key, marker)
  }
  if (node) {
    node.className = cls
    node.dataset.place = key
    if (prio === null) delete node.dataset.prio
    else node.dataset.prio = String(prio)
    node.title = title
    if (group) node.dataset.group = group
    if (levels) node.dataset.levels = levels
    else delete node.dataset.levels
    if (shift) node.dataset.shift = '1'
    else delete node.dataset.shift
    node.style.setProperty('--c', color)
    if (markerHtml.get(node) !== html) { node.innerHTML = html; markerHtml.set(node, html) }
  }
  marker.setLatLng(toLatLng(pos)).setZIndexOffset(zIndexOffset)
  return marker
}

function removeStaleMarkers(cache: Map<string, L.Marker>, layer: L.LayerGroup, visible: Set<string>) {
  for (const [key, marker] of cache) if (!visible.has(key)) {
    layer.removeLayer(marker)
    cache.delete(key)
  }
}
/** 楼群标签和它的备选位置：先放各栋中心的平均点，挡住了就挪到离平均点最近的那栋，依次往后试 */
const groupMarkers = new Map<string, { marker: L.Marker; spots: LngLat[] }>()
const groupPositions = new Map<string, LngLat>()

/** 避让后没有完整显示的状态；悬停时临时补一个完整标签 */
const REDUCED = ['clash', 'lv-brief', 'lv-icon', 'icon-only']
/** 排布和交互临时加的 class，复制成悬停标签时去掉 */
const LAYOUT_CLASSES = [...REDUCED, 'hover-suppressed', 'is-hovered', 'near-pointer', 'hover-label']

/** 悬停标签独立于基础标签；临时露出的子标签只遮去自己的父标签。 */
function updateHoverLabel() {
  const key = hovered && `${hovered.kind}:${hovered.id}`
  for (const [id, marker] of [...labelMarkers, ...poiMarkers]) {
    const node = marker.getElement()?.firstElementChild
    node?.classList.toggle('is-hovered', id === key)
    node?.classList.remove('hover-suppressed')
  }
  const visible = new Set<string>()
  if (hovered && key) {
    const base = (hovered.kind === 'poi' ? poiMarkers : labelMarkers).get(key)
    const node = base?.getElement()?.firstElementChild as HTMLElement | undefined
    if (hovered.kind === 'building') {
      const g = groupOf(hovered.id)
      if (g) labelMarkers.get(`group:${g.id}`)?.getElement()?.firstElementChild?.classList.add('hover-suppressed')
    }
    // 已完整显示的标签只变颜色；被避让、精简或按分类隐藏的标签临时完整展示。
    // 活动雷达里没能逐条列出活动的标签也算精简过
    const listable = state.panel === 'events' && !!node?.querySelector('.evs')
    if (!node || REDUCED.some((c) => node.classList.contains(c)) || listable && !node.classList.contains('lv-list')) {
      const b = hovered.kind === 'building' ? buildingById(hovered.id) : undefined
      const p = hovered.kind === 'poi' ? state.pois.find((p) => p.id === hovered!.id) : undefined
      const g = hovered.kind === 'group' ? groupById(hovered.id) : undefined
      const pos = b ? b.center : p ? p.pos : g ? g.center : undefined
      if (pos) {
        const category = b ? buildingLabelCategory(b) : p ? poiLabelCategory(p) : g!.cat
        const icon = b ? b.cat : p ? poiIcon(p) : g!.cat
        const name = b ? b.short.zh : p ? p.name.zh : g!.name.zh
        const html = node?.innerHTML || (p ? `<i>${ICONS[icon]}</i><span>${escapeHtml(name)}</span>`
          : `${ICONS[icon]}<span>${escapeHtml(name)}</span>${g ? `<em>${g.members.length} 栋</em>` : ''}`)
        // 复用基础标签已排好的锚点和微移，避免图标展开时跳回原始中心。
        const anchor: LngLat = base ? [base.getLatLng().lng, base.getLatLng().lat] : pos
        const kept = node ? [...node.classList].filter((c) => !LAYOUT_CLASSES.includes(c)).join(' ') : `${p ? 'pmark' : 'blabel'}${g ? ' group' : ''}`
        const hoverMarker = syncMarker(hoverMarkers, hoverLabelLayer, hovered, anchor, {
          html, cls: `${kept}${listable ? ' lv-list' : ''} hover-label is-hovered`, prio: null, color: mapLabelColor(category), title: name, pane: 'label-hover-pane',
        })
        const hoverNode = hoverMarker.getElement()?.firstElementChild as HTMLElement | undefined
        const placed = node && !node.classList.contains('clash') ? node : undefined
        for (const v of ['--dx', '--dy']) hoverNode?.style.setProperty(v, placed?.style.getPropertyValue(v) || '0px')
        node?.classList.add('hover-suppressed')
        visible.add(key)
      }
    }
  }
  removeStaleMarkers(hoverMarkers, hoverLabelLayer, visible)
  labelInteraction?.refresh()
}

function drawLabels() {
  const visible = new Set<string>()
  const shownChildren = new Set<string>()
  groupMarkers.clear()
  const expanded = expandedGroups()
  const all = map.getZoom() >= EXPAND_ALL_ZOOM
  const s = state.selected
  const focusGroup = s?.kind === 'group' ? s.id : s?.kind === 'building' ? groupOf(s.id)?.id : undefined
  for (const b of state.buildings) {
    const category = buildingLabelCategory(b)
    const g = groupOf(b.id)
    const sel = s?.kind === 'building' && s.id === b.id
    const groupSelected = s?.kind === 'group' && g?.id === s.id
    const matching = mapHighlights.value.has(b.id)
    const ev = mapEvents.get(b.id)
    // 选中、批量筛选和活动都是用户正在看的内容，不受分类开关影响，免得筛选和开关互相打架。
    if (!labelShown(state.labelVisibility, category) && !sel && !groupSelected && !matching && !ev) continue
    const focused = !!g && g.id === focusGroup
    const routeEnd = state.route.open && [state.route.from, state.route.to].some((end) => end?.place?.kind === 'building' && end.place.id === b.id)
    if (b.cat === 'gate' && !majorGate(b.id) && map.getZoom() < 19 && !sel && !matching && !routeEnd && !ev) continue
    // 楼群收起时，有活动的楼也单独显示，但不顶掉楼群标签
    const viaGroup = !!g && !all && !expanded.has(g.id) && !sel && !matching
    if (viaGroup && !ev) continue
    if (labelPresentation({ kind: 'building', zoom: map.getZoom(), detailed: false,
      emphasized: sel || matching || focused || routeEnd || !!ev, overview: true }) === 'hidden') continue
    const cls = ['blabel', sel && 'sel', focused && 'focused', matching && 'matching', g && 'member', ev && `has-ev ev-${ev.tier}`].filter(Boolean).join(' ')
    const icon = ICONS[b.cat]
    const prio = ev && !sel ? Math.max(prioOf(b, !!g, focused), EVENT_PRIO[ev.tier]) : prioOf(b, !!g, focused)
    visible.add(`building:${b.id}`)
    if (!viaGroup) shownChildren.add(b.id)
    syncMarker(labelMarkers, labelLayer, { kind: 'building', id: b.id }, b.center, {
      html: `${icon}<span>${escapeHtml(b.short.zh)}</span>${sel && state.room?.building === b.id ? `<em class="room-code">${escapeHtml(state.room.code)}</em>` : ''}${ev ? eventLine(ev) : ''}`,
      cls, prio, color: mapLabelColor(category), zIndexOffset: sel ? 1500 : ev ? 1000 + EVENT_PRIO[ev.tier] : matching ? 900 : 0,
      title: ev ? eventTitle(b.name.zh, ev) : b.name.zh, levels: labelLevelsFor(prio, ev), shift: !sel,
    })
  }
  if (!all) for (const g of collapsedLabelGroups(state.groups, expanded, shownChildren)) if (state.labelVisibility[g.cat]) {
    visible.add(`group:${g.id}`)
    drawGroupLabel(g)
  }
  removeStaleMarkers(labelMarkers, labelLayer, visible)
  declutter()
}

function drawGroupLabel(g: BuildingGroup) {
  const matching = g.members.every((id) => mapHighlights.value.has(id))
  const marker = syncMarker(labelMarkers, labelLayer, { kind: 'group', id: g.id }, groupPositions.get(g.id) || g.center, {
    html: `${ICONS[g.cat]}<span>${escapeHtml(g.name.zh)}</span><em>${g.members.length} 栋</em>`,
    cls: `blabel group${matching ? ' matching' : ''}`, prio: matching ? 98 : GROUP_PRIO, color: PLACE_COLORS[g.cat],
    zIndexOffset: matching ? 900 : 0, group: g.id, title: `${g.name.zh}（${g.members.length} 栋），点击展开`, shift: true,
  })
  const centers = g.members.map((id) => buildingById(id)!.center)
  const d = (p: LngLat) => (p[0] - g.center[0]) ** 2 + (p[1] - g.center[1]) ** 2
  groupMarkers.set(g.id, { marker, spots: [g.center, ...centers.sort((a, b) => d(a) - d(b))] })
}

function drawPois() {
  const visible = new Set<string>()
  for (const p of state.pois) {
    const category = poiLabelCategory(p)
    const sel = state.selected?.kind === 'poi' && state.selected.id === p.id
    const matching = mapHighlights.value.has(p.id)
    const ev = mapEvents.get(p.id)
    if (!labelShown(state.labelVisibility, category) && !sel && !matching && !ev) continue
    const routeEnd = state.route.open && [state.route.from, state.route.to].some((end) => end?.place?.kind === 'poi' && end.place.id === p.id)
    // 交通分类由用户明确打开后显示；其余设施沿用缩放分层与入口规则。
    const presentation = category === 'transport'
      ? map.getZoom() >= 19 || sel || matching || routeEnd ? 'full' : 'icon'
      : poiPresentation(p, { zoom: map.getZoom(), detailed: false, emphasized: sel || matching || routeEnd || !!ev })
    if (presentation === 'hidden') continue
    const cls = ['pmark', presentation === 'icon' && 'icon-only', sel && 'sel', matching && 'matching', ev && `has-ev ev-${ev.tier}`].filter(Boolean).join(' ')
    const prio = sel ? 140 : ev ? EVENT_PRIO[ev.tier] : matching ? 97 : 30
    visible.add(`poi:${p.id}`)
    syncMarker(poiMarkers, poiLayer, { kind: 'poi', id: p.id }, p.pos, {
      html: `<i>${ICONS[poiIcon(p)]}</i><span>${escapeHtml(p.name.zh)}</span>${ev ? eventLine(ev) : ''}`, cls, prio,
      color: mapLabelColor(category), zIndexOffset: sel ? 1500 : ev ? 1000 + EVENT_PRIO[ev.tier] : matching ? 950 : 600,
      title: ev ? eventTitle(p.name.zh, ev) : p.name.zh, levels: presentation === 'icon' ? 'icon' : labelLevelsFor(Math.max(prio, ICON_FALLBACK_PRIO), ev), shift: !sel,
    })
  }
  removeStaleMarkers(poiMarkers, poiLayer, visible)
  declutter()
}

/** 活动雷达里每个地点最多逐条列出几场 */
const LIST_ROWS = 3
/**
 * 有活动的地点：名称下面挂一块活动区，地点和活动是同一个标签，不再互相挤掉。
 * 平时只露第一行「时间 + 短标题 + 还有几场」；活动雷达里（lv-list）逐条列出，标题最多两行。
 */
function eventLine({ events }: PlaceEvents) {
  const rows = events.slice(0, LIST_ROWS).map((e, i) => {
    const tier = eventTier(e)
    return `<span class="ev ev-${tier}${i ? ' ev-extra' : ''}" data-ev="${escapeHtml(e.id)}"><b>${escapeHtml(eventWhen(e, tier))}</b>`
      + `<span class="ev-t" data-short="${escapeHtml(eventShortTitle(e.title))}"><span>${escapeHtml(e.title)}</span></span>`
      + `${!i && events.length > 1 ? `<em>+${events.length - 1}</em>` : ''}</span>`
  }).join('')
  const more = events.length > LIST_ROWS ? `<span class="ev-more">还有 ${events.length - LIST_ROWS} 场 ›</span>` : ''
  return `<span class="evs">${rows}${more}</span>`
}
const eventTitle = (place: string, { lead, events }: PlaceEvents) =>
  `${place} · ${events.length > 1 ? `${events.length} 场活动，最近一场：` : ''}${lead.title}`

/**
 * 放不下时的退路。有活动：两行 → 一行（名称 + 时间）→ 图标；缩小到 16 级以下、或是长期展览和更晚的活动，从一行起步。
 * 普通地点：重要的缩成图标，其余直接让位。
 */
function labelLevelsFor(prio: number, ev?: PlaceEvents) {
  // 活动雷达里活动就是主角：先试逐条列出，放不下再一级级收
  if (ev && state.panel === 'events') return map.getZoom() <= 16 ? 'list brief icon' : 'list full brief icon'
  if (ev) return map.getZoom() <= 16 || (ev.tier === 'ongoing' || ev.tier === 'later') && map.getZoom() < 18 ? 'brief icon' : 'full brief icon'
  return prio >= ICON_FALLBACK_PRIO ? 'full icon' : 'full'
}

/** 点位隐藏名称后保留小范围命中区，仍可悬停或点击探索。 */
function drawPoiTargets() {
  poiTargetLayer.clearLayers()
  for (const p of state.pois) {
    const selection: Selection = { kind: 'poi', id: p.id }
    L.circleMarker(toLatLng(p.pos), {
      radius: 10, stroke: false, fillOpacity: 0, pane: 'poi-hit-pane', className: 'poi-hit-target', bubblingMouseEvents: false,
    }).on('mouseover', () => hover(selection)).on('mouseout', (event) => leaveHover(selection, event)).on('click', (event) => {
      if (!sketchPoint(event)) pick(selection)
    })
      .on('add', (e) => e.target.getElement()?.setAttribute('data-place', `poi:${p.id}`))
      .addTo(poiTargetLayer)
  }
}

let declutterFrame = 0
const CENTER: LabelSlot = { slot: 'c', dx: 0, dy: 0 }
function declutter() {
  cancelAnimationFrame(declutterFrame)
  declutterFrame = requestAnimationFrame(() => {
    if (!el.value) return
    el.value.classList.add('label-layout')
    const nodes = [...el.value.querySelectorAll<HTMLElement>('[data-prio]')]
    for (const n of nodes) n.classList.remove('clash', 'lv-list', 'lv-brief', 'lv-icon')
    // 同级按地点排序，结果不随图层插入顺序变化
    nodes.sort((a, b) => Number(b.dataset.prio) - Number(a.dataset.prio) || (a.dataset.place ?? '').localeCompare(b.dataset.place ?? ''))
    const bounds = el.value.getBoundingClientRect()
    const cov = covered()
    const viewport: LabelRect = { left: bounds.left + cov.l + 8, right: bounds.right - cov.r - 8,
      top: bounds.top + cov.t + 8, bottom: bounds.bottom - (ui.desktop || ui.overlay ? cov.b : ui.sheet) - 8 }
    // 右侧按钮和桌面浮在地图上的分类条都不让标签压上去
    const placed: LabelRect[] = [mapTools.value, document.querySelector<HTMLElement>('.map-chips-float')]
      .filter((node): node is HTMLElement => !!node && node.offsetParent !== null)
      .map((node) => node.getBoundingClientRect())
    const gapX = map.getZoom() <= 17 ? 16 : 10
    const gapY = 8
    // 文字之间要留读得开的间距；只剩图标时贴近一些也不会看错
    const hits = (r: LabelRect, level: LabelLevel = 'full') => !labelFits(r, viewport)
      || placed.some((q) => level === 'icon' ? labelsOverlap(r, q, 6, 4) : labelsOverlap(r, q, gapX, gapY))
    const setLevel = (n: HTMLElement, level: LabelLevel) => {
      n.classList.toggle('lv-list', level === 'list')
      n.classList.toggle('lv-brief', level === 'brief')
      n.classList.toggle('lv-icon', level === 'icon')
    }
    const setSlot = (n: HTMLElement, s: LabelSlot) => {
      n.dataset.slot = s.slot
      n.style.setProperty('--dx', `${s.dx}px`)
      n.style.setProperty('--dy', `${s.dy}px`)
    }
    for (const n of nodes) {
      if (n.offsetParent === null) continue // 被缩放级别的样式藏掉了
      // 选中、活动标注等必须出现的标签固定在原位、完整显示，其他标签给它们让路
      const pinned = Number(n.dataset.prio) >= 130
      const levels = labelLevels(n.dataset.levels)
      const gm = n.dataset.group ? groupMarkers.get(n.dataset.group) : undefined
      if (!n.getBoundingClientRect().width) continue
      // 楼群：先试上次的位置，再从各栋中心的平均点起依次试离它最近的楼
      const here = gm?.marker.getLatLng()
      const spots: (L.LatLng | undefined)[] = gm ? [here, ...gm.spots.map(toLatLng)] : [undefined]
      let done = false
      for (const level of pinned ? levels.slice(0, 1) : levels) {
        setLevel(n, level)
        for (const spot of spots) {
          if (spot) gm!.marker.setLatLng(spot)
          const r = n.getBoundingClientRect()
          // 先在地点附近挪位置，挪不开再换备选位置、精简内容
          const slot = (n.dataset.shift ? labelSlots(r.width, r.height, n.dataset.slot) : [CENTER])
            .find((s) => !hits(shiftRect(r, s.dx, s.dy), level))
          if (!slot) continue
          setSlot(n, slot)
          placed.push(shiftRect(r, slot.dx, slot.dy))
          if (gm) groupPositions.set(n.dataset.group!, [gm.marker.getLatLng().lng, gm.marker.getLatLng().lat])
          done = true
          break
        }
        if (done) break
      }
      if (gm && !done) gm.marker.setLatLng(toLatLng(gm.spots[0]))
      if (done) continue
      // 藏起来的标签回到完整内容和正中，悬停时按原样补出；上次的位置保留，重新出现时优先用
      setLevel(n, levels[0])
      n.style.setProperty('--dx', '0px')
      n.style.setProperty('--dy', '0px')
      if (pinned) placed.push(n.getBoundingClientRect())
      else n.classList.add('clash')
    }
    el.value.classList.remove('label-layout')
    updateHoverLabel()
  })
}

function drawEntrances() {
  entranceLayer.clearLayers()
  if (map.getZoom() < 18) return
  const explicit = state.selected?.kind === 'building' && state.selected.id === state.entranceBuilding ? state.entranceBuilding : ''
  const routeEnds: { buildingId: string; point: LngLat }[] = []
  const segments = state.route.open ? state.route.result?.segments : undefined
  if (segments?.length) for (const [end, point] of [
    [state.route.from, segments[0].path[0]], [state.route.to, segments.at(-1)!.path.at(-1)!],
  ] as const) if (end?.place?.kind === 'building') routeEnds.push({ buildingId: end.place.id, point })
  for (const { building, entrance: e } of visibleEntrances(state.buildings, explicit, routeEnds))
    L.marker(toLatLng(e.pos), {
      icon: L.divIcon({ className: '', html: `<div class="emark" data-prio="120">${ICONS.entrance}<span>${escapeHtml(e.zh || building.short.zh + '入口')}</span></div>`, iconSize: [0, 0] }),
      zIndexOffset: 950,
      interactive: false,
    }).addTo(entranceLayer)
  declutter()
}

/** 地图上要显示的活动，按地点合并。不另画地图钉：活动挂在举办地点的名称标签上，由 drawLabels / drawPois 画出。 */
let mapEvents = new Map<string, PlaceEvents>()
function drawEvents() {
  if (!map) return
  // 地图就是地图：活动只在「活动」页挂到地点上，时光机有自己的活动图层
  const hidden = tm.open || state.route.open || state.panel !== 'events'
  const list = hidden ? [] : eventsIn(state.radar.range, state.radar.cat, state.radar.place)
  const selected = discovery.events.find((e) => e.id === state.eventId)
  const active = !hidden && selected?.place ? selected : undefined
  const byPlace = eventsByPlace(list)
  // 选中活动所在地点改由标注卡片表示，名称标签不再重复挂活动
  const others = active ? byPlace.get(active.place!)?.events.filter((e) => e.id !== active.id).length ?? 0 : 0
  if (active) byPlace.delete(active.place!)
  mapEvents = byPlace
  drawEventFocus(active, others)
  drawLabels()
  drawPois()
}

/** 一场直接打开；多场先打开该地点的活动列表，时间范围覆盖明天以后的活动 */
function openPlaceEvents(id: string, { lead, events }: PlaceEvents) {
  if (events.length === 1) { openEvent(lead.id); return }
  if (state.panel !== 'events') {
    state.radar.range = events.some((e) => evStart(e) >= dayStart(nowTick.value) + 86_400_000) ? 'week' : 'today'
    state.radar.cat = 'all'
  }
  showEventsAt(id)
}

/** 选中的活动：在地点名称上方弹出标注卡片（状态、标题、时间、房间），尖角指向名称，地点处有脉冲圈。 */
function drawEventFocus(event: CampusEvent | undefined, others: number) {
  const b = event && buildingById(event.place!)
  const p = event && state.pois.find((p) => p.id === event.place)
  const point = b?.center || p?.pos
  const status = event && eventStatus(event)
  const key = event && point ? `${event.id}|${status}|${others}` : ''
  if (key === eventFocusKey) return
  const replacing = !!eventFocusKey && eventFocusKey.split('|')[0] === event?.id
  eventFocusKey = key
  eventFocusLayer.clearLayers()
  if (!event || !point || !status) return
  const day = dateKey(evStart(event))
  const pill = status === 'live' || status === 'soon' || status === 'past' ? STATUS_LABELS[status]
    : `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日 ${dayName(day)}`
  const where = [b?.name.zh || p?.name.zh, event.room].filter(Boolean).join(' · ')
  const html = `<button type="button" aria-label="${escapeHtml(event.title)}" class="event-focus${replacing ? '' : ' enter'}" data-prio="150"><div class="event-callout">
    <span class="ec-head"><span class="ec-status ${status}">${escapeHtml(pill)}</span><b>${escapeHtml(timeRange(event))}</b></span>
    <b class="ec-title">${escapeHtml(event.title)}</b>
    <span class="ec-place">${ICONS.pin}<span>${escapeHtml(where)}</span>${others ? `<em>另有 ${others} 场</em>` : ''}</span>
  </div></button>`
  L.marker(toLatLng(point), {
    icon: L.divIcon({ className: '', html: '<div class="event-pulse"></div>', iconSize: [0, 0] }),
    pane: 'event-label-pane', interactive: false, keyboard: false, zIndexOffset: -1000,
  }).addTo(eventFocusLayer)
  L.marker(toLatLng(point), {
    icon: L.divIcon({ className: '', html, iconSize: [0, 0] }),
    title: event.title, alt: event.title, pane: 'event-label-pane', keyboard: false, zIndexOffset: 1600, bubblingMouseEvents: false,
  }).on('click', () => openEvent(event.id)).addTo(eventFocusLayer)
}

function drawRoute() {
  routeLayer.clearLayers()
  const underground = state.route.undergroundResult
  if (underground) {
    const path = underground.path.map(toLatLng)
    const casing: L.PolylineOptions = { color: '#fff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }
    L.polyline(path, casing).addTo(routeLayer)
    L.polyline(path, { color: '#8156a8', weight: 5.5, dashArray: '10 7', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer)
    L.circleMarker(path[0], { radius: 7, color: '#8156a8', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(routeLayer)
    L.marker(path.at(-1)!, { icon: L.divIcon({ className: '', html: `<div class="rend underground-rend">${ICONS.pin}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 1300 }).addTo(routeLayer)
    return
  }
  const r = state.route.result
  if (!r) return
  const casing: L.PolylineOptions = { color: '#fff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }
  for (const s of r.segments) L.polyline(s.path.map(toLatLng), casing).addTo(routeLayer)
  for (const s of r.segments) {
    const color = s.layer === 'underground' ? '#8156a8' : '#2f6fd6'
    L.polyline(s.path.map(toLatLng), { color, weight: 5.5, dashArray: s.layer === 'underground' ? '10 7' : undefined, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer)
  }
  const first = r.segments[0].path[0]
  const last = r.segments.at(-1)!.path.at(-1)!
  L.circleMarker(toLatLng(first), { radius: 7, color: '#2f6fd6', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(routeLayer)
  L.marker(toLatLng(last), { icon: L.divIcon({ className: '', html: `<div class="rend">${ICONS.pin}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 1300 }).addTo(routeLayer)
  for (const boundary of r.transitions) {
    const entering = boundary.kind === 'enter'
    L.circleMarker(toLatLng(boundary.pos), { radius: 7, color: '#e89a31', weight: 3, fillColor: entering ? '#fff7e8' : '#e89a31', fillOpacity: 1, interactive: false, bubblingMouseEvents: false }).addTo(routeLayer)
    L.marker(toLatLng(boundary.pos), {
      icon: L.divIcon({ className: '', html: `<span class="route-transition ${entering ? 'enter' : 'exit'}">${entering ? '↓' : '↑'}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      title: boundary.label, interactive: false, zIndexOffset: 1250,
    }).addTo(routeLayer)
  }
}

function drawCrowd() {
  crowdLayer.clearLayers()
  if (tm.open || state.route.open || (state.panel !== 'dining' && state.panel !== 'canteen')) return
  const hm = clockText(nowTick.value)
  if (!((hm >= '11:00' && hm < '13:30') || (hm >= '16:30' && hm < '19:00'))) return
  const styles = [
    { color: '#2a9d62', radius: 32, opacity: 0.14 },
    { color: '#d28b29', radius: 45, opacity: 0.18 },
    { color: '#c64e4e', radius: 58, opacity: 0.22 },
  ] as const
  for (const canteen of discovery.canteens) {
    const crowd = crowdAt(canteen.id, nowTick.value)
    const style = styles[crowd.level]
    L.circle(toLatLng(canteen.pos), { radius: style.radius, color: style.color, weight: 1.5, fillColor: style.color, fillOpacity: style.opacity, bubblingMouseEvents: false })
      .bindTooltip(`${canteen.zh} · ${CROWD_LABELS[crowd.level]} · 约 ${crowd.waitMin} 分钟${crowd.source === 'live' ? ' · 实时反馈' : ' · 估算'}`)
      .addTo(crowdLayer)
  }
}

/** 统一蓝色展示地面栅格的实际八邻接连接，不区分来源和遮挡属性。 */
function toggleRoads(on: boolean) {
  roadLayer?.remove()
  roadLayer = null
  if (!on) return
  if (!roadLayer) {
    const renderer = L.canvas({ padding: 0.3 })
    roadLayer = L.layerGroup()
    for (const path of walkablePaths())
      L.polyline(path.map(toLatLng), {
        renderer, color: '#4f8bff', weight: 1.8, opacity: 0.85, interactive: false,
        smoothFactor: 0,
      }).addTo(roadLayer)
  }
  roadLayer.addTo(map)
}

function drawUnderground() {
  undergroundLayer.clearLayers()
  if (!map || !state.underground || (state.route.network !== 'underground' && !state.showUnderground)) { undergroundLayer.remove(); return }
  const nodes = new Map(state.underground.nodes.map((n) => [n.id, n.pos]))
  for (const edge of state.underground.edges) {
    const a = nodes.get(edge.a), b = nodes.get(edge.b)
    if (!a || !b) continue
    L.polyline([a, b].map(toLatLng), { color: '#6f2dbd', weight: 4.5, opacity: 0.8, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(undergroundLayer)
  }
  for (const connector of state.underground.connectors) {
    const label = connector.kind === 'ramp' ? '车' : connector.kind === 'stairs' ? '楼' : connector.kind === 'elevator' ? '梯' : '连'
    const color = connector.kind === 'ramp' ? '#3559a8' : connector.kind === 'stairs' ? '#b65b22' : connector.kind === 'elevator' ? '#168266' : '#73549b'
    L.marker(toLatLng(connector.pos), { icon: L.divIcon({ className: '', html: `<span class="underground-connector" style="--connector-color:${color}">${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: `${connector.kind === 'ramp' ? '车辆出入口' : connector.kind === 'stairs' ? '楼梯' : connector.kind === 'elevator' ? '电梯' : '连接点'} · B1`, bubblingMouseEvents: false })
      .on('click', () => { const end = undergroundEndFor(connector.id); if (!end) return; setEnd(state.route.picking ?? (state.route.from ? 'to' : 'from'), end) }).addTo(undergroundLayer)
  }
  undergroundLayer.addTo(map)
}

function drawUndergroundSketch() {
  undergroundSketchLayer.clearLayers()
  if (!map) return
  const paths = state.undergroundSketch.current.length > 1 ? [state.undergroundSketch.current] : []
  for (const path of paths) {
    L.polyline(path.map(toLatLng), {
      color: '#a24bc4', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false,
      dashArray: state.undergroundSketch.current === path ? '8 6' : undefined,
    }).addTo(undergroundSketchLayer)
  }
  for (const path of paths) {
    for (const point of path) L.circleMarker(toLatLng(point), { radius: 3.5, color: '#fff', weight: 1.5, fillColor: '#a24bc4', fillOpacity: 1, interactive: false }).addTo(undergroundSketchLayer)
  }
  if (state.route.network === 'underground') undergroundSketchLayer.addTo(map)
  else undergroundSketchLayer.remove()
}

function drawConstruction(layer: L.LayerGroup) {
  for (const c of state.campus?.construction ?? [])
    L.polygon(outlineLatLngs(c), constructionOutline)
      .bindTooltip(`🚧 ${escapeHtml(c.name.zh)}`, { sticky: true })
      .addTo(layer)
}

// ---------- 相机：避开侧栏 / 顶栏 / 底部面板，范围限制在手绘图里（同 skdmap） ----------
function uiPadding(): { tl: L.PointTuple; br: L.PointTuple } {
  if (ui.overlay) return { tl: [ui.overlay.l + 40, ui.overlay.t + 40], br: [ui.overlay.r + 40, ui.overlay.b + 24] }
  if (ui.desktop) return { tl: [ui.sideW + 48, 48], br: [48, 48] }
  return { tl: [20, ui.topH + 16], br: [20, Math.min(ui.sheet, ui.anchors[1]) + 20] }
}
/** 可见区域中心相对地图中心的偏移 */
function visibleOffset(): L.Point {
  const size = map.getSize()
  const cov = covered()
  return L.point((cov.l - cov.r) / 2, cov.t + (size.y - cov.t - cov.b) / 2 - size.y / 2)
}
/** 离 c 最近、能让没被挡住的那块地图只看到手绘画面的中心点（世界像素） */
function clampCenter(c: L.Point, z: number): L.Point {
  const size = map.getSize()
  const cov = covered()
  const hw = (size.x - cov.l - cov.r) / 2
  const hh = (size.y - cov.t - cov.b) / 2
  const d = L.point((cov.l - cov.r) / 2, (cov.t - cov.b) / 2)
  return clampToOutline(c, PAINTED_OUTLINE.map((q) => map.project(toLatLng(q), z)), hw, hh, d)
}
type CenterZoom = (b: L.LatLngBounds, o: L.FitBoundsOptions) => { center: L.LatLng; zoom: number }
function fit(pts: LngLat[], maxZoom = 19, animate = true) {
  if (!pts.length) return
  if (animate) map.stop()
  map.invalidateSize({ pan: false })
  const { tl, br } = uiPadding()
  const opts: L.FitBoundsOptions = { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: Math.max(maxZoom, map.getMinZoom()) }
  const b = L.latLngBounds(pts.map(toLatLng))
  // 和 flyToBounds 一样，但直接飞到范围内的位置，不会先飞出去再弹回来
  const { center, zoom: z } = (map as unknown as { _getBoundsCenterZoom: CenterZoom })._getBoundsCenterZoom(b, opts)
  const target = map.unproject(clampCenter(map.project(center, z), z), z)
  if (animate) map.flyTo(target, z, { duration: 0.6 })
  else map.setView(target, z, { animate: false })
}
/** dy > 0：让目标点落在可见区域中心下方 dy 像素，给上方的标注卡片留位置 */
function focus(p: LngLat, z = Math.max(map.getZoom(), 18), dy = 0) {
  map.stop()
  map.invalidateSize({ pan: false })
  const pt = map.project(toLatLng(p), z).subtract(visibleOffset()).subtract(L.point(0, dy))
  map.flyTo(map.unproject(clampCenter(pt, z), z), z, { duration: 0.6 })
}
/** 往外缩到校园差不多铺满可见区域为止 */
/**
 * 回到全校。桌面上整个校园放进可见区域；手机竖屏太窄，整个校园只占屏幕中间一条，
 * 改成按可见区域的高度铺满（左右可以拖着看），名称也放得下。
 */
function home(animate = true) {
  if (ui.desktop || ui.overlay) return fit(state.campus!.boundary, 17, animate)
  const cov = covered()
  const size = map.getSize().subtract([cov.l + cov.r, cov.t + cov.b])
  if (size.x <= 0 || size.y <= 0) return fit(state.campus!.boundary, 17, animate)
  const bounds = L.latLngBounds(state.campus!.boundary.map(toLatLng))
  const nw = map.project(bounds.getNorthWest(), 17)
  const se = map.project(bounds.getSouthEast(), 17)
  const z = Math.max(map.getMinZoom(), Math.min(17, Math.round(17 + Math.log2(Math.max(size.x / (se.x - nw.x), size.y / (se.y - nw.y))))))
  map.stop()
  const pt = map.project(bounds.getCenter(), z).subtract(visibleOffset())
  map.setView(map.unproject(clampCenter(pt, z), z), z, animate ? { animate: true, duration: 0.5 } as L.ZoomPanOptions : { animate: false })
}
function limitZoomOut() {
  const cov = covered()
  const size = map.getSize().subtract([cov.l + cov.r, 0])
  // 媒体查询可能先于 Leaflet 的 resize 回调触发，不能用旧宽度减去新侧栏宽度计算缩放。
  if (size.x <= 0 || size.y <= 0) return
  // 宁可裁掉校园边缘，也不让校园缩成屏幕中间的一小块
  map.setMinZoom(fillZoom(map, L.latLngBounds(state.campus!.boundary.map(toLatLng)), size, 15, 19, 0.7))
  minZoom.value = map.getMinZoom()
}
let keepInside = () => {}
let unmountToday = () => {}
let unmountLocate = () => {}
let unmountTimeMachine = () => {}
let sheetTimer = 0

function zoomClass() {
  const z = map.getZoom()
  zoom.value = z
  for (let k = 15; k <= 19; k++) el.value!.classList.toggle(`z${k}`, k === Math.min(19, z))
}

onMounted(() => {
  map = createCampusMap(el.value!, state.campus!)
  limitZoomOut()
  keepInside = limitPan(map, clampCenter)
  L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('底图 © 上海科技大学校园地图 · 部分道路 © OpenStreetMap contributors').addTo(map)
  opacityLayer = createMapOpacity(map, [...state.buildings, ...(state.campus?.construction ?? []).map((c, i) => ({ ...c, id: `construction-${i}` }))])
  for (const [name, z] of [['poi-hit-pane', 450], ['label-hover-pane', 610], ['event-label-pane', 630]] as const) {
    const pane = map.createPane(name)
    pane.style.zIndex = String(z)
    pane.style.pointerEvents = 'none'
  }
  labelInteraction = createLabelInteraction(el.value!, () => hover(null))
  updateOpacity()
  const extras = L.layerGroup().addTo(map)
  drawConstruction(extras)
  ;[buildingLayer, poiTargetLayer, labelLayer, hoverLabelLayer, entranceLayer, routeLayer, poiLayer, eventFocusLayer, crowdLayer, undergroundLayer, undergroundSketchLayer].forEach((l) => l.addTo(map))
  drawBuildings()
  drawPoiTargets()
  home(false)
  zoomClass()
  el.value!.classList.toggle('mine-focus', mineFocus.value)
  drawLabels()
  drawPois()
  drawEvents()
  drawCrowd()
  drawUnderground()
  drawUndergroundSketch()
  mapApi.fit = fit
  mapApi.focus = focus
  mapApi.home = () => home()
  mapApi.relayout = declutter
  unmountToday = mountTodayLayer(map)
  // 我的地图：一打开就缩放到自己的各站（分享链接等已经选中了别的东西时不抢镜头）
  if (mineFocus.value && !state.selected && !state.eventId) fitToday()
  unmountLocate = mountLocateLayer(map)
  unmountTimeMachine = mountTimeMachineLayer(map)
  map.on('zoomend', () => {
    zoomClass()
    drawLabels()
    drawPois()
    drawEntrances()
  })
  map.on('movestart', () => labelInteraction?.setMoving(true))
  map.on('moveend', () => { labelInteraction?.setMoving(false); declutter() })
  map.on('resize', () => {
    limitZoomOut()
    keepInside()
    declutter()
  })
  map.on('click', (e: L.LeafletMouseEvent) => {
    if (tm.open) { tm.focus = ''; return }
    const pos = fromLatLng(e.latlng)
    if (state.route.network === 'underground') {
      if (state.undergroundSketch.active) {
        addUndergroundSketchPoint(pos)
        return
      }
      toast('请先在地下手绘窗口点击“开始手绘”')
      return
    }
    if (state.route.picking && state.route.network === 'surface') setEnd(state.route.picking, { name: '地图上的点', point: pos })
    else if (state.selected) select(null)
  })
  if (import.meta.env.DEV) (window as unknown as { __map: L.Map }).__map = map
})
onBeforeUnmount(() => {
  clearTimeout(sheetTimer)
  cancelAnimationFrame(declutterFrame)
  labelInteraction?.destroy()
  hoverState.dispose()
  cancelAnimationFrame(declutterFrame)
  unmountToday()
  unmountLocate()
  unmountTimeMachine()
  map?.remove()
})

watch(() => [state.selected, state.chip, mapHighlights.value, state.room], () => {
  hover(null)
  keepInside()
  restyle()
  drawLabels()
  drawPois()
  drawEntrances()
})
watch(() => state.pois, () => { drawPoiTargets(); drawPois() }, { deep: true })
watch(() => [state.route.result, state.route.undergroundResult], drawRoute)
watch(() => [state.entranceBuilding, state.route.open, state.route.result, state.route.from, state.route.to], () => { drawEntrances(); drawLabels(); drawPois() })
watch(() => [state.panel, state.eventId, state.radar.range, state.radar.cat, state.radar.place, state.route.open, discovery.events, nowTick.value, tm.open], drawEvents)
watch(() => [state.panel, state.route.open, nowTick.value, crowdRevision.value, discovery.canteens, tm.open], drawCrowd)
// 时光机全屏：侧栏和底部面板让开后重新计算缩放范围；打开和退出时回到全校，界面尺寸变化不打断镜头跟随
watch(() => [tm.open, ui.overlay?.t, ui.overlay?.r, ui.overlay?.b], ([open], [wasOpen]) => {
  limitZoomOut()
  keepInside()
  if (open !== wasOpen) {
    map.stop()
    mapApi.home()
  }
  declutter()
}, { flush: 'post' })
watch(() => state.labelVisibility, () => {
  hover(null)
  drawLabels()
  drawPois()
  drawEvents()
}, { deep: true })
watch(() => state.mapSettings, restyle, { deep: true })
watch(() => [state.showRoads, state.rainMode], () => toggleRoads(state.showRoads))
watch(() => [state.showUnderground, state.underground, state.route.network], drawUnderground, { deep: true })
watch(() => [state.route.network, state.undergroundSketch.paths, state.undergroundSketch.current], drawUndergroundSketch, { deep: true })
// 不用 :class 绑定：Vue 会整个覆盖 className，把 Leaflet 加在容器上的 class 冲掉
watch(() => !!(state.route.picking), (on) => el.value?.classList.toggle('picking', on))
watch(mineFocus, (on) => { el.value?.classList.toggle('mine-focus', on); declutter() })
watch(() => ui.sheet, () => {
  clearTimeout(sheetTimer)
  sheetTimer = window.setTimeout(() => { keepInside(); declutter() }, 250)
})
// 拖动侧栏分隔线：标注跟着可见区域重排，松手后再把镜头收回可见范围
watch(() => ui.sideW, () => {
  declutter()
  clearTimeout(sheetTimer)
  sheetTimer = window.setTimeout(() => { if (!ui.resizingSide) { limitZoomOut(); keepInside() } }, 150)
})
watch(() => ui.resizingSide, (on) => { if (!on) { limitZoomOut(); keepInside(); declutter() } })
watch(() => ui.desktop, () => {
  map.stop()
  map.invalidateSize({ pan: false })
  limitZoomOut()
  keepInside()
  declutter()
}, { flush: 'post' })

// 右侧按钮：手机上跟着底部面板走，面板拉高时藏起来
const toolsBottom = computed(() => (ui.desktop ? 24 : Math.min(ui.sheet, ui.anchors[1]) + 12))
// 快递站平面图有自己的缩放按钮，打开时校园地图的按钮让开
const toolsHidden = computed(() => tm.open || parcel.open || !ui.desktop && ui.sheet > ui.anchors[1] + 40)
</script>

<template>
  <div ref="el" class="map campus-map" role="application" aria-label="校园地图" />
  <div ref="mapTools" class="map-tools" :class="{ hidden: toolsHidden }" :style="{ bottom: toolsBottom + 'px' }">
    <CampusMapToggle />
    <MapLabelControls v-model="state.labelVisibility" @layout="declutter" />
    <LocateButton />
    <div v-if="ui.desktop" class="zoom">
      <button type="button" aria-label="放大" :disabled="zoom >= 20" @click="map.zoomIn()"><Ico name="plus" /></button>
      <button type="button" aria-label="缩小" :disabled="zoom <= minZoom" @click="map.zoomOut()"><Ico name="minus" /></button>
    </div>
  </div>
</template>

<style>
.map { position: absolute; inset: 0; background: #fbfaf7; isolation: isolate; }
.map.leaflet-container { font: inherit; }
.map-opacity-cutout { transition: fill 240ms ease-in-out; }
.building-outline { transition: stroke 240ms ease-in-out, stroke-opacity 240ms ease-in-out, stroke-width 240ms ease-in-out, fill-opacity 240ms ease-in-out; }
/* 描边仅作提示，命中范围沿轮廓内部，避免粗线抢到相邻建筑。 */
.building-outline.leaflet-interactive { pointer-events: fill; }
.map.picking, .map.picking .leaflet-interactive { cursor: crosshair; }
.leaflet-marker-icon { background: none; border: 0; }
.leaflet-control-attribution { font-size: 10px; }
.ug-marker { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 3px; white-space: nowrap; padding: 3px; border: 2px solid #b47a22; border-radius: 999px; background: #fff9e9; color: #8b5b17; box-shadow: 0 1px 5px #0003; font-size: 14px; }
.ug-marker em { padding-right: 4px; color: #6b542c; font-size: 10px; font-style: normal; font-weight: 700; }
.ug-source-popup { display: grid; gap: 6px; min-width: 220px; }
.ug-source-popup small { color: #6d746e; line-height: 1.45; }
.ug-source-popup img { display: block; width: 100%; max-height: 180px; object-fit: cover; border-radius: 8px; }


.map-tools { position: absolute; z-index: 1100; right: 12px; display: flex; flex-direction: column; gap: 10px; align-items: center; transition: bottom 0.25s, opacity 0.2s; }
@media (max-width: 899px) {
  .map-tools { right: 10px; gap: 8px; }
  .map-tools .fab { width: 40px; height: 40px; font-size: 18px; box-shadow: 0 1px 2px #0000001a, 0 3px 10px #00000021; }
}
.map-tools.hidden { opacity: 0; pointer-events: none; }
.fab { width: 42px; height: 42px; border-radius: 50%; border: 0; background: #fff; box-shadow: var(--shadow); display: grid; place-items: center; font-size: 19px; color: var(--ink); cursor: pointer; }
.fab.on { background: var(--ink); color: #fff; }
.fab:active { transform: scale(0.95); }
.zoom { display: flex; flex-direction: column; width: 42px; border-radius: 12px; background: #fff; box-shadow: var(--shadow); overflow: hidden; }
.zoom button { height: 40px; border: 0; background: none; font-size: 18px; color: var(--ink); cursor: pointer; display: grid; place-items: center; }
.zoom button + button { border-top: 1px solid var(--line); }
.zoom button:disabled { color: #ccc; cursor: default; }
@media (hover: hover) { .fab:not(.on):hover, .zoom button:not(:disabled):hover { background: #f7f7f3; } }


@media (prefers-reduced-motion: reduce) {
  .map-opacity-cutout, .building-outline, .map .blabel, .map .pmark { transition: none; }
}

/* 我的地图：其余地点退到背景，只留楼名做方位参照；小设施图标先收起来 */
.map.mine-focus .pmark:not(.matching):not(.sel):not(.hover-label) { display: none; }
.map.mine-focus .blabel:not(.matching):not(.sel):not(.focused):not(.hover-label) { opacity: .55; box-shadow: none; }

/* 手机：标签收紧一点，同样大小的屏幕放得下更多名称 */
@media (max-width: 899px) {
  .map .blabel { gap: 5px; padding: 2px 7px 2px 3px; border-radius: 9px; font-size: 11px; line-height: 17px; }
  .map .blabel > svg { width: 19px; height: 19px; padding: 3.5px; }
  .map .blabel.group { gap: 6px; padding: 4px 5px 4px 4px; font-size: 11.5px; }
  .map .blabel.group > svg { width: 21px; height: 21px; }
  .map .blabel.sel { padding: 3px 9px 3px 4px; font-size: 11.5px; }
  .map .pmark i { width: 19px; height: 19px; font-size: 12px; }
  .map .leaflet-control-attribution { display: none; }
}

.clash { visibility: hidden; pointer-events: none; }
.hover-label { pointer-events: auto; }

.emark { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 3px; white-space: nowrap; padding: 2px; border-radius: 999px; background: #fff; color: var(--green); font-size: 11px; font-weight: 700; box-shadow: 0 1px 4px #0000004d; }
.emark svg { font-size: 13px; }
.emark span { padding-right: 5px; color: var(--ink); }
.map.z17 .emark span { display: none; }
.rend { position: absolute; transform: translate(-50%, -100%); color: #d93025; font-size: 34px; line-height: 0; filter: drop-shadow(0 2px 2px #0000004d); }
.underground-rend { color: #8156a8; }
.underground-connector { display: grid; place-items: center; width: 26px; height: 26px; border: 2px solid #fff; border-radius: 50%; background: var(--connector-color); box-shadow: 0 2px 5px #0006; color: #fff; font-size: 11px; font-weight: 800; }
.route-transition { display: grid; place-items: center; width: 22px; height: 22px; border: 2px solid #e89a31; border-radius: 50%; background: #fff7e8; box-shadow: 0 1px 5px #0004; color: #9a621d; font-size: 15px; font-weight: 800; line-height: 1; }
.route-transition.exit { background: #e89a31; color: #fff; }
.rend svg { fill: #fff; }
/* 从教室号搜索进来：选中的楼名后面跟房间号 */
.blabel .room-code { margin-left: 1px; padding: 1px 6px; border-radius: 6px; background: #ffffff30; font-style: normal; font-variant-numeric: tabular-nums; }

/* 选中活动：标注卡片，尖角指向地点名称上沿，名称和卡片都不被遮住 */
.event-focus { position: absolute; left: 0; bottom: 18px; transform: translateX(-50%); padding: 0 0 9px; border: 0; background: transparent; color: inherit; font: inherit; display: block; cursor: pointer; pointer-events: auto; }
.event-focus.enter { animation: ec-in 320ms cubic-bezier(.2,.8,.25,1.2) both; }
.event-focus > * { pointer-events: none; }
.event-focus:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: 12px; }
.event-callout {
  display: flex; flex-direction: column; gap: 4px; width: max-content; min-width: 168px; max-width: 236px;
  padding: 9px 11px 10px; border: 2px solid var(--brand); border-radius: 14px; background: #fff; color: var(--ink);
  box-shadow: 0 10px 28px #6b1d2340, 0 2px 6px #0000001f; text-align: left; white-space: normal; position: relative;
}
.event-callout::after { content: ''; position: absolute; left: 50%; top: 100%; width: 12px; height: 12px; margin: -7px 0 0 -6px; border: 2px solid var(--brand); border-top: 0; border-left: 0; border-radius: 0 0 3px; background: #fff; transform: rotate(45deg); }
.ec-head { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
.ec-head b { font-variant-numeric: tabular-nums; color: var(--ink-2); font-weight: 600; }
.ec-status { padding: 1px 7px; border-radius: 999px; background: var(--brand); color: #fff; font-weight: 650; white-space: nowrap; }
.ec-status.live { background: #1f9d55; }
.ec-status.soon { background: #d9861c; }
.ec-status.past { background: var(--bg-2); color: var(--ink-3); }
.ec-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13.5px; line-height: 1.4; font-weight: 700; }
.ec-place { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 11.5px; color: var(--brand); font-weight: 600; }
.ec-place > svg { flex: none; font-size: 13px; }
.ec-place span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-place em { flex: none; margin-left: auto; padding-left: 6px; font-style: normal; font-weight: 500; color: var(--ink-3); }
@keyframes ec-in { from { opacity: 0; } }

.event-pulse { position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; background: #a8242b33; box-shadow: 0 0 0 2px #a8242b55; }
.event-pulse::before, .event-pulse::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 3px solid var(--brand); animation: ec-pulse 2.4s ease-out infinite; }
.event-pulse::after { animation-delay: 1.2s; }
@keyframes ec-pulse { from { transform: scale(1); opacity: .9; } to { transform: scale(2.8); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .event-focus.enter, .event-pulse::before, .event-pulse::after { animation: none; }
  .event-pulse::before { transform: scale(1.8); opacity: .5; }
}
</style>
