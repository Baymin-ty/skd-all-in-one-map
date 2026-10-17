<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import qrcode from 'qrcode-generator'
import Ico from '../components/Ico.vue'
import { dayLabel, demoClockEnabled, evEnd, evStart, nowTick } from '../lib/campusTime'
import { admin, leaveGuards, notify, request } from './store'
import { CATEGORY_LABELS, formatTime, SOURCE_LABELS, toLocalInput } from './eventPipeline'
import { createEvent, deleteEvent, deletePost, fetchEvents, fetchPosts, savePins, updateEvent, type AdminEvent, type AdminPost, type EventPatch } from './adminApi'

const emit = defineEmits<{ discussions: [topic: string, name: string] }>()

type Draft = { title: string; title_en: string; desc_en: string; start: string; end: string; allDay: boolean; venueRaw: string; place: string; room: string; category: string; organizer: string; speaker: string; url: string }
const events = ref<AdminEvent[]>([]), discussions = ref<Record<string, number>>({})
const loading = ref(false), loadError = ref('')
const filters = reactive({ q: '', range: 'upcoming' as 'upcoming' | 'past' | 'all', source: '', state: '' })
const shown = ref(60)
const selectedId = ref(''), creating = ref(false)
const draft = ref<Draft | null>(null), baseline = ref('')
const saving = ref(false), busy = ref(''), error = ref('')
const posts = ref<AdminPost[]>([]), postsTotal = ref(0), postsLoading = ref(false)

const buildings = computed(() => [...admin.places.buildings].sort((a, b) => a.name.zh.localeCompare(b.name.zh, 'zh')))
const placeName = (id: string | null | undefined) => admin.places.buildings.find((b) => b.id === id)?.name.zh ?? ''
const selected = computed(() => events.value.find((e) => e.id === selectedId.value) ?? null)
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
const editable = computed(() => creating.value || !!selected.value)
const pinned = computed(() => events.value.filter((e) => e.pin).sort((a, b) => a.pin! - b.pin!))
const counts = computed(() => {
  const t = nowTick.value
  return {
    upcoming: events.value.filter((e) => evEnd(e) > t).length, past: events.value.filter((e) => evEnd(e) <= t).length, all: events.value.length,
    hidden: events.value.filter((e) => e.hidden).length, cancelled: events.value.filter((e) => e.status === 'cancelled').length,
  }
})
const filtered = computed(() => {
  const q = filters.q.trim().toLowerCase(), t = nowTick.value
  return events.value.filter((e) => {
    if (filters.source && e.source !== filters.source) return false
    if (filters.state === 'visible' && (e.hidden || e.status === 'cancelled')) return false
    if (filters.state === 'hidden' && !e.hidden) return false
    if (filters.state === 'cancelled' && e.status !== 'cancelled') return false
    if (filters.state === 'edited' && !(e.manualOverrides || e.editedAt)) return false
    if (filters.state === 'discussed' && !discussions.value[e.id]) return false
    if (filters.range === 'upcoming' && evEnd(e) <= t) return false
    if (filters.range === 'past' && evEnd(e) > t) return false
    return !q || [e.title, e.title_en, e.organizer, e.venueRaw, e.speaker, e.room, placeName(e.place), e.id].join(' ').toLowerCase().includes(q)
  }).sort((a, b) => filters.range === 'past' ? evStart(b) - evStart(a) : evStart(a) - evStart(b))
})
const groups = computed(() => {
  const days = new Map<string, AdminEvent[]>()
  for (const e of filtered.value.slice(0, shown.value)) {
    const day = dayLabel(evStart(e))
    days.set(day, [...(days.get(day) ?? []), e])
  }
  return [...days]
})
watch(() => ({ ...filters }), () => { shown.value = 60 })

