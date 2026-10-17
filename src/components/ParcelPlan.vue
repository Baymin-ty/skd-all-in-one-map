<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  closeParcelPlan, findParcel, neighbors, parcel, parcelItem, queryFor, resultTitle, shelfNumbers, type ParcelItem, type Rect,
} from '../lib/parcelStation'
import { itemAt, itemBox, planSize, planSvg } from '../lib/parcelPlanSvg'
import { poiById } from '../lib/store'
import type { IconName } from '../lib/icons'
import Ico from './Ico.vue'

// 快递站货架平面图：一张可以拖动、缩放的小地图。输入取件码或货架号，对应格子标红，镜头飞过去。
const QUICK = [
  { q: '前台', zh: '前台' }, { q: '扫码机', zh: '扫码机' }, { q: '智能柜', zh: '智能柜' },
  { q: '室内入口', zh: '入口' }, { q: '卫生间', zh: '卫生间' }, { q: '信件收取处', zh: '信件' },
]
/** 聚焦一个格子时至少看这么大一片（原图像素），旁边的格子也在画面里，方便对照；也不放得太大 */
const FOCUS_SPAN = 320
const FOCUS_MAX_ZOOM = 0.6
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const root = ref<HTMLElement>()
const mapEl = ref<HTMLElement>()
const head = ref<HTMLElement>()
const card = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const q = ref(parcel.query)
const result = computed(() => findParcel(q.value))
const single = computed(() => result.value.items.length === 1 ? result.value.items[0] : undefined)
const title = computed(() => resultTitle(result.value))
const isShelf = computed(() => result.value.items.length > 0 && result.value.items.every((i) => i.kind === 'shelf'))
const near = computed(() => single.value ? neighbors(single.value).slice(0, 5) : [])
/** 结果卡片左边的方块：同一个编号的货架写编号，其他放图标 */
const badge = computed(() => {
  const labels = new Set(result.value.items.map((i) => i.group ?? i.label))
  return isShelf.value && labels.size === 1 ? [...labels][0] : ''
})
const BADGE_ICONS: Record<ParcelItem['kind'], IconName> = { shelf: 'grid', locker: 'lock', door: 'entrance', room: 'door', desk: 'pin' }
/** 多个结果时列出来逐个点；两个 36 这种搜出来还是两个的不列 */
const choices = computed(() => {
  const items = result.value.items
  const queries = items.map(queryFor)
  return items.length > 1 && items.length <= 8 && new Set(queries).size === items.length ? items : []
})
const poi = computed(() => poiById(parcel.poi))
const short = (item: ParcelItem) => item.kind === 'shelf' ? item.label : item.kind === 'locker' ? item.label.replace('智能', '') : item.name
watch(q, (v) => { parcel.query = v })

// 宽屏和手机横屏：左边一栏放搜索和结果；竖屏：上面搜索、下面结果卡片
const vw = ref(window.innerWidth)
const vh = ref(window.innerHeight)
const side = computed(() => vw.value >= 700 && vw.value > vh.value)
/** 竖屏时平面图转 90°，长边竖着放；null = 自动，按钮可以手动切换 */
const turned = ref<boolean | null>(null)
const rotated = computed(() => turned.value ?? (!side.value && vh.value > vw.value))

let map: L.Map | undefined
let art: SVGSVGElement | undefined
let overlay: L.SVGOverlay | undefined
const pins = L.layerGroup()
let flyTimer = 0

