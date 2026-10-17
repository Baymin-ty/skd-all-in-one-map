<script setup lang="ts">
import { computed } from 'vue'
import { account, openAccount } from '../lib/account'
import { dateKey, nowTick, weekdayText } from '../lib/campusTime'
import { KIND_ORDER, KIND_STYLE, myMap, type AgendaEntry } from '../lib/myMap'
import { myAgenda, navigateToPlace, openPlanItem, placeName, placeSelection, setMyScope, toggleWeekDay } from '../lib/store'
import { endMin, fromMin, isWeeklyClass, plan, type PlanItem } from '../lib/today'
import { openParcelStationMap } from '../lib/parcelStation'
import { ui } from '../lib/ui'
import Ico from './Ico.vue'
import UpNextCard from './UpNextCard.vue'

// 我的地图的面板：最上面一张「接下来」卡片（手机收起时也看得到），下面按今天 / 明天 / 本周列出安排，
// 课程、活动、吃饭、待办用和地图小旗一样的颜色区分；活动数据会自动进入对应日期。
const today = computed(() => dateKey(nowTick.value))
const where = (i: PlanItem) => {
  const sel = placeSelection(i.place)
  return [sel && placeName(sel), i.room].filter(Boolean).join(' ')
}

// ---------- 今天 / 明天 / 本周 ----------
const scopes = computed(() => [
  { id: 'today' as const, zh: '今天' },
  { id: 'tomorrow' as const, zh: '明天' },
  { id: 'week' as const, zh: '本周' },
])
/** 「日程」页也能把 plan.date 翻到别的日子，那时三个都不亮 */
const scope = computed(() => myMap.scope === 'week' ? 'week' : plan.date === today.value ? 'today' : plan.date === dateKey(nowTick.value + 86_400_000) ? 'tomorrow' : '')
const week = computed(() => myAgenda.value.week)
const entries = computed(() => myAgenda.value.entries)
const counts = computed(() => KIND_ORDER.map((k) => ({ kind: k, n: new Set(entries.value.filter((e) => e.item.kind === k).map((e) => week.value ? e.item.id : e.item.id + e.date)).size })).filter((c) => c.n))
const scopeDate = computed(() => {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`
  if (week.value) return `${md(myAgenda.value.dates[0])} – ${md(myAgenda.value.dates.at(-1)!)}`
  const d = plan.date
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日${scope.value === 'today' ? '' : ` ${weekdayText(d)}`}`
})
const emptyText = computed(() => scope.value === 'week' ? '本周没有安排' : scope.value === 'tomorrow' ? '明天没有安排' : scope.value === 'today' ? '今天没有安排' : '这天没有安排')
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
/** 没登录、课表只存在这台设备上：提醒一句登录后能同步 */
const localOnly = computed(() => !account.me && plan.items.some(isWeeklyClass))
const STATUS_TEXT = { now: '进行中', upnext: '下一项', later: '', past: '' } as const

</script>

