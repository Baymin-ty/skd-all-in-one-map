<script setup lang="ts">
import { computed } from 'vue'
import { account, openAccount } from '../lib/account'
import { dateKey, dayName, nowTick, weekdayText } from '../lib/campusTime'
import { agendaEntries, KIND_ORDER, KIND_STYLE, startsInText, upNext, type AgendaEntry } from '../lib/myMap'
import { favorites, HOME_ROLES, homePlace, openProfile, placeLabel } from '../lib/profile'
import { endFor, myAgenda, navigateToPlace, openEvent, openRoom, placeName, placeSelection, select, setEnd, setMapView, setMyScope, showPanel, state } from '../lib/store'
import { endMin, fromMin, isWeeklyClass, plan, startMin, type PlanItem } from '../lib/today'
import { walkMinutes } from '../lib/walkTime'
import { openParcelStationMap } from '../lib/parcelStation'
import Ico from './Ico.vue'

// 我的地图的面板：最上面一张「接下来」卡片（手机收起时也看得到），下面是这一天或本周的安排，
// 课程、活动、吃饭、待办用和地图小旗一样的颜色区分；最后是常用地点。
const today = computed(() => dateKey(nowTick.value))
const up = computed(() => upNext(plan.items, nowTick.value))
/** 卡片显示哪一项：今天还有下一项就看下一项，否则看正在进行的 */
const hero = computed(() => {
  const { current, next } = up.value
  if (next && (next.date === today.value || !current)) return { entry: next, live: false }
  return current ? { entry: current, live: true } : null
})
const where = (i: PlanItem) => {
  const sel = placeSelection(i.place)
  return [sel && placeName(sel), i.room].filter(Boolean).join(' ')
}
/** 从哪出发去下一项：同一天的上一站，没有就从寝室 */
function originFor(entry: AgendaEntry) {
  const sameDay = agendaEntries(plan.items, [entry.date], nowTick.value)
  const prev = sameDay.filter((e) => startMin(e.item) < startMin(entry.item) && e.item.place && e.item.place !== entry.item.place).at(-1)
  if (prev?.item.place) return { place: prev.item.place, label: '从上一站' }
  const dorm = homePlace('dorm')
  return dorm && dorm.place !== entry.item.place ? { place: dorm.place, label: '从寝室' } : null
}
const NEXT_LABEL = { class: '下一节课', event: '下一个活动', meal: '接下来吃饭', todo: '下一项待办' } as const
const heroInfo = computed(() => {
  const h = hero.value
  if (!h) return null
  const { item } = h.entry
  const style = KIND_STYLE[item.kind]
  const origin = h.live ? null : originFor(h.entry)
  const walk = origin && item.place ? walkMinutes(origin.place, item.place) : null
  const leave = walk != null && h.entry.date === today.value ? fromMin(Math.max(0, startMin(item) - walk - 2)) : ''
  const eyebrow = h.live ? `正在${item.kind === 'class' ? '上课' : '进行'} · ${fromMin(endMin(item))} 结束` : `${NEXT_LABEL[item.kind]} · ${startsInText(h.entry, nowTick.value)}`
  const meta = [where(item) || '地点未填', walk != null ? `${origin!.label}步行 ${walk} 分钟` : '', leave ? `${leave} 出发` : ''].filter(Boolean).join(' · ')
  return { item, style, eyebrow, meta, origin }
})
function goHero() {
  const info = heroInfo.value
  if (!info?.item.place) return
  // 没开定位时，用上一站或寝室当起点，路线马上就能算出来
  const from = info.origin && placeSelection(info.origin.place)
  const end = from && endFor(from)
  navigateToPlace(info.item.place)
  if (end && !state.route.from) setEnd('from', end)
}
/** 活动打开活动详情；课程打开那栋楼并定位到教室 */
function show(i: PlanItem) {
  if (i.eventId) return openEvent(i.eventId)
  const sel = placeSelection(i.place)
  if (sel?.kind === 'building' && i.room) openRoom(sel.id, i.room)
  else if (sel) select(sel)
}

