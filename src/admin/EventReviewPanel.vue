<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { admin, notify } from './store'
import { CATEGORY_LABELS, decideReview, formatTime, loadReview, pipeline, SOURCE_LABELS, toLocalInput, type ReviewItem } from './eventPipeline'

type Draft = { title: string; start: string; end: string; allDay: boolean; venueRaw: string; place: string; room: string; organizer: string; category: string }
const selectedId = ref('')
const draft = ref<Draft | null>(null)
const busy = ref(false), error = ref('')
const selected = computed(() => pipeline.review.find((item) => item.id === selectedId.value) ?? null)
const buildings = computed(() => [...admin.places.buildings].sort((a, b) => a.name.zh.localeCompare(b.name.zh, 'zh')))
const tabs = [{ state: 'pending', label: '待审核' }, { state: 'approved', label: '已通过' }, { state: 'rejected', label: '已拒绝' }] as const

onMounted(() => { void loadReview('pending') })
watch(() => pipeline.review, (items) => { if (!items.some((item) => item.id === selectedId.value)) select(items[0] ?? null) }, { immediate: true })
function select(item: ReviewItem | null) {
  selectedId.value = item?.id ?? ''; error.value = ''
  draft.value = item ? {
    title: item.event.title, start: toLocalInput(item.event.start), end: toLocalInput(item.event.end), allDay: item.event.allDay,
    venueRaw: item.event.venueRaw, place: item.event.place ?? '', room: item.event.room, organizer: item.event.organizer, category: item.event.category,
  } : null
}
async function decide(decision: 'approve' | 'reject') {
  const item = selected.value
  if (!item || !draft.value || busy.value) return
  if (decision === 'approve' && (!draft.value.title.trim() || !draft.value.start)) { error.value = '请先填写标题和开始时间'; return }
  busy.value = true; error.value = ''
  const index = pipeline.review.indexOf(item)
  try {
    const d = draft.value
    await decideReview(item, decision, decision === 'approve' ? { ...d, place: d.place || null, end: d.end || null } : undefined)
    select(pipeline.review[Math.min(index, pipeline.review.length - 1)] ?? null)
  } catch (e) { error.value = (e as Error).message; notify(error.value, 'error') }
  finally { busy.value = false }
}
const placeName = (id: string | null) => admin.places.buildings.find((b) => b.id === id)?.name.zh ?? ''
</script>

<template>
  <div class="review">
    <div class="review-tabs" role="tablist">
      <button v-for="tab in tabs" :key="tab.state" role="tab" :aria-selected="pipeline.reviewState === tab.state" :class="{ active: pipeline.reviewState === tab.state }" @click="loadReview(tab.state)">
        {{ tab.label }}<span v-if="pipeline.status">{{ pipeline.status.review[tab.state] }}</span>
      </button>
    </div>
    <div v-if="pipeline.reviewLoading && !pipeline.review.length" class="data-card empty-state">正在加载…</div>
    <div v-else-if="!pipeline.review.length" class="data-card empty-state">
      <Ico name="check" /><h3>{{ pipeline.reviewState === 'pending' ? '没有待审核的活动' : '这里还是空的' }}</h3>
      <p>{{ pipeline.reviewState === 'pending' ? '自动抓取中解析不了或可疑的条目会出现在这里，确认后才会上线。' : '处理过的条目会保留在这里备查。' }}</p>
    </div>
    <div v-else class="review-columns">
      <section class="data-card review-list" aria-label="条目列表">
        <button v-for="item in pipeline.review" :key="item.id" class="review-item" :class="{ active: item.id === selectedId }" @click="select(item)">
          <span class="review-item-top"><em :class="item.source">{{ SOURCE_LABELS[item.source] ?? item.source }}</em><small>{{ formatTime(item.createdAt) }}</small></span>
          <b>{{ item.event.title || '（无标题）' }}</b>
          <small>{{ item.event.start ? formatTime(item.event.start) : '时间未知' }} · {{ placeName(item.event.place) || item.event.venueRaw || '地点未知' }}</small>
          <span v-if="item.reasons.length" class="reason-line">{{ item.reasons[0] }}<template v-if="item.reasons.length > 1"> 等 {{ item.reasons.length }} 项</template></span>
        </button>
      </section>

      <section v-if="selected && draft" class="data-card review-detail">
        <header class="review-detail-head">
          <div><h2>{{ selected.status === 'pending' ? '核对后上线' : selected.status === 'approved' ? '已通过' : '已拒绝' }}</h2><p v-if="selected.decidedAt">处理于 {{ formatTime(selected.decidedAt) }}</p></div>
          <ul class="reasons"><li v-for="r in selected.reasons" :key="r"><Ico name="target" />{{ r }}</li></ul>
        </header>
        <div class="review-body">
          <form class="review-form" @submit.prevent="decide('approve')">
            <fieldset :disabled="selected.status !== 'pending' || busy">
              <label class="wide">活动标题<input v-model="draft.title" required maxlength="160" /></label>
              <label>开始时间<input v-model="draft.start" type="datetime-local" required /></label>
              <label>结束时间<span class="optional">选填</span><input v-model="draft.end" type="datetime-local" /></label>
              <label class="check"><input v-model="draft.allDay" type="checkbox" />全天活动（没有具体时刻）</label>
              <label class="wide">原文地点<input v-model="draft.venueRaw" maxlength="240" placeholder="邮件或官网里写的地点" /></label>
              <label>地图上的楼<select v-model="draft.place"><option value="">不在校内 / 线上</option><option v-for="b in buildings" :key="b.id" :value="b.id">{{ b.name.zh }}</option></select></label>
              <label>房间号<span class="optional">选填</span><input v-model="draft.room" maxlength="80" placeholder="如 1C-101" /></label>
              <label>分类<select v-model="draft.category"><option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option></select></label>
              <label>主办单位<input v-model="draft.organizer" maxlength="120" /></label>
            </fieldset>
            <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
            <div v-if="selected.status === 'pending'" class="review-actions">
              <button class="button primary" :disabled="busy"><Ico name="check" />{{ busy ? '处理中…' : '通过并上线' }}</button>
              <button type="button" class="button secondary danger-outline" :disabled="busy" @click="decide('reject')"><Ico name="close" />拒绝</button>
              <span class="hint">拒绝后，同一条目以后不会再进入队列。</span>
            </div>
          </form>
          <aside class="review-source">
            <h3>原始信息</h3>
            <template v-if="selected.context.kind === 'email'">
              <dl><dt>主题</dt><dd>{{ selected.context.subject }}</dd><dt>发件人</dt><dd>{{ selected.context.from }}</dd><dt>发信时间</dt><dd>{{ formatTime(selected.context.date) }}</dd></dl>
              <pre v-if="selected.context.excerpt">{{ selected.context.excerpt }}</pre>
            </template>
            <dl v-else><template v-for="(value, key) in selected.context.fields" :key="key"><dt>{{ key }}</dt><dd>{{ value || '（空）' }}</dd></template></dl>
            <a v-if="selected.event.url" :href="selected.event.url" target="_blank" rel="noopener" class="text-button">打开官网原文<Ico name="external" /></a>
          </aside>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.review { display: grid; gap: 14px; }
