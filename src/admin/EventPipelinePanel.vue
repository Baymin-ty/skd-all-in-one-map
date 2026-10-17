<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { formatTime, loadPipeline, pipeline, relativeTime, runPipeline, running, SOURCE_LABELS, type PipelineRun, type PipelineSource } from './eventPipeline'

const emit = defineEmits<{ review: [] }>()
const now = ref(Date.now())
let clock = 0
onMounted(() => { void loadPipeline(); clock = window.setInterval(() => now.value = Date.now(), 30_000) })
onBeforeUnmount(() => window.clearInterval(clock))
// 每次拿到新状态都校准“几分钟前”的参照时间。
watch(() => pipeline.status, () => { now.value = Date.now() })

const status = computed(() => pipeline.status)
const sourceLabel = (id: string) => status.value?.sources.find((s) => s.id === id)?.label ?? id
function state(source: PipelineSource) {
  if (source.running) return { tone: 'running', text: '运行中' }
  if (!source.configured) return { tone: 'idle', text: '未配置' }
  if (!source.lastRun) return { tone: 'idle', text: '等待首次运行' }
  if (source.lastRun.status === 'error') return { tone: 'error', text: '上次失败' }
  return { tone: 'ok', text: '正常' }
}
function runState(run: PipelineRun) {
  return { running: '运行中', ok: '成功', error: '失败', skipped: '未配置' }[run.status]
}
const duration = (run: PipelineRun) => run.finishedAt ? `${Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))} 秒` : '—'
const breakdown = computed(() => Object.entries(status.value?.catalog.bySource ?? {}).map(([key, n]) => `${SOURCE_LABELS[key] ?? key} ${n}`).join(' · '))
const lastSuccess = computed(() => Math.max(0, ...(status.value?.sources.map((s) => s.lastSuccessAt ?? 0) ?? [])))
const lastSuccessAge = computed(() => {
  if (!lastSuccess.value) return '还没有成功运行过'
  // 后端写入完成时间和浏览器采样时间可能相差几毫秒；成功记录不应显示成未来时间。
  return lastSuccess.value > now.value ? '刚刚' : relativeTime(lastSuccess.value, now.value)
})
</script>

<template>
  <div class="pipeline">
    <div v-if="pipeline.error && !status" class="editor-error" role="alert">{{ pipeline.error }} <button class="text-button" @click="loadPipeline()">重试</button></div>
    <p v-else-if="!status" class="muted">正在读取数据管道状态…</p>
    <template v-else>
      <div class="pipeline-summary">
        <div><small>已上线活动</small><b>{{ status.catalog.total }}</b><span>{{ breakdown || '—' }}</span></div>
        <button class="summary-review" :class="{ attention: status.review.pending }" @click="emit('review')"><small>待审核</small><b>{{ status.review.pending }}</b><span>{{ status.review.pending ? '点这里逐条确认后上线' : '没有需要处理的条目' }}</span></button>
        <div><small>最近一次成功更新</small><b class="time">{{ lastSuccessAge }}</b><span>{{ lastSuccess ? formatTime(lastSuccess) : '还没有成功运行过' }}</span></div>
        <div class="summary-action">
          <button class="button primary" :disabled="running() || !!pipeline.starting" @click="runPipeline()"><Ico name="refresh" />{{ running() ? '正在运行…' : '全部立即运行' }}</button>
          <small>{{ status.schedule ? '后台按各数据源的周期自动运行' : '自动运行已关闭' }}</small>
        </div>
      </div>

      <div class="source-grid">
        <article v-for="source in status.sources" :key="source.id" class="source-card" :class="state(source).tone">
          <header>
            <span class="source-icon"><Ico :name="source.kind === 'email' ? 'chat' : 'academic'" /></span>
            <div><h3>{{ source.label }}</h3><p>{{ source.target || '尚未连接' }}</p></div>
            <span class="state-chip" :class="state(source).tone"><i />{{ state(source).text }}</span>
          </header>
          <p class="source-desc">{{ source.description }}</p>
          <div v-if="!source.configured" class="source-hint"><Ico name="lock" /><span>{{ source.hint }}，然后重启后端。</span></div>
          <template v-else>
            <dl class="source-stats">
              <div><dt>新增</dt><dd>{{ source.lastRun?.added ?? '—' }}</dd></div>
              <div><dt>更新</dt><dd>{{ source.lastRun?.updated ?? '—' }}</dd></div>
              <div v-if="source.id === 'official'"><dt>取消</dt><dd>{{ source.lastRun?.cancelled ?? '—' }}</dd></div>
              <div :class="{ warn: source.lastRun?.review }"><dt>待审核</dt><dd>{{ source.lastRun?.review ?? '—' }}</dd></div>
              <div><dt>{{ source.kind === 'email' ? '读取邮件' : '抓取条目' }}</dt><dd>{{ source.lastRun?.scanned ?? '—' }}</dd></div>
              <div v-if="source.kind === 'email'"><dt>忽略</dt><dd>{{ source.lastRun?.skipped ?? '—' }}</dd></div>
            </dl>
            <div v-if="source.lastRun?.status === 'error'" class="source-error" role="alert"><b>错误</b>{{ source.lastRun.error }}</div>
            <ul v-if="source.lastRun?.warnings.length" class="source-warnings"><li v-for="w in source.lastRun.warnings.slice(0, 3)" :key="w">{{ w }}</li></ul>
            <footer>
              <span><Ico name="clock" />上次 {{ source.lastRun ? `${relativeTime(source.lastRun.startedAt, now)}（${source.lastRun.trigger === 'manual' ? '手动' : '定时'}）` : '从未运行' }}<template v-if="source.nextRunAt"> · 下次 {{ relativeTime(source.nextRunAt, now) }}</template> · 每 {{ source.intervalMinutes >= 60 ? `${source.intervalMinutes / 60} 小时` : `${source.intervalMinutes} 分钟` }}</span>
              <button class="button secondary" :disabled="source.running || !!pipeline.starting" @click="runPipeline(source.id)"><Ico name="play" />{{ source.running ? '运行中…' : '立即运行' }}</button>
            </footer>
          </template>
        </article>
      </div>

      <section class="data-card run-log">
        <header class="section-heading"><h2>运行记录</h2><span class="count-tag">最近 {{ status.runs.length }} 次</span></header>
        <div class="run-table" role="table">
          <div class="run-row head" role="row"><span>开始时间</span><span>数据源</span><span>方式</span><span>结果</span><span>新增 / 更新 / 待审</span><span>耗时</span></div>
          <div v-for="run in status.runs" :key="run.id" class="run-row" role="row">
            <span>{{ formatTime(run.startedAt) }}</span>
            <span>{{ sourceLabel(run.source) }}</span>
            <span>{{ run.trigger === 'manual' ? '手动' : '定时' }}</span>
            <span><em class="run-status" :class="run.status">{{ runState(run) }}</em><small v-if="run.error" :title="run.error">{{ run.error }}</small></span>
            <span>{{ run.added }} / {{ run.updated }} / {{ run.review }}</span>
            <span>{{ duration(run) }}</span>
          </div>
          <p v-if="!status.runs.length" class="empty-state">还没有运行记录。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pipeline { display: grid; gap: 18px; }