// ---------- 这一天 / 本周 ----------
const week = computed(() => myAgenda.value.week)
const entries = computed(() => myAgenda.value.entries)
const counts = computed(() => KIND_ORDER.map((k) => ({ kind: k, n: new Set(entries.value.filter((e) => e.item.kind === k).map((e) => week.value ? e.item.id : e.item.id + e.date)).size })).filter((c) => c.n))
const scopeTitle = computed(() => {
  if (week.value) {
    const [a, b] = [myAgenda.value.dates[0], myAgenda.value.dates.at(-1)!]
    return { main: '本周', sub: `${Number(a.slice(5, 7))}/${Number(a.slice(8))} – ${Number(b.slice(5, 7))}/${Number(b.slice(8))}` }
  }
  const d = plan.date
  return { main: dayName(d) === weekdayText(d) ? weekdayText(d) : dayName(d), sub: `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日 ${weekdayText(d)}` }
})
/** 本周按天分组；某一天就一组 */
const groups = computed(() => {
  const out: { date: string; label: string; items: AgendaEntry[] }[] = []
  for (const e of entries.value) {
    let g = out.at(-1)
    if (!g || g.date !== e.date) out.push(g = { date: e.date, label: `${weekdayText(e.date)} ${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}${e.date === today.value ? ' · 今天' : ''}`, items: [] })
    g.items.push(e)
  }
  return out
})
const hasClasses = computed(() => plan.items.some(isWeeklyClass))
const STATUS_TEXT = { now: '进行中', upnext: '下一项', later: '', past: '' } as const

// ---------- 常用地点 ----------
const places = computed(() => [
  ...HOME_ROLES.map((r) => ({ id: r.role, zh: r.zh, icon: r.icon, place: homePlace(r.role) })).filter((p) => p.place),
  ...favorites().map((f) => ({ id: f.id, zh: '收藏', icon: 'heart' as const, place: f })),
])
</script>

