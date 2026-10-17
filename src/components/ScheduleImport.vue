<script setup lang="ts">
import { computed, ref } from 'vue'
import { importItems, isWeeklyClass, plan, type PlanItem } from '../lib/today'
import { ACADEMIC_TERMS, formatWeekRanges, parseWeeks, termForDate, type AcademicTermKey } from '../lib/academicCalendar'
import { dateKey } from '../lib/campusTime'
import { discovery } from '../lib/discoveryData'
import { scheduleNote } from '../lib/scheduleImport'
import { buildRoomIndex, resolveRoomPlace } from '../lib/roomSearch'
import { state, toast } from '../lib/store'
import Ico from './Ico.vue'

type Parsed = { title: string; weekday: number; start: string; end: string; room: string; weeks?: number[]; weeksText: string; teacher?: string }
const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const open = ref(false), file = ref<HTMLInputElement>(), loading = ref(false), error = ref(''), warnings = ref<string[]>([]), classes = ref<Parsed[]>([])
const currentTerm = termForDate(dateKey())?.key ?? ACADEMIC_TERMS[0].key
const termKey = ref<AcademicTermKey>(currentTerm)
const selectedTerm = computed(() => ACADEMIC_TERMS.find((term) => term.key === termKey.value) ?? ACADEMIC_TERMS[0])
const existing = computed(() => plan.items.filter(isWeeklyClass).length)
/** 重新导入通常是换学期或识别错了：默认替换旧课表，避免同一门课出现两遍 */
const replace = ref(true)
const ready = computed(() => classes.value.filter((item) => item.title.trim() && item.weekday >= 1 && item.weekday <= 7 && /^\d\d:\d\d$/.test(item.start) && /^\d\d:\d\d$/.test(item.end)))
function blankClass(): Parsed { return { title: '', weekday: 1, start: '08:00', end: '09:40', room: '', weeks: undefined, weeksText: '', teacher: '' } }
function addClass() { classes.value.push(blankClass()) }
function removeClass(index: number) { classes.value.splice(index, 1) }
function roomPlace(room?: string) {
  const value = room?.trim() ?? ''
  const hit = value ? resolveRoomPlace(value, buildRoomIndex(state.buildings, state.groups, discovery.events)) : null
  return hit ? state.buildings.find((building) => building.id === hit.building)?.name.zh ?? '已关联地图' : ''
}
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
    classes.value = (body.classes || []).map((item: Parsed) => ({ ...item, weeksText: item.weeks?.length ? formatWeekRanges(item.weeks) : '' })); warnings.value = body.warnings || []
  }
  catch (e) { error.value = e instanceof Error ? e.message : '课表识别失败' }
  finally { loading.value = false }
}
function confirm() {
  if (!ready.value.length) { toast('请先补齐至少一门课的开始和结束时间'); return }
  const items: Omit<PlanItem, 'id'>[] = ready.value.map((item) => {
    const weeks = parseWeeks(item.weeksText)
    const room = String(item.room ?? '').trim()
    const place = room ? resolveRoomPlace(room, buildRoomIndex(state.buildings, state.groups, discovery.events))?.building : undefined
    return { kind: 'class', title: item.title.trim(), start: item.start, end: item.end, place, room: room || undefined, note: scheduleNote({ ...item, weeks }), weekdays: [item.weekday], weeks: weeks.length ? weeks : undefined, term: termKey.value, source: 'ai' }
  })
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
        <p class="muted">核对后直接导入；周次支持输入区间，教室会自动关联地图。</p>
        <p class="preview-summary"><b>{{ ready.length }}</b> / {{ classes.length }} 门课程 · {{ selectedTerm.label }} · 共 {{ selectedTerm.weeks }} 周</p>
        <div class="schedule-options">
          <label>校历学期<select v-model="termKey"><option v-for="term in ACADEMIC_TERMS" :key="term.key" :value="term.key">{{ term.label }}（{{ term.start }}–{{ term.end }}）</option></select></label>
          <button type="button" class="act small" @click="addClass"><Ico name="plus" />添加课程</button>
        </div>
        <table>
          <thead><tr><th>课程</th><th>星期</th><th>时间</th><th>教室</th><th>周次</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in classes" :key="index">
              <td data-label="课程"><input v-model="item.title" aria-label="课程名" /><input v-model="item.teacher" placeholder="教师（可不填）" aria-label="教师" /></td>
              <td data-label="星期"><select v-model.number="item.weekday" aria-label="星期"><option v-for="(day, dayIndex) in WEEKDAYS.slice(1)" :key="day" :value="dayIndex + 1">{{ day }}</option></select></td>
              <td data-label="时间"><input v-model="item.start" placeholder="HH:MM" aria-label="开始时间" /><input v-model="item.end" placeholder="HH:MM" aria-label="结束时间" /></td>
              <td data-label="教室"><input v-model="item.room" placeholder="如 信息学院1D106" aria-label="教室" /><small v-if="roomPlace(item.room)" class="room-ok">{{ roomPlace(item.room) }} · 可导航</small></td>
              <td data-label="周次"><input v-model="item.weeksText" placeholder="如 1-16" aria-label="教学周次" /><small>留空=整个学期</small></td>
              <td data-label="操作"><button type="button" class="icon-btn danger" aria-label="删除课程" @click="removeClass(index)"><Ico name="trash" /></button></td>
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
.preview-summary { margin: 7px 0 2px; color: var(--ink-2); font-size: 12px; }
.preview-summary b { color: var(--brand); }
.schedule-preview table { width: 100%; margin: 10px 0; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
.schedule-preview th, .schedule-preview td { padding: 5px; border-bottom: 1px solid var(--line); text-align: left; }
.schedule-preview th:nth-child(1) { width: 25%; } .schedule-preview th:nth-child(2) { width: 10%; } .schedule-preview th:nth-child(3) { width: 15%; } .schedule-preview th:nth-child(4) { width: 22%; } .schedule-preview th:nth-child(5) { width: 20%; } .schedule-preview th:nth-child(6) { width: 8%; }
.schedule-preview td input, .schedule-preview td select, .schedule-options select { width: 100%; box-sizing: border-box; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 4px; font: inherit; }
.schedule-preview td small { display: block; margin-top: 3px; color: var(--ink-3); font-size: 9px; white-space: nowrap; }
.schedule-preview td .room-ok { color: #247a55; }
.schedule-options { display: flex; align-items: end; gap: 8px; margin: 8px 0; }
.schedule-options label { flex: 1; color: var(--ink-2); font-size: 11px; }
.schedule-options select { display: block; margin-top: 4px; }
.icon-btn { border: 0; background: none; cursor: pointer; }
.icon-btn.danger { color: #b3261e; }
.replace { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 12.5px; color: var(--ink-2); }
.error { color: #b13c37; font-size: 13px; }
.warning { color: #8b640e; font-size: 12px; }
@media (max-width: 680px) {
  .schedule-preview { padding: 10px; }
  .schedule-preview table, .schedule-preview tbody, .schedule-preview tr, .schedule-preview td { display: block; }
  .schedule-preview thead { display: none; }
  .schedule-preview tr { display: grid; grid-template-columns: minmax(0, 1fr) 74px; gap: 7px 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .schedule-preview tr:last-child { border-bottom: 0; }
  .schedule-preview td { padding: 0; border: 0; }
  .schedule-preview td::before { content: attr(data-label); display: block; margin: 0 0 3px; color: var(--ink-3); font-size: 10px; }
  .schedule-preview td:nth-child(1), .schedule-preview td:nth-child(4) { grid-column: 1 / -1; }
  .schedule-preview td:nth-child(6) { grid-column: 2; grid-row: 4; justify-self: end; }
  .schedule-preview td:nth-child(6)::before { display: none; }
  .schedule-preview td:nth-child(6) .icon-btn { margin-top: 4px; }
}
</style>
