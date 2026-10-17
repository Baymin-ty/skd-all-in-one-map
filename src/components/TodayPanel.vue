<script setup lang="ts">
import { computed, ref } from 'vue'
import { dateKey, dayName, nowTick, timestamp } from '../lib/campusTime'
import { CROWD_LABELS, crowdAt } from '../lib/crowd'
import { discovery } from '../lib/discoveryData'
import { lateLegs, nextStep, suggestEvents, suggestMeals, type PlanContext } from '../lib/planner'
import { navigateToPlace, openEvent, placeName, placeSelection, select, toast } from '../lib/store'
import { addItem, endMin, fromMin, isWeeklyClass, itemFromEvent, itemsOnIncludingEvents, nowMinute, plan, PLAN_KINDS, removeItem, startMin, withDiscoveryEvents, type PlanItem } from '../lib/today'
import { walkMinutes } from '../lib/walkTime'
import { account } from '../lib/account'
import { openProfile } from '../lib/profile'
import Ico from './Ico.vue'
import TodayItemForm from './TodayItemForm.vue'

const DAY = 86_400_000
const days = computed(() => [0, 1, 2].map((n) => {
  const date = dateKey(timestamp(dateKey()) + n * DAY)
  return { date, label: n === 0 ? '今天' : n === 1 ? '明天' : `${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${dayName(date)}` }
}))
const ctx = computed((): PlanContext => ({
  date: plan.date, now: nowTick.value, items: withDiscoveryEvents(plan.items, discovery.events), canteens: discovery.canteens, events: discovery.events, walk: walkMinutes, crowd: crowdAt,
}))
const day = computed(() => itemsOnIncludingEvents(plan.items, discovery.events, plan.date))
const now = computed(() => nowMinute(plan.date, nowTick.value))
const legs = computed(() => lateLegs(ctx.value))
const step = computed(() => nextStep(ctx.value))
const meals = computed(() => suggestMeals(ctx.value))
const mealCrowdLabel = computed(() => meals.value.some((s) => s.crowd.source === 'live') ? '含实时反馈' : '排队时间为估算')
const freeEvents = computed(() => suggestEvents(ctx.value))
const editing = ref<PlanItem | 'new' | null>(null)
const classCount = computed(() => plan.items.filter(isWeeklyClass).length)
const autoEvent = (i: PlanItem) => !!i.eventId && i.id.startsWith('event:')

const status = (i: PlanItem) => endMin(i) <= now.value ? 'past' : startMin(i) <= now.value ? 'now' : 'next'
const where = (i: PlanItem) => {
  const sel = placeSelection(i.place)
  return [sel && placeName(sel), i.room].filter(Boolean).join(' · ')
}
const range = (i: PlanItem) => `${i.start}–${fromMin(endMin(i))}`
function show(i: PlanItem) {
  if (i.eventId) return openEvent(i.eventId)
  const sel = placeSelection(i.place)
  if (sel) select(sel)
}
function remove(i: PlanItem) {
  if (autoEvent(i)) return
  removeItem(i.id)
  toast(i.weekdays?.length ? '已删除这门课（每周的都删除了）' : '已删除')
}
function addMeal(s: (typeof meals.value)[number]) {
  addItem({ kind: 'meal', title: `${s.meal === 'lunch' ? '午饭' : '晚饭'} · ${s.canteen.zh}`, place: s.canteen.place, start: fromMin(s.arrive), end: fromMin(s.done), date: plan.date, source: 'planner' })
  toast('已加入吃饭安排')
}
function addEvent(e: (typeof freeEvents.value)[number]) {
  addItem(itemFromEvent(e.event))
  toast('已加入活动')
}
const leaveText = computed(() => {
  const s = step.value
  if (s?.leaveIn == null) return ''
  if (s.leaveIn < 0) return `已经晚了 ${-s.leaveIn} 分钟，尽快出发`
  if (s.leaveIn === 0) return '现在出发'
  return s.leaveIn < 60 ? `${s.leaveIn} 分钟后出发` : `${fromMin(s.leaveAt!)} 出发`
})
</script>

