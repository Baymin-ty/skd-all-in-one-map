<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BaiduCRS, baiduTiles, clampToOutline, fillZoom, fromLatLng, limitPan, PAINTED_OUTLINE, toLatLng } from '../lib/geo'
import type { BuildingGroup } from '../lib/groups'
import { ICONS } from '../lib/icons'
import { walkableCells } from '../lib/route'
import {
  buildingById, canEdit, chipHasBuilding, chipHasPoi, endFor, expandedGroups, groupOf, mapApi, movePoi, newDraft,
  PLACE_COLORS, POI_CATS, select, setEnd, state, toast, WALKWAY_COLOR, type Selection,
} from '../lib/store'
import type { Building, LngLat } from '../lib/types'
import { covered, SIDEBAR_W, TOPBAR_H, ui } from '../lib/ui'
import Ico from './Ico.vue'

const el = ref<HTMLDivElement>()
let map: L.Map
const zoom = ref(17)
const minZoom = ref(16)
/** 放大到这一级，楼群自动展开显示各栋（标签放得下了） */
const EXPAND_ALL_ZOOM = 19

const buildingLayer = L.layerGroup()
const labelLayer = L.layerGroup()
const poiLayer = L.layerGroup()
const routeLayer = L.layerGroup()
const entranceLayer = L.layerGroup()
let roadLayer: L.LayerGroup | null = null
const polys = new Map<string, L.Polygon>()

// ---------- 楼的多边形：底图上楼已经画好了，平时透明只接点击；风雨长廊常亮 ----------
const baseStyle: L.PathOptions = { stroke: false, fillColor: '#fff', fillOpacity: 0 }
const hoverStyle: L.PathOptions = { stroke: true, color: '#fffdf4', weight: 2, opacity: 1, fillColor: '#fff8de', fillOpacity: 0.22 }
const selStyle: L.PathOptions = { stroke: true, color: '#a8242b', weight: 2.5, opacity: 1, dashArray: undefined, fillColor: '#fff0d9', fillOpacity: 0.26 }
const catStyle = (c: string): L.PathOptions => ({ stroke: true, color: c, weight: 1.5, opacity: 0.9, dashArray: undefined, fillColor: c, fillOpacity: 0.2 })
/** 展开的楼群：虚线圈出同组的楼 */
const memberStyle = (c: string): L.PathOptions => ({ stroke: true, color: c, weight: 1.5, opacity: 0.95, dashArray: '4 3', fillColor: c, fillOpacity: 0.12 })
const walkwayStyle = (strong: boolean): L.PathOptions => ({
  stroke: true, color: WALKWAY_COLOR, weight: strong ? 3 : 2, opacity: 1, dashArray: strong ? undefined : '6 4',
  fillColor: WALKWAY_COLOR, fillOpacity: strong ? 0.35 : 0.18,
})

function styleFor(b: Building): L.PathOptions {
  if (state.selected?.id === b.id) return selStyle
  if (b.walkway) return walkwayStyle(state.route.rain || state.chip === 'walkway')
  if (state.chip && chipHasBuilding(state.chip, b)) return catStyle(PLACE_COLORS[b.cat])
  const g = groupOf(b.id)
  if (g && expandedGroups().has(g.id) && state.selected) return memberStyle(PLACE_COLORS[b.cat])
  return baseStyle
}
const restyle = () => state.buildings.forEach((b) => polys.get(b.id)?.setStyle(styleFor(b)))

/** 楼、楼群、点位被点到：在选导航端点就设端点，否则打开详情 */
function pick(sel: Selection) {
  if (state.placing) return
  const which = state.route.picking
  if (which && sel.kind !== 'group') {
    const end = endFor(sel)
    if (end) setEnd(which, end)
  } else select(sel, sel.kind === 'group')
}

function drawBuildings() {
  buildingLayer.clearLayers()
  polys.clear()
  for (const b of state.buildings) {
    const p = L.polygon(b.poly.map(toLatLng), { ...styleFor(b), bubblingMouseEvents: false })
    p.on('click', () => pick({ kind: 'building', id: b.id }))
    p.on('mouseover', () => state.selected?.id !== b.id && p.setStyle(hoverStyle))
    p.on('mouseout', () => p.setStyle(styleFor(b)))
    p.addTo(buildingLayer)
    polys.set(b.id, p)
  }
}