async function load() {
  loading.value = true; loadError.value = ''
  try { const data = await fetchEvents(); events.value = data.events; discussions.value = data.discussions }
  catch (e) { loadError.value = (e as Error).message }
  finally { loading.value = false }
}
function draftFrom(e: Partial<AdminEvent>): Draft {
  return {
    title: e.title ?? '', title_en: e.title_en ?? '', desc_en: e.desc_en ?? '', start: toLocalInput(e.start), end: toLocalInput(e.end), allDay: !!e.allDay,
    venueRaw: e.venueRaw ?? '', place: e.place ?? '', room: e.room ?? '', category: e.category ?? 'lecture', organizer: e.organizer ?? '', speaker: e.speaker ?? '', url: e.url ?? '',
  }
}
function confirmLeave() { return !dirty.value || confirm('活动修改还未保存，放弃这些修改？') }
function open(e: AdminEvent) {
  if (e.id === selectedId.value && !creating.value) return
  if (!confirmLeave()) return
  creating.value = false; selectedId.value = e.id
  draft.value = draftFrom(e); baseline.value = JSON.stringify(draft.value); error.value = ''
}
function startCreate() {
  if (!confirmLeave()) return
  creating.value = true; selectedId.value = ''
  draft.value = draftFrom({ category: 'lecture' }); baseline.value = JSON.stringify(draft.value); error.value = ''
}
function close() {
  if (!confirmLeave()) return
  creating.value = false; selectedId.value = ''; draft.value = null; error.value = ''
}
function replace(next: AdminEvent) {
  const i = events.value.findIndex((e) => e.id === next.id)
  if (i < 0) events.value.push(next); else events.value.splice(i, 1, next)
}
async function save() {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.title.trim() || !d.start) { error.value = '请填写活动标题和开始时间'; return }
  if (d.end && d.end < d.start) { error.value = '结束时间不能早于开始时间'; return }
  saving.value = true; error.value = ''
  try {
    if (creating.value) {
      const result = await createEvent({ ...d, place: d.place || null, end: d.end || null, venueRaw: d.venueRaw || placeName(d.place) })
      replace(result); creating.value = false; selectedId.value = result.id
      notify('活动已发布，前台刷新后可见')
    } else {
      const before = JSON.parse(baseline.value) as Draft
      const patch = Object.fromEntries(Object.entries(d).filter(([key, value]) => before[key as keyof Draft] !== value)) as EventPatch
      if ('place' in patch) patch.place = d.place || null
      if ('end' in patch) patch.end = d.end || null
      replace(await updateEvent(selectedId.value, patch))
      notify(selected.value?.source === 'organizer' ? '已保存修改' : '已保存，之后自动同步不会覆盖这些修改')
    }
    draft.value = draftFrom(selected.value!); baseline.value = JSON.stringify(draft.value)
  } catch (e) { error.value = (e as Error).message }
  finally { saving.value = false }
}
async function quick(e: AdminEvent, patch: EventPatch, message: string) {
  busy.value = e.id
  try { replace(await updateEvent(e.id, patch)); notify(message) }
  catch (err) { notify((err as Error).message, 'error') }
  finally { busy.value = '' }
}
const toggleHidden = (e: AdminEvent) => quick(e, { hidden: !e.hidden }, e.hidden ? '已恢复在前台显示' : '已隐藏，前台不再显示这场活动')
const toggleCancelled = (e: AdminEvent) => quick(e, { status: e.status === 'cancelled' ? 'active' : 'cancelled' }, e.status === 'cancelled' ? '已恢复为正常举办' : '已标记为取消，前台显示「已取消」')
async function setPins(ids: string[], message: string) {
  try {
    const { pins } = await savePins(ids)
    const rank = new Map(pins.map((id, i) => [id, i + 1]))
    events.value = events.value.map((e) => rank.has(e.id) ? { ...e, pin: rank.get(e.id) } : e.pin ? (({ pin: _pin, ...rest }) => rest)(e) : e)
    notify(message)
  } catch (err) { notify((err as Error).message, 'error') }
}
const ids = () => pinned.value.map((e) => e.id)
const togglePin = (e: AdminEvent) => e.pin ? setPins(ids().filter((id) => id !== e.id), '已取消置顶') : setPins([...ids(), e.id], '已置顶，前台活动列表最先显示')
function movePin(e: AdminEvent, delta: number) {
  const list = ids(), i = list.indexOf(e.id), j = i + delta
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  void setPins(list, '置顶顺序已更新')
}
async function remove(e: AdminEvent) {
  if (!confirm(`删除「${e.title}」？删除后前台和签到记录入口都会消失，无法撤销。`)) return
  busy.value = e.id
  try {
    await deleteEvent(e.id)
    events.value = events.value.filter((item) => item.id !== e.id)
    if (selectedId.value === e.id) { selectedId.value = ''; draft.value = null }
    notify('活动已删除')
  } catch (err) { notify((err as Error).message, 'error') }
  finally { busy.value = '' }
}

