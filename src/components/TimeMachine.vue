<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clockText, dateKey, dayName, dayStart, evStart, nowTick, timeRange, weekdayText } from '../lib/campusTime'
import { discovery, EVENT_CATS } from '../lib/discoveryData'
import { buildLink, openShare } from '../lib/deepLink'
import { buildingById, closeRoute, openEvent, mapApi, poiById, select, state } from '../lib/store'
import {
  busiestWindow, closeTimeMachine, floorHour, glowAt, glowColor, glowWhen, isLong, momentAt, nightAt, packLanes, pause, play,
  seek, setWindow, shiftWindow, SPEEDS, tm, togglePlay, WINDOW_HOURS, WINDOW_MS, windowEnd, windowEvents, windowLabel,
} from '../lib/timeMachine'
import { ui } from '../lib/ui'
import Ico from './Ico.vue'

const MIN = 60_000
const HOUR = 3_600_000
const hud = ref<HTMLElement>()
const dock = ref<HTMLElement>()
const track = ref<HTMLElement>()
const feedEl = ref<HTMLElement>()
const wide = ref(window.innerWidth >= 1100)

const events = windowEvents
/** 列表、统计和时间轴颜色按模拟分钟刷新，地图钉在图层里逐帧更新 */
const minute = computed(() => Math.floor(tm.t / MIN) * MIN)
const moment = computed(() => momentAt(events.value, minute.value))
const feed = computed(() => moment.value.slice(0, 5))
const stats = computed(() => {
  let live = 0, soon = 0, long = 0
  for (const e of events.value) {
    const g = glowAt(e, minute.value)
    if (g?.phase === 'ongoing') long++
    else if (g?.phase === 'live' || g?.phase === 'spot') live++
    else if (g && evStart(e) > minute.value && evStart(e) - minute.value <= 2 * HOUR) soon++
  }
  return { live, soon, long, total: events.value.filter((e) => !isLong(e)).length }
})
const clock = computed(() => clockText(minute.value))
const dateText = computed(() => {
  const d = dateKey(minute.value)
  const rel = dayName(d)
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 ${weekdayText(d)}${rel === '今天' || rel === '明天' ? ' · ' + rel : ''}`
})
const relative = computed(() => {
  const diff = Math.round((minute.value - Math.floor(nowTick.value / MIN) * MIN) / MIN)
  if (Math.abs(diff) < 1) return '此刻'
  const abs = Math.abs(diff)
  const text = abs < 60 ? `${abs} 分钟` : `${Math.floor(abs / 60)} 小时${abs % 60 ? ` ${abs % 60} 分` : ''}`
  if (abs >= 48 * 60) return `${diff > 0 ? '比现在晚' : '比现在早'} ${Math.round(abs / 1440)} 天`
  return `现在 ${diff > 0 ? '+' : '−'} ${text}`
})
const rateText = computed(() => !tm.playing || !tm.adaptive ? '' : tm.rate < 0.6 ? '活动开始 · 慢放' : tm.rate > 2 ? '空档 · 快进' : '')

// ---------- 时间轴 ----------
const pct = (t: number) => `${((t - tm.from) / WINDOW_MS) * 100}%`
const head = computed(() => pct(tm.t))
const bars = computed(() => packLanes(events.value, tm.from, windowEnd()).map((bar) => {
  const g = glowAt(bar.e, minute.value)
  const phase = !g ? 'gone' : g.phase === 'past' ? 'past' : g.phase === 'live' || g.phase === 'spot' ? 'live' : 'next'
  return { ...bar, phase, color: g && phase === 'next' ? glowColor(g) : '' }
}))
const days = computed(() => {
  const out: { left: string; label: string }[] = []
  for (let d = dayStart(tm.from); d < windowEnd(); d += 86_400_000) {
    // 窗口从深夜开始时，起点那天只剩几小时，日期标签会和第二天的挤在一起
    if (d < tm.from && d + 86_400_000 - tm.from < 4 * HOUR) continue
    const key = dateKey(d)
    out.push({ left: pct(Math.max(d, tm.from)), label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))} ${weekdayText(key)}` })
  }
  return out
})
const ticks = computed(() => {
  const out: { left: string; label: string; major: boolean }[] = []
  for (let t = Math.ceil(tm.from / HOUR) * HOUR; t <= windowEnd(); t += HOUR) {
    const h = Number(clockText(t).slice(0, 2))
    if (h % 3) continue
    out.push({ left: pct(t), label: h % 6 ? '' : `${String(h).padStart(2, '0')}:00`, major: h === 0 })
  }
  return out
})
/** 时间轴底色：白天暖色，夜里暗下去，和地图的昼夜一致 */
const sky = computed(() => {
  const stops: string[] = []
  for (let i = 0; i <= WINDOW_HOURS * 2; i++) {
    const day = 1 - nightAt(tm.from + i * 30 * MIN)
    stops.push(`rgba(255, 206, 128, ${(0.04 + 0.16 * day).toFixed(3)}) ${((i / (WINDOW_HOURS * 2)) * 100).toFixed(2)}%`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
})
const nowPos = computed(() => nowTick.value >= tm.from && nowTick.value <= windowEnd() ? pct(nowTick.value) : '')

let scrubbing = false
let resume = false
function scrubTo(x: number) {
  const r = track.value!.getBoundingClientRect()
  seek(tm.from + Math.min(1, Math.max(0, (x - r.left) / r.width)) * WINDOW_MS)
}
function down(e: PointerEvent) {
  track.value!.setPointerCapture(e.pointerId)
  scrubbing = true
  resume = tm.playing
  pause()
  tm.focus = ''
  scrubTo(e.clientX)
}
function move(e: PointerEvent) { if (scrubbing) scrubTo(e.clientX) }
function up() {
  if (!scrubbing) return
  scrubbing = false
  if (resume) play()
}

// ---------- 窗口与活动 ----------
const best = computed(() => busiestWindow(discovery.events))
const isNow = computed(() => tm.from === floorHour(nowTick.value))
/** 手机上窗口说明写短一点：5/19 周二 00:00 */
const windowText = computed(() => {
  if (ui.desktop) return windowLabel(tm.from)
  const d = dateKey(tm.from)
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8))} ${weekdayText(d)} ${clockText(tm.from)}`
})
const placePoint = (id: string | null) => id ? buildingById(id)?.center || poiById(id)?.pos : undefined
const placeLabel = (id: string | null, room = '') => [id && (buildingById(id)?.name.zh || poiById(id)?.name.zh), room].filter(Boolean).join(' · ') || '地点待定'
function focusEvent(id: string) {
  const e = events.value.find((e) => e.id === id)
  if (!e) return
  pause()
  tm.focus = id
  const point = placePoint(e.place)
  if (point) mapApi.focus(point, 18, 80)
}
const focused = computed(() => {
  const e = events.value.find((e) => e.id === tm.focus)
  if (!e) return null
  const g = glowAt(e, minute.value) ?? { phase: 'past' as const, p: 0.5 }
  return { e, g, color: glowColor(g), when: glowWhen(e, g, minute.value) }
})
function details(id: string) {
  close()
  openEvent(id)
}
function close() {
  if (document.fullscreenElement) void document.exitFullscreen()
  closeTimeMachine()
}
function shareDemo() {
  const start = isNow.value ? 'now' : `${dateKey(tm.from)}T${clockText(tm.from)}`
  openShare({ title: `活动时光机 · ${windowLabel(tm.from)}`, links: [
    { label: '时光机', url: buildLink({ kind: 'timemachine', start }), hint: '扫码在手机上播放这 48 小时的活动' },
  ] })
}

// ---------- 全屏、键盘、让地图避开界面 ----------
const canFullscreen = !!document.fullscreenEnabled
const fullscreen = ref(!!document.fullscreenElement)
const onFullscreen = () => { fullscreen.value = !!document.fullscreenElement }
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen().catch(() => {})
}
function key(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  if (target?.closest('input, select, textarea, [contenteditable], .share-backdrop')) return
  if (e.key === ' ' && !target?.closest('button')) { e.preventDefault(); togglePlay() }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    tm.focus = ''
    seek(tm.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? HOUR : 10 * MIN))
  } else if (e.key === 'Home') { e.preventDefault(); seek(tm.from) }
  else if (e.key === 'Escape') { if (tm.focus) tm.focus = ''; else close() }
}
function measure() {
  wide.value = window.innerWidth >= 1100
  if (!dock.value || !hud.value) return
  const b = Math.round(window.innerHeight - dock.value.getBoundingClientRect().top + 8)
  const t = Math.round(hud.value.getBoundingClientRect().bottom + 4)
  const r = ui.desktop && wide.value && feedEl.value ? Math.round(window.innerWidth - feedEl.value.getBoundingClientRect().left + 8) : 0
  const old = ui.overlay
  if (!old || old.t !== t || old.r !== r || old.b !== b) ui.overlay = { l: 0, t, r, b }
}
let observer: ResizeObserver | undefined
onMounted(async () => {
  // 全屏回放：收起侧栏里的详情、导航和分类选中，免得和活动钉抢地图
  closeRoute()
  select(null, false)
  state.chip = null
  window.addEventListener('keydown', key)
  window.addEventListener('resize', measure)
  document.addEventListener('fullscreenchange', onFullscreen)
  await nextTick()
  observer = new ResizeObserver(measure)
  for (const el of [dock.value, hud.value]) if (el) observer.observe(el)
  measure()
})
watch(() => ui.desktop, () => nextTick(measure))
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('keydown', key)
  window.removeEventListener('resize', measure)
  document.removeEventListener('fullscreenchange', onFullscreen)
  ui.overlay = null
})
</script>

<template>
  <section class="tm-ui" aria-label="活动时光机" :class="{ desktop: ui.desktop }" :style="{ '--dock': (ui.overlay?.b ?? 200) + 'px' }">
    <header ref="hud" class="tm-hud tm-glass">
      <span class="tm-kicker"><Ico name="history" />活动时光机<small>{{ WINDOW_HOURS }} 小时回放</small></span>
      <div class="tm-clock" role="timer" aria-live="off">
        <b>{{ clock }}</b>
        <span>{{ dateText }}<small>{{ relative }}</small></span>
      </div>
      <div class="tm-stats">
        <span class="live"><i />进行中 <b>{{ stats.live }}</b></span>
        <span class="soon"><i />2 小时内 <b>{{ stats.soon }}</b></span>
        <span><i />共 <b>{{ stats.total }}</b> 场</span>
        <span v-if="stats.long" class="long"><i />长期展览 <b>{{ stats.long }}</b></span>
      </div>
      <div v-if="ui.desktop" class="tm-legend" aria-hidden="true"><i class="ramp" />越临近越醒目<i class="dot" />进行中</div>
    </header>

    <aside v-if="ui.desktop && wide" ref="feedEl" class="tm-feed" aria-label="此刻的活动">
      <article v-if="focused" class="tm-card tm-glass focus" :style="{ '--c': focused.color }">
        <span class="tm-chip">{{ focused.when }}</span>
        <b>{{ focused.e.title }}</b>
        <small>{{ timeRange(focused.e) }} · {{ EVENT_CATS[focused.e.category] }}</small>
        <small><Ico name="pin" />{{ placeLabel(focused.e.place, focused.e.room) }}</small>
        <small v-if="focused.e.organizer">{{ focused.e.organizer }}</small>
        <span class="tm-card-actions">
          <button type="button" class="tm-btn light" @click="details(focused.e.id)">查看详情<Ico name="chevron" /></button>
          <button type="button" class="tm-btn" @click="play()"><Ico name="play" />继续播放</button>
        </span>
      </article>
      <h3 class="tm-feed-head">此刻 <small>{{ moment.length ? `${moment.length} 场进行中或 3 小时内开始` : '附近时段没有活动' }}</small></h3>
      <TransitionGroup name="tm-card" tag="div" class="tm-feed-list">
        <button v-for="{ e, g } in feed" :key="e.id" type="button" class="tm-card tm-glass" :class="[`ph-${g.phase}`, { on: e.id === tm.focus }]"
          :style="{ '--c': glowColor(g), '--p': g.p }" @click="focusEvent(e.id)">
          <span class="tm-chip">{{ glowWhen(e, g, minute) }}</span>
          <b>{{ e.title }}</b>
          <small><Ico name="pin" />{{ placeLabel(e.place, e.room) }}</small>
        </button>
      </TransitionGroup>
    </aside>

    <article v-if="focused && !(ui.desktop && wide)" class="tm-card tm-glass focus floating" :style="{ '--c': focused.color, bottom: (ui.overlay?.b ?? 200) + 'px' }">
      <span class="tm-chip">{{ focused.when }}</span>
      <b>{{ focused.e.title }}</b>
      <small><Ico name="pin" />{{ placeLabel(focused.e.place, focused.e.room) }} · {{ timeRange(focused.e) }}</small>
      <span class="tm-card-actions">
        <button type="button" class="tm-btn light" @click="details(focused.e.id)">查看详情<Ico name="chevron" /></button>
        <button type="button" class="tm-btn" @click="play()"><Ico name="play" />继续</button>
      </span>
    </article>

    <div v-if="!discovery.eventsLoading && !events.length" class="tm-empty tm-glass" role="status">
      <b>这 48 小时没有收录活动</b>
      <small>{{ windowLabel(tm.from) }}</small>
      <button v-if="best !== null && best !== tm.from" type="button" class="tm-btn light" @click="setWindow(best); play()">跳到活动最多的 48 小时</button>
    </div>

    <div ref="dock" class="tm-dock tm-glass">
      <div class="tm-controls">
        <button type="button" class="tm-play" :aria-label="tm.playing ? '暂停' : '播放'" :title="tm.playing ? '暂停（空格）' : '播放（空格）'" @click="togglePlay">
          <Ico :name="tm.playing ? 'pause' : 'play'" />
        </button>
        <button type="button" class="tm-icon" aria-label="从头播放" title="从头播放（Home）" @click="seek(tm.from); play()"><Ico name="restart" /></button>
        <div class="tm-window" role="group" aria-label="时间窗口">
          <button type="button" class="tm-icon small" aria-label="前一天" title="前一天" @click="shiftWindow(-1)"><Ico name="back" /></button>
          <span class="tm-window-label" :title="windowLabel(tm.from)">{{ windowText }}</span>
          <button type="button" class="tm-icon small" aria-label="后一天" title="后一天" @click="shiftWindow(1)"><Ico name="chevron" /></button>
          <button type="button" class="tm-pill" :class="{ on: isNow }" :aria-pressed="isNow" @click="setWindow(floorHour(nowTick)); play()">现在</button>
          <button v-if="best !== null" type="button" class="tm-pill" :class="{ on: best === tm.from }" :aria-pressed="best === tm.from" title="活动最多的 48 小时" @click="setWindow(best); play()">最热闹</button>
        </div>
        <div class="tm-options">
          <div class="tm-seg" role="group" aria-label="播放速度">
            <button v-for="s in SPEEDS" :key="s" type="button" :class="{ on: tm.speed === s }" :aria-pressed="tm.speed === s" :title="`每秒 ${s} 小时`" @click="tm.speed = s">{{ s }}×</button>
          </div>
          <button type="button" class="tm-pill" :class="{ on: tm.adaptive }" :aria-pressed="tm.adaptive" title="活动开始前后慢放，没有活动时快进" @click="tm.adaptive = !tm.adaptive">智能变速</button>
          <button type="button" class="tm-pill" :class="{ on: tm.follow }" :aria-pressed="tm.follow" title="镜头飞到刚开始的活动" @click="tm.follow = !tm.follow">镜头跟随</button>
          <button type="button" class="tm-pill" :class="{ on: tm.loop }" :aria-pressed="tm.loop" @click="tm.loop = !tm.loop">循环</button>
        </div>
        <span class="tm-rate" :class="{ on: rateText }" aria-hidden="true">{{ rateText }}</span>
        <span class="tm-end">
          <button type="button" class="tm-icon" aria-label="分享时光机" title="扫码在手机上看" @click="shareDemo"><Ico name="grid" /></button>
          <button v-if="canFullscreen" type="button" class="tm-icon" :aria-label="fullscreen ? '退出全屏' : '全屏'" :title="fullscreen ? '退出全屏' : '全屏演示'" @click="toggleFullscreen"><Ico :name="fullscreen ? 'shrink' : 'expand'" /></button>
          <button type="button" class="tm-exit" aria-label="退出时光机" title="退出（Esc）" @click="close"><Ico name="close" /><span>退出</span></button>
        </span>
      </div>

      <div ref="track" class="tm-track" role="slider" tabindex="0" aria-label="播放进度" :aria-valuemin="0" :aria-valuemax="WINDOW_HOURS * 60"
        :aria-valuenow="Math.round((tm.t - tm.from) / MIN)" :aria-valuetext="`${dateText} ${clock}`"
        @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
        <div class="tm-sky" :style="{ background: sky }" />
        <div class="tm-progress" :style="{ width: head }" />
        <span v-for="d in days" :key="d.left" class="tm-day" :style="{ left: d.left }">{{ d.label }}</span>
        <span v-for="t in ticks" :key="t.left" class="tm-tick" :class="{ major: t.major }" :style="{ left: t.left }"><small v-if="t.label">{{ t.label }}</small></span>
        <i v-for="bar in bars" :key="bar.e.id" class="tm-bar" :class="bar.phase" :title="`${clockText(evStart(bar.e))} ${bar.e.title}`"
          :style="{ left: bar.left * 100 + '%', width: `max(4px, ${bar.width * 100}%)`, top: 20 + bar.lane * 9 + 'px', background: bar.color || undefined }" />
        <span v-if="nowPos" class="tm-now" :style="{ left: nowPos }"><small>现在</small></span>
        <span class="tm-head" :style="{ left: head }"><small>{{ clock }}</small></span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tm-ui { position: absolute; inset: 0; z-index: 1050; pointer-events: none; color: #fff; }
.tm-ui > * { pointer-events: auto; }
.tm-glass { background: #121826e0; backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); box-shadow: 0 10px 34px #0b10204d, inset 0 0 0 1px #ffffff14; }
button { cursor: pointer; }

/* ---------- 左上：模拟时钟和统计 ---------- */
.tm-hud { position: absolute; top: calc(env(safe-area-inset-top) + 12px); left: 12px; right: 12px; padding: 10px 14px 12px; border-radius: 18px; }
.desktop .tm-hud { top: 20px; left: 20px; right: auto; width: 340px; padding: 14px 18px 14px; }
.tm-kicker { display: flex; align-items: center; gap: 6px; color: #ffd28a; font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.tm-kicker small { margin-left: auto; color: #ffffff80; font-weight: 500; letter-spacing: 0; }
.tm-clock { display: flex; align-items: baseline; gap: 12px; margin-top: 2px; }
.tm-clock b { font-size: 34px; line-height: 1.1; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.desktop .tm-clock b { font-size: 48px; }
.tm-clock span { display: flex; flex-direction: column; font-size: 13px; font-weight: 600; }
.tm-clock small { color: #ffffff8c; font-size: 11.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
.tm-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; color: #ffffffb3; }
.tm-stats span { display: inline-flex; align-items: center; gap: 5px; }
.tm-stats i { width: 7px; height: 7px; border-radius: 50%; background: #9d8fb8; }
.tm-stats .live i { background: #2fc06d; box-shadow: 0 0 0 3px #2fc06d40; }
.tm-stats .soon i { background: #f0a040; }
.tm-stats .long i { background: #c07c9a; }
.tm-stats b { color: #fff; font-variant-numeric: tabular-nums; }
.tm-legend { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #ffffff17; font-size: 11px; color: #ffffff8c; }
.tm-legend .ramp { width: 64px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #9d8fb8, #9b4f72, #e08a1e); }
.tm-legend .dot { width: 8px; height: 8px; margin-left: 8px; border-radius: 50%; background: #1f9d55; box-shadow: 0 0 0 3px #1f9d5555; }

/* ---------- 右侧：此刻的活动 ---------- */
.tm-feed { position: absolute; top: 20px; right: 20px; width: 300px; max-height: calc(100% - var(--dock, 200px) - 40px); display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.tm-feed-head { display: flex; align-items: baseline; gap: 8px; margin: 2px 4px 0; padding: 4px 10px; border-radius: 999px; background: #121826b8; font-size: 13px; font-weight: 700; width: max-content; max-width: 100%; }
.tm-feed-head small { color: #ffffffa6; font-size: 11.5px; font-weight: 500; }
.tm-feed-list { position: relative; display: flex; flex-direction: column; gap: 8px; }
.tm-card { --c: #9b4f72; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; padding: 11px 13px 12px; border: 0; border-radius: 14px; color: #fff; text-align: left; font: inherit; border-left: 4px solid var(--c); }
button.tm-card { opacity: calc(.62 + .38 * var(--p, 1)); transition: opacity 240ms, transform 160ms; }
button.tm-card:hover, button.tm-card.on { opacity: 1; transform: translateX(-3px); }
.tm-card b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13.5px; line-height: 1.4; }
.tm-card small { display: flex; align-items: center; gap: 4px; max-width: 100%; overflow: hidden; color: #ffffffa6; font-size: 11.5px; white-space: nowrap; text-overflow: ellipsis; }
.tm-card small .svgi { flex: none; }
.tm-chip { padding: 2px 8px; border-radius: 999px; background: var(--c); color: #fff; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tm-card.ph-spot { box-shadow: 0 0 0 2px #2fc06d80, 0 10px 34px #0b10204d; }
.tm-card.focus { gap: 5px; padding: 14px 15px; }
.tm-card.focus b { -webkit-line-clamp: 3; font-size: 15px; }
.tm-card.floating { position: absolute; left: 12px; right: 12px; width: auto; margin-bottom: 8px; }
.tm-card-actions { display: flex; gap: 8px; margin-top: 6px; }
.tm-card-enter-active, .tm-card-leave-active { transition: opacity 300ms, transform 300ms; }
.tm-card-enter-from { opacity: 0; transform: translateX(16px); }
.tm-card-leave-to { opacity: 0; transform: translateX(16px); }
.tm-card-leave-active { position: absolute; }
.tm-card-move { transition: transform 300ms; }

.tm-empty { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 22px; border-radius: 18px; text-align: center; }
.tm-empty small { color: #ffffffa6; margin-bottom: 6px; }

/* ---------- 底部：播放控制和时间轴 ---------- */
.tm-dock { position: absolute; left: 8px; right: 8px; bottom: calc(env(safe-area-inset-bottom) + 8px); padding: 10px 12px 8px; border-radius: 20px; }
.desktop .tm-dock { left: 20px; right: 20px; bottom: 20px; padding: 12px 18px 10px; }
.tm-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.tm-play { flex: none; display: grid; place-items: center; width: 46px; height: 46px; border: 0; border-radius: 50%; background: #fff; color: #121826; font-size: 20px; box-shadow: 0 0 0 4px #ffffff24; }
.tm-play:active { transform: scale(.95); }
.tm-icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: #ffffff1a; color: #fff; font-size: 17px; }
.tm-icon.small { width: 28px; height: 28px; font-size: 14px; }
@media (hover: hover) { .tm-icon:hover, .tm-pill:hover, .tm-seg button:hover { background: #ffffff2e; } }
.tm-window { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tm-window-label { font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tm-pill { flex: none; height: 30px; padding: 0 11px; border: 0; border-radius: 999px; background: #ffffff1a; color: #ffffffcc; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.tm-pill.on { background: #ffd28a; color: #3a2606; }
.tm-options { display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.tm-options::-webkit-scrollbar { display: none; }
.tm-seg { flex: none; display: flex; padding: 2px; border-radius: 999px; background: #ffffff14; }
.tm-seg button { height: 26px; min-width: 36px; padding: 0 8px; border: 0; border-radius: 999px; background: none; color: #ffffffb3; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
.tm-seg button.on { background: #fff; color: #121826; }
.tm-rate { flex: none; height: 22px; padding: 0 9px; border-radius: 999px; background: #2fc06d26; color: #7ce3a6; font-size: 11.5px; font-weight: 650; line-height: 22px; opacity: 0; transition: opacity 240ms; }
.tm-rate.on { opacity: 1; }
.tm-end { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.tm-exit { display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 14px 0 11px; border: 0; border-radius: 999px; background: #ffffff1a; color: #fff; font-size: 13px; font-weight: 650; }
.tm-exit:hover { background: #a8242b; }
.tm-btn { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; background: #ffffff1f; color: #fff; font-size: 12.5px; font-weight: 650; }
.tm-btn.light { background: #fff; color: #121826; }
button:focus-visible, .tm-track:focus-visible { outline: 2px solid #ffd28a; outline-offset: 2px; }

.tm-track { position: relative; height: 76px; margin-top: 8px; touch-action: none; cursor: ew-resize; user-select: none; -webkit-user-select: none; }
.tm-sky { position: absolute; left: 0; right: 0; top: 16px; bottom: 16px; border-radius: 8px; }
.tm-progress { position: absolute; left: 0; top: 16px; bottom: 16px; border-radius: 8px 0 0 8px; background: #ffffff0f; pointer-events: none; }
.tm-day { position: absolute; top: 0; padding-left: 5px; border-left: 1px solid #ffffff59; font-size: 11px; font-weight: 650; line-height: 14px; color: #ffffffcc; white-space: nowrap; pointer-events: none; }
.tm-tick { position: absolute; top: 16px; bottom: 12px; width: 1px; background: #ffffff1a; pointer-events: none; }
.tm-tick.major { background: #ffffff59; }
.tm-tick small { position: absolute; bottom: -14px; left: 0; transform: translateX(-50%); font-size: 10px; color: #ffffff73; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tm-bar { position: absolute; height: 6px; border-radius: 3px; background: #9d8fb8; pointer-events: auto; transition: background 240ms, box-shadow 240ms; }
.tm-bar.live { background: #2fc06d; box-shadow: 0 0 8px #2fc06dcc; }
.tm-bar.past, .tm-bar.gone { background: #ffffff38; }
.tm-now { position: absolute; top: 14px; bottom: 12px; width: 0; border-left: 1.5px dashed #ffd28acc; pointer-events: none; }
.tm-now small { position: absolute; top: -14px; left: 3px; color: #ffd28a; font-size: 10px; font-weight: 700; white-space: nowrap; }
.tm-head { position: absolute; top: 12px; bottom: 8px; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 10px #ffffffb3; pointer-events: none; }
.tm-head::before { content: ''; position: absolute; left: -5px; top: -4px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.tm-head small { position: absolute; bottom: -4px; left: 50%; transform: translate(-50%, 100%); padding: 0 5px; border-radius: 6px; background: #fff; color: #121826; font-size: 10px; font-weight: 750; font-variant-numeric: tabular-nums; line-height: 14px; }

/* 手机：时间窗口一行，选项可以横向滑动 */
.tm-ui:not(.desktop) .tm-window { flex: 1; }
.tm-ui:not(.desktop) .tm-window-label { overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.tm-ui:not(.desktop) .tm-options { order: 5; flex-basis: 100%; }
.tm-ui:not(.desktop) .tm-end { margin-left: 0; }
.tm-ui:not(.desktop) .tm-end .tm-icon { display: none; }
.tm-ui:not(.desktop) .tm-exit span { display: none; }
.tm-ui:not(.desktop) .tm-exit { width: 36px; padding: 0; justify-content: center; }
.tm-ui:not(.desktop) .tm-rate { position: absolute; top: -30px; left: 50%; transform: translateX(-50%); background: #121826e0; }
.tm-ui:not(.desktop) .tm-window .tm-pill { padding: 0 9px; }
@media (max-width: 420px) {
  .tm-ui:not(.desktop) .tm-window .tm-icon.small { display: none; }
  .tm-ui:not(.desktop) .tm-options .tm-pill { padding: 0 9px; font-size: 12px; }
  .tm-ui:not(.desktop) .tm-seg button { min-width: 30px; padding: 0 6px; }
  .tm-ui:not(.desktop) .tm-clock b { font-size: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .tm-card-enter-active, .tm-card-leave-active, .tm-card-move, button.tm-card, .tm-bar, .tm-rate { transition: none; }
}
</style>
