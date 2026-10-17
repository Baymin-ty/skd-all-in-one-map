<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCampusMap } from '../lib/campusMap'
import { toLatLng } from '../lib/geo'
import { createMapOpacity } from '../lib/mapOpacity'
import { buildingOutline } from '../lib/buildingOutline'
import { outlineLatLngs } from '../lib/outlineGeometry'
import type { MapSettings } from '../lib/mapSettings'
import { admin, category } from './store'
import { ICONS } from '../lib/icons'

const props = defineProps<{ settings: MapSettings }>()
const el = ref<HTMLDivElement>()
const selected = ref(admin.places.buildings.find((b) => b.short.zh === '图书馆')?.id ?? admin.places.buildings[0]?.id ?? '')
const hovered = ref('')
let map: L.Map, resize: ResizeObserver, opacity: ReturnType<typeof createMapOpacity>
const labels = new Map<string, HTMLElement>()
const outlines = new Map<string, L.Polygon>()
function update() {
  if (!opacity) return
  opacity.update((b) => b.id === selected.value || b.id === hovered.value ? props.settings.selected
    : props.settings.selectable, props.settings.background)
  for (const [id, polygon] of outlines)
    polygon.setStyle(buildingOutline(id === selected.value, id === hovered.value, props.settings))
  for (const [id, node] of labels) {
    node.classList.toggle('sel', id === selected.value)
  }
}
function home() {
  map.fitBounds(L.latLngBounds(admin.campus!.boundary.map(toLatLng)), { padding: [35, 35], maxZoom: 17 })
}
onMounted(() => {
  map = createCampusMap(el.value!, admin.campus!, { maxZoom: Infinity })
  map.setMaxBounds(L.latLngBounds(admin.campus!.bounds.map(toLatLng)).pad(0.4))
  const initial = admin.places.buildings.find((b) => b.id === selected.value)
  if (initial) map.setView(toLatLng(initial.center), 18)
  else home()
  opacity = createMapOpacity(map, [...admin.places.buildings, ...(admin.campus?.construction ?? []).map((c, i) => ({ ...c, id: `construction-${i}` }))])
  const samples = admin.places.buildings.filter((b) => ['图书馆', '教学中心', '行政中心', '体育馆'].includes(b.short.zh))
  for (const b of admin.places.buildings) {
    const choose = () => { selected.value = b.id }
    const hover = () => { hovered.value = b.id }
    const polygon = L.polygon(outlineLatLngs(b), {
      smoothFactor: 0,
      ...buildingOutline(b.id === selected.value, false, props.settings), className: 'building-outline', bubblingMouseEvents: false,
    })
      .on('click', choose).on('mouseover', hover).on('mouseout', () => hovered.value = '').addTo(map)
    outlines.set(b.id, polygon)
    if (samples.includes(b) || b.id === selected.value) {
      const node = document.createElement('span')
      const c = category({ kind: 'building', data: b })
      node.className = 'blabel'; node.style.setProperty('--c', c.color)
      node.innerHTML = ICONS[c.icon]
      const name = document.createElement('span'); name.textContent = b.short.zh || b.name.zh; node.append(name)
      labels.set(b.id, node)
      L.marker(toLatLng(b.center), { icon: L.divIcon({ className: '', html: node, iconSize: [0, 0] }), title: b.name.zh })
        .on('click', choose).on('mouseover', hover).on('mouseout', () => hovered.value = '').addTo(map)
    }
  }
  map.on('click', () => selected.value = '')
  L.control.zoom({ position: 'bottomright', zoomInTitle: '放大预览', zoomOutTitle: '缩小预览' }).addTo(map)
  L.control.attribution({ prefix: false }).addAttribution('底图 © 上海科技大学校园地图').addTo(map)
  resize = new ResizeObserver(() => map.invalidateSize()); resize.observe(el.value!)
  update()
})
watch(() => [props.settings, selected.value, hovered.value], update, { deep: true })
onBeforeUnmount(() => { resize?.disconnect(); map?.remove() })
</script>

<template>
  <div class="appearance-map-wrap">
    <div ref="el" class="appearance-map campus-map" role="application" aria-label="地图显示效果预览" />
    <button type="button" class="button secondary appearance-home" @click="home">全校视野</button>
    <div class="appearance-map-tip">悬停高亮 · 点击选中 · 拖动和缩放查看边缘</div>
  </div>
</template>

<style>
.appearance-map-wrap { position: relative; min-height: 510px; isolation: isolate; }
.appearance-map { position: absolute; inset: 0; background: #fbfaf7; font: inherit; }
.appearance-home { position: absolute; z-index: 500; top: 16px; right: 16px; }
.appearance-map-tip { position: absolute; z-index: 500; top: 16px; left: 16px; max-width: calc(100% - 130px); background: #ffffffed; border-radius: 6px; padding: 10px; font-size: 11px; pointer-events: none; }
.appearance-map .map-opacity-cutout { transition: fill 240ms ease-in-out; }
.appearance-map .building-outline { transition: stroke 240ms ease-in-out, stroke-opacity 240ms ease-in-out, stroke-width 240ms ease-in-out; }
.appearance-map .building-outline.leaflet-interactive { pointer-events: fill; }
@media (prefers-reduced-motion: reduce) { .appearance-map-label, .appearance-map .map-opacity-cutout, .appearance-map .building-outline { transition: none; } }
@media (max-width: 700px) { .appearance-map-wrap { min-height: 350px; } }
</style>
