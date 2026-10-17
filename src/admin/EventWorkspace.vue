<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import qrcode from 'qrcode-generator'
import { demoClockEnabled, nowTick } from '../lib/campusTime'
import { admin, notify, request } from './store'
import { CATEGORY_LABELS, formatTime, pipeline, stopPipelinePoll, toLocalInput } from './eventPipeline'
import EventPipelinePanel from './EventPipelinePanel.vue'
import EventReviewPanel from './EventReviewPanel.vue'
import Ico from '../components/Ico.vue'

type Tab = 'pipeline' | 'review' | 'organizer'
const tab = ref<Tab>((sessionStorage.getItem('admin.events.tab') as Tab) || 'pipeline')
watch(tab, (value) => { try { sessionStorage.setItem('admin.events.tab', value) } catch { /* 无存储 */ } })
const tabs = computed(() => [
  { id: 'pipeline' as const, label: '数据管道', icon: 'refresh' as const },
  { id: 'review' as const, label: '待审核', icon: 'check' as const, badge: pipeline.status?.review.pending || 0 },
  { id: 'organizer' as const, label: '主办方发布', icon: 'users' as const },
])

type EventDraft = { id?: string; title: string; title_en: string; desc_en: string; start: string; end: string; venueRaw: string; place: string; room: string; category: string; organizer: string }
const events = ref<any[]>([]), loading = ref(false), saving = ref(false), error = ref('')
const draft = ref<EventDraft>(empty())
const baseline = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value)
const buildings = computed(() => [...admin.places.buildings].sort((a, b) => a.name.zh.localeCompare(b.name.zh, 'zh')))
const placeName = (id: string) => admin.places.buildings.find((b) => b.id === id)?.name.zh ?? ''
const checkin = ref<{ eventId: string; code: string; expiresAt: number } | null>(null)
let checkinTimer = 0
function empty(): EventDraft { return { title: '', title_en: '', desc_en: '', start: '', end: '', venueRaw: '', place: '', room: '', category: 'lecture', organizer: '' } }
async function loadEvents() {
  if (!admin.loggedIn) return
  loading.value = true; error.value = ''
  try { events.value = await request<any[]>('/api/organizer/events') }
  catch (e) { error.value = e instanceof Error ? e.message : '活动加载失败' }
  finally { loading.value = false }
}
function edit(event: any) {
  if (dirty.value && !confirm('当前活动还有未保存的修改，放弃这些修改？')) return
  draft.value = { ...empty(), ...event, start: toLocalInput(event.start) || event.start || '', end: toLocalInput(event.end), place: event.place || '' }
  baseline.value = JSON.stringify(draft.value); error.value = ''
}
async function save() {
  saving.value = true; error.value = ''
  try {
    const body = { ...draft.value, place: draft.value.place || null, venueRaw: draft.value.venueRaw || placeName(draft.value.place) }
    const result = await request<any>(draft.value.id ? `/api/organizer/events/${draft.value.id}` : '/api/organizer/events', { method: draft.value.id ? 'PUT' : 'POST', body: JSON.stringify(body) })
    const index = events.value.findIndex((event) => event.id === result.id)
    if (index < 0) events.value.unshift(result); else events.value.splice(index, 1, result)
    draft.value = { ...empty(), ...result, start: toLocalInput(result.start) || result.start, end: toLocalInput(result.end), place: result.place || '' }
    baseline.value = JSON.stringify(draft.value)
    notify('活动已保存，前台地图已同步显示')
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败' }
  finally { saving.value = false }
}
function poster() {
  if (!draft.value.id) { notify('请先保存活动'); return }
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fbf7f1'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#8f2631'; ctx.fillRect(0, 0, canvas.width, 22)
  ctx.fillStyle = '#202923'; ctx.textAlign = 'center'; ctx.font = '700 58px -apple-system, sans-serif'; ctx.fillText(draft.value.title.slice(0, 26), 540, 300)
  ctx.font = '32px -apple-system, sans-serif'; ctx.fillText(draft.value.start.replace('T', ' '), 540, 380); ctx.fillText(draft.value.venueRaw || placeName(draft.value.place) || '上科大校园', 540, 440)
  const code = qrcode(0, 'M'); code.addData(`${location.origin}/?event=${encodeURIComponent(draft.value.id)}`); code.make(); const n = code.getModuleCount(); const cell = 12; const x = 540 - n * cell / 2; const y = 700
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 30, y - 30, n * cell + 60, n * cell + 60); ctx.fillStyle = '#202923'; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell, cell)
  ctx.font = '24px -apple-system, sans-serif'; ctx.fillStyle = '#65736b'; ctx.fillText('扫码查看活动详情并导航', 540, y + n * cell + 90)
  const a = document.createElement('a'); a.download = `${draft.value.title || '活动'}-海报.png`; a.href = canvas.toDataURL('image/png'); a.click()
}
const checkinUrl = computed(() => {
  if (!checkin.value) return ''
  const query = new URLSearchParams({ checkin: checkin.value.eventId, code: checkin.value.code })
  // Preserve the simulated campus time in a demo QR so a scan on another
  // device still submits against the same attendance window.
  if (demoClockEnabled.value) query.set('now', new Date(nowTick.value + 8 * 3_600_000).toISOString().slice(0, 16))
  return `${location.origin}/?${query}`
})
const checkinSvg = computed(() => {
  if (!checkinUrl.value) return ''
  const code = qrcode(0, 'M'); code.addData(checkinUrl.value); code.make()
  return code.createSvgTag({ cellSize: 8, margin: 3, scalable: true })
})
async function openCheckin() {
  if (!draft.value.id) { notify('请先保存活动'); return }
  try {
    const at = demoClockEnabled.value ? `?at=${encodeURIComponent(String(nowTick.value))}` : ''
    checkin.value = await request<{ eventId: string; code: string; expiresAt: number }>(`/api/events/${encodeURIComponent(draft.value.id)}/checkin-code${at}`)
    window.clearInterval(checkinTimer)
    checkinTimer = window.setInterval(() => { void openCheckin() }, 4 * 60_000)
  } catch (e) { notify(e instanceof Error ? e.message : '签到码获取失败', 'error') }
}
function closeCheckin() { checkin.value = null; window.clearInterval(checkinTimer); checkinTimer = 0 }
watch([() => admin.loggedIn, tab], ([loggedIn, current]) => { if (loggedIn && current === 'organizer' && !events.value.length) void loadEvents() }, { immediate: true })
onBeforeUnmount(() => { window.clearInterval(checkinTimer); stopPipelinePoll() })
</script>