async function loadPosts(id: string) {
  postsLoading.value = true; posts.value = []; postsTotal.value = 0
  try { const page = await fetchPosts({ topic: `event:${id}` }); if (selectedId.value === id) { posts.value = page.posts; postsTotal.value = page.total } }
  catch { /* 讨论加载失败不影响编辑 */ }
  finally { postsLoading.value = false }
}
async function removePost(post: AdminPost) {
  if (!confirm(`删除笔记「${post.title}」及其 ${post.comments} 条评论？`)) return
  try {
    await deletePost(post.id)
    posts.value = posts.value.filter((p) => p.id !== post.id); postsTotal.value--
    discussions.value = { ...discussions.value, [selectedId.value]: Math.max(0, (discussions.value[selectedId.value] ?? 1) - 1) }
    notify('笔记已删除')
  } catch (err) { notify((err as Error).message, 'error') }
}
watch(selectedId, (id) => { if (id) void loadPosts(id); else posts.value = [] })

// 海报与签到码：保存后的任何活动都可以用
function poster() {
  const e = selected.value
  if (!e) return
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fbf7f1'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#8f2631'; ctx.fillRect(0, 0, canvas.width, 22)
  ctx.fillStyle = '#202923'; ctx.textAlign = 'center'; ctx.font = '700 58px -apple-system, sans-serif'; ctx.fillText(e.title.slice(0, 26), 540, 300)
  ctx.font = '32px -apple-system, sans-serif'; ctx.fillText(formatTime(e.start), 540, 380); ctx.fillText(e.venueRaw || placeName(e.place) || '上科大校园', 540, 440)
  const code = qrcode(0, 'M'); code.addData(`${location.origin}/?event=${encodeURIComponent(e.id)}`); code.make(); const n = code.getModuleCount(); const cell = 12; const x = 540 - n * cell / 2; const y = 700
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 30, y - 30, n * cell + 60, n * cell + 60); ctx.fillStyle = '#202923'; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell, cell)
  ctx.font = '24px -apple-system, sans-serif'; ctx.fillStyle = '#65736b'; ctx.fillText('扫码查看活动详情并导航', 540, y + n * cell + 90)
  const a = document.createElement('a'); a.download = `${e.title || '活动'}-海报.png`; a.href = canvas.toDataURL('image/png'); a.click()
}
const checkin = ref<{ eventId: string; code: string; expiresAt: number } | null>(null)
let checkinTimer = 0
const checkinSvg = computed(() => {
  if (!checkin.value) return ''
  const query = new URLSearchParams({ checkin: checkin.value.eventId, code: checkin.value.code })
  // 演示时钟下扫码的设备要用同一个模拟时间，签到窗口才对得上
  if (demoClockEnabled.value) query.set('now', new Date(nowTick.value + 8 * 3_600_000).toISOString().slice(0, 16))
  const code = qrcode(0, 'M'); code.addData(`${location.origin}/?${query}`); code.make()
  return code.createSvgTag({ cellSize: 8, margin: 3, scalable: true })
})
async function openCheckin() {
  const e = selected.value
  if (!e) return
  try {
    const at = demoClockEnabled.value ? `?at=${encodeURIComponent(String(nowTick.value))}` : ''
    checkin.value = await request<{ eventId: string; code: string; expiresAt: number }>(`/api/events/${encodeURIComponent(e.id)}/checkin-code${at}`)
    window.clearInterval(checkinTimer)
    checkinTimer = window.setInterval(() => { void openCheckin() }, 4 * 60_000)
  } catch (err) { notify((err as Error).message, 'error') }
}
function closeCheckin() { checkin.value = null; window.clearInterval(checkinTimer); checkinTimer = 0 }

