<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { computeAnchors, ui } from '../lib/ui'

// 手机底部面板，三档：收起 / 半屏 / 展开。
// 拖把手随时可以拉；面板没展开时，在内容上竖着滑也是拉面板（跟地图类 App 一样，先展开再滚动列表），
// 展开后列表滚到顶再往下滑就收回去。轻点把手在收起和半屏之间切换。
const body = ref<HTMLElement>()
const foot = ref<HTMLElement>()
let startY = 0
let startX = 0
let startH = 0
let lastY = 0
let lastT = 0
let speed = 0
let moved = false
/** 这一次触摸由谁处理：还没决定 / 面板跟手 / 交给列表滚动或横向滑动 */
let mode: '' | 'sheet' | 'native' = ''

function begin(y: number, t: number) {
  startY = lastY = y
  startH = ui.sheet
  lastT = t
  speed = 0
  moved = false
}
function follow(y: number, t: number) {
  if (Math.abs(y - startY) > 4) moved = true
  const [lo, , hi] = ui.anchors
  ui.sheet = Math.min(hi, Math.max(lo, startH + startY - y))
  const dt = t - lastT
  if (dt > 0) speed = (lastY - y) / dt // 向上为正，px/ms
  lastY = y
  lastT = t
}
function settle() {
  ui.dragging = false
  const a = ui.anchors
  // 甩得快就往甩的方向走一档，否则停到最近的一档
  const i = a.reduce((best, h, k) => (Math.abs(h - ui.sheet) < Math.abs(a[best] - ui.sheet) ? k : best), 0)
  const next = Math.abs(speed) > 0.45 ? (speed > 0 ? a.find((h) => h > ui.sheet + 8) : [...a].reverse().find((h) => h < ui.sheet - 8)) : undefined
  ui.sheet = next ?? a[i]
  if (ui.sheet === a[0]) body.value?.scrollTo({ top: 0 })
}

// ---------- 把手：鼠标和触摸都用 pointer 事件 ----------
function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  begin(e.clientY, e.timeStamp)
  ui.dragging = true
}
function move(e: PointerEvent) {
  if (ui.dragging) follow(e.clientY, e.timeStamp)
}
function up() {
  if (!ui.dragging) return
  if (!moved) {
    ui.dragging = false
    ui.sheet = ui.sheet < ui.anchors[1] ? ui.anchors[1] : ui.anchors[0]
    return
  }
  settle()
}

// ---------- 内容区：触摸手势在面板和列表滚动之间分流 ----------
function touchStart(e: TouchEvent) {
  if (e.touches.length !== 1 || ui.dragging) { mode = 'native'; return }
  const t = e.touches[0]
  startX = t.clientX
  begin(t.clientY, e.timeStamp)
  mode = ''
}
function touchMove(e: TouchEvent) {
  if (mode === 'native' || e.touches.length !== 1) return
  const t = e.touches[0]
  if (!mode) {
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    // 横向滑动（日期、筛选条）和展开后的正常滚动都交给浏览器
    const expanded = ui.sheet >= ui.anchors[2] - 2
    const atTop = (body.value?.scrollTop ?? 0) <= 0
    const target = e.target instanceof Element ? e.target : null
    const ownScroll = target?.closest('textarea, input, select, [data-sheet-scroll]')
    if (Math.abs(dx) > Math.abs(dy) || ownScroll || expanded && !(atTop && dy > 0)) { mode = 'native'; return }
    mode = 'sheet'
    ui.dragging = true
    begin(t.clientY, e.timeStamp)
  }
  e.preventDefault()
  follow(t.clientY, e.timeStamp)
}
function touchEnd() {
  if (mode === 'sheet') settle()
  mode = ''
}

let observer: ResizeObserver | undefined
onMounted(() => {
  // 标签栏高度含 Home 指示条的安全区，量出来再算三档高度
  observer = new ResizeObserver(() => {
    const h = foot.value?.offsetHeight
    if (h && Math.abs(h - ui.footH) > 0.5) { ui.footH = h; computeAnchors() }
  })
  if (foot.value) observer.observe(foot.value)
  body.value?.addEventListener('touchmove', touchMove, { passive: false })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  body.value?.removeEventListener('touchmove', touchMove)
})
</script>

<template>
  <section class="sheet" :class="{ dragging: ui.dragging, peek: ui.sheet <= ui.anchors[0] + 2 }" :style="{ height: ui.sheet + 'px' }">
    <div class="grip" role="slider" aria-label="拖动调整面板高度" :aria-valuenow="ui.sheet" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <span />
    </div>
    <div ref="body" class="sheet-body" @touchstart.passive="touchStart" @touchend="touchEnd" @touchcancel="touchEnd"><slot /></div>
    <div v-if="$slots.footer" ref="foot" class="sheet-foot"><slot name="footer" /></div>
  </section>
</template>

<style scoped>
.sheet { position: absolute; z-index: 1002; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: #fff; border-radius: 20px 20px 0 0; box-shadow: 0 -1px 0 #0000000d, 0 -6px 24px #0000001f; transition: height 0.28s cubic-bezier(0.2, 0.8, 0.2, 1); will-change: height; }
.sheet.dragging { transition: none; }
.grip { flex: none; height: 22px; display: grid; place-items: center; cursor: grab; touch-action: none; }
.grip span { width: 38px; height: 5px; border-radius: 3px; background: #d4d4da; }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.sheet.peek .sheet-body { overflow: hidden; }
.sheet-foot { flex: none; padding: 2px 4px calc(env(safe-area-inset-bottom) + 2px); border-top: 1px solid var(--line); background: #fffffff2; }
.sheet-body:last-child { padding-bottom: env(safe-area-inset-bottom); }
</style>
