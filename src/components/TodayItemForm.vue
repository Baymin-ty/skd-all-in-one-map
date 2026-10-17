<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { discovery } from '../lib/discoveryData'
import { ACADEMIC_TERMS, formatWeekRanges, parseWeeks } from '../lib/academicCalendar'
import { placeName, placeSelection, search, toast, type SearchHit } from '../lib/store'
import { addItem, itemsOn, overlaps, plan, PLAN_KINDS, updateItem, weekdayOf, type PlanItem, type PlanKind } from '../lib/today'
import Ico from './Ico.vue'

/** classOnly：在「我的」课表里用，只编辑每周重复的课程 */
const props = defineProps<{ item: PlanItem | null; date: string; classOnly?: boolean }>()
const emit = defineEmits<{ done: [] }>()
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const form = reactive({
  kind: props.item?.kind ?? 'class' as PlanKind,
  title: props.item?.title ?? '',
  place: props.item?.place ?? '',
  room: props.item?.room ?? '',
  start: props.item?.start ?? '08:00',
  end: props.item?.end ?? '',
  weekly: props.classOnly || (props.item ? !!props.item.weekdays?.length : true),
  weekdays: props.item?.weekdays ?? [weekdayOf(props.date)],
  weeksText: props.item?.weeks?.length ? formatWeekRanges(props.item.weeks) : '',
  term: props.item?.term ?? ACADEMIC_TERMS[0].key,
  note: props.item?.note ?? '',
})
const q = ref('')
const placeLabel = computed(() => {
  const sel = placeSelection(form.place)
  return [sel && placeName(sel), form.room].filter(Boolean).join(' · ')
})
// 只要能落到一个地点的结果：楼、点位、教室号、食堂
const hits = computed(() => q.value.trim() ? search(q.value).filter((h) => ['building', 'poi', 'room', 'canteen'].includes(h.sel.kind)).slice(0, 6) : [])
function pick(h: SearchHit) {
  const sel = h.sel
  if (sel.kind === 'room') { form.place = sel.id; form.room = sel.room.code }
  else if (sel.kind === 'canteen') { form.place = discovery.canteens.find((c) => c.id === sel.id)?.place ?? ''; form.room = '' }
  else if (sel.kind === 'building' || sel.kind === 'poi') { form.place = sel.id; form.room = '' }
  if (!form.title.trim()) form.title = h.name
  q.value = ''
}
function toggleDay(d: number) {
  form.weekdays = form.weekdays.includes(d) ? form.weekdays.filter((x) => x !== d) : [...form.weekdays, d].sort()
}
const error = ref('')
function save() {
  error.value = ''
  if (!form.title.trim()) return void (error.value = '写一下这是什么安排')
  if (form.end && form.end <= form.start) return void (error.value = '结束时间要晚于开始时间')
  const weekly = form.kind === 'class' && form.weekly
  const weeks = weekly ? parseWeeks(form.weeksText) : []
  if (weekly && !form.weekdays.length) return void (error.value = '至少选一天')
  const data: Omit<PlanItem, 'id'> = {
    kind: form.kind, title: form.title.trim(), place: form.place || undefined, room: form.room.trim() || undefined,
    start: form.start, end: form.end || undefined, note: form.note.trim() || undefined,
    date: weekly ? undefined : props.item?.date ?? props.date, weekdays: weekly ? form.weekdays : undefined,
    weeks: weeks.length ? weeks : undefined, term: weeks.length ? form.term : undefined,
    eventId: props.item?.eventId, source: props.item?.source ?? 'manual',
  }
  const probe = { ...data, id: props.item?.id ?? '' }
  const clash = itemsOn(plan.items, props.date).find((i) => i.id !== probe.id && overlaps(i, probe))
  if (props.item) updateItem(props.item.id, data)
  else addItem(data)
  toast(clash ? `已保存，和「${clash.title}」时间重叠` : '已保存')
  emit('done')
}
</script>

