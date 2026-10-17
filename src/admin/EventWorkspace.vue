<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import qrcode from 'qrcode-generator'
import { account, loadAccount, openAccount } from '../lib/account'
import { demoClockEnabled, nowTick } from '../lib/campusTime'
import { notify } from './store'
import Ico from '../components/Ico.vue'

type EventDraft = { id?: string; title: string; title_en: string; desc_en: string; start: string; end: string; venueRaw: string; place: string; room: string; category: string; organizer: string }
const events = ref<any[]>([]), loading = ref(false), saving = ref(false), error = ref('')
const draft = ref<EventDraft>(empty())
const checkin = ref<{ eventId: string; code: string; expiresAt: number } | null>(null)
let checkinTimer = 0
async function organizerRequest<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1', ...(init.headers || {}) } })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `请求失败（${response.status}）`)
  return body as T
}
function empty(): EventDraft { return { title: '', title_en: '', desc_en: '', start: '', end: '', venueRaw: '', place: '', room: '', category: 'lecture', organizer: '' } }
async function loadEvents() {
  loading.value = true; error.value = ''
  try { events.value = await organizerRequest<any[]>('/api/organizer/events') }
  catch (e) { error.value = e instanceof Error ? e.message : '活动加载失败'; if (!account.me) openAccount() }
  finally { loading.value = false }
}
function edit(event: any) { draft.value = { ...empty(), ...event, end: event.end || '' } }
async function save() {
  if (!account.me) { openAccount(); return }
  saving.value = true; error.value = ''
  try {
    const result = await organizerRequest<any>(draft.value.id ? `/api/organizer/events/${draft.value.id}` : '/api/organizer/events', { method: draft.value.id ? 'PUT' : 'POST', body: JSON.stringify(draft.value) })
    const index = events.value.findIndex((event) => event.id === result.id)
    if (index < 0) events.value.unshift(result); else events.value.splice(index, 1, result)
    edit(result); notify('活动已保存')
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败' }
  finally { saving.value = false }
}
function poster() {
  if (!draft.value.id) { notify('请先保存活动'); return }
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fbf7f1'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#8f2631'; ctx.fillRect(0, 0, canvas.width, 22)
  ctx.fillStyle = '#202923'; ctx.textAlign = 'center'; ctx.font = '700 58px -apple-system, sans-serif'; ctx.fillText(draft.value.title.slice(0, 26), 540, 300)
  ctx.font = '32px -apple-system, sans-serif'; ctx.fillText(draft.value.start.replace('T', ' '), 540, 380); ctx.fillText(draft.value.venueRaw || draft.value.place || '上科大校园', 540, 440)
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
    const result = await organizerRequest<{ eventId: string; code: string; expiresAt: number }>(`/api/events/${encodeURIComponent(draft.value.id)}/checkin-code${at}`)
    checkin.value = result
    window.clearInterval(checkinTimer)
    checkinTimer = window.setInterval(() => { void openCheckin() }, 4 * 60_000)
  } catch (e) { error.value = e instanceof Error ? e.message : '签到码获取失败' }
}
function closeCheckin() { checkin.value = null; window.clearInterval(checkinTimer); checkinTimer = 0 }
onMounted(async () => { await loadAccount(); await loadEvents() })
// The first load opens the campus login dialog when the visitor is signed
// out.  Reload after that dialog completes so the activity list does not stay
// stuck on the initial 401 response.
watch(() => account.me, (me, previous) => {
  if (me && me !== previous) void loadEvents()
})
onBeforeUnmount(() => window.clearInterval(checkinTimer))
</script>

