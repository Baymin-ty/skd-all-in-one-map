<script setup lang="ts">
import { ref } from 'vue'
import { ui } from '../lib/ui'

// 手机底部面板：拖把手在三档之间切换（收起 / 半屏 / 展开），轻点把手在收起和半屏之间切换
let startY = 0
let startH = 0
let lastY = 0
let lastT = 0
let speed = 0
let moved = false
const body = ref<HTMLElement>()

function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  startY = lastY = e.clientY
  startH = ui.sheet
  lastT = e.timeStamp
  speed = 0
  moved = false
  ui.dragging = true
}
function move(e: PointerEvent) {
  if (!ui.dragging) return
  if (Math.abs(e.clientY - startY) > 4) moved = true
  const [lo, , hi] = ui.anchors
  ui.sheet = Math.min(hi, Math.max(lo, startH + startY - e.clientY))
  const dt = e.timeStamp - lastT
  if (dt > 0) speed = (lastY - e.clientY) / dt // 向上为正，px/ms
  lastY = e.clientY
  lastT = e.timeStamp
}
function up() {
  if (!ui.dragging) return
  ui.dragging = false
  const a = ui.anchors
  if (!moved) {
    ui.sheet = ui.sheet < a[1] ? a[1] : a[0]
    return
  }
  // 甩得快就往甩的方向走一档，否则停到最近的一档
  const i = a.reduce((best, h, k) => (Math.abs(h - ui.sheet) < Math.abs(a[best] - ui.sheet) ? k : best), 0)
  const next = Math.abs(speed) > 0.5 ? (speed > 0 ? a.find((h) => h > ui.sheet) : [...a].reverse().find((h) => h < ui.sheet)) : undefined
  ui.sheet = next ?? a[i]
  if (ui.sheet === a[0]) body.value?.scrollTo({ top: 0 })
}
</script>

<template>
  <section class="sheet" :class="{ dragging: ui.dragging }" :style="{ height: ui.sheet + 'px' }">
    <div class="grip" role="slider" aria-label="拖动调整面板高度" :aria-valuenow="ui.sheet" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <span />
    </div>
    <div ref="body" class="sheet-body"><slot /></div>
    <div v-if="$slots.footer" class="sheet-foot"><slot name="footer" /></div>
  </section>
</template>

<style scoped>
.sheet { position: absolute; z-index: 1002; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; background: #fff; border-radius: 18px 18px 0 0; box-shadow: 0 -2px 18px #00000029; transition: height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.sheet.dragging { transition: none; }
.grip { flex: none; height: 24px; display: grid; place-items: center; cursor: grab; touch-action: none; }
.grip span { width: 36px; height: 5px; border-radius: 3px; background: #d6d6db; }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.sheet-foot { flex: none; padding: 4px 6px calc(env(safe-area-inset-bottom) + 4px); border-top: 1px solid var(--line); background: #fff; }
.sheet-body:last-child { padding-bottom: env(safe-area-inset-bottom); }
</style>