<template>
  <div class="page my-page">
    <!-- 接下来：手机收起时露出的就是这张卡片 -->
    <section v-if="heroInfo" class="hero" :class="{ live: hero?.live }" :style="{ '--k': heroInfo.style.color, '--ks': heroInfo.style.soft }">
      <button type="button" class="hero-main" @click="show(heroInfo.item)">
        <span class="hero-icon"><Ico :name="heroInfo.style.icon" /></span>
        <span class="grow">
          <span class="hero-eyebrow">{{ heroInfo.eyebrow }}</span>
          <b class="hero-title">{{ heroInfo.item.title }}</b>
          <small class="hero-meta">{{ heroInfo.meta }}</small>
        </span>
      </button>
      <button v-if="heroInfo.item.place && !hero?.live" type="button" class="hero-go" @click="goHero"><Ico name="walk" /><span>导航</span></button>
    </section>
    <section v-else class="hero empty">
      <span class="hero-icon"><Ico :name="account.me ? 'academic' : 'users'" /></span>
      <span class="grow">
        <b class="hero-title">{{ !account.me && !hasClasses ? '登录后，地图只显示你的课和活动' : !hasClasses ? '导入课表，上课地点自动标上地图' : '接下来 7 天没有安排' }}</b>
        <small class="hero-meta">{{ !account.me && !hasClasses ? '校园邮箱登录，课表和寝室换手机也在' : !hasClasses ? '截一张教务课表的图就行，每周自动排好' : '可以去活动雷达看看最近有什么' }}</small>
      </span>
      <button v-if="!account.me && !hasClasses" type="button" class="hero-go" @click="openAccount()"><span>登录</span></button>
      <button v-else-if="!hasClasses" type="button" class="hero-go" @click="openProfile('schedule')"><span>导入</span></button>
      <button v-else type="button" class="hero-go" @click="state.radar.place = ''; showPanel('events')"><span>活动</span></button>
    </section>

    <!-- 这一天 / 本周 -->
    <header class="scope-head">
      <h2><b>{{ scopeTitle.main }}</b><small>{{ scopeTitle.sub }}</small></h2>
      <span class="legend" aria-label="图例">
        <span v-for="c in counts" :key="c.kind" :style="{ '--k': KIND_STYLE[c.kind].color }"><i />{{ KIND_STYLE[c.kind].zh }} {{ c.n }}</span>
      </span>
    </header>

    <div v-for="g in groups" :key="g.date" class="day">
      <h3 v-if="week" class="day-label" :class="{ today: g.date === today }">{{ g.label }}</h3>
      <ul class="list-plain agenda">
        <li v-for="e in g.items" :key="e.item.id + e.date" class="ag" :class="week ? { past: e.date < today } : e.status" :style="{ '--k': KIND_STYLE[e.item.kind].color, '--ks': KIND_STYLE[e.item.kind].soft }">
          <span class="ag-time"><b>{{ e.item.start }}</b><small>{{ fromMin(endMin(e.item)) }}</small></span>
          <button type="button" class="ag-main" @click="show(e.item)">
            <b><span class="ag-kind"><Ico :name="KIND_STYLE[e.item.kind].icon" />{{ KIND_STYLE[e.item.kind].zh }}</span><span class="ellipsis">{{ e.item.title }}</span><em v-if="!week && STATUS_TEXT[e.status]">{{ STATUS_TEXT[e.status] }}</em></b>
            <small class="ellipsis">{{ where(e.item) || '地点未填' }}</small>
          </button>
          <button v-if="e.item.place" type="button" class="ag-go" :aria-label="`导航到${where(e.item)}`" @click="navigateToPlace(e.item.place)"><Ico name="walk" /></button>
        </li>
      </ul>
    </div>
    <p v-if="!entries.length" class="day-empty">
      {{ week ? '这周没有安排' : `${scopeTitle.main}没有课和活动` }}<template v-if="!week && hasClasses"> · <button type="button" class="text-link" @click="setMyScope('week')">看本周</button></template>
    </p>

    <div class="my-actions">
      <button type="button" class="act small parcel-action" @click="openParcelStationMap"><Ico name="grid" />快递站地图</button>
      <button type="button" class="act small" @click="showPanel('today')"><Ico name="clock" />日程与吃饭建议</button>
      <button type="button" class="act small" @click="openProfile('schedule')"><Ico name="academic" />{{ hasClasses ? '管理课表' : '导入课表' }}</button>
    </div>

    <!-- 常用地点 -->
    <section class="sec">
      <h3>我的地点 <button type="button" class="text-link" @click="openProfile('places')">{{ places.length ? '管理' : '设置寝室和实验室' }}</button></h3>
      <div v-if="places.length" class="my-places">
        <button v-for="p in places" :key="p.id" type="button" class="place-chip" :class="{ fav: p.icon === 'heart' }" @click="navigateToPlace(p.place!.place)">
          <span class="pc-icon"><Ico :name="p.icon" /></span><span class="grow"><b>{{ p.zh }}</b><small class="ellipsis">{{ placeLabel(p.place!) }}</small></span><Ico name="walk" class="pc-go" />
        </button>
      </div>
      <p v-else class="muted">设好寝室、实验室，地图上会标出来，一键导航过去。</p>
    </section>

    <button type="button" class="to-all" @click="setMapView('all')"><Ico name="building" /><span class="grow">查看全校地图<small>所有楼宇、点位和今天的活动</small></span><Ico name="chevron" /></button>
  </div>
</template>

<style scoped>
.my-page { padding-top: 6px; }
/* 接下来 */
.hero { display: flex; align-items: center; gap: 10px; min-height: 84px; padding: 10px 10px 10px 12px; border-radius: 16px; background: var(--ks, var(--bg-2)); border: 1px solid color-mix(in srgb, var(--k, #999) 22%, #fff); }
.hero.empty { --k: var(--brand); --ks: var(--brand-soft); }
.hero-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 11px; padding: 0; border: 0; background: none; text-align: left; color: inherit; cursor: pointer; }
.hero-icon { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: var(--k); color: #fff; font-size: 21px; box-shadow: 0 4px 12px color-mix(in srgb, var(--k) 35%, transparent); }
.hero.live .hero-icon { animation: hero-live 2s ease-in-out infinite; }
.hero-eyebrow { display: block; font-size: 12px; font-weight: 700; color: var(--k); }
.hero-title { display: block; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16.5px; font-weight: 750; letter-spacing: -0.01em; color: var(--ink); }
.hero-meta { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--ink-2); }
.hero-go { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 56px; height: 56px; border: 0; border-radius: 14px; background: var(--k); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.hero-go .svgi { font-size: 20px; }
.hero-go:active { transform: scale(.96); }
@keyframes hero-live { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--k) 18%, transparent); } }
@media (prefers-reduced-motion: reduce) { .hero.live .hero-icon { animation: none; } }

