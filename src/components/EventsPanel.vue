<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { discovery, EVENT_CATS, EVENT_RANGES, eventsIn, loadDiscovery } from '../lib/discoveryData'
import { dateKey, dayLabel, eventStatus, evStart, icsFor, STATUS_LABELS, timeRange } from '../lib/campusTime'
import { fitEvents, navigateToPlace, placeName, placeSelection, select, state, toast } from '../lib/store'
import { addItem, itemFromEvent, plan } from '../lib/today'
import { buildLink, openShare } from '../lib/deepLink'
import CommunityEntry from './CommunityEntry.vue'
import EventCard from './EventCard.vue'
import Ico from './Ico.vue'
import { checkin, loadCheckins } from '../lib/checkin'
import { displayText, isEnglish, t } from '../lib/i18n'

const shown = ref(30)
const list = computed(() => eventsIn(state.radar.range, state.radar.cat, state.radar.place))
const inRange = computed(() => eventsIn(state.radar.range, 'all', state.radar.place))
const cats = computed(() => [...new Set(inRange.value.map((e) => e.category))])
const event = computed(() => discovery.events.find((e) => e.id === state.eventId))
const location = computed(() => placeSelection(event.value?.place))
const status = computed(() => event.value ? eventStatus(event.value) : 'past')
const categoryName = computed(() => {
  if (!event.value) return ''
  return isEnglish.value ? ({ lecture: 'Lecture', conference: 'Conference', culture: 'Culture', student: 'Student activity', career: 'Career', library: 'Library', international: 'International', wellbeing: 'Wellbeing', campus: 'Campus affairs', other: 'Other' } as Record<string, string>)[event.value.category] : EVENT_CATS[event.value.category]
})
const groups = computed(() => {
  const map = new Map<string, typeof list.value>()
  // 后台置顶的活动排在最前面单独一组（往期列表不置顶）
  const pinned = state.radar.range === 'past' ? [] : list.value.filter((e) => e.pin).sort((a, b) => a.pin! - b.pin!)
  if (pinned.length) map.set(isEnglish.value ? 'Featured' : '置顶推荐', pinned)
  for (const e of list.value.filter((item) => !pinned.includes(item)).slice(0, shown.value)) {
    const day = dayLabel(evStart(e))
    if (!map.has(day)) map.set(day, [])
    map.get(day)!.push(e)
  }
  return [...map.entries()]
})
const placeLabel = computed(() => {
  const sel = placeSelection(state.radar.place)
  return sel ? placeName(sel) : ''
})
watch(() => [state.radar.range, state.radar.cat, state.radar.place], () => { shown.value = 30; fitEvents() })
function back() { state.eventId = ''; state.selected = null; fitEvents() }
function addCalendar() {
  if (!event.value) return
  const url = URL.createObjectURL(new Blob([icsFor(event.value)], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = `${event.value.title.slice(0, 40)}.ics`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** 分享框：活动详情链接；有地点时另给「扫码直接导航到会场」，方便组织者印在海报上 */
function share() {
  const e = event.value
  if (!e) return
  openShare({ title: e.title, links: [
    { label: '活动详情', url: buildLink({ kind: 'event', id: e.id }), hint: '扫码查看活动详情' },
    ...e.place ? [{ label: '导航到会场', url: buildLink({ kind: 'to', place: e.place, room: e.room || undefined }), hint: '扫码后直接导航到活动地点' }] : [],
  ] })
}
const planned = computed(() => !!event.value && (plan.items.some((i) => !i.deleted && i.eventId === event.value!.id) || dateKey(evStart(event.value)) === plan.date))
watch(event, (value) => { if (value) void loadCheckins(value.id) }, { immediate: true })
function addToToday() {
  if (!event.value || planned.value) return
  const item = addItem(itemFromEvent(event.value))
  toast(`已加入「我的今天」· ${item.date === plan.date ? '' : item.date!.slice(5).replace('-', '/') + ' '}${item.start}`)
}
</script>

<template>
  <div class="page events-page">
    <template v-if="event">
      <button class="text-back" type="button" @click="back"><Ico name="back" />{{ isEnglish ? 'Back to events' : '返回活动列表' }}</button>
      <div class="tags detail-tags"><span v-if="event.status === 'cancelled'" class="pill cancelled-pill">{{ isEnglish ? 'Cancelled' : '已取消' }}</span><span v-else class="pill" :class="status">{{ isEnglish ? ({ live: 'Live', soon: 'Starting soon', upcoming: 'Upcoming', past: 'Past' } as Record<string, string>)[status] : STATUS_LABELS[status] }}</span><span class="pill">{{ categoryName }}</span></div>
      <h2 class="title">{{ displayText(event.title, event.title_en) }}</h2>
      <div class="actions wrap-actions">
        <button v-if="location" type="button" class="act primary" @click="navigateToPlace(event.place!)"><Ico name="walk" />{{ t('event.navigate') }}</button>
        <button type="button" class="act" :class="{ on: planned }" :disabled="planned" @click="addToToday"><Ico :name="planned ? 'check' : 'plus'" />{{ planned ? (isEnglish ? 'In My Day' : '已在我的今天') : (isEnglish ? 'Add to My Day' : '加入我的今天') }}</button>
        <button type="button" class="act" @click="addCalendar"><Ico name="calendar" />{{ isEnglish ? 'Add to calendar' : '加入日历' }}</button>
        <button type="button" class="act" @click="share"><Ico name="external" />{{ isEnglish ? 'Share' : '分享' }}</button>
        <a v-if="event.url" class="act" :href="event.url" target="_blank" rel="noopener noreferrer"><Ico name="external" />原始通知</a>
      </div>
      <CommunityEntry :target="{ type: 'event', id: event.id, name: displayText(event.title, event.title_en) }" />
      <p v-if="isEnglish && event.desc_en" class="event-description">{{ event.desc_en }}</p>
      <section class="checkin-card"><div><b>{{ isEnglish ? 'Event check-in' : '活动签到' }}</b><small>{{ checkin.me ? (isEnglish ? 'You checked in' : '你已签到') : (isEnglish ? `${checkin.count} checked in` : `${checkin.count} 人已签到`) }}</small></div><span v-if="checkin.me" class="pill live">{{ isEnglish ? 'Attended' : '已到场' }}</span></section>
      <div class="kv">
        <span class="ic"><Ico name="clock" /></span><div class="v">{{ dayLabel(evStart(event)) }}<br />{{ timeRange(event) }}<small v-if="!event.end && !event.allDay">通知未注明结束时间，状态按 90 分钟估算</small></div>
        <span class="ic"><Ico name="pin" /></span><div class="v"><button v-if="location" class="text-link" type="button" @click="select(location)">{{ placeName(location) }}</button><span v-else>{{ event.unmapped || event.venueRaw || t('event.location') }}</span><b v-if="event.room"> · {{ event.room }}</b><small v-if="event.floor != null">{{ event.floor < 0 ? (isEnglish ? 'Basement' : '地下楼层') : `${event.floor} ${isEnglish ? 'floor' : '楼'}` }}{{ isEnglish ? ' (estimated from room)' : '（按房间号推测）' }}</small><small v-if="location">{{ event.venueRaw }}</small><small v-else>{{ isEnglish ? 'This venue is not on the map yet' : '此地点尚未标在地图上' }}</small></div>
        <template v-if="event.speaker && event.speaker !== '无'"><span class="ic"><Ico name="users" /></span><div class="v">{{ event.speaker }}<small>{{ isEnglish ? 'Speaker' : '主讲人' }}</small></div></template>
        <template v-if="event.organizer"><span class="ic"><Ico name="academic" /></span><div class="v">{{ event.organizer }}<small>{{ isEnglish ? 'Organizer' : '主办单位' }}</small></div></template>
        <span class="ic"><Ico name="service" /></span><div class="v">{{ event.source === 'official' ? (isEnglish ? 'University event calendar' : '学校官网活动日历') : (isEnglish ? 'University email notice' : '学校邮件通知') }}<small>{{ isEnglish ? 'See the original notice for details' : '活动信息以原始通知为准' }}</small></div>
      </div>
    </template>
    <template v-else>
      <h2 class="title">活动雷达</h2>
      <p class="sub">找到感兴趣的活动，直接导航到举办地点</p>
      <div class="filter-chips" aria-label="活动时间">
        <button v-for="(label, key) in EVENT_RANGES" :key="key" type="button" :class="{ on: state.radar.range === key }" :aria-pressed="state.radar.range === key" @click="state.radar.range = key; state.radar.cat = 'all'">{{ label }}</button>
      </div>
      <div class="filter-chips secondary-chips" aria-label="活动分类">
        <button type="button" :class="{ on: state.radar.cat === 'all' }" @click="state.radar.cat = 'all'">全部 {{ inRange.length }}</button>
        <button v-for="cat in cats" :key="cat" type="button" :class="{ on: state.radar.cat === cat }" @click="state.radar.cat = cat">{{ EVENT_CATS[cat] }} {{ inRange.filter((e) => e.category === cat).length }}</button>
      </div>
      <button v-if="state.radar.place" class="filter-location" type="button" @click="state.radar.place = ''"><Ico name="pin" />{{ placeLabel || '所选地点' }}<Ico name="close" /></button>
      <p v-if="discovery.eventsLoading" class="empty" role="status">活动加载中…</p>
      <div v-else-if="discovery.eventsError" class="empty"><p>{{ discovery.eventsError }}</p><button type="button" class="act" @click="loadDiscovery('events')">重新加载</button></div>
      <template v-else>
        <p class="result-caption">{{ list.length }} 场活动 · 地图角标随筛选更新</p>
        <section v-for="[day, items] in groups" :key="day" class="event-day"><h3>{{ day }}</h3><EventCard v-for="e in items" :key="e.id" :event="e" /></section>
        <div v-if="!list.length" class="empty"><Ico name="calendar" /><p>这个范围暂时没有活动</p><button type="button" class="text-link" @click="state.radar.range = 'upcoming'; state.radar.cat = 'all'; state.radar.place = ''">查看全部待开始活动</button></div>
        <button v-if="list.length > shown" type="button" class="more-button" @click="shown += 30">再看 {{ Math.min(30, list.length - shown) }} 场活动</button>
        <p class="source-note">学校官网活动日历与邮件通知 · 收录截至 2026-10-16<br />活动时间、地点以原始通知为准</p>
      </template>
    </template>
  </div>
</template>

<style scoped>
.detail-tags { margin: 10px 0; }
.events-page .title { overflow-wrap: anywhere; }
.event-day h3 { margin-top: 18px; padding-bottom: 5px; font-size: 13px; color: var(--ink-2); }
.filter-location { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 0; background: #eef4fd; color: var(--blue); font-size: 12px; cursor: pointer; }
.checkin-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 0; padding: 12px 14px; border: 1px solid #d8ebdf; border-radius: 13px; background: #f2faf5; }.checkin-card b,.checkin-card small { display: block; }.checkin-card b { font-size: 13px; }.checkin-card small { margin-top: 3px; color: var(--ink-3); font-size: 11px; }
</style>
