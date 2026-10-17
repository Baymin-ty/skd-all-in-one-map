<script setup lang="ts">
import { computed } from 'vue'
import { endFor, navigateToPlace, openDining, openRoute, PLACE_COLORS, placeSelection, select, setEnd, setMapView, showPanel, state } from '../lib/store'
import { discovery, eventsIn } from '../lib/discoveryData'
import { CROWD_LABELS, crowdAt, crowdRevision } from '../lib/crowd'
import { dateKey, nowTick } from '../lib/campusTime'
import { endMin, fromMin, itemsOn, nowMinute, plan, startMin } from '../lib/today'
import { homePlace, openProfile } from '../lib/profile'
import { openParcelStationMap } from '../lib/parcelStation'
import EventCard from './EventCard.vue'
import Ico from './Ico.vue'

const gates = computed(() => state.buildings.filter((b) => b.cat === 'gate'))
const upcoming = computed(() => eventsIn('week'))
const leastCrowd = computed(() => {
  void crowdRevision.value
  void nowTick.value
  return discovery.canteens.map((canteen) => ({ canteen, crowd: crowdAt(canteen.id, nowTick.value) })).sort((a, b) => a.crowd.waitMin - b.crowd.waitMin)[0]
})
// 寝室、实验室在「我的」里设置
const dorm = computed(() => homePlace('dorm'))
const lab = computed(() => homePlace('lab'))
function goPersonal(place: { place: string }) {
  // Keep a useful origin when the user has not granted location access yet.
  if (!state.route.from) {
    const day = itemsOn(plan.items, dateKey(nowTick.value))
    const candidate = day.find((item) => item.place && item.place !== place.place) || [...day].reverse().find((item) => item.place && item.place !== place.place)
    const origin = candidate?.place && placeSelection(candidate.place)
    const end = origin && endFor(origin)
    if (end) setEnd('from', end)
  }
  navigateToPlace(place.place)
}
const todayHint = computed(() => {
  const day = itemsOn(plan.items, dateKey(nowTick.value))
  const now = nowMinute(dateKey(nowTick.value), nowTick.value)
  const current = day.find((i) => startMin(i) <= now && now < endMin(i))
  const next = day.find((i) => startMin(i) > now)
  if (next) return `下一项 ${next.start} ${next.title}`
  if (current) return `正在进行：${current.title}，${fromMin(endMin(current))} 结束`
  return day.length ? '今天的安排都完成了' : '加上今天的课，自动安排吃饭和路线'
})
const todayCount = computed(() => itemsOn(plan.items, dateKey(nowTick.value)).length)
</script>

