<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BaiduCRS, baiduTiles, fromLatLng, PAINTED_OUTLINE, toLatLng } from '../lib/geo'
import { walkableCells } from '../lib/route'
import {
  buildingById, endFor, movePoi, newDraft, PLACE_COLORS, POI_CATS, select, setEnd, state, toast, WALKWAY_COLOR,
} from '../lib/store'
import type { Building, LngLat } from '../lib/types'

const el = ref<HTMLDivElement>()
let map: L.Map

const buildingLayer = L.layerGroup()
const labelLayer = L.layerGroup()
const poiLayer = L.layerGroup()
const routeLayer = L.layerGroup()
const entranceLayer = L.layerGroup()
let roadLayer: L.LayerGroup | null = null
const polys = new Map<string, L.Polygon>()

// 底图上楼已经画好了，平时多边形透明，只用来接点击；风雨长廊常亮，方便一眼看到
const baseStyle: L.PathOptions = { stroke: false, fillColor: '#fff', fillOpacity: 0 }
const hoverStyle: L.PathOptions = { stroke: true, color: '#fffdf4', weight: 2, fillColor: '#fff8de', fillOpacity: 0.25 }
const selStyle: L.PathOptions = { stroke: true, color: '#a8242b', weight: 2.5, fillColor: '#fff0d9', fillOpacity: 0.28 }
const walkwayStyle = (strong: boolean): L.PathOptions => ({
  stroke: true, color: WALKWAY_COLOR, weight: strong ? 3 : 2, dashArray: strong ? undefined : '6 4',
  fillColor: WALKWAY_COLOR, fillOpacity: strong ? 0.35 : 0.18,
})
const styleFor = (b: Building) =>
  state.selected?.id === b.id ? selStyle : b.walkway ? walkwayStyle(state.route.rain) : baseStyle

