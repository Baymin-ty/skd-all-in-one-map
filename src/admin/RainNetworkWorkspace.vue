<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { SurfaceGrid } from '../lib/network'
import { createCampusMap } from '../lib/campusMap'
import { admin } from './store'
import { discardRain, loadRain, paint, rain, rainCanRedo, rainCanUndo, rainDirty, redoRain, saveRain, undoRain } from './rainStore'
const mapEl = ref<HTMLDivElement>()
const tool = ref<'walk' | 'erase' | 'pan'>('walk')
const drawing = ref(false)
let map: L.Map | null = null
let gridLayer: L.Layer | null = null
const grid = computed(() => rain.grid)

function cellOf(g: SurfaceGrid, latlng: L.LatLng) {
  return {
    row: Math.floor((g.y0 - latlng.lat) / g.dy),
    col: Math.floor((latlng.lng - g.x0) / g.dx),
  }
}

// 只保存 getter，不保存栅格快照：paint/undo/redo/discard 都会整体替换 rain.grid，存快照会一直画旧对象。
const RainGridLayer = L.Layer.extend({
  initialize(getGrid: () => SurfaceGrid | null) { this._getGrid = getGrid },
  onAdd(m: L.Map) {
    this._map = m
    const canvas = L.DomUtil.create('canvas', 'rain-grid-canvas') as HTMLCanvasElement
    this._canvas = canvas
    m.getPane('overlayPane')?.appendChild(canvas)
    this._update = () => this._draw()
    m.on('moveend zoomend resize viewreset', this._update)
    this._draw()
  },
  onRemove(m: L.Map) {
    m.off('moveend zoomend resize viewreset', this._update)
    L.DomUtil.remove(this._canvas)
  },
  redraw() { this._draw() },
  _draw() {
    const m = this._map as L.Map
    const g = this._getGrid() as SurfaceGrid | null
    const c = this._canvas as HTMLCanvasElement
    if (!m || !c || !g || !g.rows.length || !g.rows[0].length) return
    const ctx = c.getContext('2d')!
    const size = m.getSize()
    const dpr = window.devicePixelRatio || 1
    c.width = size.x * dpr; c.height = size.y * dpr
    c.style.width = size.x + 'px'; c.style.height = size.y + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 绘制用的是容器坐标，因此把 canvas 原点钉在同一时刻的图层原点，之后随 pane 刚性平移/缩放都保持对齐。
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]))
    ctx.clearRect(0, 0, size.x, size.y)

    const b = m.getBounds()
    const minRow = Math.max(0, Math.floor((g.y0 - b.getNorth()) / g.dy))
    const maxRow = Math.min(g.rows.length - 1, Math.floor((g.y0 - b.getSouth()) / g.dy))
    const minCol = Math.max(0, Math.floor((b.getWest() - g.x0) / g.dx))
    const maxCol = Math.min(g.rows[0].length - 1, Math.floor((b.getEast() - g.x0) / g.dx))

    for (let r = minRow; r <= maxRow; r++) {
      for (let col = minCol; col <= maxCol; col++) {
        const walk = g.rows[r][col] === '0' || g.rows[r][col] === '2'
        ctx.fillStyle = walk ? 'rgba(79,139,255,0.65)' : 'rgba(200,210,220,0.35)'
        const nw = m.latLngToContainerPoint(L.latLng(g.y0 - r * g.dy, g.x0 + col * g.dx))
        const ne = m.latLngToContainerPoint(L.latLng(g.y0 - r * g.dy, g.x0 + (col + 1) * g.dx))
        const sw = m.latLngToContainerPoint(L.latLng(g.y0 - (r + 1) * g.dy, g.x0 + col * g.dx))
        const se = m.latLngToContainerPoint(L.latLng(g.y0 - (r + 1) * g.dy, g.x0 + (col + 1) * g.dx))
        ctx.beginPath()
        ctx.moveTo(nw.x, nw.y); ctx.lineTo(ne.x, ne.y)
        ctx.lineTo(se.x, se.y); ctx.lineTo(sw.x, sw.y)
        ctx.closePath(); ctx.fill()
      }
    }
  },
})

function paintAt(latlng: L.LatLng) {
  const g = grid.value
  if (!g) return
  const { row, col } = cellOf(g, latlng)
  paint(row, col, tool.value === 'walk', rain.brushSize)
}

/** 工具决定拖拽手势归谁：平移给地图，画笔/擦除给画布（同时禁掉框选缩放和触屏滚动页面的 touch-action）。 */
function applyToolMode() {
  const m = map, el = mapEl.value
  if (!m || !el) return
  if (tool.value === 'pan') { m.dragging.enable(); m.boxZoom.enable(); m.doubleClickZoom.enable(); el.style.touchAction = '' }
  else { m.dragging.disable(); m.boxZoom.disable(); m.doubleClickZoom.disable(); el.style.touchAction = 'none' }
}

