<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Ico from './Ico.vue'
const props = defineProps<{ photos: string[]; title: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const index = ref(0)
watch(() => props.photos, async (photos) => {
  index.value = 0
  await nextTick()
  if (photos.length && !dialog.value?.open) dialog.value?.showModal()
  else if (!photos.length && dialog.value?.open) dialog.value.close()
}, { immediate: true })
function move(step: number) { index.value = Math.min(props.photos.length - 1, Math.max(0, index.value + step)) }
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="image-preview" :aria-label="title" @close="emit('close')" @keydown.left.prevent="move(-1)" @keydown.right.prevent="move(1)">
      <div class="preview-heading"><b>{{ title }}</b><small>{{ index + 1 }} / {{ photos.length }}</small><button type="button" class="close" aria-label="关闭图片预览" @click="emit('close')"><Ico name="close" /></button></div>
      <img v-if="photos[index]" :src="photos[index]" :alt="`${title} · 第 ${index + 1} 张`" />
      <div v-if="photos.length > 1" class="preview-controls"><button type="button" class="act" :disabled="index === 0" @click="move(-1)"><Ico name="back" />上一张</button><button type="button" class="act" :disabled="index === photos.length - 1" @click="move(1)">下一张<Ico name="chevron" /></button></div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.image-preview { width: min(960px, calc(100vw - 24px)); max-height: 92dvh; padding: 14px; border: 0; border-radius: 16px; background: #fff; box-shadow: 0 16px 60px #0005; }
.image-preview::backdrop { background: #182027b3; }
.preview-heading { display: flex; gap: 10px; align-items: center; padding-bottom: 12px; }
.preview-heading b { flex: 1; font-size: 14px; }
.preview-heading small { color: var(--ink-3); font-size: 12px; }
.image-preview > img { display: block; width: 100%; max-height: 70dvh; object-fit: contain; border-radius: 8px; background: var(--bg-2); }
.preview-controls { display: flex; justify-content: center; gap: 16px; margin-top: 12px; }
</style>