/* 这一天 / 本周 */
.scope-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin: 20px 0 6px; }
.scope-head h2 { display: flex; align-items: baseline; gap: 8px; margin: 0; }
.scope-head h2 b { font-size: 19px; font-weight: 750; letter-spacing: -0.01em; }
.scope-head h2 small { font-size: 12.5px; color: var(--ink-3); font-weight: 500; }
.legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 10px; font-size: 11.5px; color: var(--ink-2); }
.legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--k); }
.day-label { margin: 14px 0 2px; font-size: 12.5px; font-weight: 700; color: var(--ink-3); }
.day-label.today { color: var(--brand); }
.agenda { display: flex; flex-direction: column; }
.ag { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.ag:last-child { border-bottom: 0; }
.ag-time { display: flex; flex-direction: column; align-items: flex-end; font-variant-numeric: tabular-nums; }
.ag-time b { font-size: 13.5px; }
.ag-time small { font-size: 11px; color: var(--ink-3); }
.ag-main { position: relative; min-width: 0; padding: 2px 0 2px 12px; border: 0; background: none; text-align: left; color: inherit; cursor: pointer; }
.ag-main::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 3.5px; border-radius: 3px; background: var(--k); }
.ag-main b { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 14.5px; font-weight: 650; }
.ag-main small { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-2); }
.ag-kind { flex: none; display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px 1px 4px; border-radius: 6px; background: var(--ks); color: var(--k); font-size: 11px; font-weight: 700; }
.ag-kind .svgi { font-size: 12px; }
.ag-main em { flex: none; padding: 1px 6px; border-radius: 999px; background: var(--k); color: #fff; font-size: 10.5px; font-style: normal; font-weight: 700; }
.ag.now .ag-main em { background: var(--green); }
.ag-go { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 50%; background: #fff; color: var(--k); font-size: 18px; cursor: pointer; }
.ag.past { opacity: .5; }
.ag.past .ag-main::before { background: #c3c6cd; }
.day-empty { margin: 14px 0 4px; padding: 16px; border-radius: 12px; background: var(--bg-2); color: var(--ink-3); font-size: 13px; text-align: center; }
.my-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.parcel-action { border-color: #e9c8cb; background: var(--brand-soft); color: var(--brand); }

/* 常用地点 */
.sec h3 { justify-content: space-between; }
.my-places { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.place-chip { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px 10px; border: 1px solid #e8e1f3; border-radius: 13px; background: #faf8fd; text-align: left; color: inherit; cursor: pointer; }
.place-chip b { display: block; font-size: 13.5px; }
.place-chip small { display: block; font-size: 11.5px; color: var(--ink-3); }
.pc-icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #7a5bb5; color: #fff; font-size: 15px; }
.place-chip.fav { border-color: #f3dbe3; background: #fdf8fa; }
.place-chip.fav .pc-icon { background: #d0567a; }
.pc-go { flex: none; color: var(--ink-3); font-size: 16px; }
.to-all { display: flex; align-items: center; gap: 12px; width: 100%; margin-top: 22px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: #fff; text-align: left; color: inherit; cursor: pointer; }
.to-all > .svgi:first-child { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--bg-2); font-size: 18px; }
.to-all span b, .to-all .grow { font-size: 14px; font-weight: 650; }
.to-all small { display: block; font-size: 12px; font-weight: 400; color: var(--ink-3); }
.to-all .svgi:last-child { color: var(--ink-3); }
@media (hover: hover) { .ag-main:hover b { color: var(--k); } .place-chip:hover, .to-all:hover { background: var(--bg-2); } .ag-go:hover { background: var(--ks); } }
</style>