<template>
  <form class="form plan-form" @submit.prevent="save">
    <div v-if="!classOnly" class="kind-switch" role="radiogroup" aria-label="类型">
      <button v-for="(k, key) in PLAN_KINDS" :key="key" type="button" role="radio" :aria-checked="form.kind === key" :class="{ on: form.kind === key }" @click="form.kind = key"><Ico :name="k.icon" />{{ k.zh }}</button>
    </div>
    <label>{{ classOnly ? '课程名' : '名称' }}<input v-model="form.title" type="text" maxlength="80" :placeholder="classOnly ? '例如：线性代数' : '例如：线性代数、取快递'" /></label>
    <label>地点
      <span v-if="form.place" class="picked"><Ico name="pin" />{{ placeLabel }}<button type="button" aria-label="清除地点" @click="form.place = ''; form.room = ''"><Ico name="close" /></button></span>
      <input v-model="q" type="search" :placeholder="form.place ? '换一个地点' : '搜楼名或教室号，如 SEM501、1A-108'" aria-label="搜索地点" />
    </label>
    <ul v-if="hits.length" class="list-plain place-hits">
      <li v-for="h in hits" :key="h.sel.kind + h.name + h.sub"><button type="button" @click="pick(h)"><Ico :name="h.icon" /><span><b>{{ h.name }}</b><small>{{ h.sub }}</small></span></button></li>
    </ul>
    <div class="times">
      <label>开始<input v-model="form.start" type="time" required /></label>
      <label>结束<input v-model="form.end" type="time" /></label>
    </div>
    <template v-if="form.kind === 'class'">
      <label v-if="!classOnly" class="check"><input v-model="form.weekly" type="checkbox" />每周重复</label>
      <span v-else class="days-label">每周上课的日子</span>
      <div v-if="form.weekly" class="weekdays" aria-label="上课的星期">
        <button v-for="(w, i) in WEEKDAYS" :key="w" type="button" :class="{ on: form.weekdays.includes(i + 1) }" :aria-pressed="form.weekdays.includes(i + 1)" @click="toggleDay(i + 1)">{{ w }}</button>
      </div>
      <div v-if="form.weekly" class="term-weeks">
        <label>校历学期<select v-model="form.term"><option v-for="term in ACADEMIC_TERMS" :key="term.key" :value="term.key">{{ term.label }}</option></select></label>
        <label>教学周次<input v-model="form.weeksText" placeholder="如 1-4,6；留空=整个学期" /></label>
      </div>
    </template>
    <label>备注<input v-model="form.note" type="text" maxlength="120" placeholder="可不填" /></label>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions">
      <button type="submit" class="act primary">保存</button>
      <button type="button" class="act" @click="emit('done')">取消</button>
    </div>
  </form>
</template>

<style scoped>
.plan-form { margin-top: 16px; padding: 14px; border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.kind-switch, .weekdays { display: flex; gap: 6px; }
.kind-switch button, .weekdays button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px; height: 34px; border: 1px solid var(--line); border-radius: 10px; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.kind-switch button.on, .weekdays button.on { background: var(--brand-soft); border-color: #e9c8cb; color: var(--brand); }
.weekdays button { height: 30px; padding: 0; }
.picked { display: flex; align-items: center; gap: 5px; padding: 6px 8px 6px 10px; border-radius: 10px; background: var(--brand-soft); color: var(--brand); font-size: 13px; }
.picked button { margin-left: auto; border: 0; background: none; color: inherit; cursor: pointer; display: grid; place-items: center; }
.place-hits { margin-top: -6px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.place-hits button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--line); background: #fff; text-align: left; cursor: pointer; }
.place-hits li:last-child button { border-bottom: 0; }
.place-hits button:hover { background: var(--bg-2); }
.place-hits b { display: block; font-size: 13px; }
.place-hits small { display: block; font-size: 11.5px; color: var(--ink-3); }
.times { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.term-weeks { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check { flex-direction: row !important; align-items: center; gap: 6px !important; }
.days-label { margin-bottom: -4px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.plan-form .actions { margin: 4px 0 0; }
</style>
