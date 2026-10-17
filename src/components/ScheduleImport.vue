<script setup lang="ts">
import { computed, ref } from 'vue'
import { importItems, type PlanItem } from '../lib/today'
import { toast } from '../lib/store'
import Ico from './Ico.vue'

type Parsed = { title: string; weekday: number; start: string; end: string; room: string; weeks?: number[]; teacher?: string }
const open = ref(false), file = ref<HTMLInputElement>(), loading = ref(false), error = ref(''), warnings = ref<string[]>([]), classes = ref<Parsed[]>([])
const ready = computed(() => classes.value.filter((item) => /^\d\d:\d\d$/.test(item.start) && /^\d\d:\d\d$/.test(item.end)))
function readFile(input: HTMLInputElement) { const value = input.files?.[0]; if (!value) return; const reader = new FileReader(); reader.onload = () => { void parse(String(reader.result)); }; reader.readAsDataURL(value) }
async function parse(image: string) {
  open.value = true; loading.value = true; error.value = ''; classes.value = []
  try { const response = await fetch('/api/schedule/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || '课表识别失败'); classes.value = body.classes || []; warnings.value = body.warnings || [] }
  catch (e) { error.value = e instanceof Error ? e.message : '课表识别失败' }
  finally { loading.value = false }
}
function confirm() {
  if (!ready.value.length) { toast('请先补齐至少一门课的开始和结束时间'); return }
  const items: Omit<PlanItem, 'id'>[] = ready.value.map((item) => ({ kind: 'class', title: item.title, start: item.start, end: item.end, room: item.room || undefined, note: item.teacher ? `教师：${item.teacher}` : undefined, weekdays: [item.weekday], source: 'ai' }))
  importItems(items); open.value = false; toast(`已导入 ${items.length} 门课程`)
}
</script>

<template>
      <section class="schedule-import"><button type="button" class="act" @click="file?.click()"><Ico name="image" />导入课表截图</button><input ref="file" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="readFile($event.target as HTMLInputElement)" /><div v-if="open" class="schedule-preview"><div class="schedule-head"><b>课表识别{{ loading ? '中…' : '预览' }}</b><button type="button" class="close" @click="open = false"><Ico name="close" /></button></div><p v-if="loading" class="muted">正在识别课程、时间和教室…</p><p v-if="error" class="error" role="alert">{{ error }}</p><p v-for="warning in warnings" :key="warning" class="warning">{{ warning }}</p><table v-if="!loading && classes.length"><thead><tr><th>课程</th><th>星期</th><th>时间</th><th>教室</th></tr></thead><tbody><tr v-for="item in classes" :key="item.title + item.weekday + item.start"><td><input v-model="item.title" /></td><td>{{ item.weekday }}</td><td><input v-model="item.start" placeholder="HH:MM" /><input v-model="item.end" placeholder="HH:MM" /></td><td><input v-model="item.room" /></td></tr></tbody></table><p v-else-if="!loading && !error" class="muted">没有识别到课程，请换一张更清晰的截图。</p><button v-if="classes.length" type="button" class="act primary" :disabled="!ready.length" @click="confirm">{{ ready.length === classes.length ? '确认并加入我的今天' : `确认 ${ready.length} 门课` }}</button></div></section>
</template>

<style scoped>
.schedule-import { margin-top: 12px; }.schedule-preview { margin-top: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }.schedule-head { display:flex; justify-content:space-between; align-items:center; }.schedule-preview table { width:100%; margin:10px 0; border-collapse:collapse; font-size:11px; }.schedule-preview th,.schedule-preview td { padding:5px; border-bottom:1px solid var(--line); text-align:left; }.schedule-preview input { width:100%; box-sizing:border-box; min-width:0; border:1px solid var(--line); border-radius:5px; padding:4px; font:inherit; }.error { color:#b13c37; }.warning { color:#8b640e; font-size:12px; }
</style>
