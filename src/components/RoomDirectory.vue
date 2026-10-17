<script setup lang="ts">
import { computed, ref } from 'vue'
import { floorLabel, roomFloors, roomsFrom } from '../lib/rooms'
import Ico from './Ico.vue'
const props = defineProps<{ rooms: unknown[]; focus?: string }>()
// 从教室号搜索进来时先筛出这个房间
const q = ref(props.focus ?? '')
const rooms = computed(() => roomsFrom(props.rooms))
const floors = computed(() => roomFloors(rooms.value, q.value))
const labels: Record<string, string> = { restroom: '卫生间', hall: '报告厅', classroom: '教室', meeting: '会议室', lab: '实验室', office: '办公室', other: '房间' }
</script>

<template>
  <section v-if="rooms.length" class="sec room-directory">
    <h3>楼内房间 <span class="muted">{{ rooms.length }} 间</span></h3>
    <label class="room-search"><Ico name="search" /><input v-model="q" type="search" placeholder="搜房间号或名称，如 1B101、会议室" aria-label="搜索楼内房间" /></label>
    <p v-if="q.trim()" class="result-caption" aria-live="polite">找到 {{ floors.reduce((n, f) => n + f.rooms.length, 0) }} 间房间</p>
    <details v-for="f in floors" :key="String(f.floor) + !!q.trim()" :open="!!q.trim()" class="floor-group">
      <summary><b>{{ floorLabel(f.floor) }}</b><span>{{ f.rooms.length }} 间</span><Ico name="chevron" /></summary>
      <ul class="list-plain"><li v-for="r in f.rooms" :key="r.code + r.label" :class="{ restroom: r.kind === 'restroom', focused: r.code === focus }"><Ico :name="r.kind === 'classroom' ? 'academic' : r.kind === 'meeting' ? 'users' : 'door'" /><div><b>{{ r.code }}</b><span>{{ r.label }}</span></div><small>{{ labels[r.kind] || '房间' }}</small></li></ul>
    </details>
    <p v-if="!floors.length" class="empty">没有找到这个房间，试试只输入房间号。</p>
  </section>
</template>

<style scoped>
.room-search { display: flex; gap: 8px; align-items: center; padding: 10px 12px; margin-bottom: 10px; background: var(--bg-2); border-radius: 11px; color: var(--ink-3); }.room-search input { width: 100%; min-width: 0; background: none; border: 0; outline: none; font-size: 12px; }.room-search:focus-within { outline: 2px solid var(--blue); }
.floor-group { border-bottom: 1px solid var(--line); }.floor-group summary { display: flex; align-items: center; gap: 10px; padding: 12px 2px; list-style: none; cursor: pointer; font-size: 13px; }.floor-group summary::-webkit-details-marker { display: none; }.floor-group summary span { flex: 1; font-size: 11px; color: var(--ink-3); }.floor-group summary .svgi { color: var(--ink-3); transition: transform .15s; }.floor-group[open] summary .svgi { transform: rotate(90deg); }
.floor-group ul { padding: 0 0 8px; }.floor-group li { display: flex; gap: 8px; align-items: center; padding: 8px; border-radius: 8px; background: var(--bg-2); margin-bottom: 4px; }.floor-group li > .svgi { color: var(--ink-3); font-size: 14px; }.floor-group li div { min-width: 0; flex: 1; }.floor-group li b { display: block; font-variant-numeric: tabular-nums; font-size: 12px; }.floor-group li div span { display: block; font-size: 11px; color: var(--ink-2); }.floor-group li small { font-size: 10px; color: var(--ink-3); }.floor-group .restroom { color: var(--blue); }.floor-group li.focused { background: var(--brand-soft); outline: 1.5px solid var(--brand); }
</style>
