<script setup lang="ts">
import { computed, ref } from 'vue'
import { importItems, isWeeklyClass, plan, type PlanItem } from '../lib/today'
import { toast } from '../lib/store'
import Ico from './Ico.vue'

type Parsed = { title: string; weekday: number; start: string; end: string; room: string; weeks?: number[]; teacher?: string }
const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const open = ref(false), file = ref<HTMLInputElement>(), loading = ref(false), error = ref(''), warnings = ref<string[]>([]), classes = ref<Parsed[]>([])
const existing = computed(() => plan.items.filter(isWeeklyClass).length)
/** 重新导入通常是换学期或识别错了：默认替换旧课表，避免同一门课出现两遍 */
const replace = ref(true)
const ready = computed(() => classes.value.filter((item) => /^\d\d:\d\d$/.test(item.start) && /^\d\d:\d\d$/.test(item.end)))
function readFile(input: HTMLInputElement) {
  const value = input.files?.[0]
  input.value = ''
  if (!value) return
  if (value.size > 4 * 1024 * 1024) { open.value = true; classes.value = []; error.value = '课表截图不能超过 4 MB，可以截小一点再试'; return }
  const reader = new FileReader()
  reader.onload = () => { void parse(String(reader.result)) }
  reader.readAsDataURL(value)
}
async function parse(image: string) {
  open.value = true; loading.value = true; error.value = ''; classes.value = []; warnings.value = []; replace.value = true
  try {
    const response = await fetch('/api/schedule/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || '课表识别失败')
    classes.value = body.classes || []; warnings.value = body.warnings || []
  }
  catch (e) { error.value = e instanceof Error ? e.message : '课表识别失败' }
  finally { loading.value = false }
}
function confirm() {
  if (!ready.value.length) { toast('请先补齐至少一门课的开始和结束时间'); return }
  const items: Omit<PlanItem, 'id'>[] = ready.value.map((item) => ({ kind: 'class', title: item.title, start: item.start, end: item.end, room: item.room || undefined, note: item.teacher ? `教师：${item.teacher}` : undefined, weekdays: [item.weekday], source: 'ai' }))
  const replacing = replace.value && existing.value > 0
  importItems(items, replacing)
  open.value = false
  toast(replacing ? `已替换为新课表，共 ${items.length} 门课` : `已导入 ${items.length} 门课程`)
}
</script>

<template>
  <section class="schedule-import">
    <button type="button" class="act primary small" :disabled="loading" @click="file?.click()"><Ico name="image" />{{ existing ? '重新导入截图' : '导入课表截图' }}</button>
    <input ref="file" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="readFile($event.target as HTMLInputElement)" />
    <div v-if="open" class="schedule-preview">
      <div class="schedule-head"><b>课表识别{{ loading ? '中…' : '预览' }}</b><button type="button" class="close" aria-label="关闭预览" @click="open = false"><Ico name="close" /></button></div>
      <p v-if="loading" class="muted">正在识别课程、时间和教室…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-for="warning in warnings" :key="warning" class="warning">{{ warning }}</p>
      <template v-if="!loading && classes.length">
        <p class="muted">核对一下识别结果，可以直接改。</p>
        <table>
          <thead><tr><th>课程</th><th>星期</th><th>时间</th><th>教室</th></tr></thead>
          <tbody>
            <tr v-for="item in classes" :key="item.title + item.weekday + item.start">
              <td><input v-model="item.title" aria-label="课程名" /></td>
              <td>{{ WEEKDAYS[item.weekday] }}</td>
              <td><input v-model="item.start" placeholder="HH:MM" aria-label="开始时间" /><input v-model="item.end" placeholder="HH:MM" aria-label="结束时间" /></td>
              <td><input v-model="item.room" aria-label="教室" /></td>
            </tr>
          </tbody>
        </table>
        <label v-if="existing" class="replace"><input v-model="replace" type="checkbox" />替换现有的 {{ existing }} 门课（不勾选则追加）</label>
        <button type="button" class="act primary" :disabled="!ready.length" @click="confirm">{{ ready.length === classes.length ? `确认导入 ${ready.length} 门课` : `确认 ${ready.length} 门课（其余缺时间）` }}</button>
      </template>
      <p v-else-if="!loading && !error" class="muted">没有识别到课程，请换一张更清晰的截图。</p>
    </div>
  </section>
</template>

<style scoped>
.schedule-preview { margin-top: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
.schedule-head { display: flex; justify-content: space-between; align-items: center; }
.schedule-preview table { width: 100%; margin: 10px 0; border-collapse: collapse; font-size: 11px; }
.schedule-preview th, .schedule-preview td { padding: 5px; border-bottom: 1px solid var(--line); text-align: left; }
.schedule-preview td input { width: 100%; box-sizing: border-box; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 4px; font: inherit; }
.replace { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 12.5px; color: var(--ink-2); }
.error { color: #b13c37; font-size: 13px; }
.warning { color: #8b640e; font-size: 12px; }
</style>