/** 地图被搜索栏、结果卡片挡住的边距（px） */
function insets() {
  const box = mapEl.value!.getBoundingClientRect()
  const pad = { l: 12, t: 12, r: 12, b: 12 }
  if (side.value) {
    pad.l = Math.max(pad.l, (head.value?.parentElement?.getBoundingClientRect().right ?? 0) - box.left + 16)
    pad.r = 64 // 右边一列按钮
  } else {
    pad.t = Math.max(pad.t, (head.value?.getBoundingClientRect().bottom ?? 0) - box.top + 10)
    pad.b = Math.max(pad.b, box.bottom - (card.value?.getBoundingClientRect().top ?? box.bottom) + 10)
  }
  return pad
}
/** 没被挡住的那片区域（px） */
function visibleArea() {
  const size = map!.getSize(), p = insets()
  return { size, p, w: Math.max(60, size.x - p.l - p.r), h: Math.max(60, size.y - p.t - p.b) }
}
/** 刚好装下平面图上这一块（[x, y, 宽, 高]）的缩放级别 */
function fitZoom([, , w, h]: Rect) {
  const area = visibleArea()
  return Math.log2(Math.min(area.w / w, area.h / h))
}
/** 让这一块的中心落在没被挡住区域的正中，返回地图中心该放哪 */
function centerFor([x, y, w, h]: Rect, zoom: number) {
  const { size, p, w: aw, h: ah } = visibleArea()
  const s = 2 ** zoom
  return L.latLng(-(y + h / 2 + (size.y / 2 - (p.t + ah / 2)) / s), x + w / 2 + (size.x / 2 - (p.l + aw / 2)) / s)
}
function show(rect: Rect, animate = true, maxZoom = map!.getMaxZoom()) {
  if (!map) return
  const zoom = Math.min(maxZoom, Math.max(map.getMinZoom(), fitZoom(rect)))
  const center = centerFor(rect, zoom)
  if (animate && !reduceMotion) map.flyTo(center, zoom, { duration: 0.55 })
  else map.setView(center, zoom, { animate: false })
}
/** 刚打开时：整张图放得下又看得清（≥ 0.4 倍）就看全图；否则短边铺满，先看入口那一段。whole = 「看全图」按钮 */
function overview(animate = true, whole = false) {
  const [w, h] = planSize(rotated.value)
  if (whole || fitZoom([0, 0, w, h]) >= Math.log2(0.4)) return show([0, 0, w, h], animate)
  const [ex, ey, ew, eh] = itemBox(parcelItem('entry')!, rotated.value)
  show(rotated.value ? [0, ey + eh / 2 - 0.5, w, 1] : [ex + ew / 2 - 0.5, 0, 1, h], animate, 0)
}
function union(items: ParcelItem[]): Rect {
  const boxes = items.map((i) => itemBox(i, rotated.value))
  const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]))
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2])), y1 = Math.max(...boxes.map((b) => b[1] + b[3]))
  return [x0, y0, x1 - x0, y1 - y0]
}
/** 镜头对准结果；gentle：点图上格子时，已经在画面里就不动，不在才平移，不改缩放 */
function focusResult(animate = true, gentle = false) {
  const items = result.value.items
  if (!map || !items.length) return
  const [x, y, w, h] = union(items)
  if (gentle) {
    const { size, p } = visibleArea()
    const a = map.containerPointToLatLng([p.l, p.t]), b = map.containerPointToLatLng([size.x - p.r, size.y - p.b])
    // 上方留出小旗的高度
    const pin = 40 / 2 ** map.getZoom()
    if (x >= a.lng && x + w <= b.lng && y - pin >= -a.lat && y + h <= -b.lat) return
    map.panTo(centerFor([x, y, w, h], map.getZoom()), { animate: animate && !reduceMotion })
    return
  }
  const sw = Math.max(w, FOCUS_SPAN), sh = Math.max(h, FOCUS_SPAN)
  show([x + w / 2 - sw / 2, y + h / 2 - sh / 2, sw, sh], animate, FOCUS_MAX_ZOOM)
}