function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && draft.value && !document.querySelector('dialog[open]')) {
    event.preventDefault(); if (dirty.value || creating.value) void save()
  }
}
onMounted(() => { void load(); leaveGuards.add(confirmLeave); window.addEventListener('keydown', keydown) })
onBeforeUnmount(() => { leaveGuards.delete(confirmLeave); window.removeEventListener('keydown', keydown); window.clearInterval(checkinTimer) })
defineExpose({ startCreate, reload: load })
const overridden = computed(() => Object.keys(selected.value?.manualOverrides ?? {}).filter((key) => key !== 'unmapped' && key !== 'floor'))
const FIELD_LABELS: Record<string, string> = { title: '标题', title_en: '英文标题', desc_en: '英文简介', place: '地点', room: '房间', start: '开始时间', end: '结束时间', allDay: '全天', venueRaw: '地点写法', organizer: '主办单位', speaker: '主讲人', category: '分类', url: '原文链接', status: '状态' }
</script>

<template>
  <div class="catalog">
    <section class="data-card catalog-list" aria-label="活动目录">
      <div class="catalog-filters">
        <div class="search-field"><Ico name="search" /><input v-model="filters.q" type="search" placeholder="搜索标题、主办方、地点…" aria-label="搜索活动" /></div>
        <div class="kind-filters" aria-label="时间范围">
          <button v-for="r in ([['upcoming', '未结束'], ['past', '往期'], ['all', '全部']] as const)" :key="r[0]" :class="{ active: filters.range === r[0] }" :aria-pressed="filters.range === r[0]" @click="filters.range = r[0]">{{ r[1] }}<span>{{ counts[r[0]] }}</span></button>
        </div>
        <div class="catalog-selects">
          <select v-model="filters.source" aria-label="来源"><option value="">全部来源</option><option v-for="(label, key) in SOURCE_LABELS" :key="key" :value="key">{{ label }}</option></select>
          <select v-model="filters.state" aria-label="状态">
            <option value="">全部状态</option><option value="visible">前台显示中</option><option value="hidden">已隐藏（{{ counts.hidden }}）</option>
            <option value="cancelled">已取消（{{ counts.cancelled }}）</option><option value="edited">人工改过</option><option value="discussed">有讨论</option>
          </select>
        </div>
      </div>

      <div class="catalog-scroll">
        <section v-if="pinned.length" class="pinned">
          <h3><Ico name="bookmark" />置顶 · 前台活动列表最先显示</h3>
          <div v-for="(e, i) in pinned" :key="e.id" class="pinned-row" :class="{ active: selectedId === e.id }">
            <b class="pin-rank">{{ i + 1 }}</b>
            <button class="pinned-name" @click="open(e)"><b>{{ e.title }}</b><small>{{ formatTime(e.start) }}<template v-if="evEnd(e) <= nowTick"> · 已结束</template></small></button>
            <span class="pin-actions">
              <button class="icon-button" title="上移" aria-label="上移" :disabled="i === 0" @click="movePin(e, -1)"><Ico name="chevron" class="up" /></button>
              <button class="icon-button" title="下移" aria-label="下移" :disabled="i === pinned.length - 1" @click="movePin(e, 1)"><Ico name="chevron" class="down" /></button>
              <button class="icon-button" title="取消置顶" aria-label="取消置顶" @click="togglePin(e)"><Ico name="close" /></button>
            </span>
          </div>
        </section>

        <p v-if="loading && !events.length" class="empty-state">正在读取活动目录…</p>
        <div v-else-if="loadError" class="empty-state"><b>活动目录加载失败</b><p>{{ loadError }}</p><button class="button secondary" @click="load">重试</button></div>
        <div v-else-if="!filtered.length" class="empty-state"><Ico name="search" /><b>没有符合条件的活动</b><p>换个关键词或筛选条件试试。</p></div>
        <template v-for="[day, list] in groups" :key="day">
          <h3 class="day-heading">{{ day }}<small>{{ list.length }}</small></h3>
          <button v-for="e in list" :key="e.id" class="event-row" :class="{ active: selectedId === e.id, muted: e.hidden || e.status === 'cancelled' }" :aria-pressed="selectedId === e.id" @click="open(e)">
            <span class="event-time">{{ e.allDay ? '全天' : formatTime(e.start).slice(-5) }}</span>
            <span class="event-main">
              <b>{{ e.title }}</b>
              <small>{{ placeName(e.place) || e.venueRaw || '地点未定' }}{{ e.room ? ` · ${e.room}` : '' }}</small>
              <span class="event-chips">
                <em :class="e.source">{{ SOURCE_LABELS[e.source] ?? e.source }}</em>
                <em v-if="e.pin" class="pin">置顶</em>
                <em v-if="e.hidden" class="hidden">已隐藏</em>
                <em v-if="e.status === 'cancelled'" class="cancelled">已取消</em>
                <em v-if="e.manualOverrides || e.editedAt" class="edited">人工改过</em>
                <em v-if="discussions[e.id]" class="talk"><Ico name="chat" />{{ discussions[e.id] }}</em>
              </span>
            </span>
          </button>
        </template>
        <button v-if="filtered.length > shown" class="text-button more" @click="shown += 80">再显示 {{ Math.min(80, filtered.length - shown) }} 场（共 {{ filtered.length }} 场）</button>
      </div>
    </section>

    <section v-if="editable && draft" class="data-card catalog-editor" aria-label="活动编辑">
      <header class="editor-head">
        <div class="editor-title">
          <span class="dialog-eyebrow">{{ creating ? '新建主办方活动' : `${SOURCE_LABELS[selected!.source] ?? selected!.source}活动 · ${selected!.id}` }}</span>
          <h2>{{ creating ? '新建活动' : selected!.title }}</h2>
        </div>
        <span class="draft-state" :class="{ dirty: dirty || creating }">{{ dirty || creating ? '待保存' : '未修改' }}</span>
        <button class="icon-button" aria-label="关闭编辑" @click="close"><Ico name="close" /></button>
      </header>

      <div v-if="selected" class="quick-actions" role="toolbar" aria-label="快捷操作">
        <button class="button secondary" :class="{ active: selected.pin }" :disabled="!!busy" @click="togglePin(selected)"><Ico name="bookmark" />{{ selected.pin ? `取消置顶（第 ${selected.pin} 位）` : '置顶' }}</button>
        <button class="button secondary" :class="{ active: selected.hidden }" :disabled="!!busy" @click="toggleHidden(selected)"><Ico :name="selected.hidden ? 'eye' : 'eyeClosed'" />{{ selected.hidden ? '恢复显示' : '在前台隐藏' }}</button>
        <button class="button secondary" :disabled="!!busy" @click="toggleCancelled(selected)"><Ico :name="selected.status === 'cancelled' ? 'restart' : 'close'" />{{ selected.status === 'cancelled' ? '恢复举办' : '标记取消' }}</button>
        <button class="button secondary" @click="poster"><Ico name="download" />海报</button>
        <button class="button secondary" @click="openCheckin"><Ico name="grid" />签到码</button>
        <a v-if="selected.url" class="button secondary" :href="selected.url" target="_blank" rel="noopener"><Ico name="external" />原文</a>
      </div>
      <p v-if="selected && selected.source !== 'organizer'" class="sync-note">
        <Ico name="refresh" />这场活动由{{ SOURCE_LABELS[selected.source] }}自动同步。在这里改过的字段会被记住，之后同步不会覆盖<template v-if="overridden.length">；已人工修改：{{ overridden.map((k) => FIELD_LABELS[k] ?? k).join('、') }}</template>。
      </p>

      <form class="event-form" @submit.prevent="save">
        <fieldset :disabled="saving">
          <label class="wide">活动标题<input v-model="draft.title" required maxlength="160" placeholder="例如：AI 与未来教育讲座" /></label>
          <label>开始时间<input v-model="draft.start" type="datetime-local" required /></label>
          <label>结束时间<span class="optional">选填</span><input v-model="draft.end" type="datetime-local" :min="draft.start" /></label>
          <label class="check wide"><input v-model="draft.allDay" type="checkbox" />全天活动（展览等没有具体时刻）</label>
          <label>地图上的楼<select v-model="draft.place"><option value="">不在校内 / 线上</option><option v-for="b in buildings" :key="b.id" :value="b.id">{{ b.name.zh }}</option></select></label>
          <label>房间号<span class="optional">选填</span><input v-model="draft.room" maxlength="80" placeholder="如 1C-101" /></label>
          <label class="wide">地点写法<span class="optional">原文地点，默认用楼名</span><input v-model="draft.venueRaw" maxlength="240" :placeholder="placeName(draft.place) || '学校报告厅'" /></label>
          <label>分类<select v-model="draft.category"><option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option></select></label>
          <label>主办单位<input v-model="draft.organizer" maxlength="120" /></label>
          <label>主讲人<span class="optional">选填</span><input v-model="draft.speaker" maxlength="160" /></label>
          <label>原文链接<span class="optional">选填</span><input v-model="draft.url" type="url" maxlength="500" placeholder="https://" /></label>
          <details class="wide english"><summary>英文信息（选填）</summary><label>English title<input v-model="draft.title_en" maxlength="160" /></label><label>English description<textarea v-model="draft.desc_en" rows="3" maxlength="4000" /></label></details>
        </fieldset>
        <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
        <footer class="event-save">
          <span>⌘ / Ctrl S 快速保存</span>
          <button v-if="selected?.source === 'organizer'" type="button" class="text-button danger" :disabled="!!busy" @click="remove(selected)"><Ico name="trash" />删除活动</button>
          <button type="button" class="button secondary" :disabled="saving" @click="close">{{ dirty ? '放弃修改' : '关闭' }}</button>
          <button class="button primary" :disabled="saving || (!creating && !dirty)"><Ico name="check" />{{ saving ? '保存中…' : creating ? '发布活动' : '保存修改' }}</button>
        </footer>
      </form>

      <section v-if="selected" class="event-talk">
        <header><h3><Ico name="chat" />同学讨论<small>{{ postsTotal }}</small></h3><button v-if="postsTotal" class="text-button" @click="emit('discussions', `event:${selected.id}`, selected.title)">在讨论管理中查看<Ico name="chevron" /></button></header>
        <p v-if="postsLoading" class="muted">正在读取…</p>
        <p v-else-if="!posts.length" class="muted">还没有同学在这场活动下发帖。</p>
        <article v-for="p in posts.slice(0, 5)" :key="p.id" class="talk-row">
          <div><b>{{ p.title }}</b><small>{{ p.author.name }} · {{ formatTime(p.createdAt) }} · {{ p.comments }} 条评论 · {{ p.likes }} 赞</small><p>{{ p.content }}</p></div>
          <button class="icon-button danger" title="删除这篇笔记" aria-label="删除这篇笔记" @click="removePost(p)"><Ico name="trash" /></button>
        </article>
      </section>
    </section>

    <section v-else class="data-card catalog-empty">
      <span class="lock-icon"><Ico name="calendar" /></span>
      <h2>选择一场活动进行整理</h2>
      <p>可以修改时间地点、置顶到前台列表最前面、隐藏不合适的条目，或标记取消。<br>官网和邮件同步来的活动改过之后，自动同步不会再覆盖。</p>
      <div class="catalog-stats">
        <div><b>{{ counts.upcoming }}</b><small>未结束</small></div>
        <div><b>{{ pinned.length }}</b><small>置顶</small></div>
        <div><b>{{ counts.hidden }}</b><small>已隐藏</small></div>
        <div><b>{{ Object.keys(discussions).length }}</b><small>有讨论</small></div>
      </div>
      <button class="button primary" @click="startCreate"><Ico name="plus" />新建活动</button>
    </section>

    <div v-if="checkin" class="checkin-overlay" role="dialog" aria-modal="true"><div class="checkin-screen"><button type="button" class="icon-button close" aria-label="关闭签到码" @click="closeCheckin"><Ico name="close" /></button><p class="eyebrow">活动签到 · 每 5 分钟刷新</p><h2>{{ selected?.title }}</h2><div class="checkin-qr" v-html="checkinSvg" /><p>请打开校园地图扫码签到</p><small>本码于 {{ new Date(checkin.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} 失效</small></div></div>
  </div>
</template>

<style scoped>
.catalog { display: grid; grid-template-columns: minmax(320px, 420px) minmax(0, 1fr); gap: 18px; align-items: start; }
.catalog-list { display: flex; flex-direction: column; height: calc(100dvh - 228px); min-height: 520px; }
.catalog-filters { flex: none; display: grid; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid var(--line); }
.catalog-filters .kind-filters { margin: 0; }
.catalog-selects { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.catalog-selects select { font-size: 12px; padding: 7px 8px; }
.catalog-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 12px; scrollbar-width: thin; }
.pinned { margin: 8px 0 6px; padding: 10px 8px 6px; border-radius: 9px; background: #fbf6ea; }
.pinned h3 { display: flex; align-items: center; gap: 6px; padding: 0 4px 6px; color: #8a6420; font-size: 11px; font-weight: 600; }
.pinned-row { display: flex; align-items: center; gap: 8px; padding: 4px; border-radius: 7px; }
.pinned-row.active { background: #fff; box-shadow: 0 0 0 1px #ecdcb6; }
.pin-rank { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; background: #e9c97a; color: #5c4210; font-size: 11px; }
.pinned-name { flex: 1; min-width: 0; background: transparent; text-align: left; }
.pinned-name b, .pinned-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pinned-name b { font-size: 12.5px; font-weight: 600; }
.pinned-name small { color: #9a7b3e; font-size: 11px; }
.pin-actions { display: flex; flex: none; }
.pin-actions .icon-button { width: 26px; height: 26px; font-size: 13px; }
.up :deep(svg) { transform: rotate(-90deg); }
.down :deep(svg) { transform: rotate(90deg); }
.day-heading { position: sticky; top: -4px; z-index: 1; display: flex; align-items: baseline; gap: 6px; margin: 0 -8px; padding: 10px 16px 6px; background: #fffffff2; color: #627569; font-size: 12px; font-weight: 600; backdrop-filter: blur(4px); }
.day-heading small { color: #a0aca4; font-weight: 400; }
.event-row { display: flex; gap: 10px; width: 100%; padding: 9px 8px; border: 1px solid transparent; border-radius: 8px; background: #fff; text-align: left; }
.event-row:hover { background: #f6f8f5; }
.event-row.active { background: #edf5ef; border-color: #d2e3d6; }
.event-row.muted .event-main > b { color: #93a097; text-decoration: line-through #c9d1cb; }
.event-time { flex: none; width: 38px; padding-top: 1px; color: #6c8074; font-size: 12px; font-variant-numeric: tabular-nums; }
.event-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.event-main > b { font-size: 13px; font-weight: 550; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.event-main > small { color: #8a988e; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.event-chips em { display: inline-flex; align-items: center; gap: 3px; padding: 0 6px; border-radius: 4px; background: #eef2ef; color: #5b6f62; font-size: 10.5px; font-style: normal; line-height: 18px; }
.event-chips em.email { background: #eef0fb; color: #4a57a0; }
.event-chips em.organizer { background: #e8f3ee; color: #28634e; }
.event-chips em.pin { background: #fbefd3; color: #8a6420; }
.event-chips em.hidden { background: #eceeed; color: #6f7a74; }
.event-chips em.cancelled { background: #fbe9e6; color: #a8412f; }
.event-chips em.edited { background: #f3edf8; color: #7d4bab; }
.event-chips em.talk { background: #e9f1fb; color: #3266a8; }
.more { display: flex; width: 100%; padding: 12px 0; }

.catalog-editor, .catalog-empty { position: sticky; top: 14px; max-height: calc(100dvh - 228px); min-height: 520px; overflow-y: auto; scrollbar-width: thin; }
.editor-head { display: flex; align-items: flex-start; gap: 10px; padding: 18px 20px 14px; border-bottom: 1px solid var(--line); }
.editor-title { flex: 1; min-width: 0; }
.editor-title .dialog-eyebrow { margin-bottom: 4px; }
.editor-title h2 { font-size: 17px; line-height: 1.45; }
.editor-head .draft-state { margin-top: 3px; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px 0; }
.quick-actions .button { min-height: 32px; padding: 5px 11px; font-size: 12px; }
.quick-actions .button .svgi { font-size: 14px; }
.sync-note { display: flex; gap: 8px; margin: 12px 20px 0; padding: 9px 12px; border-radius: 8px; background: #f4f7fb; color: #4c6585; font-size: 12px; line-height: 1.6; }
.sync-note .svgi { margin-top: 3px; }
.event-form { padding: 16px 20px 0; }
.event-form fieldset { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 0; padding: 0; border: 0; min-width: 0; }
.event-form label { display: grid; gap: 5px; align-content: start; color: #4f6155; font-size: 12px; font-weight: 500; }
.event-form label.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.event-form .wide { grid-column: 1 / -1; }
.event-form input:not([type=checkbox]), .event-form textarea, .event-form select { width: 100%; }
.optional { margin-left: 6px; font-weight: 400; color: #9aa59e; }
label:has(.optional) { grid-template-columns: auto 1fr; }
label:has(.optional) > :is(input, select) { grid-column: 1 / -1; }
.english summary { cursor: pointer; font-size: 12px; color: #397656; }
.english label { margin-top: 10px; }
.event-form .editor-error { margin: 14px 0 0; }
.event-save { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; margin: 16px -20px 0; padding: 12px 20px; border-top: 1px solid var(--line); background: #fff; }
.event-save > span { margin-right: auto; color: #a0ae93; font-size: 11px; }
.event-talk { margin: 0; padding: 16px 20px 20px; border-top: 1px solid var(--line); background: #fafbfa; }
.event-talk header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.event-talk h3 { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.event-talk h3 small { color: #8b998f; font-weight: 400; }
.muted { color: var(--muted); font-size: 12px; }
.talk-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid #edf1ee; }
.talk-row > div { flex: 1; min-width: 0; }
.talk-row b { font-size: 13px; }
.talk-row small { display: block; color: #8a988e; font-size: 11px; }
.talk-row p { margin-top: 4px; color: #4f6155; font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.catalog-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 24px; text-align: center; }
.catalog-empty p { color: var(--muted); font-size: 13px; line-height: 1.8; }
.lock-icon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #edf4ef; color: #28634e; font-size: 22px; }
.catalog-stats { display: grid; grid-template-columns: repeat(4, minmax(70px, 1fr)); gap: 8px; margin: 8px 0; }
.catalog-stats div { padding: 10px 12px; border-radius: 9px; background: #f6f8f7; }
.catalog-stats b { display: block; color: #1f3d30; font-size: 20px; font-weight: 650; }
.catalog-stats small { color: var(--muted); font-size: 11px; }

.checkin-overlay { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 20px; background: #16251eef; }
.checkin-screen { position: relative; width: min(480px, 100%); padding: 36px 28px 30px; border-radius: 20px; background: #fff; text-align: center; }
.checkin-screen .close { position: absolute; top: 12px; right: 12px; }
.checkin-screen h2 { margin: 10px 0 20px; }
.checkin-screen .eyebrow { color: #2d8150; font-size: 12px; }
.checkin-qr { width: min(360px, 90vw); margin: 0 auto 16px; }
.checkin-qr :deep(svg) { display: block; width: 100%; height: auto; }
.checkin-screen small { color: #758178; }
@media (max-width: 1000px) {
  .catalog { grid-template-columns: 1fr; }
  .catalog-list { height: 460px; min-height: 0; }
  .catalog-editor, .catalog-empty { position: static; max-height: none; min-height: 0; }
}
@media (max-width: 680px) { .event-form fieldset { grid-template-columns: 1fr; } .catalog-stats { grid-template-columns: repeat(2, 1fr); } }
</style>
