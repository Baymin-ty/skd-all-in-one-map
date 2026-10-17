<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createCampusMap } from '../lib/campusMap'
import { admin } from './store'
import { discardRain, loadRain, paint, rain, rainCanRedo, rainCanUndo, rainDirty, redoRain, saveRain, undoRain } from './rainStore'
const canvas = ref<HTMLCanvasElement>()
const mapEl = ref<HTMLDivElement>()
const tool = ref<'walk' | 'erase'>('walk')
const drawing = ref(false)
const showBg = ref(true)
let map: L.Map | null = null
const grid = computed(() => rain.grid)
function render() {
  const c = canvas.value, g = grid.value
  if (!c || !g) return
  const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight
  c.width = w * dpr; c.height = h * dpr
  const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cw = w / g.rows[0].length, ch = h / g.rows.length
  ctx.clearRect(0, 0, w, h)
  if (!showBg.value) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
  for (let r = 0; r < g.rows.length; r++) for (let col = 0; col < g.rows[r].length; col++) {
    const walk = g.rows[r][col] === '0' || g.rows[r][col] === '2'
    ctx.fillStyle = walk ? (showBg.value ? 'rgba(79,139,255,0.65)' : '#4f8bff') : (showBg.value ? 'rgba(200,210,220,0.35)' : '#e8edf2')
    ctx.fillRect(col * cw, r * ch, Math.ceil(cw), Math.ceil(ch))
  }
}
function fitMap() {
  const g = rain.grid, cm = rain.campus, el = mapEl.value
  if (!g || !cm || !el || map) { map?.invalidateSize({ pan: false }); return }
  map = createCampusMap(el, cm, { maxZoom: 20 })
  map.dragging.disable(); map.scrollWheelZoom.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); map.keyboard.disable(); map.touchZoom.disable()
  const north = g.y0, south = g.y0 - g.rows.length * g.dy, west = g.x0, east = g.x0 + g.rows[0].length * g.dx
  map.fitBounds(L.latLngBounds([[south, west], [north, east]]), { animate: false, padding: [0, 0] })
}
function cell(e: PointerEvent) {
  const c = canvas.value, g = grid.value
  if (!c || !g) return
  const b = c.getBoundingClientRect()
  paint(Math.floor((e.clientY - b.top) / b.height * g.rows.length), Math.floor((e.clientX - b.left) / b.width * g.rows[0].length), tool.value === 'walk', rain.brushSize)
}
function down(e: PointerEvent) { drawing.value = true; canvas.value?.setPointerCapture(e.pointerId); cell(e) }
function move(e: PointerEvent) { if (drawing.value) cell(e) }
function up() { drawing.value = false }
function discard() { if (!rainDirty.value || confirm('放弃当前未保存的避雨路网修改？')) discardRain() }
function resize() { render(); map?.invalidateSize({ pan: false }) }
onMounted(async () => { await loadRain(); await nextTick(); render(); if (showBg.value) fitMap(); window.addEventListener('resize', resize) })
watch(showBg, (v) => { if (v) { nextTick(fitMap); render() } else { render() } })
onBeforeUnmount(() => window.removeEventListener('resize', resize))
watch(grid, render, { deep: true })
</script>
<template>
  <section class="rain-workspace">
    <div class="rain-toolbar"><div><h2>避雨地面路网</h2><p>在普通路网副本上标记雨天可走区域；蓝色为可走，灰色为不可走。</p></div><span v-if="rainDirty" class="dirty">有未保存修改</span></div>
    <div v-if="rain.error" class="editor-error">{{ rain.error }}</div>
    <div v-if="rain.loading" class="empty-state">正在加载路网…</div>
    <template v-else-if="grid">
      <div class="rain-actions"><button class="button" :class="{ primary: tool === 'walk' }" @click="tool = 'walk'">画笔 · 可走</button><button class="button" :class="{ primary: tool === 'erase' }" @click="tool = 'erase'">擦除 · 不可走</button><button class="button secondary" :disabled="!rainCanUndo" @click="undoRain">撤销</button><button class="button secondary" :disabled="!rainCanRedo" @click="redoRain">重做</button><button class="button secondary" @click="discard">放弃修改</button><button class="button primary" :disabled="!rainDirty || rain.saving || !admin.loggedIn" @click="saveRain">{{ rain.saving ? '保存中…' : '保存避雨版本' }}</button><span class="brush-divider" /><span class="brush-label">画笔</span><button v-for="s in [1,3,5,7,9]" :key="s" class="button brush-size" :class="{ primary: rain.brushSize === s }" :title="`${s}×${s} 方格`" @click="rain.brushSize = s">{{ s }}×{{ s }}</button><span class="brush-divider" /><button class="button" :class="{ primary: showBg }" @click="showBg = !showBg">{{ showBg ? '隐藏背景图' : '显示背景图' }}</button></div>
      <p class="rain-help">拖动鼠标或触控连续涂格；画笔越大，一次覆盖的格子越多。当前版本独立保存，不会修改普通路网或地下路网。</p>
      <div class="canvas-wrap"><div v-show="showBg" ref="mapEl" class="rain-map" /><canvas ref="canvas" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" /></div>
    </template>
  </section>
</template>
<style scoped>
.rain-workspace { padding: 26px clamp(18px, 4vw, 54px); max-width: 1200px; margin: auto; }
.rain-toolbar { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }.rain-toolbar h2 { margin:0; }.rain-toolbar p,.rain-help { color:var(--ink-3); font-size:13px; }.dirty { color:#a35d16; font-weight:700; }
.rain-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:22px 0 8px; }.brush-divider { width:1px; height:22px; background:var(--line); margin:0 4px; }.brush-label { color:var(--ink-3); font-size:13px; margin-left:4px; }.brush-size { padding:6px 10px; font-size:13px; }.canvas-wrap { position:relative; width:100%; aspect-ratio:250/172; max-height:70vh; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#f5f7f9; }.canvas-wrap canvas { position:relative; z-index:1; display:block; width:100%; height:100%; image-rendering:pixelated; touch-action:none; cursor:crosshair; }.rain-map { position:absolute; inset:0; z-index:0; }
</style>