.muted { color: var(--muted); }
.pipeline-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 1px; border: 1px solid var(--line); border-radius: 10px; background: var(--line); overflow: hidden; }
.pipeline-summary > * { display: flex; flex-direction: column; gap: 3px; padding: 16px 20px; background: #fff; text-align: left; }
.pipeline-summary small { color: var(--muted); font-size: 12px; }
.pipeline-summary b { font-size: 26px; font-weight: 650; letter-spacing: -.5px; color: #1f3d30; }
.pipeline-summary b.time { font-size: 20px; line-height: 39px; }
.pipeline-summary span { font-size: 12px; color: #7a877f; }
.summary-review { cursor: pointer; }
.summary-review:hover { background: #f7faf8; }
.summary-review.attention b { color: #b0472f; }
.summary-review.attention { box-shadow: inset 3px 0 #c0533f; }
.summary-action { justify-content: center; align-items: flex-end; }
.source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 18px; }
.source-card { display: flex; flex-direction: column; gap: 14px; padding: 20px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.source-card.error { border-color: #e6c3bc; }
.source-card header { display: flex; align-items: center; gap: 12px; }
.source-card header > div { flex: 1; min-width: 0; }
.source-card h3 { font-size: 15px; }
.source-card header p { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 9px; background: #edf4ef; color: #28634e; font-size: 19px; }
.state-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 20px; font-size: 12px; background: #f0f2f1; color: #68766d; white-space: nowrap; }
.state-chip i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.state-chip.ok { background: #e7f3eb; color: #2e7a4f; }
.state-chip.error { background: #fbeae6; color: #a8412f; }
.state-chip.running { background: #e8f0fb; color: #3266a8; }
.state-chip.running i { animation: pulse 1s infinite alternate; }
@keyframes pulse { from { opacity: 1 } to { opacity: .2 } }
.source-desc { font-size: 13px; color: #56675c; line-height: 1.6; }
.source-hint { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; background: #fbf6ea; color: #7d6327; font-size: 12px; }
.source-hint .svgi { margin-top: 3px; }
.source-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 8px; margin: 0; }
.source-stats div { padding: 9px 10px; border-radius: 8px; background: #f6f8f7; }
.source-stats dt { font-size: 11px; color: var(--muted); }
.source-stats dd { margin: 2px 0 0; font-size: 18px; font-weight: 600; color: #26402f; }
.source-stats .warn { background: #fdf0ec; }
.source-stats .warn dd { color: #b0472f; }
.source-error { padding: 10px 12px; border-radius: 8px; background: #fff3f0; color: #a33a36; font-size: 12px; word-break: break-all; }
.source-error b { margin-right: 8px; }
.source-warnings { margin: 0; padding-left: 18px; font-size: 12px; color: #8a6d2c; }
.source-card footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); }
.source-card footer > span { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.run-table { font-size: 13px; }
.run-row { display: grid; grid-template-columns: 120px 150px 60px minmax(160px, 1fr) 130px 70px; gap: 12px; align-items: center; padding: 10px 20px; border-bottom: 1px solid #eef2ef; }
.run-row.head { font-size: 12px; color: var(--muted); background: #fafbfa; }
.run-row small { display: block; font-size: 11px; color: #a33a36; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.run-status { font-style: normal; font-size: 12px; padding: 1px 8px; border-radius: 10px; background: #f0f2f1; }
.run-status.ok { background: #e7f3eb; color: #2e7a4f; }
.run-status.error { background: #fbeae6; color: #a8412f; }
.run-status.running { background: #e8f0fb; color: #3266a8; }
@media (max-width: 1100px) { .pipeline-summary { grid-template-columns: 1fr 1fr; } .summary-action { align-items: flex-start; } }
@media (max-width: 760px) {
  .pipeline-summary { grid-template-columns: 1fr; }
  .source-grid { grid-template-columns: 1fr; }
  .run-row { grid-template-columns: 1fr 1fr; padding: 10px 14px; }
  .run-row.head { display: none; }
}
</style>
