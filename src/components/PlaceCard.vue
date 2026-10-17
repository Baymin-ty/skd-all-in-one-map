<script setup lang="ts">
import { computed } from 'vue'
import {
  buildingById, CHIPS, endFor, groupOf, openCanteen, poiById, select, setChip, setEnd, showEntrances, showEventsAt, state,
} from '../lib/store'
import { discovery, eventsIn } from '../lib/discoveryData'
import EventCard from './EventCard.vue'
import Ico from './Ico.vue'
import CanteenRow from './CanteenRow.vue'
import RoomDirectory from './RoomDirectory.vue'
import CommunityEntry from './CommunityEntry.vue'
import { floorLabel } from '../lib/rooms'
import { POI_KINDS, poiKindLabel } from '../lib/catalog'
import { buildLink, openShare } from '../lib/deepLink'
import { setUserData } from '../lib/userData'
import { upsertMapPlace } from '../lib/mapPrefs'
import { displayText, t } from '../lib/i18n'

const b = computed(() => (state.selected?.kind === 'building' ? buildingById(state.selected.id) : undefined))
const poi = computed(() => (state.selected?.kind === 'poi' ? poiById(state.selected.id) : undefined))
const group = computed(() => (b.value ? groupOf(b.value.id) : undefined))
const place = computed(() => b.value ?? poi.value)
const kind = computed(() => {
  if (b.value) return b.value.walkway ? '风雨长廊' : state.categories[b.value.cat]?.zh
  return poi.value && poiKindLabel(poi.value)
})
const hours = computed(() => b.value?.hours?.zh || poi.value?.hours?.zh)
const room = computed(() => b.value && state.room?.building === b.value.id ? state.room : null)
const canteen = computed(() => discovery.canteens.find((c) => c.place === place.value?.id))
const events = computed(() => place.value ? eventsIn('upcoming', 'all', place.value.id) : [])
const category = computed(() => CHIPS.find((c) => c.id === (b.value?.walkway ? 'walkway' : b.value?.cat || (poi.value?.cat === 'life' ? 'service' : poi.value?.cat))))

function sharePlace() {
  if (!place.value) return
  const id = place.value.id
  const code = room.value?.code
  openShare({ title: [place.value.name.zh, code].filter(Boolean).join(' '), links: [
    { label: '直接导航', url: buildLink({ kind: 'to', place: id, room: code }), hint: '扫码后从当前位置导航到这里' },
    { label: '地点详情', url: buildLink({ kind: 'place', place: id, room: code }), hint: '扫码后打开地点详情' },
  ] })
}
function routeHere(which: 'from' | 'to') {
  const end = state.selected && endFor(state.selected)
  if (!end) return
  setEnd(which, room.value ? { ...end, name: `${end.name} ${room.value.code}` } : end)
  // 收起详情，让出地方给导航卡片和路线
  select(null)
}
function savePlace(role: 'dorm' | 'lab' | 'office' | 'fav') {
  if (!place.value) return
  state.mapPrefs = upsertMapPlace(state.mapPrefs, { id: `${role}-${place.value.id}`, role, place: place.value.id, room: room.value?.code, label: place.value.name.zh })
  setUserData('map', state.mapPrefs)
  state.toast = role === 'dorm' ? '已设为我的寝室' : '已加入我的地点'
}
</script>

