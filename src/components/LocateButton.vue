<script setup lang="ts">
import { computed } from 'vue'
import { locator, startLocating, stopLocating } from '../lib/locate'
import Ico from './Ico.vue'

const active = computed(() => locator.status === 'on' || locator.status === 'locating')
const title = computed(() => {
  if (locator.status === 'locating') return '正在定位…'
  if (locator.status === 'on') return locator.follow ? '关闭定位' : '回到我的位置'
  return locator.mock ? '模拟定位' : '显示我的位置'
})
function toggle() {
  // 已经在跟随：再点一次关掉；拖走了地图：再点一次回到我的位置
  if (active.value && locator.follow) stopLocating()
  else startLocating()
}
</script>

<template>
  <button type="button" class="fab locate" :class="{ on: active && locator.follow, idle: active && !locator.follow, busy: locator.status === 'locating' }"
    :aria-pressed="active" :title="title" :aria-label="title" @click="toggle">
    <Ico name="target" />
  </button>
</template>

<style scoped>
.locate.idle { color: #2f6fd6; }
.locate.on { background: #2f6fd6; color: #fff; }
.locate.busy .svgi { animation: locate-spin 1.2s linear infinite; }
@keyframes locate-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .locate.busy .svgi { animation: none; } }
</style>