// ---------- 标签：优先级高的先占位置，被挡住的藏起来（declutter） ----------
function prioOf(b: Building, inGroup: boolean, focused: boolean) {
  if (state.selected?.id === b.id) return 100
  if (focused) return 95 // 点开的楼群：各栋名字优先
  if (state.chip && chipHasBuilding(state.chip, b)) return 92 // 分类条选中的那类优先
  if (b.walkway) return 90
  if (b.cat === 'gate') return 85
  if (b.cat === 'dining') return 80
  if (inGroup) return 60
  return b.cat === 'housing' ? 45 : 50
}

function labelIcon(html: string, cls: string, prio: number, color: string, group = '') {
  const data = group ? ` data-group="${group}"` : ''
  return L.divIcon({ className: '', html: `<div class="${cls}" data-prio="${prio}"${data} style="--c:${color}">${html}</div>`, iconSize: [0, 0] })
}
/** 楼群标签和它的备选位置：先放各栋中心的平均点，挡住了就挪到离平均点最近的那栋，依次往后试 */
const groupMarkers = new Map<string, { marker: L.Marker; spots: LngLat[] }>()

function drawLabels() {
  labelLayer.clearLayers()
  groupMarkers.clear()
  const expanded = expandedGroups()
  const all = map.getZoom() >= EXPAND_ALL_ZOOM
  const s = state.selected
  const focusGroup = s?.kind === 'group' ? s.id : s?.kind === 'building' ? groupOf(s.id)?.id : undefined
  for (const b of state.buildings) {
    const g = groupOf(b.id)
    const sel = state.selected?.id === b.id
    if (g && !all && !expanded.has(g.id) && !sel) continue
    const major = b.cat === 'gate' || b.cat === 'dining' || b.walkway
    const matching = state.chip && chipHasBuilding(state.chip, b)
    const cls = ['blabel', major && 'major', b.walkway && 'walkway', sel && 'sel', matching && 'matching', g && 'member'].filter(Boolean).join(' ')
    const icon = ICONS[b.walkway ? 'walkway' : b.cat]
    L.marker(toLatLng(b.center), {
      icon: labelIcon(`${icon}<span>${b.short.zh}</span>`, cls, prioOf(b, !!g, !!g && g.id === focusGroup), b.walkway ? WALKWAY_COLOR : PLACE_COLORS[b.cat]),
      zIndexOffset: sel ? 1000 : 0,
      keyboard: false,
    })
      .on('click', () => pick({ kind: 'building', id: b.id }))
      .addTo(labelLayer)
  }
  if (!all) for (const g of state.groups) if (!expanded.has(g.id)) drawGroupLabel(g)
  declutter()
}

function drawGroupLabel(g: BuildingGroup) {
  const matching = state.chip === g.cat
  const marker = L.marker(toLatLng(g.center), {
    icon: labelIcon(`${ICONS[g.cat]}<span>${g.name.zh}</span><em>${g.members.length}</em>`, `blabel group major${matching ? ' matching' : ''}`, 75, PLACE_COLORS[g.cat], g.id),
    keyboard: false,
    title: `${g.name.zh}（${g.members.length} 栋），点击展开`,
  })
    .on('click', () => pick({ kind: 'group', id: g.id }))
    .addTo(labelLayer)
  const centers = g.members.map((id) => buildingById(id)!.center)
  const d = (p: LngLat) => (p[0] - g.center[0]) ** 2 + (p[1] - g.center[1]) ** 2
  groupMarkers.set(g.id, { marker, spots: [g.center, ...centers.sort((a, b) => d(a) - d(b))] })
}