<template>
  <div class="event-workspace">
    <div v-if="!admin.loggedIn" class="data-card event-locked">
      <span class="lock-icon"><Ico name="lock" /></span>
      <h2>登录后管理活动</h2>
      <p>活动数据管道的运行状态、待审核队列和主办方活动都需要管理口令。</p>
      <button class="button primary" @click="admin.loginOpen = true">管理员登录</button>
    </div>
    <template v-else>
      <div class="event-tabs" role="tablist" aria-label="活动管理">
        <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ active: tab === t.id }" @click="tab = t.id">
          <Ico :name="t.icon" />{{ t.label }}<span v-if="'badge' in t && t.badge" class="nav-badge">{{ t.badge }}</span>
        </button>
      </div>

      <EventPipelinePanel v-if="tab === 'pipeline'" @review="tab = 'review'" />
      <EventReviewPanel v-else-if="tab === 'review'" />
      <div v-else class="event-columns">
        <section class="data-card event-list">
          <header class="section-heading"><h2>已发布的活动</h2><button class="button secondary small" @click="edit(empty())"><Ico name="plus" />新建</button></header>
          <p v-if="loading" class="empty-state">加载中…</p>
          <button v-for="event in events" :key="event.id" type="button" class="event-list-item" :class="{ active: draft.id === event.id }" @click="edit(event)">
            <b>{{ event.title }}</b><small>{{ formatTime(event.start) }} · {{ placeName(event.place) || event.venueRaw || '未设置地点' }}</small>
          </button>
          <div v-if="!events.length && !loading" class="empty-state"><Ico name="calendar" /><p>还没有主办方发布的活动。<br>右侧填写后保存，就会出现在前台地图上。</p></div>
        </section>
        <section class="data-card event-editor">
          <header class="section-heading"><h2>{{ draft.id ? '编辑活动' : '新建活动' }}</h2><span v-if="dirty" class="count-tag unsaved">未保存</span></header>
          <form @submit.prevent="save">
            <label class="wide">活动标题<input v-model="draft.title" required maxlength="160" placeholder="例如：AI 与未来教育讲座" /></label>
            <label>开始时间<input v-model="draft.start" type="datetime-local" required /></label>
            <label>结束时间<span class="optional">选填</span><input v-model="draft.end" type="datetime-local" /></label>
            <label>地图上的楼<select v-model="draft.place"><option value="">不在校内 / 线上</option><option v-for="b in buildings" :key="b.id" :value="b.id">{{ b.name.zh }}</option></select></label>
            <label>房间号<span class="optional">选填</span><input v-model="draft.room" maxlength="80" placeholder="如 1C-101" /></label>
            <label>地点写法<span class="optional">选填，默认用楼名</span><input v-model="draft.venueRaw" maxlength="240" :placeholder="placeName(draft.place) || '学校报告厅'" /></label>
            <label>分类<select v-model="draft.category"><option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option></select></label>
            <label class="wide">主办单位<input v-model="draft.organizer" maxlength="120" /></label>
            <details class="wide english"><summary>英文信息（选填）</summary><label>English title<input v-model="draft.title_en" maxlength="160" /></label><label>English description<textarea v-model="draft.desc_en" rows="3" maxlength="4000" /></label></details>
            <p v-if="error" class="editor-error wide" role="alert">{{ error }}</p>
            <div class="event-actions wide">
              <button class="button primary" :disabled="saving || (!!draft.id && !dirty)">{{ saving ? '保存中…' : draft.id ? '保存修改' : '发布活动' }}</button>
              <button type="button" class="button secondary" :disabled="!draft.id" :title="draft.id ? '' : '保存后可用'" @click="poster"><Ico name="download" />生成海报</button>
              <button type="button" class="button secondary" :disabled="!draft.id" :title="draft.id ? '' : '保存后可用'" @click="openCheckin"><Ico name="grid" />签到码</button>
            </div>
          </form>
        </section>
      </div>
    </template>
    <div v-if="checkin" class="checkin-overlay" role="dialog" aria-modal="true"><div class="checkin-screen"><button type="button" class="icon-button close" aria-label="关闭签到码" @click="closeCheckin"><Ico name="close" /></button><p class="eyebrow">活动签到 · 每 5 分钟刷新</p><h2>{{ draft.title }}</h2><div class="checkin-qr" v-html="checkinSvg" /><p>请打开校园地图扫码签到</p><small>本码于 {{ new Date(checkin.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} 失效</small></div></div>
  </div>
</template>

<style scoped>
.event-workspace { display: grid; gap: 18px; }
.event-locked { display: grid; justify-items: center; gap: 10px; padding: 60px 20px; text-align: center; }
.event-locked p { color: var(--muted); font-size: 13px; }
.lock-icon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #edf4ef; color: #28634e; font-size: 22px; }
.event-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.event-tabs button { display: flex; align-items: center; gap: 7px; padding: 10px 14px; margin-bottom: -1px; background: transparent; border-bottom: 2px solid transparent; color: #6b7a71; font-size: 14px; }
.event-tabs button.active { color: #1f4d3a; border-bottom-color: #28634e; font-weight: 600; }
.event-tabs button:hover:not(.active) { color: #33503f; }
.event-columns { display: grid; grid-template-columns: minmax(240px, .75fr) minmax(360px, 1.25fr); gap: 18px; align-items: start; }
.button.small { min-height: 32px; padding: 5px 11px; font-size: 12px; }
.event-list-item { display: block; width: 100%; padding: 12px 20px; border-bottom: 1px solid #eef2ef; background: #fff; text-align: left; }
.event-list-item:hover { background: #f8faf9; }
.event-list-item.active { background: #eef6f1; box-shadow: inset 3px 0 #28634e; }
.event-list-item b, .event-list-item small { display: block; }
.event-list-item small { margin-top: 3px; color: #7a877f; }
.event-editor form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 20px; }
.event-editor label { display: grid; gap: 5px; font-size: 12px; color: #4f6155; font-weight: 500; }
.event-editor .wide { grid-column: 1 / -1; }
.event-editor input, .event-editor textarea, .event-editor select { width: 100%; }
.optional { margin-left: 6px; font-weight: 400; color: #9aa59e; }
.english summary { cursor: pointer; font-size: 12px; color: #397656; }
.english label { margin-top: 10px; }
.unsaved { background: #fbf2df; color: #8a6420; }
.event-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.editor-error { padding: 10px; border-radius: 8px; background: #fff3f0; color: #a33a36; }
.checkin-overlay { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: #16251eef; }
.checkin-screen { position: relative; width: min(480px, 100%); padding: 36px 28px 30px; border-radius: 20px; background: #fff; text-align: center; }
.checkin-screen .close { position: absolute; top: 12px; right: 12px; }
.checkin-screen h2 { margin: 10px 0 20px; }
.checkin-screen .eyebrow { color: #2d8150; font-size: 12px; }
.checkin-qr { width: min(360px, 90vw); margin: 0 auto 16px; }
.checkin-qr :deep(svg) { display: block; width: 100%; height: auto; }
.checkin-screen small { color: #758178; }
@media (max-width: 800px) { .event-columns { grid-template-columns: 1fr; } .event-editor form { grid-template-columns: 1fr; } .event-tabs { overflow-x: auto; } }
</style>