<template>
  <div class="page my-page">
    <!-- 接下来：手机收起时露出的就是这张卡片 -->
    <UpNextCard fallback />
    <p v-if="localOnly" class="sync-hint">课表只存在这台设备上 · <button type="button" @click="openAccount()">登录</button>后换手机也在</p>

    <!-- 今天 / 明天 / 本周：列出来的是地图上各站的图例；完整日程、吃饭建议在「日程」，课表和常用地点在「我的」 -->
    <header class="scope-head">
      <div class="seg" role="group" aria-label="看哪天的安排">
        <button v-for="o in scopes" :key="o.id" type="button" :class="{ on: scope === o.id }" :aria-pressed="scope === o.id" @click="setMyScope(o.id)">{{ o.zh }}</button>
      </div>
      <small class="scope-date">{{ scopeDate }}</small>
    </header>
    <p v-if="entries.length" class="legend" aria-label="图例">
      <span v-for="c in counts" :key="c.kind" :style="{ '--k': KIND_STYLE[c.kind].color }"><i />{{ KIND_STYLE[c.kind].zh }} {{ c.n }}</span>
    </p>
    <p v-else class="scope-empty">{{ emptyText }}</p>

    <p v-if="week && entries.length" class="day-hint">{{ myAgenda.day ? '地图只显示选中的一天 · 再点一次看整周' : '点某一天，地图只显示那天的安排' }}</p>
    <div v-for="g in groups" :key="g.date" class="day" :class="{ dim: week && myAgenda.day && myAgenda.day !== g.date }">
      <h3 v-if="week" class="day-label"><button type="button" :class="{ today: g.date === today, on: myAgenda.day === g.date }" :aria-pressed="myAgenda.day === g.date" @click="toggleWeekDay(g.date)">{{ g.label }}<Ico v-if="myAgenda.day === g.date" name="close" /></button></h3>
      <ul class="list-plain agenda">
        <li v-for="e in g.items" :key="e.item.id + e.date" class="ag" :class="week ? { past: e.date < today } : e.status" :style="{ '--k': KIND_STYLE[e.item.kind].color, '--ks': KIND_STYLE[e.item.kind].soft }">
          <span class="ag-time"><b>{{ e.item.start }}</b><small>{{ fromMin(endMin(e.item)) }}</small></span>
          <button type="button" class="ag-main" @click="openPlanItem(e.item)">
            <b><span class="ag-kind"><Ico :name="KIND_STYLE[e.item.kind].icon" />{{ KIND_STYLE[e.item.kind].zh }}</span><span class="ellipsis">{{ e.item.title }}</span><em v-if="!week && STATUS_TEXT[e.status]">{{ STATUS_TEXT[e.status] }}</em></b>
            <small class="ellipsis">{{ where(e.item) || '地点未填' }}</small>
          </button>
          <button v-if="e.item.place" type="button" class="ag-go" :aria-label="`导航到${where(e.item)}`" @click="navigateToPlace(e.item.place)"><Ico name="walk" /></button>
        </li>
      </ul>
    </div>

    <!-- 手机没有左侧导航栏，快递站放这里 -->
    <button v-if="!ui.desktop" type="button" class="act small parcel-action" @click="openParcelStationMap"><Ico name="parcel" />快递站地图</button>
  </div>
</template>

<style scoped>
.my-page { padding-top: 6px; }
.sync-hint { margin: 8px 2px 0; color: var(--ink-3); font-size: 12px; }
.sync-hint button { padding: 0; border: 0; background: none; color: var(--brand); font: inherit; font-weight: 650; cursor: pointer; }

/* 今天 / 明天 / 本周 */
.scope-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 18px 0 4px; }
.seg { display: flex; padding: 3px; border-radius: 999px; background: var(--bg-2); }
.seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: none; color: var(--ink-2); font-size: 13px; font-weight: 650; white-space: nowrap; cursor: pointer; transition: background-color .15s, color .15s; }
.seg button.on { background: #fff; color: var(--ink); box-shadow: 0 1px 3px #0000001f; }
.scope-date { flex: none; font-size: 12.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 6px 2px 0; font-size: 11.5px; color: var(--ink-2); }
.legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--k); }
.scope-empty { margin: 10px 2px 0; color: var(--ink-3); font-size: 13px; }
.day-label { margin: 14px 0 2px; }
.day-label button { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; margin-left: -10px; border: 0; border-radius: 999px; background: none; color: var(--ink-3); font-size: 12.5px; font-weight: 700; cursor: pointer; transition: background-color .15s, color .15s; }
.day-label button.today { color: var(--brand); }
.day-label button.on { background: var(--ink); color: #fff; }
.day-label button .svgi { font-size: 11px; }
@media (hover: hover) { .day-label button:not(.on):hover { background: var(--bg-2); color: var(--ink); } }
.day { transition: opacity .2s; }
.day.dim { opacity: .4; }
.day-hint { margin: 6px 2px 0; font-size: 11.5px; color: var(--ink-3); }
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
.my-page { display: flex; flex-direction: column; }
.parcel-action { align-self: flex-start; margin-top: 16px; }
.parcel-action { border-color: #e9c8cb; background: var(--brand-soft); color: var(--brand); }

/* 常用地点 */
.sec h3 { justify-content: space-between; }
@media (hover: hover) { .ag-main:hover b { color: var(--k); } .ag-go:hover { background: var(--ks); } .seg button:not(.on):hover { color: var(--ink); } }
</style>
