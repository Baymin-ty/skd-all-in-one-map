<script setup lang="ts">
import { computed, ref } from 'vue'
import { search, select, type SearchHit } from '../lib/store'

const q = ref('')
const focused = ref(false)
const hits = computed(() => search(q.value))

function choose(h: SearchHit) {
  select(h.sel)
  q.value = ''
  focused.value = false
}
</script>

<template>
  <div class="search">
    <input
      v-model="q" type="search" placeholder="搜楼、点位、别名（如 一食堂、SIST）" aria-label="搜索"
      @focus="focused = true" @blur="focused = false" @keydown.enter="hits[0] && choose(hits[0])"
    />
    <ul v-if="focused && q.trim()" class="hits">
      <li v-for="h in hits" :key="h.sel.id" @mousedown.prevent="choose(h)">
        <span>{{ h.name }}</span><small>{{ h.sub }}</small>
      </li>
      <li v-if="!hits.length" class="none">没有找到</li>
    </ul>
  </div>
</template>