/** 标红命中的格子，上方插一个小旗；格子太多（例如全部智能柜）就不插旗 */
function highlight() {
  if (!art || !map) return
  const items = result.value.items
  const ids = new Set(items.map((i) => i.id))
  art.classList.toggle('dim', ids.size > 0)
  for (const g of art.querySelectorAll<SVGGElement>('.pp-item')) {
    const on = ids.has(g.dataset.id ?? '')
    g.classList.toggle('on', on)
    // 提到最上层，呼吸光不被旁边的格子盖住；房间不提，免得盖住里面的门
    if (on && !g.classList.contains('pp-room')) art.appendChild(g)
  }
  pins.clearLayers()
  const clusters = new Map<string, ParcelItem[]>()
  for (const item of items) clusters.set(item.group ?? item.id, [...clusters.get(item.group ?? item.id) ?? [], item])
  if (clusters.size > 3) return
  for (const [key, members] of clusters) {
    const [x, y, w] = union(members)
    const text = members.length > 1 ? key : short(members[0])
    L.marker(L.latLng(-y, x + w / 2), {
      icon: L.divIcon({ className: 'pp-pin', html: `<span>${text}</span>`, iconSize: [0, 0] }), interactive: false, keyboard: false,
    }).addTo(pins)
  }
}

function draw() {
  if (!map) return
  const [w, h] = planSize(rotated.value)
  const bounds = L.latLngBounds([[-h, 0], [0, w]])
  overlay?.remove()
  const holder = document.createElement('div')
  holder.innerHTML = planSvg(rotated.value)
  art = holder.firstElementChild as SVGSVGElement
  overlay = L.svgOverlay(art, bounds, { interactive: false }).addTo(map)
  map.setMaxBounds(bounds.pad(0.4))
  map.setMinZoom(fitZoom([0, 0, w, h]) - 0.5)
  highlight()
}

function pick(query: string, gentle = false) {
  q.value = query
  void nextTick(() => {
    clearTimeout(flyTimer)
    focusResult(true, gentle)
  })
}
function submit() {
  clearTimeout(flyTimer)
  // 收起手机键盘，焦点留在平面图里（Esc 还能关）
  root.value?.focus({ preventScroll: true })
  if (result.value.items.length) focusResult()
}
function clear() {
  q.value = ''
  input.value?.focus()
}
function toggleTurn() {
  turned.value = !rotated.value
}
function zoomBy(d: number) {
  if (d > 0) map?.zoomIn(0.75)
  else map?.zoomOut(0.75)
}
function close() {
  closeParcelPlan()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  if (e.target === input.value && q.value) q.value = ''
  else close()
}

// 输入时先标红，停下来再挪镜头，免得打「15」时先飞到 1 号货架
watch(() => result.value.items.map((i) => i.id).join(), () => {
  highlight()
  clearTimeout(flyTimer)
  flyTimer = window.setTimeout(() => focusResult(), 450)
})
watch(rotated, async () => {
  draw()
  await nextTick()
  if (result.value.items.length) focusResult(false)
  else overview(false)
})

// 手机键盘弹出会让窗口变矮：输入框聚焦时不跟着改布局，免得横竖来回跳
function onResize() {
  vw.value = window.innerWidth
  if (document.activeElement !== input.value) vh.value = window.innerHeight
  map?.invalidateSize({ pan: false })
}
// 安卓返回键 / 浏览器后退：关掉平面图回到地图，而不是离开网站
function onPop() { closeParcelPlan() }
// 竖屏时右侧按钮跟在搜索栏下面
const headObserver = new ResizeObserver(() => root.value?.style.setProperty('--head-h', `${head.value?.offsetHeight ?? 0}px`))