/** 楼、点位被点到时：在选导航端点就设端点，否则打开详情 */
function pick(sel: { kind: 'building' | 'poi'; id: string }) {
  const which = state.route.picking
  if (which) {
    const end = endFor(sel)
    if (end) setEnd(which, end)
  } else if (!state.placing) select(sel, false)
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

function drawLabels() {
  labelLayer.clearLayers()
  for (const b of state.buildings) {
    const major = b.cat === 'gate' || b.cat === 'dining' || b.walkway
    const color = b.walkway ? WALKWAY_COLOR : PLACE_COLORS[b.cat]
    const cls = ['blabel', major && 'major', b.walkway && 'walkway', state.selected?.id === b.id && 'sel'].filter(Boolean).join(' ')
    L.marker(toLatLng(b.center), {
      icon: L.divIcon({ className: '', html: `<div class="${cls}" style="--c:${color}">${b.short.zh}</div>`, iconSize: [0, 0] }),
      keyboard: false,
    })
      .on('click', () => pick({ kind: 'building', id: b.id }))
      .addTo(labelLayer)
  }
}

function drawPois() {
  poiLayer.clearLayers()
  for (const p of state.pois) {
    const c = POI_CATS[p.cat] ?? POI_CATS.life
    const sel = state.selected?.id === p.id
    const m = L.marker(toLatLng(p.pos), {
      icon: L.divIcon({
        className: '',
        html: `<div class="pmark${sel ? ' sel' : ''}${state.editing ? ' editable' : ''}" style="--c:${c.color}"><i>${c.icon}</i><span>${p.name.zh}</span></div>`,
        iconSize: [0, 0],
      }),
      draggable: state.editing,
      zIndexOffset: sel ? 1000 : 500,
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
  // 新建中的点位：可拖动微调位置，保存前只在表单里
  const d = state.draft
  if (d && !d.id) {
    const m = L.marker(toLatLng(d.pos), {
      icon: L.divIcon({ className: '', html: '<div class="pmark draft"><i>＋</i><span>新点位</span></div>', iconSize: [0, 0] }),
      draggable: true,
      zIndexOffset: 1100,
    })
    m.on('dragend', () => state.draft && (state.draft.pos = fromLatLng(m.getLatLng())))
    m.addTo(poiLayer)
  }
}

function drawEntrances() {
  entranceLayer.clearLayers()
  const b = state.selected?.kind === 'building' ? buildingById(state.selected.id) : null
  for (const e of b?.entrances ?? [])
    L.marker(toLatLng(e.pos), {
      icon: L.divIcon({ className: '', html: `<div class="emark">🚪<span>${e.zh ?? ''}</span></div>`, iconSize: [0, 0] }),
      interactive: false,
    }).addTo(entranceLayer)
}

function drawRoute() {
  routeLayer.clearLayers()
  const r = state.route.result
  if (!r) return
  for (const s of r.segments) {
    const ll = s.path.map(toLatLng)
    L.polyline(ll, { color: '#fff', weight: 10, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer)
  }
  for (const s of r.segments)
    L.polyline(s.path.map(toLatLng), {
      color: s.covered ? WALKWAY_COLOR : '#2f6fd6', weight: 5.5, lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(routeLayer)
  const first = r.segments[0].path[0]
  const last = r.segments.at(-1)!.path.at(-1)!
  L.circleMarker(toLatLng(first), { radius: 7, color: '#2f6fd6', weight: 3, fillColor: '#fff', fillOpacity: 1 }).addTo(routeLayer)
  L.marker(toLatLng(last), { icon: L.divIcon({ className: '', html: '<div class="rend">📍</div>', iconSize: [0, 0] }), interactive: false }).addTo(routeLayer)
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
    L.polygon(c.poly.map(toLatLng), { color: '#e0891f', weight: 2, dashArray: '6 5', fillColor: '#e0891f', fillOpacity: 0.12 })
      .bindTooltip(`🚧 ${c.name.zh}`, { sticky: true })
      .addTo(layer)
}

/** 侧栏（桌面）或底部面板（手机）挡住的那部分地图不算可视区域 */
function padding(): L.FitBoundsOptions {
  if (window.innerWidth >= 768) return { paddingTopLeft: [400, 40], paddingBottomRight: [40, 40] }
  const sheetOpen = state.selected || state.route.open || state.draft
  return { paddingTopLeft: [20, 100], paddingBottomRight: [20, sheetOpen ? Math.round(window.innerHeight * 0.45) : 20] }
}

function zoomClass() {
  const z = map.getZoom()
  // 20 级（放大超过原生瓦片）按 19 级显示标签
  for (let k = 16; k <= 19; k++) el.value!.classList.toggle(`z${k}`, k === Math.min(19, z))
}

onMounted(() => {
  const outline = L.latLngBounds(PAINTED_OUTLINE.map(toLatLng))
  map = L.map(el.value!, {
    crs: BaiduCRS,
    zoomControl: false,
    attributionControl: false,
    // 再往外缩只剩空白
    minZoom: 16,
    maxZoom: 20,
    // 只用整数缩放：小数缩放时瓦片之间会有细缝
    zoomSnap: 1,
    // 留足余量：边上的地方（比如西门）也能拖到侧栏/底部面板外面
    maxBounds: outline.pad(0.5),
    maxBoundsViscosity: 1,
  })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  L.control.attribution({ prefix: false, position: 'bottomright' }).addAttribution('底图 © 上海科技大学校园地图 · 部分道路 © OpenStreetMap contributors').addTo(map)
  baiduTiles({ minZoom: 14, maxZoom: 20, maxNativeZoom: 19, keepBuffer: 4, bounds: outline.pad(0.1), errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }).addTo(map)
  const extras = L.layerGroup().addTo(map)
  drawConstruction(extras)
  ;[buildingLayer, labelLayer, entranceLayer, routeLayer, poiLayer].forEach((l) => l.addTo(map))
  drawBuildings()
  drawLabels()
  drawPois()
  map.fitBounds(L.latLngBounds((state.campus?.boundary ?? PAINTED_OUTLINE).map(toLatLng)), { ...padding(), maxZoom: 17 })
  zoomClass()
  map.on('zoomend', zoomClass)
  map.on('click', (e: L.LeafletMouseEvent) => {
    const pos: LngLat = fromLatLng(e.latlng)
    if (state.placing) newDraft(pos)
    else if (state.route.picking) setEnd(state.route.picking, { name: '地图上的点', point: pos })
    else select(null)
  })
  if (import.meta.env.DEV) (window as unknown as { __map: L.Map }).__map = map
})
onBeforeUnmount(() => map?.remove())

watch(() => state.selected, () => {
  for (const b of state.buildings) polys.get(b.id)?.setStyle(styleFor(b))
  drawLabels()
  drawPois()
  drawEntrances()
})
watch(() => [state.pois, state.editing, state.draft?.id, state.draft?.pos], drawPois, { deep: true })
watch(() => state.route.result, drawRoute)
watch(() => state.route.rain, () => state.buildings.forEach((b) => b.walkway && polys.get(b.id)?.setStyle(styleFor(b))))
watch(() => state.showRoads, toggleRoads)
// 不用 :class 绑定：Vue 会整个覆盖 className，把 Leaflet 加在容器上的 class 冲掉
watch(() => !!(state.route.picking || state.placing), (on) => el.value?.classList.toggle('picking', on))
watch(() => state.flyTo, (f) => {
  if (!f) return
  if (f.poly && f.poly.length > 1) map.flyToBounds(L.latLngBounds(f.poly.map(toLatLng)), { ...padding(), maxZoom: 18, duration: 0.6 })
  else map.flyTo(toLatLng(f.pos), Math.max(map.getZoom(), 18), { duration: 0.6 })
})
</script>

<template>
  <div ref="el" class="map" />
</template>

<style>
.map { position: absolute; inset: 0; background: #f4f2ec; font: inherit; }
.map.picking, .map.picking .leaflet-interactive { cursor: crosshair; }
.leaflet-marker-icon { background: none; border: 0; }
.leaflet-control-attribution { font-size: 10px; }

/* 楼名：缩小时只留大门、食堂、风雨长廊 */
.blabel {
  position: absolute; transform: translate(-50%, -50%); white-space: nowrap; cursor: pointer;
  padding: 1px 6px; border-radius: 6px; background: #fffffff0; box-shadow: 0 1px 3px #0000001f;
  border-left: 3px solid var(--c); color: #303b36; font-size: 11px; font-weight: 600; line-height: 16px;
}
.blabel.walkway { background: var(--c); color: #fff; border-left-color: #fff8; }
.blabel.sel { background: #a8242b; color: #fff; border-left-color: #fff; z-index: 5; }
.map.z16 .blabel:not(.major):not(.sel) { display: none; }

/* 点位：圆形图标，放大到 18 级才显示名字 */
.pmark {
  position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 4px; white-space: nowrap;
  padding: 2px; border-radius: 999px; background: #fff; box-shadow: 0 1px 4px #0000004d; font-size: 11px; font-weight: 600; cursor: pointer;
}
.pmark i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--c); font-style: normal; font-size: 11px; }
.pmark span { display: none; padding-right: 6px; }
.map.z18 .pmark span, .map.z19 .pmark span, .pmark.sel span, .pmark.draft span { display: inline; }
.map.z16 .pmark:not(.sel) { display: none; }
.pmark.sel { outline: 2.5px solid #a8242b; }
.pmark.editable { outline: 2px dashed #2f6fd6; cursor: grab; }
.pmark.draft { outline: 2.5px solid #2f6fd6; }
.pmark.draft i { background: #2f6fd6; color: #fff; }

.emark { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 2px; white-space: nowrap; padding: 1px 6px 1px 3px; border-radius: 999px; background: #fff; font-size: 11px; font-weight: 700; box-shadow: 0 1px 4px #0000004d; }
.rend { position: absolute; transform: translate(-50%, -95%); font-size: 30px; filter: drop-shadow(0 2px 2px #0000004d); }
</style>