<template>
  <div class="page home">
    <!-- 第一排就是最常用的几件事，手机收起面板时也露在外面 -->
    <div class="quick">
      <button type="button" class="q-go" @click="openRoute()"><Ico name="walk" /><b>步行导航</b></button>
      <button type="button" class="q-parcel" @click="openParcelStationMap"><Ico name="grid" /><b>快递站地图</b></button>
      <button v-if="dorm" type="button" class="q-me" @click="goPersonal(dorm)"><Ico name="housing" /><b>回寝室</b></button>
      <button v-else type="button" class="q-me" @click="openProfile('places')"><Ico name="housing" /><b>设寝室</b></button>
      <button v-if="lab" type="button" class="q-me" @click="goPersonal(lab)"><Ico name="academic" /><b>去实验室</b></button>
      <button v-else type="button" class="q-mine" @click="setMapView('mine')"><Ico name="users" /><b>我的地图</b></button>
    </div>

    <section class="sec now">
      <h3>现在 <span class="muted">点地图上的楼和点位看详情</span></h3>
      <button type="button" class="now-row" @click="showPanel('today')">
        <span class="now-icon today"><Ico name="clock" /></span>
        <span class="grow"><b>我的今天<em v-if="todayCount">{{ todayCount }} 项</em></b><small class="ellipsis">{{ todayHint }}</small></span>
        <Ico name="chevron" class="chev" />
      </button>
      <button v-if="leastCrowd" type="button" class="now-row" @click="openDining(leastCrowd.canteen.id)">
        <span class="now-icon food"><Ico name="dining" /></span>
        <span class="grow"><b>{{ leastCrowd.canteen.zh }} 人最少</b><small>{{ CROWD_LABELS[leastCrowd.crowd.level] }} · 约 {{ leastCrowd.crowd.waitMin }} 分钟 · {{ leastCrowd.crowd.source === 'live' ? '实时反馈' : '估算' }}</small></span>
        <Ico name="chevron" class="chev" />
      </button>
    </section>

    <section v-if="upcoming.length" class="sec upcoming">
      <h3>近期活动 <button type="button" class="text-link" @click="state.radar.place = ''; showPanel('events')">全部 {{ upcoming.length }} 场</button></h3>
      <EventCard v-for="event in upcoming.slice(0, 3)" :key="event.id" :event="event" show-day />
    </section>

    <section class="sec">
      <h3>楼群 <span class="muted">点开看每一栋</span></h3>
      <ul class="list-plain rows">
        <li v-for="g in state.groups" :key="g.id" class="tap" @click="select({ kind: 'group', id: g.id })">
          <span class="ric" :style="{ background: PLACE_COLORS[g.cat] }"><Ico :name="g.cat" /></span>
          <div class="grow"><b>{{ g.name.zh }}</b><small>{{ g.name.en }}</small></div>
          <span class="pill">{{ g.members.length }} 栋</span>
          <Ico name="chevron" class="chev" />
        </li>
      </ul>
    </section>

    <section class="sec">
      <h3>校门</h3>
      <div class="tags">
        <button v-for="b in gates" :key="b.id" type="button" class="tagbtn" @click="select({ kind: 'building', id: b.id })"><Ico name="gate" />{{ b.name.zh }}</button>
      </div>
    </section>

    <footer class="foot">
      <p>底图、楼宇、点位来自上海科技大学校园地图；部分道路 © OpenStreetMap contributors · <a href="/admin/" target="_blank" rel="noopener">管理后台</a></p>
    </footer>
  </div>
</template>

<style scoped>
.home { padding-top: 6px; }
.quick { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.quick button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-width: 0; height: 80px; padding: 8px 4px; border: 1px solid var(--line); border-radius: 16px; background: #fff; cursor: pointer; }
.quick .svgi { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--bg-2); font-size: 19px; }
.quick b { font-size: 12.5px; font-weight: 650; white-space: nowrap; }
.quick button:active { transform: scale(.97); }
.quick .q-go { border-color: var(--brand); background: var(--brand); color: #fff; }
.quick .q-go .svgi { background: #ffffff26; }
.quick .q-parcel .svgi { background: var(--brand-soft); color: var(--brand); }
.quick .q-me .svgi { background: #f3eefb; color: #6d4c9c; }
.quick .q-mine .svgi { background: #e9effb; color: #2f5fc4; }
@media (hover: hover) { .quick button:not(.q-go):hover { background: #f9f9fb; } .quick .q-go:hover { background: #941f25; } }
.now h3, .upcoming h3 { justify-content: space-between; }
.now-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 8px; margin: 0 -8px; width: calc(100% + 16px); border: 0; border-radius: 12px; background: none; text-align: left; cursor: pointer; }
.now-row b, .now-row small { display: block; }
.now-row b { font-size: 14.5px; }
.now-row b em { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #eaf4ee; color: #1f7a48; font-size: 11px; font-style: normal; font-weight: 600; }
.now-row small { margin-top: 2px; color: var(--ink-3); font-size: 12px; }
@media (hover: hover) { .now-row:hover { background: #f7f7f9; } }
.now-icon { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; font-size: 18px; }
.now-icon.today { background: #eaf4ee; color: #1f7a48; }
.now-icon.food { background: #fff2e0; color: #ad6a19; }
.foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); }
.foot p { color: var(--ink-3); font-size: 11px; line-height: 1.6; }
.foot a { color: var(--ink-3); text-decoration: underline; text-underline-offset: 2px; }
.tagbtn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 13px; cursor: pointer; }
.tagbtn .svgi { color: var(--ink-3); }
.tagbtn:hover { background: var(--bg-2); }
</style>