<template>
  <div class="event-workspace">
    <div class="event-toolbar"><div><h1>活动</h1><p>发布活动、设置地点，并生成带二维码的海报。</p></div><button class="button secondary" @click="edit(empty())"><Ico name="plus" />新建活动</button></div>
    <div v-if="error" class="editor-error" role="alert">{{ error }}</div>
    <div class="event-columns">
      <section class="event-list data-card"><h2>我的活动</h2><p v-if="loading">加载中…</p><button v-for="event in events" :key="event.id" type="button" class="event-list-item" :class="{ active: draft.id === event.id }" @click="edit(event)"><b>{{ event.title }}</b><small>{{ event.start }} · {{ event.venueRaw || '未定位' }}</small></button><p v-if="!events.length && !loading" class="muted">还没有活动。</p></section>
      <section class="event-editor data-card"><h2>{{ draft.id ? '编辑活动' : '新建活动' }}</h2><form @submit.prevent="save"><label>中文标题<input v-model="draft.title" required maxlength="160" /></label><label>English title<input v-model="draft.title_en" maxlength="160" /></label><label>开始时间<input v-model="draft.start" type="datetime-local" required /></label><label>结束时间<input v-model="draft.end" type="datetime-local" /></label><label>地点名称<input v-model="draft.venueRaw" placeholder="学校报告厅" /></label><label>地图地点 ID<input v-model="draft.place" placeholder="可从地点管理复制" /></label><label>房间号<input v-model="draft.room" /></label><label>英文简介<textarea v-model="draft.desc_en" rows="3" maxlength="4000" /></label><label>主办单位<input v-model="draft.organizer" /></label><div class="event-actions"><button class="button primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button><button type="button" class="button secondary" :disabled="!draft.id" @click="poster"><Ico name="download" />生成海报</button><button type="button" class="button secondary" :disabled="!draft.id" @click="openCheckin"><Ico name="grid" />签到码</button></div></form></section>
    </div>
    <div v-if="checkin" class="checkin-overlay" role="dialog" aria-modal="true"><div class="checkin-screen"><button type="button" class="close" @click="closeCheckin"><Ico name="close" /></button><p class="eyebrow">活动签到 · 每 5 分钟刷新</p><h2>{{ draft.title }}</h2><div class="checkin-qr" v-html="checkinSvg" /><p>请打开校园地图扫码签到</p><small>本码于 {{ new Date(checkin.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} 失效</small></div></div>
  </div>
</template>

<style scoped>
.event-workspace { padding: 28px; }.event-toolbar { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:20px; }.event-toolbar h1 { margin:0; }.event-toolbar p { margin:5px 0 0; color:#78857c; }.event-columns { display:grid; grid-template-columns: minmax(220px,.7fr) minmax(320px,1.3fr); gap:18px; }.data-card { padding:18px; border:1px solid var(--line); border-radius:14px; background:#fff; }.data-card h2 { margin:0 0 14px; font-size:17px; }.event-list-item { display:block; width:100%; padding:11px 9px; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; cursor:pointer; }.event-list-item.active { background:#eef7f1; }.event-list-item b,.event-list-item small { display:block; }.event-list-item small { margin-top:3px; color:#7a877f; }.event-editor form { display:grid; gap:11px; }.event-editor label { display:grid; gap:5px; font-size:12px; color:#5d6c62; }.event-editor input,.event-editor textarea { width:100%; box-sizing:border-box; padding:9px 10px; border:1px solid var(--line); border-radius:8px; font:inherit; }.event-actions { display:flex; gap:10px; margin-top:5px; }.editor-error { padding:10px; border-radius:8px; background:#fff3f0; color:#a33a36; }
.checkin-overlay { position:fixed; inset:0; z-index:20; display:grid; place-items:center; padding:20px; background:#16251eeF; }.checkin-screen { position:relative; width:min(480px,100%); padding:36px 28px 30px; border-radius:20px; background:#fff; text-align:center; }.checkin-screen .close { position:absolute; top:12px; right:12px; }.checkin-screen h2 { margin:10px 0 20px; }.checkin-screen .eyebrow { color:#2d8150; font-size:12px; }.checkin-qr { width:min(360px,90vw); margin:0 auto 16px; }.checkin-qr :deep(svg) { display:block; width:100%; height:auto; }.checkin-screen small { color:#758178; }
@media (max-width: 800px) { .event-workspace { padding:16px; }.event-columns { grid-template-columns:1fr; } }
</style>