.review-tabs { display: flex; gap: 6px; }
.review-tabs button { display: flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: 7px; background: transparent; color: #5f6f65; font-size: 13px; }
.review-tabs button.active { background: #fff; box-shadow: 0 0 0 1px var(--line); color: #1f3d30; font-weight: 600; }
.review-tabs span { font-size: 11px; padding: 0 6px; border-radius: 8px; background: #edf1ee; color: #5f6f65; }
.review-columns { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 18px; align-items: start; }
.review-list { max-height: calc(100dvh - 260px); overflow: auto; }
.review-item { display: grid; gap: 4px; width: 100%; padding: 13px 16px; text-align: left; background: #fff; border-bottom: 1px solid #eef2ef; }
.review-item:hover { background: #f8faf9; }
.review-item.active { background: #eef6f1; box-shadow: inset 3px 0 #28634e; }
.review-item b { font-size: 13px; line-height: 1.4; }
.review-item small { color: #7a877f; font-size: 12px; }
.review-item-top { display: flex; justify-content: space-between; align-items: center; }
.review-item em { font-style: normal; font-size: 11px; padding: 0 7px; border-radius: 4px; background: #edf1ee; color: #4d6356; }
.review-item em.email { background: #eef0fb; color: #4a57a0; }
.reason-line { font-size: 12px; color: #a24c32; }
.review-detail-head { display: flex; justify-content: space-between; gap: 16px; padding: 18px 20px; border-bottom: 1px solid var(--line); }
.review-detail-head p { font-size: 12px; color: var(--muted); }
.reasons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin: 0; padding: 0; list-style: none; }
.reasons li { display: flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; background: #fdf0ec; color: #9b4530; font-size: 12px; }
.review-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); }
.review-form { padding: 20px; display: grid; gap: 14px; align-content: start; }
.review-form fieldset { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 0; padding: 0; border: 0; min-width: 0; }
.review-form label { display: grid; gap: 5px; font-size: 12px; color: #4f6155; font-weight: 500; }
.review-form label.wide, .review-form label.check { grid-column: 1 / -1; }
.review-form label.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.review-form input:not([type=checkbox]), .review-form select { width: 100%; }
.optional { margin-left: 6px; font-weight: 400; color: #9aa59e; }
label:has(.optional) { grid-template-rows: auto auto; }
.review-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.review-actions .hint { font-size: 12px; color: var(--muted); }
.danger-outline:hover:not(:disabled) { color: #a33a36 !important; border-color: #d9a49e !important; background: #fff6f4 !important; }
.review-source { padding: 20px; border-left: 1px solid var(--line); background: #fafbfa; display: grid; gap: 10px; align-content: start; }
.review-source h3 { font-size: 13px; color: #4f6155; }
.review-source dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; margin: 0; font-size: 12px; }
.review-source dt { color: var(--muted); }
.review-source dd { margin: 0; word-break: break-word; }
.review-source pre { margin: 0; padding: 10px; border-radius: 8px; background: #fff; border: 1px solid var(--line); font: 12px/1.6 inherit; white-space: pre-wrap; max-height: 320px; overflow: auto; }
.empty-state h3 { color: #3f574a; font-size: 14px; }
@media (max-width: 1100px) { .review-body { grid-template-columns: 1fr; } .review-source { border-left: 0; border-top: 1px solid var(--line); } }
@media (max-width: 760px) { .review-columns { grid-template-columns: 1fr; } .review-list { max-height: 280px; } .review-form fieldset { grid-template-columns: 1fr; } }
</style>