<template>
  <div v-if="place" class="page">
    <button v-if="group" type="button" class="crumb" @click="select({ kind: 'group', id: group.id })">
      <Ico name="back" />{{ group.name.zh }} · {{ group.members.length }} 栋
    </button>
    <button v-else-if="category" type="button" class="crumb" @click="setChip(category.id)"><Ico name="back" />返回{{ category.zh }}</button>
    <div class="head">
      <div class="row kick">
        <span class="pill" :class="{ walkway: b?.walkway }">{{ kind }}</span>
        <span v-if="b?.isNew" class="pill new">新楼</span>
      </div>
      <button type="button" class="close" aria-label="关闭" @click="select(null)"><Ico name="close" /></button>
    </div>
    <h2 class="title">{{ displayText(place.name.zh, place.name.en) }}</h2>
    <p v-if="place.name.en" class="sub">{{ place.name.en }}</p>

    <div v-if="room" class="room-banner" role="status">
      <span class="rb-icon"><Ico name="door" /></span>
      <div>
        <b>{{ room.code }}</b><span>{{ floorLabel(room.floor) }}<template v-if="room.label"> · {{ room.label }}</template></span>
        <small v-if="room.confidence === 'rule'">按房间号推测楼层，以现场指示为准</small>
        <small v-else-if="room.confidence === 'history'">根据往期活动地点「{{ room.venue }}」推测</small>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="act primary" @click="routeHere('to')"><Ico name="walk" />{{ t('event.navigate') }}</button>
      <button type="button" class="act" @click="routeHere('from')">从这出发</button>
      <button v-if="canteen" type="button" class="act" @click="openCanteen(canteen.id)"><Ico name="book" />食堂与菜单</button>
      <button type="button" class="act" @click="savePlace(b?.cat === 'housing' ? 'dorm' : 'fav')"><Ico name="bookmark" />{{ b?.cat === 'housing' ? '设为我的寝室' : '加入我的地点' }}</button>
      <button type="button" class="act" @click="sharePlace"><Ico name="external" />分享</button>
    </div>

    <section v-if="canteen" class="sec"><h3>在这里吃</h3><CanteenRow :canteen="canteen" /></section>
    <CommunityEntry v-else-if="!b?.walkway && b?.cat !== 'gate'" :target="{ type: 'place', id: place.id, name: place.name.zh, subtitle: kind ? `${kind} · 来过的同学怎么说` : undefined }" />

    <section v-if="events.length" class="sec">
      <h3>这里的活动 <button type="button" class="text-link" @click="state.radar.range = 'upcoming'; state.radar.cat = 'all'; showEventsAt(place.id)">查看 {{ events.length }} 场</button></h3>
      <EventCard v-for="event in events.slice(0, 3)" :key="event.id" :event="event" show-day />
    </section>

    <div v-if="hours" class="kv">
      <span class="ic"><Ico name="clock" /></span>
      <div class="v"><small>开放时间</small>{{ hours }}</div>
    </div>

    <section v-if="b?.entrances?.length && b.cat !== 'gate' && !b.walkway" class="ents">
      <button type="button" class="text-link" :aria-expanded="state.entranceBuilding === b.id" @click="state.entranceBuilding === b.id ? state.entranceBuilding = '' : showEntrances(b.id)"><Ico name="entrance" />{{ state.entranceBuilding === b.id ? '收起出入口' : `查看 ${b.entrances.length} 个出入口` }}</button>
      <div v-if="state.entranceBuilding === b.id" class="tags">
        <button v-for="(e, i) in b.entrances" :key="i" type="button" class="echip" @click="showEntrances(b.id, e.pos)">{{ e.zh || '入口' }}</button>
      </div>
    </section>

    <p v-if="b?.walkway" class="note rain"><Ico name="rain" /> 下雨天打开导航里的「雨天模式」，路线会优先从长廊下面走。</p>
    <p v-if="b?.info" class="note">{{ b.info.zh }}</p>
    <p v-if="b?.note" class="note">{{ b.note.zh }}</p>
    <p v-if="poi?.kind" class="note"><Ico :name="POI_KINDS[poi.kind].icon" /> {{ POI_KINDS[poi.kind].hint }}</p>
    <p v-if="poi?.desc?.zh" class="note">{{ poi.desc.zh }}</p>

    <section v-if="b?.orgs.length" class="sec">
      <h3>单位</h3>
      <div class="tags"><span v-for="o in b.orgs" :key="o.zh" class="pill">{{ o.zh }}</span></div>
    </section>
    <section v-if="b?.aliases.length" class="sec">
      <h3>也叫</h3>
      <div class="tags"><span v-for="a in b.aliases" :key="a" class="pill">{{ a }}</span></div>
    </section>
    <RoomDirectory v-if="b?.rooms.length" :key="b.id + (room?.code ?? '')" :rooms="b.rooms" :focus="room?.confidence === 'exact' ? room.code : ''" />
    <p v-if="poi?.source" class="muted top">来源：{{ poi.source }}</p>
  </div>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 2px; margin: 2px 0 2px -4px; padding: 3px 8px 3px 2px; border: 0; border-radius: 999px; background: none; color: var(--blue); font-size: 13px; font-weight: 600; cursor: pointer; }
.crumb:hover { background: var(--bg-2); }
.ents { margin-top: 14px; }
.ents h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 13.5px; color: var(--ink-2); }
.echip { border: 1px solid #bfe5cf; background: #eefaf3; color: #146c3c; border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
.pill.walkway { background: var(--walkway); color: #fff; }
.note.rain { background: #eaf6f9; color: #0b6577; display: flex; gap: 6px; align-items: flex-start; }
.top { margin-top: 10px; }
.room-banner { display: flex; gap: 12px; align-items: center; margin: 12px 0 4px; padding: 12px 14px; border: 1.5px solid #e9c8cb; border-radius: 14px; background: var(--brand-soft); }
.rb-icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: var(--brand); color: #fff; font-size: 20px; }
.room-banner b { margin-right: 8px; font-size: 18px; font-variant-numeric: tabular-nums; color: var(--brand); }
.room-banner span { font-size: 13px; font-weight: 600; color: var(--ink); }
.room-banner small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--ink-2); }
</style>
