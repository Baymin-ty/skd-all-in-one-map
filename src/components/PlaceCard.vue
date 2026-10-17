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
import { homePlace, isFavorite, openProfile, setHomePlace, toggleFavorite } from '../lib/profile'
import { displayText, t } from '../lib/i18n'
import { isParcelStation, openParcelPlan, parcel } from '../lib/parcelStation'
import { planSvg } from '../lib/parcelPlanSvg'
import { EXPLORER_BUILDING_ID, openBuildingExplorer } from '../lib/buildingExplorer'

const b = computed(() => (state.selected?.kind === 'building' ? buildingById(state.selected.id) : undefined))
const poi = computed(() => (state.selected?.kind === 'poi' ? poiById(state.selected.id) : undefined))
const group = computed(() => (b.value ? groupOf(b.value.id) : undefined))
const place = computed(() => b.value ?? poi.value)
const kind = computed(() => {
  if (b.value) return state.categories[b.value.cat]?.zh
  return poi.value && poiKindLabel(poi.value)
})
const hours = computed(() => b.value?.hours?.zh || poi.value?.hours?.zh)
const room = computed(() => b.value && state.room?.building === b.value.id ? state.room : null)
const canteen = computed(() => discovery.canteens.find((c) => c.place === place.value?.id))
const events = computed(() => place.value ? eventsIn('upcoming', 'all', place.value.id) : [])
/** 快递站：卡片里放货架平面图的缩略图和取件码输入框 */
const parcelStation = computed(() => !!place.value && isParcelStation(place.value))
const parcelThumb = planSvg(false)
function openShelves() {
  if (place.value) openParcelPlan(parcel.query, place.value.id)
}
const category = computed(() => CHIPS.find((c) => c.id === (b.value?.cat || (poi.value?.cat === 'life' ? 'service' : poi.value?.cat))))

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
// 寝室只有一个，换楼就替换；其他地点是收藏，可随时取消。都在「我的」里集中管理。
const isDorm = computed(() => !!place.value && homePlace('dorm')?.place === place.value.id)
const faved = computed(() => !!place.value && isFavorite(place.value.id))
function setDorm() {
  if (!place.value) return
  if (isDorm.value) return openProfile('places')
  setHomePlace('dorm', place.value.id, room.value?.code)
  state.toast = '已设为我的寝室，可在「我的」里改房间号'
}
function favorite() {
  if (!place.value) return
  state.toast = toggleFavorite(place.value.id, room.value?.code) ? '已收藏，在「我的」里查看' : '已取消收藏'
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
        <span class="pill">{{ kind }}</span>
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
      <button v-if="b?.id === EXPLORER_BUILDING_ID" type="button" class="act" @click="openBuildingExplorer"><Ico name="door" />去楼内看看</button>
      <button v-if="parcelStation" type="button" class="act" @click="openShelves"><Ico name="grid" />快递站地图</button>
      <button type="button" class="act" @click="routeHere('from')">从这出发</button>
      <button v-if="canteen" type="button" class="act" @click="openCanteen(canteen.id)"><Ico name="book" />食堂与菜单</button>
      <button v-if="b?.cat === 'housing'" type="button" class="act" :class="{ saved: isDorm }" @click="setDorm"><Ico :name="isDorm ? 'check' : 'housing'" />{{ isDorm ? '我的寝室' : '设为我的寝室' }}</button>
      <button v-else type="button" class="act" :class="{ saved: faved }" :aria-pressed="faved" @click="favorite"><Ico name="bookmark" />{{ faved ? '已收藏' : '收藏' }}</button>
      <button type="button" class="act" @click="sharePlace"><Ico name="external" />分享</button>
    </div>

    <section v-if="parcelStation" class="sec parcel">
      <h3>快递站地图 <small>输入取件码，对应货架标红</small></h3>
      <form class="parcel-find" role="search" @submit.prevent="openShelves">
        <Ico name="search" />
        <input v-model="parcel.query" type="search" placeholder="取件码或货架号，如 15-3-2045" aria-label="取件码或货架号" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        <button type="submit" class="act primary small">找货架</button>
      </form>
      <button type="button" class="parcel-thumb" aria-label="打开快递站地图" @click="openShelves">
        <span class="parcel-art" v-html="parcelThumb" />
        <span class="parcel-open"><Ico name="expand" />打开快递站地图</span>
      </button>
    </section>
    <section v-if="canteen" class="sec"><h3>在这里吃</h3><CanteenRow :canteen="canteen" /></section>
    <CommunityEntry v-else-if="b?.cat !== 'gate'" :target="{ type: 'place', id: place.id, name: place.name.zh, subtitle: kind ? `${kind} · 来过的同学怎么说` : undefined }" />

    <section v-if="events.length" class="sec">
      <h3>这里的活动 <button type="button" class="text-link" @click="state.radar.range = 'upcoming'; state.radar.cat = 'all'; showEventsAt(place.id)">查看 {{ events.length }} 场</button></h3>
      <EventCard v-for="event in events.slice(0, 3)" :key="event.id" :event="event" show-day />
    </section>

    <div v-if="hours" class="kv">
      <span class="ic"><Ico name="clock" /></span>
      <div class="v"><small>开放时间</small>{{ hours }}</div>
    </div>

    <section v-if="b?.entrances?.length && b.cat !== 'gate'" class="ents">
      <button type="button" class="text-link" :aria-expanded="state.entranceBuilding === b.id" @click="state.entranceBuilding === b.id ? state.entranceBuilding = '' : showEntrances(b.id)"><Ico name="entrance" />{{ state.entranceBuilding === b.id ? '收起出入口' : `查看 ${b.entrances.length} 个出入口` }}</button>
      <div v-if="state.entranceBuilding === b.id" class="tags">
        <button v-for="(e, i) in b.entrances" :key="i" type="button" class="echip" @click="showEntrances(b.id, e.pos)">{{ e.zh || '入口' }}</button>
      </div>
    </section>

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
.act.saved { border-color: #ecc9cc; background: var(--brand-soft); color: var(--brand); }
.top { margin-top: 10px; }
.room-banner { display: flex; gap: 12px; align-items: center; margin: 12px 0 4px; padding: 12px 14px; border: 1.5px solid #e9c8cb; border-radius: 14px; background: var(--brand-soft); }
.rb-icon { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: var(--brand); color: #fff; font-size: 20px; }
.room-banner b { margin-right: 8px; font-size: 18px; font-variant-numeric: tabular-nums; color: var(--brand); }
.room-banner span { font-size: 13px; font-weight: 600; color: var(--ink); }
.room-banner small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--ink-2); }
.parcel h3 small { color: var(--ink-3); font-size: 12.5px; font-weight: 500; }
.parcel-find { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 4px 0 14px; border-radius: 999px; background: var(--bg-2); color: var(--ink-2); font-size: 17px; }
.parcel-find:focus-within { background: #fff; box-shadow: 0 0 0 2px var(--blue); }
/* 16px：iOS 聚焦输入框时不自动放大页面 */
.parcel-find input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: none; font-size: 16px; color: var(--ink); }
.parcel-find input::-webkit-search-cancel-button { display: none; }
.parcel-find .act { height: 36px; padding: 0 14px; font-size: 14px; }
.parcel-thumb { position: relative; display: block; width: 100%; margin-top: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 14px; background: #f3f4f7; cursor: pointer; }
.parcel-art { display: block; aspect-ratio: 1980 / 378; pointer-events: none; }
.parcel-open { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 999px; background: #fffffff0; box-shadow: 0 1px 6px #0000001f; color: var(--ink); font-size: 12.5px; font-weight: 650; }
@media (hover: hover) { .parcel-thumb:hover { border-color: #d6d6de; } }
</style>
