<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadImage, StreetViewTransitionRenderer } from '../lib/streetViewTransition'

/** 街景图片显示 + “向前穿梭”WebGL 转场；WebGL 不可用时退回普通 <img>。 */
const props = defineProps<{ urls: string[]; index: number }>()
const canvas = ref<HTMLCanvasElement>()
const fallbackSrc = ref<string>()
const useFallback = ref(false)
let renderer: StreetViewTransitionRenderer | null = null
let shownIndex = -1
let request = 0
let motionQuery: MediaQueryList | null = null
const onMotion = () => { if (renderer) renderer.reducedMotion = !!motionQuery?.matches }

function preload(index: number) {
  for (const i of [index - 1, index + 1]) {
    const url = props.urls[i]
    if (url) loadImage(url).catch(() => {})
  }
}

async function goTo(index: number) {
  const url = props.urls[index]
  if (!url) return
  const token = ++request
  // 连续点击：先把进行中的转场直接收尾，新转场等新图加载完再开始。
  renderer?.finish()
  preload(index)
  let img: HTMLImageElement
  try { img = await loadImage(url) } catch {
    if (token === request) { fallbackSrc.value = url; if (renderer) { useFallback.value = true } }
    return
  }
  if (token !== request) return
  const dir: 1 | -1 = index >= shownIndex ? 1 : -1
  const first = shownIndex < 0
  shownIndex = index
  fallbackSrc.value = url
  if (!renderer) return
  useFallback.value = false
  if (first) renderer.show(url, img)
  else renderer.transition(url, img, dir)
  renderer.prune([props.urls[index - 1], url, props.urls[index + 1]].filter(Boolean) as string[])
}

onMounted(() => {
  try {
    renderer = new StreetViewTransitionRenderer(canvas.value!)
    motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    motionQuery?.addEventListener('change', onMotion)
    onMotion()
  } catch {
    renderer = null
    useFallback.value = true
  }
  goTo(props.index)
})
watch(() => [props.index, props.urls[props.index]] as const, () => goTo(props.index))
onBeforeUnmount(() => {
  request++
  motionQuery?.removeEventListener('change', onMotion)
  renderer?.destroy()
  renderer = null
})
</script>
<template>
  <div class="street-image">
    <canvas v-show="!useFallback" ref="canvas" role="img" aria-label="地下街景" />
    <img v-if="useFallback && fallbackSrc" :src="fallbackSrc" alt="地下街景" />
  </div>
</template>
<style scoped>
.street-image{position:relative;width:100%;height:100%}.street-image canvas,.street-image img{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:contain}
</style>
