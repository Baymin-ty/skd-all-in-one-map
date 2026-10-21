<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clampToOutline, fillZoom, fromLatLng, limitPan, PAINTED_OUTLINE, toLatLng } from '../lib/geo'
import { createCampusMap } from '../lib/campusMap'
import { createMapOpacity } from '../lib/mapOpacity'
import { buildingOutline } from '../lib/buildingOutline'
import { groupBuildings } from '../lib/groups'
import { buildingLabelCategory, mapLabelColor, poiLabelCategory } from '../lib/mapLabelCategories'
import { labelFits, labelsOverlap, type LabelRect } from '../lib/mapLabels'
import { ICONS } from '../lib/icons'
import type { Building, LngLat, Poi } from '../lib/types'
import { admin, assets, canRedo, canUndo, category, changeGeometry, deleteVertex, draftOutline, filtered, mapControl, mapPick, moveEntrance, redoGeometry, removeEntrance, selectAsset, setPosition, undoGeometry, type Asset } from './store'
import { outlineLatLngs, outlinePoints, outlineRings } from '../lib/outlineGeometry'
import Ico from '../components/Ico.vue'

const el = ref<HTMLDivElement>()
const zoom = ref(17), minZoom = ref(15)
const editing = computed(() => !!admin.draft)
const drawing = computed(() => ['position', 'polygon', 'entrance'].includes(admin.mode))
const draftEntrances = computed(() => admin.draft?.kind === 'building' ? ((admin.draft.data as Building).entrances ?? []) : [])
const SNAP_DISTANCE = 26
const snapLayer = L.layerGroup()
const objects = L.layerGroup(), drafts = L.layerGroup()
let map: L.Map, resize: ResizeObserver, opacity: ReturnType<typeof createMapOpacity>
let keepInside = () => {}, hovered = '', layoutFrame = 0
const polygons = new Map<string, L.Polygon>()
function styleFor(id: string) {
  return buildingOutline(isSelected(id), hovered === id, admin.mapSettings)
}
const expandedGroups = new Set<string>()
const labelNodes: { node: HTMLElement; priority: number }[] = []
const isSelected = (id: string) => admin.draft?.kind === 'building' ? (admin.draft.data.id || '__draft__') === id : admin.selected?.kind === 'building' && admin.selected.data.id === id
function updateOpacity() {
  if (!opacity) return
  const settings = admin.mapSettings
  const filteredIds = new Set(filtered.value.map((a) => a.data.id))
  const filtering = !!(admin.search || admin.category || admin.kind)
  opacity.update((b) => isSelected(b.id) || b.id === hovered ? settings.selected
    : filtering && !editing.value && !filteredIds.has(b.id) ? settings.selectable * 0.45 : settings.selectable, settings.background)
}
function syncGeometry() {
  if (!opacity) return
  const buildings = admin.places.buildings.filter((b) => !(admin.draft?.kind === 'building' && admin.draft.data.id === b.id))
  if (admin.draft?.kind === 'building') buildings.push({ ...admin.draft.data as Building, id: admin.draft.data.id || '__draft__' })
  opacity.setBuildings(buildings)
  updateOpacity()
}
function hover(id: string) {
  if (editing.value || hovered === id) return
  hovered = id
  for (const [key, polygon] of polygons) polygon.setStyle(styleFor(key))
  updateOpacity()
}
function layoutLabels() {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(() => {
    if (!el.value) return
    const viewport = el.value.getBoundingClientRect()
    const bounds: LabelRect = { left: viewport.left + 8, right: viewport.right - 8, top: viewport.top + 60, bottom: viewport.bottom - 45 }
    const occupied: LabelRect[] = [...el.value.parentElement!.querySelectorAll<HTMLElement>('.map-legend, .admin-map-tools, .map-context, .map-instruction, .map-history')]
      .filter((node) => node.offsetWidth > 0).map((node) => node.getBoundingClientRect())
    for (const { node, priority } of [...labelNodes].sort((a, b) => b.priority - a.priority)) {
      node.style.visibility = ''
      const rect = node.getBoundingClientRect()
      if (priority < 140 && (!labelFits(rect, bounds) || occupied.some((other) => labelsOverlap(rect, other)))) node.style.visibility = 'hidden'
      else occupied.push(rect)
    }
  })
}
function label(pos: LngLat, html: string, title: string, priority: number, choose: () => void, id = '') {
  const marker = L.marker(toLatLng(pos), {
    title, icon: L.divIcon({ className: '', html, iconSize: [0, 0] }), keyboard: true, bubblingMouseEvents: false,
    zIndexOffset: priority * 10,
  }).on('click', choose).on('mouseover', () => hover(id)).on('mouseout', () => hover('')).addTo(objects)
  const node = marker.getElement()?.firstElementChild as HTMLElement | null
  if (node) labelNodes.push({ node, priority })
}
function limitZoomOut() {
  if (!map || !admin.campus) return
  map.setMinZoom(fillZoom(map, L.latLngBounds(admin.campus.boundary.map(toLatLng)), map.getSize(), 15, 17))
  minZoom.value = map.getMinZoom()
}
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const valid = (p: LngLat) => p.every(Number.isFinite)
function projectOnSegment(p: L.Point, a: L.Point, b: L.Point) {
  const dx = b.x - a.x, dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
  return L.point(a.x + t * dx, a.y + t * dy)
}
/** 标注入口时，把点吸到建筑轮廓的最近的边上，门就正好落在墙上 */
function snapEntrance(latlng: L.LatLng) {
  const b = admin.draft?.kind === 'building' ? admin.draft.data as Building : null
  if (!b || !map) return { pos: fromLatLng(latlng), snapped: false }
  const point = map.latLngToContainerPoint(latlng)
  let best: { point: L.Point; distance: number } | null = null
  for (const ring of outlineRings(b)) {
    for (let i = 0; i < ring.length; i++) {
      const a = map.latLngToContainerPoint(toLatLng(ring[i]))
      const b2 = map.latLngToContainerPoint(toLatLng(ring[(i + 1) % ring.length]))
      const projected = projectOnSegment(point, a, b2)
      const distance = point.distanceTo(projected)
      if (!best || distance < best.distance) best = { point: projected, distance }
    }
  }
  if (!best || best.distance > SNAP_DISTANCE) return { pos: fromLatLng(latlng), snapped: false }
  return { pos: fromLatLng(map.containerPointToLatLng(best.point)), snapped: true }
}
let snapMarker: L.Marker | null = null
function drawSnapPreview(latlng: L.LatLng | null) {
  if (!latlng || !map || admin.mode !== 'entrance' || admin.saving) {
    snapMarker?.remove(); snapMarker = null
    return
  }
  const { pos, snapped } = snapEntrance(latlng)
  if (!snapMarker) {
    snapMarker = L.marker(toLatLng(pos), {
      interactive: false, keyboard: false, zIndexOffset: 1200,
      icon: L.divIcon({ className: 'entrance-snap', html: '<span></span>', iconSize: [0, 0] }),
    }).addTo(snapLayer)
  } else snapMarker.setLatLng(toLatLng(pos))
  snapMarker.getElement()?.classList.toggle('snapped', snapped)
}
function focus(a: Asset) {
  if (!map) return
  map.stop(); map.invalidateSize({ pan: false })
  if (a.kind === 'building') {
    const b = a.data as Building
    if (b.poly.length) map.fitBounds(L.latLngBounds(outlinePoints(b).map(toLatLng)), { padding: [60, 65], maxZoom: 20, animate: false })
  } else if (valid((a.data as Poi).pos)) map.setView(toLatLng((a.data as Poi).pos), 19, { animate: false })
}
function home() {
  if (map && admin.campus) map.fitBounds(L.latLngBounds(admin.campus.boundary.map(toLatLng)), { padding: [24, 24], maxZoom: 17 })
}
function choose(a: Asset) { if (!editing.value) selectAsset(a) }
function draw() {
  if (!map) return
  objects.clearLayers(); polygons.clear(); labelNodes.length = 0; hovered = ''
  const visible = editing.value ? assets.value : [...filtered.value]
  if (!editing.value && admin.selected && !visible.some((a) => a.kind === admin.selected!.kind && a.data.id === admin.selected!.data.id)) visible.push(admin.selected)
  const visibleBuildings = visible.filter((a) => a.kind === 'building').map((a) => a.data as Building)
  const groups = groupBuildings(visibleBuildings)
  const grouped = new Set(groups.filter((g) => zoom.value < 19 && !expandedGroups.has(g.id)).flatMap((g) => g.members))
  for (const a of visible) {
    const selected = admin.selected?.kind === a.kind && admin.selected?.data.id === a.data.id
    if ((!selected && (a.kind === 'building' && !admin.showBuildings || a.kind === 'poi' && !admin.showPois)) || (editing.value && a.kind === 'poi') || (a.kind === admin.draft?.kind && a.data.id === admin.draft?.data.id)) continue
    const c = category(a)
    if (a.kind === 'building') {
      const b = a.data as Building
      const polygon = L.polygon(outlineLatLngs(b), {
        ...(editing.value ? buildingOutline(false, false, admin.mapSettings) : styleFor(b.id)),
        smoothFactor: 0, className: 'building-outline',
        interactive: !editing.value, bubblingMouseEvents: false,
      }).on('click', () => choose(a)).on('mouseover', () => hover(b.id)).on('mouseout', () => hover('')).addTo(objects)
      polygons.set(b.id, polygon)
      if (!editing.value && admin.labels && (selected || !grouped.has(b.id))) {
        label(b.center, `<span class="blabel ${selected ? 'sel' : ''}" style="--c:${mapLabelColor(buildingLabelCategory(b))}">${ICONS[c.icon]}<span>${escape(b.short.zh || b.name.zh)}</span></span>`,
          b.name.zh, selected ? 140 : b.cat === 'gate' ? 85 : b.cat === 'dining' ? 80 : 65, () => choose(a), b.id)
      }
    } else {
      const p = a.data as Poi
      label(p.pos, `<span class="pmark ${selected ? 'sel' : zoom.value < 19 || !admin.labels ? 'icon-only' : ''}" style="--c:${mapLabelColor(poiLabelCategory(p))}"><i>${ICONS[c.icon]}</i><span>${escape(p.name.zh)}</span></span>`,
        p.name.zh, selected ? 140 : 40, () => choose(a))
    }
  }
  if (!editing.value && admin.labels && admin.showBuildings && zoom.value < 19) for (const g of groups) {
    if (expandedGroups.has(g.id)) continue
    label(g.center, `<span class="blabel group" style="--c:${mapLabelColor(g.cat)}">${ICONS[g.cat]}<span>${escape(g.name.zh)}</span><em>${g.members.length} 栋</em></span>`,
      `${g.name.zh} · 点击展开`, 88, () => {
        expandedGroups.add(g.id)
        map.fitBounds(L.latLngBounds(g.points.map(toLatLng)), { padding: [50, 60], maxZoom: 19 })
        draw()
      })
  }
  if (!editing.value && admin.selected?.kind === 'building') {
    for (const [i, entrance] of ((admin.selected.data as Building).entrances ?? []).entries()) L.marker(toLatLng(entrance.pos), {
      interactive: false,
      icon: L.divIcon({ className: 'admin-entrance', html: `<span class="entrance-badge">${i + 1}</span><span class="entrance-name">${escape(entrance.zh || `入口 ${i + 1}`)}</span>`, iconSize: [0, 0] }),
      title: entrance.zh || `入口 ${i + 1}`,
    }).addTo(objects)
  }
  updateOpacity(); layoutLabels()
}
function drawDraft() {
  drafts.clearLayers()
  const d = admin.draft
  if (!d || !map) return
  if (d.kind === 'poi') {
    const p = d.data as Poi
    if (!admin.positionSet || !valid(p.pos)) return
    const marker = L.marker(toLatLng(p.pos), {
      title: '拖动调整点位位置', draggable: !admin.saving,
      icon: L.divIcon({ className: 'admin-pin-host', html: `<span class="admin-map-pin draft">${ICONS.pin}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
    }).addTo(drafts)
    marker.on('dragend', () => setPosition(fromLatLng(marker.getLatLng())))
    return
  }
  const b = d.data as Building
  const ring = draftOutline.value
  for (const [index, other] of outlineRings(b).entries()) if (index !== admin.outlinePart)
    L.polygon(other.map(toLatLng), { smoothFactor: 0, color: '#a8242b', weight: 1.5, dashArray: '4 3', fillOpacity: 0, interactive: false }).addTo(drafts)
  const shape = L.polygon(ring.map(toLatLng), { smoothFactor: 0, color: '#a8242b', weight: 2.5, fillColor: '#a8242b', fillOpacity: 0.06, interactive: false }).addTo(drafts)
  if (admin.mode === 'vertices' || admin.mode === 'polygon') {
    ring.forEach((p, i) => {
      const marker = L.marker(toLatLng(p), {
        title: `轮廓顶点 ${i + 1}`, draggable: !admin.saving,
        icon: L.divIcon({ className: 'vertex-hit', html: `<span class="vertex-dot ${admin.selectedVertex === i ? 'active' : ''}"></span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(drafts)
      marker.on('drag', () => shape.setLatLngs(ring.map((point, j) => j === i ? marker.getLatLng() : toLatLng(point))))
      marker.on('dragend', () => changeGeometry(() => ring[i] = fromLatLng(marker.getLatLng())))
      marker.on('click', () => {
        if (i === 0 && admin.mode === 'polygon' && ring.length >= 3) admin.mode = 'vertices'
        else admin.selectedVertex = i
      })
      if (admin.mode === 'vertices' && ring.length >= 3) {
        const next = ring[(i + 1) % ring.length]
        const middle: LngLat = [+(0.5 * (p[0] + next[0])).toFixed(6), +(0.5 * (p[1] + next[1])).toFixed(6)]
        L.marker(toLatLng(middle), {
          title: `在第 ${i + 1} 条边上添加顶点`,
          icon: L.divIcon({ className: 'vertex-hit midpoint', html: '<span class="vertex-dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        }).on('click', () => { changeGeometry(() => ring.splice(i + 1, 0, middle)); admin.selectedVertex = i + 1 }).addTo(drafts)
      }
    })
  }
  for (const [i, entrance] of (b.entrances ?? []).entries()) {
    const name = entrance.zh || `入口 ${i + 1}`
    const marker = L.marker(toLatLng(entrance.pos), {
      title: name,
      draggable: !admin.saving && admin.mode !== 'entrance' && admin.mode !== 'polygon',
      interactive: admin.mode !== 'entrance',
      bubblingMouseEvents: false,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: `admin-entrance${admin.selectedEntrance === i ? ' active' : ''}${admin.entranceTarget === i ? ' targeting' : ''}`,
        html: `<span class="entrance-badge">${i + 1}</span><span class="entrance-name">${escape(name)}</span>`,
        iconSize: [0, 0],
      }),
    }).addTo(drafts)
    marker.on('click', () => { admin.selectedEntrance = i })
    marker.on('dragstart', () => { admin.selectedEntrance = i })
    marker.on('dragend', () => moveEntrance(i, fromLatLng(marker.getLatLng())))
  }
  if (valid(b.center)) L.marker(toLatLng(b.center), {
    icon: L.divIcon({ className: 'admin-label-host', html: `<span class="blabel sel" style="--c:${category(d).color}">${ICONS[category(d).icon]}<span>${escape(b.short.zh || b.name.zh || '新建筑')}</span></span>`, iconSize: [0, 0] }),
    interactive: false, keyboard: false,
  }).addTo(drafts)
}
function finish() {
  admin.selectedVertex = null
  admin.entranceTarget = null
  admin.mode = admin.mode === 'polygon' ? 'vertices' : ''
}
onMounted(() => {
  map = createCampusMap(el.value!, admin.campus!, { maxZoom: Infinity })
  limitZoomOut()
  keepInside = limitPan(map, (center, z) => {
    const size = map.getSize()
    return clampToOutline(center, PAINTED_OUTLINE.map((p) => map.project(toLatLng(p), z)), size.x / 2, size.y / 2)
  })
  L.control.attribution({ prefix: false }).addAttribution('底图 © 上海科技大学校园地图').addTo(map)
  objects.addTo(map); drafts.addTo(map); snapLayer.addTo(map)
  home()
  opacity = createMapOpacity(map, admin.places.buildings)
  syncGeometry()
  if (admin.draft?.data.id) focus(admin.draft)
  else if (admin.selected) focus(admin.selected)
  zoom.value = map.getZoom(); draw(); drawDraft()
  if (drawing.value) map.doubleClickZoom.disable()
  map.on('click', (e: L.LeafletMouseEvent) => {
    const picked = admin.mode === 'entrance' ? snapEntrance(e.latlng).pos : fromLatLng(e.latlng)
    mapPick(picked)
    if (admin.mode === 'vertices') admin.selectedVertex = null
    drawSnapPreview(e.latlng)
  })
  map.on('mousemove', (e: L.LeafletMouseEvent) => drawSnapPreview(e.latlng))
  map.on('mouseout', () => drawSnapPreview(null))
  map.on('zoomend', () => { zoom.value = map.getZoom(); draw() })
  map.on('moveend', layoutLabels)
  map.on('movestart', () => hover(''))
  mapControl.focus = focus; mapControl.home = home
  mapControl.focusEntrance = (pos) => map.flyTo(toLatLng(pos), Math.max(map.getZoom(), 19), { duration: 0.45 })
  resize = new ResizeObserver(() => { map.invalidateSize({ pan: false }); limitZoomOut(); keepInside(); layoutLabels() }); resize.observe(el.value!)
})
watch(() => [filtered.value, admin.showBuildings, admin.showPois, admin.labels, admin.selected, editing.value], draw, { deep: true })
watch(() => [admin.draft, admin.saving, admin.mode, admin.selectedVertex, admin.positionSet, admin.outlinePart, admin.selectedEntrance, admin.entranceTarget], drawDraft, { deep: true })
watch(() => [admin.places.buildings, admin.draft, admin.campus], syncGeometry, { deep: true })
watch(() => admin.mapSettings, () => { updateOpacity(); draw() }, { deep: true })
watch(drawing, (on) => { if (map) on ? map.doubleClickZoom.disable() : map.doubleClickZoom.enable() })
watch(() => admin.mode, (mode) => { if (mode !== 'entrance') drawSnapPreview(null) })
watch(() => admin.draftVersion, () => { if (map && admin.draft?.data.id) focus(admin.draft) })
onBeforeUnmount(() => { cancelAnimationFrame(layoutFrame); resize?.disconnect(); mapControl.focus = () => {}; mapControl.home = () => {}; mapControl.focusEntrance = () => {}; snapMarker = null; map?.remove() })
</script>

<template>
  <div class="admin-map-wrap" :class="{ picking: drawing }">
    <div ref="el" class="admin-map campus-map" aria-label="校园资产管理地图" />
    <div v-if="!editing" class="map-context"><Ico name="pin" /><span>{{ admin.selected ? '已定位到所选地点 · 右侧查看详情' : '点击地图或左侧目录，选择要编辑的地点' }}</span></div>
    <div v-else-if="!admin.mode" class="map-context"><Ico name="edit" /><span>{{ admin.draft?.kind === 'poi' ? '拖动标记调整位置，完成后点击保存' : '在右侧调整轮廓，或标注出入口（可连续点击添加）' }}</span></div>
    <div v-if="admin.mode" class="map-instruction" role="status">
      <span v-if="admin.mode === 'polygon'">点击地图画轮廓 · {{ draftOutline.length }} 个点</span>
      <span v-else-if="admin.mode === 'vertices'">{{ admin.selectedVertex !== null ? `已选中第 ${admin.selectedVertex + 1} 个点` : '拖动白点调整轮廓' }}</span>
      <span v-else-if="admin.mode === 'entrance'">
        <template v-if="admin.entranceTarget !== null">点击新位置，移动第 {{ admin.entranceTarget + 1 }} 个入口</template>
        <template v-else>点击楼门位置连续添加 · 已有 {{ draftEntrances.length }} 个</template>
      </span>
      <span v-else>点击地图选择位置</span>
      <button v-if="admin.mode === 'vertices' && admin.selectedVertex !== null" class="delete-point" :disabled="admin.saving || draftOutline.length <= 3" @click="deleteVertex">删除顶点</button>
      <button v-if="admin.mode === 'entrance' && admin.entranceTarget === null && draftEntrances.length" class="delete-point" :disabled="admin.saving" title="删除上一个入口（可撤销）" @click="removeEntrance(draftEntrances.length - 1)">撤销上一个</button>
      <button :disabled="admin.saving || (admin.mode === 'polygon' && draftOutline.length < 3)" @click="finish">{{ admin.mode === 'polygon' ? '完成绘制' : admin.mode === 'vertices' ? '完成调整' : admin.mode === 'entrance' ? '完成标注' : '取消' }}</button>
    </div>
    <div v-if="editing" class="map-history" aria-label="地图操作历史"><button :disabled="!canUndo" title="撤销地图操作（⌘ / Ctrl Z）" @click="undoGeometry"><Ico name="undo" />撤销</button><button :disabled="!canRedo" title="重做地图操作（⌘ / Ctrl Shift Z）" @click="redoGeometry"><Ico name="redo" />重做</button></div>
    <div class="admin-map-tools">
      <button title="全校视野" aria-label="全校视野" @click="home"><Ico name="home" /></button>
      <button v-if="admin.selected || (admin.draft && (admin.positionSet || draftOutline.length >= 3))" title="定位当前地点" aria-label="定位当前地点" @click="focus((admin.draft || admin.selected)!)"><Ico name="target" /></button>
      <button title="放大" aria-label="放大" :disabled="zoom >= 20" @click="map.zoomIn()"><Ico name="plus" /></button>
      <button title="缩小" aria-label="缩小" :disabled="zoom <= minZoom" @click="map.zoomOut()"><Ico name="minus" /></button>
    </div>
    <div v-if="!editing" class="map-legend"><Ico name="eye" /><label><input v-model="admin.showBuildings" type="checkbox" />建筑</label><label><input v-model="admin.showPois" type="checkbox" />点位</label><label><input v-model="admin.labels" type="checkbox" />名称</label></div>
  </div>
</template>