<template>
  <div class="page today-page">
    <h2 class="title">我的今天</h2>
    <p class="sub">课、活动和吃饭排成一条路线，按下课时间推荐去哪吃饭</p>
    <div class="filter-chips" aria-label="日期">
      <button v-for="d in days" :key="d.date" type="button" :class="{ on: plan.date === d.date }" :aria-pressed="plan.date === d.date" @click="plan.date = d.date">{{ d.label }}</button>
    </div>
    <p v-if="!plan.persisted" class="note warn">这个浏览器不允许保存数据，刷新页面后安排会丢失。</p>
    <button type="button" class="schedule-link" @click="openProfile('schedule')">
      <Ico name="academic" />
      <span class="grow">{{ classCount ? `课表 ${classCount} 门课，按星期自动排进来` : '还没有课表：导入截图后每天自动排课' }}</span>
      <span class="sl-go">{{ classCount ? '管理课表' : '去导入' }}<Ico name="chevron" /></span>
    </button>

    <section v-if="step?.next" class="next-card" :class="{ late: (step.leaveIn ?? 0) < 0 }">
      <span class="nc-eyebrow"><Ico name="clock" />下一项 · {{ step.next.start }}</span>
      <b>{{ step.next.title }}</b>
      <span class="nc-meta">{{ where(step.next) || '地点未填' }}<template v-if="step.walk != null"> · 步行 {{ step.walk }} 分钟</template></span>
      <span class="nc-leave">{{ leaveText }}</span>
      <button v-if="step.next.place" type="button" class="act primary small" @click="navigateToPlace(step.next.place!)"><Ico name="walk" />到这去</button>
    </section>
    <section v-else-if="step?.current" class="next-card">
      <span class="nc-eyebrow"><Ico name="clock" />正在进行</span>
      <b>{{ step.current.title }}</b>
      <span class="nc-meta">{{ range(step.current) }}<template v-if="where(step.current)"> · {{ where(step.current) }}</template> · 之后没有安排了</span>
    </section>

    <ol v-if="day.length" class="timeline">
      <template v-for="(i, n) in day" :key="i.id">
        <li v-if="n > 0 && legs.get(i.id)" class="leg" :class="{ late: legs.get(i.id)!.late }">
          <Ico name="walk" />
          <span v-if="legs.get(i.id)!.late">步行 {{ legs.get(i.id)!.walk }} 分钟，会迟到 {{ legs.get(i.id)!.late }} 分钟</span>
          <span v-else-if="legs.get(i.id)!.walk != null">步行 {{ legs.get(i.id)!.walk }} 分钟</span>
          <span v-else>地点未填，没法估算路程</span>
        </li>
        <li class="stop" :class="status(i)">
          <span class="time"><b>{{ i.start }}</b><small>{{ fromMin(endMin(i)) }}</small></span>
          <span class="dot"><Ico :name="PLAN_KINDS[i.kind].icon" /></span>
          <div class="body">
            <button type="button" class="stop-title" @click="show(i)">{{ i.title }}</button>
            <span class="meta"><span class="kind">{{ PLAN_KINDS[i.kind].zh }}</span>{{ where(i) || '地点未填' }}<template v-if="i.weekdays?.length"> · 每周</template></span>
            <span v-if="i.note" class="meta">{{ i.note }}</span>
            <span class="stop-actions">
              <button v-if="i.place" type="button" class="text-link" @click="navigateToPlace(i.place)">到这去</button>
              <template v-if="!autoEvent(i)"><button type="button" class="text-link" @click="editing = i">编辑</button><button type="button" class="text-link danger" @click="remove(i)">删除</button></template>
            </span>
          </div>
        </li>
      </template>
    </ol>
    <div v-else-if="editing !== 'new'" class="empty"><Ico name="calendar" /><p>{{ plan.date === dateKey() ? '今天' : '这天' }}还没有安排</p><p class="muted">活动会自动显示在日程里，也可以手动添加课程或待办</p></div>

    <TodayItemForm v-if="editing" :key="editing === 'new' ? 'new' : editing.id" :item="editing === 'new' ? null : editing" :date="plan.date" @done="editing = null" />
    <button v-else type="button" class="act add-btn" @click="editing = 'new'"><Ico name="plus" />添加安排</button>

    <section v-if="meals.length" class="sec">
      <h3>吃饭建议 <span class="muted">{{ mealCrowdLabel }}</span></h3>
      <div v-for="s in meals" :key="s.meal" class="suggest">
        <span class="sg-icon food"><Ico name="dining" /></span>
        <div class="grow">
          <b>{{ s.meal === 'lunch' ? '午饭' : '晚饭' }} · {{ s.canteen.zh }}<small v-if="s.canteen.outlets.length > 1"> {{ s.outlet.zh }}</small></b>
          <p>
            <template v-if="s.prev">{{ fromMin(s.leave) }} 从{{ where(s.prev) || s.prev.title }}出发<template v-if="s.delay >= 10">（下课后歇 {{ s.delay }} 分钟，错开饭点高峰）</template>，</template><template v-else>{{ fromMin(s.arrive) }} 到，</template>步行 {{ s.walkIn }} 分钟
            · 预计排队 {{ s.crowd.waitMin }} 分钟（{{ CROWD_LABELS[s.crowd.level] }}）
            <template v-if="s.next"> · {{ fromMin(s.back!) }} 前回到{{ where(s.next) || s.next.title }}</template>
          </p>
          <span class="sg-actions">
            <button type="button" class="act small" @click="addMeal(s)"><Ico name="plus" />加入安排</button>
            <button type="button" class="act small" @click="navigateToPlace(s.canteen.place)"><Ico name="walk" />到这去</button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="freeEvents.length" class="sec">
      <h3>空档里可以去 <span class="muted">不和已有安排冲突</span></h3>
      <div v-for="s in freeEvents" :key="s.event.id" class="suggest">
        <span class="sg-icon"><Ico name="calendar" /></span>
        <div class="grow">
          <button type="button" class="stop-title" @click="openEvent(s.event.id)">{{ s.event.title }}</button>
          <p>{{ fromMin(s.start) }}–{{ fromMin(s.end) }} · {{ placeName(placeSelection(s.event.place)!) }}<template v-if="s.prev?.place"> · 从上一站步行 {{ s.walkIn }} 分钟</template></p>
          <span class="sg-actions"><button type="button" class="act small" @click="addEvent(s)"><Ico name="plus" />加入安排</button></span>
        </div>
      </div>
    </section>

    <p class="source-note">{{ account.me ? '安排已同步到校园账号。' : '安排只保存在这台设备的浏览器里，登录后可同步到账号。' }}步行时间按校园路网估算。</p>
  </div>