function drawPois() {
  poiLayer.clearLayers()
  const editable = canEdit()
  for (const p of state.pois) {
    const c = POI_CATS[p.cat] ?? POI_CATS.life
    const sel = state.selected?.id === p.id
    const matching = state.chip && chipHasPoi(state.chip, p)
    const cls = ['pmark', sel && 'sel', editable && 'editable', matching && 'matching'].filter(Boolean).join(' ')
    const m = L.marker(toLatLng(p.pos), {
      icon: labelIcon(`<i>${ICONS[c.icon]}</i><span>${p.name.zh}</span>`, cls, sel ? 100 : matching ? 55 : 30, c.color),
      draggable: editable,
      zIndexOffset: sel ? 1100 : 600,
      keyboard: false,
    })
    m.on('click', () => pick({ kind: 'poi', id: p.id }))
    m.on('dragend', () => {
      movePoi(p.id, fromLatLng(m.getLatLng())).catch((e) => {
        toast(`没保存：${e.message}`)
        drawPois()
      })
    })
    m.addTo(poiLayer)
  }
  // 新建中的点位：可以拖动微调，保存前只在表单里
  const d = state.draft
  if (d && !d.id) {
    const m = L.marker(toLatLng(d.pos), {
      icon: labelIcon(`<i>${ICONS.plus}</i><span>新点位</span>`, 'pmark draft', 100, '#2f6fd6'),
      draggable: true,
      zIndexOffset: 1200,
    })
    m.on('dragend', () => state.draft && (state.draft.pos = fromLatLng(m.getLatLng())))
    m.addTo(poiLayer)
  }
  declutter()
}

let declutterFrame = 0
function declutter() {
  cancelAnimationFrame(declutterFrame)
  declutterFrame = requestAnimationFrame(() => {
    if (!el.value) return
    const nodes = [...el.value.querySelectorAll<HTMLElement>('[data-prio]')]
    for (const n of nodes) n.classList.remove('clash', 'compact')
    nodes.sort((a, b) => Number(b.dataset.prio) - Number(a.dataset.prio))
    const placed: DOMRect[] = []
    const hits = (r: DOMRect) => placed.some((q) => r.left < q.right + 2 && r.right > q.left - 2 && r.top < q.bottom + 1 && r.bottom > q.top - 1)
    for (const n of nodes) {
      if (n.offsetParent === null) continue // 被缩放级别的样式藏掉了
      const gm = n.dataset.group ? groupMarkers.get(n.dataset.group) : undefined
      if (gm) gm.marker.setLatLng(toLatLng(gm.spots[0]))
      let r = n.getBoundingClientRect()
      if (!r.width) continue
      if (gm && hits(r)) {
        for (const spot of gm.spots.slice(1)) {
          gm.marker.setLatLng(toLatLng(spot))
          r = n.getBoundingClientRect()
          if (!hits(r)) break
        }
        if (hits(r)) gm.marker.setLatLng(toLatLng(gm.spots[0]))
        r = n.getBoundingClientRect()
      }
      if (hits(r) && n.classList.contains('pmark')) {
        // 点位先只留图标，图标也挡住才藏
        n.classList.add('compact')
        r = n.getBoundingClientRect()
      }
      if (hits(r) && Number(n.dataset.prio) < 100) n.classList.add('clash')
      else placed.push(r)
    }
  })
}

function drawEntrances() {
  entranceLayer.clearLayers()
  const b = state.selected?.kind === 'building' ? buildingById(state.selected.id) : undefined
  for (const e of b?.entrances ?? [])
    L.marker(toLatLng(e.pos), {
      icon: L.divIcon({ className: '', html: `<div class="emark">${ICONS.entrance}<span>${e.zh ?? ''}</span></div>`, iconSize: [0, 0] }),
      zIndexOffset: 950,
      interactive: false,
    }).addTo(entranceLayer)
}

