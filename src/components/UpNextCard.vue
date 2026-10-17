<script setup lang="ts">
import { computed } from 'vue'
import { account, openAccount } from '../lib/account'
import { dateKey, nowTick } from '../lib/campusTime'
import { agendaEntries, KIND_STYLE, startsInText, upNext, type AgendaEntry } from '../lib/myMap'
import { homePlace, openProfile } from '../lib/profile'
import { endFor, navigateToPlace, openPlanItem, placeName, placeSelection, setEnd, showPanel, state } from '../lib/store'
import { endMin, fromMin, isWeeklyClass, plan, startMin, type PlanItem } from '../lib/today'
import { walkMinutes } from '../lib/walkTime'
import Ico from './Ico.vue'

// 「接下来」卡片：下一节课 / 活动，带步行时间和一键导航。我的地图和全校地图的面板最上面都放它，
// 手机收起面板时露出的就是这张。fallback 时没有安排也占位，引导登录、导入课表或去看活动。
defineProps<{ fallback?: boolean }>()

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
const hasClasses = computed(() => plan.items.some(isWeeklyClass))
</script>

<template>
  <section v-if="heroInfo" class="hero" :class="{ live: hero?.live }" :style="{ '--k': heroInfo.style.color, '--ks': heroInfo.style.soft }">
    <button type="button" class="hero-main" @click="openPlanItem(heroInfo.item)">
      <span class="hero-icon"><Ico :name="heroInfo.style.icon" /></span>
      <span class="grow">
        <span class="hero-eyebrow">{{ heroInfo.eyebrow }}</span>
        <b class="hero-title">{{ heroInfo.item.title }}</b>
        <small class="hero-meta">{{ heroInfo.meta }}</small>
      </span>
    </button>
    <button v-if="heroInfo.item.place && !hero?.live" type="button" class="hero-go" @click="goHero"><Ico name="walk" /><span>导航</span></button>
  </section>
  <section v-else-if="fallback && hasClasses" class="hero empty">
    <span class="hero-icon"><Ico :name="account.me ? 'academic' : 'users'" /></span>
    <span class="grow">
      <b class="hero-title">{{ !account.me && !hasClasses ? '登录可获得你的专属课表' : !hasClasses ? '导入课表，上课地点自动标上地图' : '接下来 7 天没有安排' }}</b>
  <small class="hero-meta">{{ !account.me && !hasClasses ? '邮箱登录，课表和寝室换手机也在' : !hasClasses ? '截一张教务课表的图就行，每周自动排好' : '可以去活动雷达看看最近有什么' }}</small>
    </span>
    <button v-if="!account.me && !hasClasses" type="button" class="hero-go" @click="openAccount()"><span>登录</span></button>
    <button v-else-if="!hasClasses" type="button" class="hero-go" @click="openProfile('schedule')"><span>导入</span></button>
    <button v-else type="button" class="hero-go" @click="state.radar.place = ''; showPanel('events')"><span>活动</span></button>
  </section>
</template>

<style scoped>
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
</style>