</template>

<style scoped>
.note.warn { background: #fff4e5; color: #8a4b08; }
.schedule-link { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 4px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: #fff; color: var(--ink-2); font-size: 12.5px; text-align: left; cursor: pointer; }
.schedule-link > .svgi { flex: none; font-size: 16px; color: #6d4c9c; }
.sl-go { flex: none; display: inline-flex; align-items: center; gap: 2px; color: var(--blue); font-weight: 600; }
@media (hover: hover) { .schedule-link:hover { background: #f9f9fb; } }
.next-card { position: relative; display: flex; flex-direction: column; gap: 3px; margin-top: 14px; padding: 13px 14px; border-radius: 14px; background: var(--brand-soft); border: 1.5px solid #ecc9cc; }
.next-card.late { background: #fff4e5; border-color: #f2cf9f; }
.nc-eyebrow { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 650; color: var(--brand); }
.next-card b { font-size: 16px; line-height: 1.35; padding-right: 92px; }
.nc-meta { font-size: 12.5px; color: var(--ink-2); padding-right: 92px; }
.nc-leave { font-size: 13px; font-weight: 700; color: var(--brand); }
.next-card.late .nc-leave { color: #a2560b; }
.next-card .act { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); }

.timeline { list-style: none; margin: 16px 0 0; padding: 0; }
.stop { display: grid; grid-template-columns: 46px 30px minmax(0, 1fr); gap: 8px; align-items: start; }
.stop .time { display: flex; flex-direction: column; align-items: flex-end; padding-top: 4px; font-variant-numeric: tabular-nums; }
.stop .time b { font-size: 13px; }
.stop .time small { font-size: 11px; color: var(--ink-3); }
.stop .dot { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--brand); color: #fff; font-size: 15px; box-shadow: 0 0 0 3px #fff, 0 0 0 4px var(--line); }
.stop .body { min-width: 0; padding: 3px 0 12px; }
.stop-title { display: block; padding: 0; border: 0; background: none; text-align: left; font-size: 14.5px; font-weight: 700; line-height: 1.4; color: var(--ink); cursor: pointer; }
.stop-title:hover { color: var(--brand); }
.meta { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-2); }
.kind { margin-right: 6px; padding: 0 6px; border-radius: 5px; background: var(--bg-2); font-size: 11px; font-weight: 600; }
.stop-actions { display: flex; gap: 12px; margin-top: 5px; }
.stop-actions .text-link { font-size: 12px; }
.text-link.danger { color: #b3261e; }
.stop.past { opacity: .5; }
.stop.past .dot { background: #b9b9c0; }
.stop.now .dot { background: #1f9d55; box-shadow: 0 0 0 3px #fff, 0 0 0 5px #1f9d5555; }
.leg { display: flex; align-items: center; gap: 6px; margin: -4px 0 8px 61px; padding: 4px 10px; border-left: 2px dashed #d9d9df; font-size: 12px; color: var(--ink-3); }
.leg.late { color: #b3261e; border-left-color: #f0b4ae; font-weight: 600; }
.add-btn { width: 100%; justify-content: center; margin-top: 12px; border-style: dashed; color: var(--brand); }

.suggest { display: flex; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; margin-bottom: 8px; }
.suggest b { font-size: 14px; }
.suggest b small { font-weight: 500; color: var(--ink-3); }
.suggest p { margin-top: 3px; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
.sg-icon { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--brand-soft); color: var(--brand); font-size: 17px; }
.sg-icon.food { background: #fff2e0; color: #ad6a19; }
.sg-actions { display: flex; gap: 6px; margin-top: 8px; }
.empty p + p { margin-top: 4px; font-size: 12.5px; }
</style>