onMounted(async () => {
  history.pushState({ parcelPlan: true }, '')
  window.addEventListener('popstate', onPop)
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey)
  map = L.map(mapEl.value!, {
    crs: L.CRS.Simple, zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 110, minZoom: -4, maxZoom: 2.2,
    attributionControl: false, zoomControl: false, bounceAtZoomLimits: false, maxBoundsViscosity: 0.85,
  })
  pins.addTo(map)
  if (head.value) headObserver.observe(head.value)
  map.on('click', (e: L.LeafletMouseEvent) => {
    const hit = itemAt([e.latlng.lng, -e.latlng.lat], rotated.value, 16 / 2 ** map!.getZoom())
    if (hit) pick(queryFor(hit), true)
  })
  await nextTick()
  draw()
  if (result.value.items.length) focusResult(false)
  else overview(false)
  if (side.value && !q.value) input.value?.focus()
  else root.value?.focus()
})
onBeforeUnmount(() => {
  clearTimeout(flyTimer)
  headObserver.disconnect()
  window.removeEventListener('popstate', onPop)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey)
  map?.remove()
  map = undefined
  if (history.state?.parcelPlan) history.back()
})
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="pp" :class="{ side, turned: rotated }" role="dialog" aria-modal="true" aria-label="快递站地图" tabindex="-1">
      <div ref="mapEl" class="pp-map" />

      <div class="pp-panel">
        <header ref="head" class="pp-head">
          <div class="pp-title">
            <button type="button" class="pp-back" aria-label="返回地图" @click="close"><Ico name="back" /></button>
            <div class="grow"><b>快递站地图</b><small class="ellipsis">{{ poi?.name.zh ?? '快递服务中心' }}<template v-if="poi?.hours"> · {{ poi.hours.zh }}</template></small></div>
          </div>
          <form class="pp-search" role="search" @submit.prevent="submit">
            <Ico name="search" />
            <input
              ref="input" v-model="q" type="search" placeholder="取件码或货架号，如 15-3-2045" aria-label="取件码或货架号"
              enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" @blur="onResize"
            />
            <button v-if="q" type="button" class="pp-clear" aria-label="清空" @click="clear"><Ico name="close" /></button>
          </form>
          <div class="pp-quick" aria-label="常用位置">
            <button v-for="x in QUICK" :key="x.q" type="button" :class="{ on: q === x.q }" :aria-pressed="q === x.q" @click="pick(x.q)">{{ x.zh }}</button>
          </div>
        </header>

        <section ref="card" class="pp-card" aria-live="polite">
          <template v-if="!q.trim()">
            <b class="pp-card-title">输入取件码找货架</b>
            <p class="pp-text">取件码一般是「货架-层-编号」，例如 15-3-2045 就是 15 号货架第 3 层。也可以直接点图上的格子。</p>
            <div class="pp-legend">
              <span><i class="lg-shelf" />货架</span><span><i class="lg-locker" />智能柜</span><span><i class="lg-desk" />前台 · 扫码</span><span><i class="lg-door" />入口 · 门</span>
            </div>
          </template>
          <template v-else-if="!result.items.length">
            <b class="pp-card-title">没有找到「{{ q.trim() }}」</b>
            <p class="pp-text"><template v-if="result.missing">图上没有 {{ result.missing }}。</template>货架编号有 {{ shelfNumbers() }}；智能柜 1–6 号。</p>
          </template>
          <template v-else>
            <div class="pp-result">
              <span class="pp-badge">{{ badge }}<Ico v-if="!badge" :name="BADGE_ICONS[result.items[0].kind]" /></span>
              <div class="grow">
                <b class="pp-card-title">{{ title }}</b>
                <small v-if="single?.hint">{{ single.hint }}</small>
                <small v-else-if="result.items.length > 1">图上标红了 {{ result.items.length }} 处</small>
              </div>
            </div>
            <div v-if="result.layer || result.serial" class="pp-code">
              <span v-if="result.layer"><small>层</small><b>第 {{ result.layer }} 层</b></span>
              <span v-if="result.serial"><small>编号</small><b>{{ result.serial }}</b></span>
            </div>
            <div v-if="choices.length" class="pp-links"><button v-for="c in choices" :key="c.id" type="button" @click="pick(queryFor(c))">{{ short(c) }}</button></div>
            <p v-if="near.length" class="pp-near">挨着 <button v-for="n in near" :key="n.id" type="button" @click="pick(queryFor(n), true)">{{ short(n) }}</button></p>
            <p v-if="result.also.length" class="pp-near">也可能是 <button v-for="a in result.also" :key="a.id" type="button" @click="pick(queryFor(a))">{{ a.name }}</button></p>
            <p v-if="isShelf" class="pp-tip">取完件到前台旁的 <button type="button" @click="pick('扫码机')">扫码机</button> 扫码出库</p>
          </template>
        </section>
      </div>

      <div class="pp-tools">
        <button type="button" class="pp-zoom" aria-label="放大" title="放大" @click="zoomBy(1)"><Ico name="plus" /></button>
        <button type="button" class="pp-zoom" aria-label="缩小" title="缩小" @click="zoomBy(-1)"><Ico name="minus" /></button>
        <button type="button" aria-label="看全图" title="看全图" @click="overview(true, true)"><Ico name="expand" /></button>
        <button type="button" :aria-label="rotated ? '横着看' : '竖着看'" :title="rotated ? '横着看' : '竖着看'" @click="toggleTurn"><Ico name="rotate" /></button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pp { position: fixed; inset: 0; z-index: 1200; background: #eceef2; outline: none; overscroll-behavior: none; }
.pp-map { position: absolute; inset: 0; z-index: 0; isolation: isolate; background: #eceef2; font: inherit; }
.pp-map :deep(svg.pp-art) { filter: drop-shadow(0 2px 10px #0000001f); }
button { cursor: pointer; font: inherit; }

/* 竖屏：顶部搜索、底部卡片，中间整块是地图 */
.pp-panel { display: contents; }
.pp-head {
  position: absolute; z-index: 2; top: 0; left: 0; right: 0; padding: calc(env(safe-area-inset-top) + 8px) 10px 10px;
  background: #fffffff2; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 2px 14px #0000001a; border-radius: 0 0 18px 18px;
}
.pp-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.pp-title b { display: block; font-size: 16px; line-height: 1.25; }
.pp-title small { display: block; color: var(--ink-3); font-size: 12px; }
.pp-back { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--bg-2); color: var(--ink); font-size: 20px; }
.pp-search { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 6px 0 14px; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); font-size: 18px; }
.pp-search:focus-within { background: #fff; box-shadow: 0 0 0 2px var(--blue); }
/* 16px：iOS 聚焦输入框时不自动放大页面 */
.pp-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: none; font-size: 16px; color: var(--ink); }
.pp-search input::-webkit-search-cancel-button { display: none; }
.pp-clear { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #e4e4ea; color: var(--ink-2); font-size: 14px; }
.pp-quick { display: flex; gap: 6px; margin: 8px -10px 0; padding: 0 10px; overflow-x: auto; scrollbar-width: none; }
.pp-quick::-webkit-scrollbar { display: none; }
.pp-quick button { flex: none; height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: #fff; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.pp-quick button.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand); }

.pp-card {
  position: absolute; z-index: 2; left: 8px; right: 8px; bottom: calc(env(safe-area-inset-bottom) + 8px); max-height: 40dvh; overflow-y: auto;
  padding: 12px 14px 14px; border-radius: 18px; background: #fff; box-shadow: 0 4px 22px #00000026;
}
.pp-card-title { display: block; font-size: 17px; line-height: 1.3; font-weight: 750; }
.pp-text { margin-top: 4px; color: var(--ink-2); font-size: 13.5px; line-height: 1.55; }
.pp-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; color: var(--ink-2); font-size: 12.5px; }
.pp-legend span { display: inline-flex; align-items: center; gap: 5px; }
.pp-legend i { width: 14px; height: 10px; border-radius: 2px; border: 1.5px solid; }
.lg-shelf { background: #fff; border-color: #7a7a82; }
.lg-locker { background: #e6effc; border-color: #2f6fd6; }
.lg-desk { background: #fdf1dc; border-color: #c38b2c; }
.lg-door { background: #fdecec; border-color: #d64545; border-style: dashed !important; }

.pp-result { display: flex; align-items: center; gap: 12px; }
.pp-result small { display: block; margin-top: 1px; color: var(--ink-2); font-size: 13px; }
.pp-badge { flex: none; display: grid; place-items: center; min-width: 46px; height: 46px; padding: 0 8px; border-radius: 12px; background: var(--brand); color: #fff; font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; box-shadow: 0 0 0 4px var(--brand-soft); }
.pp-badge .svgi { font-size: 22px; }
.pp-code { display: flex; gap: 8px; margin-top: 10px; }
.pp-code span { display: flex; align-items: baseline; gap: 6px; padding: 6px 12px; border-radius: 10px; background: var(--bg-2); }
.pp-code small { color: var(--ink-3); font-size: 12px; }
.pp-code b { font-size: 15px; font-variant-numeric: tabular-nums; }
.pp-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pp-links button, .pp-near button, .pp-tip button { height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--ink); font-size: 13px; font-weight: 600; }
.pp-near, .pp-tip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; color: var(--ink-3); font-size: 12.5px; }
.pp-tip button { color: #865811; border-color: #f0d9b0; background: #fdf6ea; }

/* 右侧按钮：竖屏放在搜索栏下面，宽屏放右下角 */
.pp-tools { position: absolute; z-index: 2; right: 10px; top: calc(var(--head-h, 150px) + 10px); display: flex; flex-direction: column; gap: 8px; }
.pp-tools button { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 12px; background: #fffffff2; color: var(--ink); font-size: 18px; box-shadow: 0 2px 10px #00000024; }
.pp-tools button:active { transform: scale(0.95); }
@media (hover: hover) { .pp-tools button:hover, .pp-back:hover, .pp-quick button:hover, .pp-near button:hover, .pp-links button:hover { background: #f4f4f7; } }
@media (pointer: coarse) { .pp-zoom { display: none !important; } }

/* 宽屏和手机横屏：左边一栏 */
.side .pp-panel { position: absolute; z-index: 2; top: calc(env(safe-area-inset-top) + 12px); bottom: 12px; left: calc(env(safe-area-inset-left) + 12px); width: min(360px, 40vw); display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
.side .pp-panel > * { pointer-events: auto; }
.side .pp-head { position: static; padding: 12px; border-radius: 18px; }
.side .pp-quick { margin: 8px -12px 0; padding: 0 12px; flex-wrap: wrap; }
.side .pp-card { position: static; flex: 0 1 auto; max-height: none; min-height: 0; }
.side .pp-tools { top: auto; bottom: 16px; right: calc(env(safe-area-inset-right) + 16px); }
@media (max-height: 480px) {
  .side .pp-panel { top: 8px; bottom: 8px; gap: 6px; }
  .side .pp-head { padding: 8px 10px; }
  .side .pp-title { margin-bottom: 6px; }
  .side .pp-quick { flex-wrap: nowrap; }
  .side .pp-card { padding: 10px 12px; }
  .side .pp-legend { display: none; }
}

/* 搜到时格子上方的小旗：屏幕上大小固定，缩小看全图也找得到 */
:global(.pp-pin) { position: relative; }
:global(.pp-pin span) {
  position: absolute; left: 0; bottom: 7px; transform: translateX(-50%); padding: 3px 10px; border-radius: 999px; background: var(--brand); color: #fff;
  font-size: 14px; font-weight: 750; line-height: 1.35; white-space: nowrap; box-shadow: 0 3px 10px #0000003d; animation: pp-drop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
:global(.pp-pin span::after) { content: ''; position: absolute; left: 50%; bottom: -5px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0; border-top-color: var(--brand); }
@keyframes pp-drop { from { opacity: 0; transform: translate(-50%, -10px); } }
@media (prefers-reduced-motion: reduce) { :global(.pp-pin span) { animation: none; } }
</style>