function onPointerDown(e: Event) {
  if (!map || tool.value === 'pan') return
  L.DomEvent.stop(e)
  drawing.value = true
  paintAt(map.mouseEventToLatLng(e as PointerEvent))
  mapEl.value?.setPointerCapture((e as PointerEvent).pointerId)
}
function onPointerMove(e: Event) {
  if (!drawing.value || !map || tool.value === 'pan') return
  L.DomEvent.stop(e)
  paintAt(map.mouseEventToLatLng(e as PointerEvent))
}
function onPointerUp() { drawing.value = false }

function discard() { if (!rainDirty.value || confirm('放弃当前未保存的避雨路网修改？')) discardRain() }

onMounted(async () => {
  await loadRain()
  const cm = rain.campus, g = rain.grid, el = mapEl.value
  if (!cm || !g || !el) return
  map = createCampusMap(el, cm, { maxZoom: 20, zoomAnimation: false })
  const south = g.y0 - g.rows.length * g.dy, north = g.y0, west = g.x0, east = g.x0 + g.rows[0].length * g.dx
  map.fitBounds(L.latLngBounds([[south, west], [north, east]]), { animate: false })
  gridLayer = new (RainGridLayer as any)(() => rain.grid).addTo(map)
  applyToolMode()
  L.DomEvent.on(el, 'pointerdown', onPointerDown)
  L.DomEvent.on(el, 'pointermove', onPointerMove)
  L.DomEvent.on(el, 'pointerup pointercancel', onPointerUp)
})
onBeforeUnmount(() => {
  if (map && mapEl.value) {
    L.DomEvent.off(mapEl.value, 'pointerdown', onPointerDown)
    L.DomEvent.off(mapEl.value, 'pointermove', onPointerMove)
    L.DomEvent.off(mapEl.value, 'pointerup pointercancel', onPointerUp)
    mapEl.value.style.touchAction = ''
    map.remove(); map = null; gridLayer = null
  }
})
watch(tool, applyToolMode)
watch(grid, () => (gridLayer as any)?.redraw?.(), { deep: true })
</script>
<template>
  <section class="rain-workspace">
    <div class="rain-toolbar"><div><h2>避雨地面路网</h2><p>在普通路网副本上标记雨天可走区域；蓝色为可走，灰色为不可走。</p></div><span v-if="rainDirty" class="dirty">有未保存修改</span></div>
    <div v-if="rain.error" class="editor-error">{{ rain.error }}</div>
    <div v-if="rain.loading" class="empty-state">正在加载路网…</div>
    <template v-else-if="grid">
      <div class="rain-actions"><button class="button" :class="{ primary: tool === 'walk' }" @click="tool = 'walk'">画笔 · 可走</button><button class="button" :class="{ primary: tool === 'erase' }" @click="tool = 'erase'">擦除 · 不可走</button><button class="button" :class="{ primary: tool === 'pan' }" @click="tool = 'pan'">平移地图</button><button class="button secondary" :disabled="!rainCanUndo" @click="undoRain">撤销</button><button class="button secondary" :disabled="!rainCanRedo" @click="redoRain">重做</button><button class="button secondary" @click="discard">放弃修改</button><button class="button primary" :disabled="!rainDirty || rain.saving || !admin.loggedIn" @click="saveRain">{{ rain.saving ? (rain.attempt > 1 ? '重试中…' : '保存中…') : '保存避雨版本' }}</button><span class="brush-divider" /><span class="brush-label">画笔</span><button v-for="s in [1,3,5,7,9]" :key="s" class="button brush-size" :class="{ primary: rain.brushSize === s }" :title="`${s}×${s} 方格`" @click="rain.brushSize = s">{{ s }}×{{ s }}</button></div>
      <p class="rain-help">画笔/擦除模式下拖动鼠标或触控即连续涂格，画笔越大一次覆盖的格子越多；需要移动地图请点「平移地图」（滚轮和双指缩放始终可用）。当前版本独立保存，不会修改普通路网或地下路网。</p>
      <div ref="mapEl" class="canvas-wrap" :class="{ panning: tool === 'pan' }" /></template>
  </section>
</template>
<style scoped>
.rain-workspace { padding: 26px clamp(18px, 4vw, 54px); max-width: 1200px; margin: auto; }
.rain-toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }.rain-toolbar h2 { margin:0; }.rain-toolbar p,.rain-help { color:var(--ink-3); font-size:13px; }.dirty { color:#a35d16; font-weight:700; }
.rain-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:22px 0 8px; }.brush-divider { width:1px; height:22px; background:var(--line); margin:0 4px; }.brush-label { color:var(--ink-3); font-size:13px; margin-left:4px; }.brush-size { padding:6px 10px; font-size:13px; }
.canvas-wrap { width:100%; aspect-ratio:250/172; max-height:70vh; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#f5f7f9; cursor:crosshair; }
.canvas-wrap.panning { cursor:grab; }
.canvas-wrap.panning:active { cursor:grabbing; }
</style>
<style>
/* 位置由 L.DomUtil.setPosition 用 transform 写在图层坐标系上，这里只负责不拦截指针事件。 */
.rain-grid-canvas { position:absolute; pointer-events:none; z-index:300; }
</style>
