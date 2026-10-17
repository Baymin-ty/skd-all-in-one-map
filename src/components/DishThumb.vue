<script setup lang="ts">
import { computed } from 'vue'
import type { Dish } from '../lib/discoveryTypes'

/** Dish photo, or a coloured placeholder with an emoji guessed from its tags. */
const props = defineProps<{ d: Dish; size?: number }>()
const EMOJI: [string, string, string][] = [
  ['dumplings', '🥟', '#fff1e0'], ['noodles', '🍜', '#fdf0e3'], ['rice', '🍚', '#f3f1ea'], ['soup', '🍲', '#fdeee8'],
  ['sweet', '🍰', '#fdeef4'], ['veg', '🥬', '#eaf6ec'], ['breakfast', '🥐', '#fbf2e2'], ['spicy1', '🌶️', '#fdecea'],
]
const ph = computed(() => EMOJI.find(([k]) => props.d.tags?.includes(k)) ?? ['', '🍽️', '#f2f2f5'])
</script>

<template>
  <img v-if="d.photo" :src="d.photo" :alt="d.zh" class="dthumb" :style="{ width: (size || 56) + 'px', height: (size || 56) + 'px' }" loading="lazy" />
  <span v-else class="dthumb ph" :style="{ width: (size || 56) + 'px', height: (size || 56) + 'px', background: ph[2], fontSize: Math.round((size || 56) * 0.48) + 'px' }" aria-hidden="true">{{ ph[1] }}</span>
</template>

<style scoped>
.dthumb { border-radius: 12px; object-fit: cover; flex: none; display: grid; place-items: center; }
</style>