function drawRoute() {
  routeLayer.clearLayers()
  const r = state.route.result
  if (!r) return
  const casing: L.PolylineOptions = { color: '#fff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }
  for (const s of r.segments) L.polyline(s.path.map(toLatLng), casing).addTo(routeLayer)
  for (const s of r.segments)
    L.polyline(s.path.map(toLatLng), { color: s.covered ? WALKWAY_COLOR : '#2f6fd6', weight: 5.5, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer)
  const first = r.segments[0].path[0]
  const last = r.segments.at(-1)!.path.at(-1)!
  L.circleMarker(toLatLng(first), { radius: 7, color: '#2f6fd6', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(routeLayer)
  L.marker(toLatLng(last), { icon: L.divIcon({ className: '', html: `<div class="rend">${ICONS.pin}</div>`, iconSize: [0, 0] }), interactive: false, zIndexOffset: 1300 }).addTo(routeLayer)
}

/** 路网：红 = 手绘图上的路，蓝 = OpenStreetMap 补的路，青 = 风雨长廊下 */
function toggleRoads(on: boolean) {
  if (!on) {
    roadLayer?.remove()
    return
  }
  if (!roadLayer) {
    const renderer = L.canvas({ padding: 0.3 })
    roadLayer = L.layerGroup()
    for (const c of walkableCells())
      L.circleMarker(toLatLng(c.pos), {
        renderer, radius: c.covered ? 2.6 : 1.8, stroke: false, fillOpacity: 0.85, interactive: false,
        fillColor: c.covered ? WALKWAY_COLOR : c.osm ? '#4f8bff' : '#ff4d4f',
      }).addTo(roadLayer)
  }
  roadLayer.addTo(map)
}

function drawConstruction(layer: L.LayerGroup) {
  for (const c of state.campus?.construction ?? [])
    L.polygon(c.poly.map(toLatLng), { color: '#e0891f', weight: 2, dashArray: '6 5', fillColor: '#e0891f', fillOpacity: 0.1 })
      .bindTooltip(`🚧 ${c.name.zh}`, { sticky: true })
      .addTo(layer)
}

// ---------- 相机：避开侧栏 / 顶栏 / 底部面板，范围限制在手绘图里（同 skdmap） ----------
function uiPadding(): { tl: L.PointTuple; br: L.PointTuple } {
  if (ui.desktop) return { tl: [SIDEBAR_W + 48, 48], br: [48, 48] }
  return { tl: [20, TOPBAR_H + 16], br: [20, Math.min(ui.sheet, ui.anchors[1]) + 20] }
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
  const { tl, br } = uiPadding()
  const opts: L.FitBoundsOptions = { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: Math.max(maxZoom, map.getMinZoom()) }
  const b = L.latLngBounds(pts.map(toLatLng))
  // 和 flyToBounds 一样，但直接飞到范围内的位置，不会先飞出去再弹回来
  const { center, zoom: z } = (map as unknown as { _getBoundsCenterZoom: CenterZoom })._getBoundsCenterZoom(b, opts)
  const target = map.unproject(clampCenter(map.project(center, z), z), z)
  if (animate) map.flyTo(target, z, { duration: 0.6 })
  else map.setView(target, z, { animate: false })
}
function focus(p: LngLat, z = Math.max(map.getZoom(), 18)) {
  const pt = map.project(toLatLng(p), z).subtract(visibleOffset())
  map.flyTo(map.unproject(clampCenter(pt, z), z), z, { duration: 0.6 })
}
/** 往外缩到校园差不多铺满可见区域为止 */
function limitZoomOut() {
  const cov = covered()
  const size = map.getSize().subtract([cov.l + cov.r, 0])
  map.setMinZoom(fillZoom(map, L.latLngBounds(state.campus!.boundary.map(toLatLng)), size, 15, 17))
  minZoom.value = map.getMinZoom()
}
let keepInside = () => {}
let sheetTimer = 0

function zoomClass() {
  const z = map.getZoom()
  zoom.value = z
  for (let k = 15; k <= 19; k++) el.value!.classList.toggle(`z${k}`, k === Math.min(19, z))
}

onMounted(() => {
  map = L.map(el.value!, {
    crs: BaiduCRS,
    zoomControl: false,
    attributionControl: false,
    minZoom: 15,
    maxZoom: 20,
    // 只用整数缩放：小数缩放时瓦片之间会有细缝
    zoomSnap: 1,
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120,
  })
  limitZoomOut()
  keepInside = limitPan(map, clampCenter)
  L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('底图 © 上海科技大学校园地图 · 部分道路 © OpenStreetMap contributors').addTo(map)
  const [[x0, y0], [x1, y1]] = state.campus!.bounds
  baiduTiles({
    minZoom: 14, maxZoom: 20, maxNativeZoom: 19, keepBuffer: 4,
    bounds: L.latLngBounds([y0 - 0.006, x0 - 0.006], [y1 + 0.006, x1 + 0.006]),
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  }).addTo(map)
  const extras = L.layerGroup().addTo(map)
  drawConstruction(extras)
  ;[buildingLayer, labelLayer, entranceLayer, routeLayer, poiLayer].forEach((l) => l.addTo(map))
  drawBuildings()
  fit(state.campus!.boundary, 17, false)
  zoomClass()
  drawLabels()
  drawPois()
  mapApi.fit = fit
  mapApi.focus = focus
  mapApi.home = () => fit(state.campus!.boundary, 17)
  map.on('zoomend', () => {
    const crossed = (zoom.value >= EXPAND_ALL_ZOOM) !== (map.getZoom() >= EXPAND_ALL_ZOOM)
    zoomClass()
    if (crossed) drawLabels()
    else declutter()
  })
  map.on('resize', () => {
    limitZoomOut()
    keepInside()
  })
  map.on('click', (e: L.LeafletMouseEvent) => {
    const pos = fromLatLng(e.latlng)
    if (state.placing) newDraft(pos)
    else if (state.route.picking) setEnd(state.route.picking, { name: '地图上的点', point: pos })
    else if (state.selected && !state.draft) select(null)
  })
  if (import.meta.env.DEV) (window as unknown as { __map: L.Map }).__map = map
})
onBeforeUnmount(() => {
  clearTimeout(sheetTimer)
  cancelAnimationFrame(declutterFrame)
  map?.remove()
})

watch(() => [state.selected, state.chip], () => {
  keepInside()
  restyle()
  drawLabels()
  drawPois()
  drawEntrances()
})
watch(() => [state.pois, canEdit(), state.draft?.id, state.draft?.pos], drawPois, { deep: true })
watch(() => state.route.result, drawRoute)
watch(() => state.route.rain, restyle)
watch(() => state.showRoads, toggleRoads)
watch(() => state.labels, (on) => {
  el.value?.classList.toggle('labels-hidden', !on)
  declutter()
})
// 不用 :class 绑定：Vue 会整个覆盖 className，把 Leaflet 加在容器上的 class 冲掉
watch(() => !!(state.route.picking || state.placing), (on) => el.value?.classList.toggle('picking', on))
watch(() => ui.sheet, () => {
  clearTimeout(sheetTimer)
  sheetTimer = window.setTimeout(() => keepInside(), 200)
})
watch(() => ui.desktop, () => {
  limitZoomOut()
  keepInside()
})

// 右侧按钮：手机上跟着底部面板走，面板拉高时藏起来
const toolsBottom = computed(() => (ui.desktop ? 24 : Math.min(ui.sheet, ui.anchors[1]) + 12))
const toolsHidden = computed(() => !ui.desktop && ui.sheet > ui.anchors[1] + 40)
</script>

<template>
  <div ref="el" class="map" role="application" aria-label="校园地图" />
  <div class="map-tools" :class="{ hidden: toolsHidden }" :style="{ bottom: toolsBottom + 'px' }">
    <button type="button" class="fab" :class="{ on: !state.labels }" :aria-pressed="!state.labels" :title="state.labels ? '隐藏地点名称' : '显示地点名称'" @click="state.labels = !state.labels">
      <Ico :name="state.labels ? 'eye' : 'eyeClosed'" />
    </button>
    <button type="button" class="fab" :class="{ on: state.showRoads }" :aria-pressed="state.showRoads" title="显示步行路网" @click="state.showRoads = !state.showRoads">
      <Ico name="road" />
    </button>
    <button type="button" class="fab" title="回到全校" aria-label="回到全校" @click="mapApi.home()"><Ico name="home" /></button>
    <div v-if="ui.desktop" class="zoom">
      <button type="button" aria-label="放大" :disabled="zoom >= 20" @click="map.zoomIn()"><Ico name="plus" /></button>
      <button type="button" aria-label="缩小" :disabled="zoom <= minZoom" @click="map.zoomOut()"><Ico name="minus" /></button>
    </div>
  </div>
</template>

<style>
.map { position: absolute; inset: 0; background: #fbfaf7; isolation: isolate; }
.map.leaflet-container { font: inherit; }
.map.picking, .map.picking .leaflet-interactive { cursor: crosshair; }
.leaflet-marker-icon { background: none; border: 0; }
.leaflet-control-attribution { font-size: 10px; }

.map-tools { position: absolute; z-index: 1000; right: 12px; display: flex; flex-direction: column; gap: 10px; align-items: center; transition: bottom 0.25s, opacity 0.2s; }
.map-tools.hidden { opacity: 0; pointer-events: none; }
.fab { width: 42px; height: 42px; border-radius: 50%; border: 0; background: #fff; box-shadow: var(--shadow); display: grid; place-items: center; font-size: 19px; color: var(--ink); cursor: pointer; }
.fab.on { background: var(--ink); color: #fff; }
.fab:active { transform: scale(0.95); }
.zoom { display: flex; flex-direction: column; width: 42px; border-radius: 12px; background: #fff; box-shadow: var(--shadow); overflow: hidden; }
.zoom button { height: 40px; border: 0; background: none; font-size: 18px; color: var(--ink); cursor: pointer; display: grid; place-items: center; }
.zoom button + button { border-top: 1px solid var(--line); }
.zoom button:disabled { color: #ccc; cursor: default; }
@media (hover: hover) { .fab:not(.on):hover, .zoom button:not(:disabled):hover { background: #f7f7f3; } }

/* 楼名：白底胶囊 + 分类色图标（同 skdmap） */
.blabel {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; cursor: pointer;
  display: flex; align-items: center; gap: 4px; padding: 2px 6px 2px 2px; border-radius: 6px;
  background: #fffffff0; box-shadow: 0 1px 3px #0000001f; color: #303b36; font-size: 11px; font-weight: 600; line-height: 16px;
}
.blabel svg { flex: none; font-size: 11px; color: #fff; background: var(--c); border-radius: 4px; padding: 3px; box-sizing: content-box; }
.blabel.group { font-size: 12px; padding-right: 3px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent), 0 2px 6px #00000024; }
.blabel.group em { font-style: normal; font-size: 10.5px; font-weight: 700; color: #fff; background: var(--c); border-radius: 999px; padding: 0 6px; }
.blabel.walkway { background: var(--c); color: #fff; }
.blabel.walkway svg { background: #ffffff38; }
.blabel.matching { box-shadow: 0 0 0 1.5px var(--c), 0 1px 3px #0000001f; }
.blabel.sel { padding: 4px 8px 4px 4px; background: var(--brand); color: #fff; box-shadow: 0 2px 6px #8f303a40; z-index: 5; }
.blabel.sel svg { background: #ffffff38; }
@media (hover: hover) { .blabel:not(.sel):hover { background: #fff; box-shadow: 0 1px 6px #00000029; } }

/* 点位：圆形图标，放大到 18 级才带名字 */
.pmark {
  position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 4px; white-space: nowrap;
  padding: 2px; border-radius: 999px; background: #fff; box-shadow: 0 1px 4px #0000004d; font-size: 11px; font-weight: 600; cursor: pointer;
}
.pmark i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--c); color: #fff; font-size: 12px; }
.pmark span { padding-right: 6px; }
.pmark.compact span { display: none; }
.pmark.matching { box-shadow: 0 0 0 2px var(--c), 0 1px 4px #0000004d; }
.pmark.sel { outline: 2.5px solid var(--brand); }
.pmark.editable { outline: 2px dashed var(--blue); cursor: grab; }
.pmark.draft { outline: 2.5px solid var(--blue); }
.pmark.editable.sel { outline: 2.5px solid var(--brand); }

/* 缩放分级：16 级只看校门、食堂、风雨长廊和楼群；17 级点位只有图标 */
.map.z15 .blabel:not(.major):not(.sel), .map.z16 .blabel:not(.major):not(.sel) { display: none; }
.map.z15 .pmark:not(.sel):not(.matching):not(.draft), .map.z16 .pmark:not(.sel):not(.matching):not(.draft) { display: none; }
.map.z17 .pmark:not(.sel):not(.draft) span { display: none; }
.map.labels-hidden .blabel:not(.sel), .map.labels-hidden .pmark:not(.sel):not(.draft) { display: none; }
.clash { visibility: hidden; pointer-events: none; }

.emark { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 3px; white-space: nowrap; padding: 2px; border-radius: 999px; background: #fff; color: var(--green); font-size: 11px; font-weight: 700; box-shadow: 0 1px 4px #0000004d; }
.emark svg { font-size: 13px; }
.emark span { padding-right: 5px; color: var(--ink); }
.map.z17 .emark span { display: none; }
.rend { position: absolute; transform: translate(-50%, -100%); color: #d93025; font-size: 34px; line-height: 0; filter: drop-shadow(0 2px 2px #0000004d); }
.rend svg { fill: #fff; }
</style>
