<script setup lang="ts">
import { computed, ref } from 'vue'
import { discovery } from '../lib/discoveryData'
import { dateKey, dayName, MEAL_LABELS } from '../lib/campusTime'
import { nowTick } from '../lib/campusTime'
import { menuGroups, menuMeals, outletSummary, outletTone, weekDates } from '../lib/canteenMenu'
import { menuItems, priceLong, scheduleText, TAG_LABELS } from '../lib/menu'
import { buildingById, navigateToPlace, placeSelection, select, selectCanteenOutlet, showEntrances, showPanel, state } from '../lib/store'
import { CROWD_LABELS, crowdAt, submitCrowd } from '../lib/crowd'
import { toast } from '../lib/store'
import { openSheet } from '../lib/ui'
import CommunityEntry from './CommunityEntry.vue'
import { stallCommunity } from '../lib/community'
import Ico from './Ico.vue'
import DishThumb from './DishThumb.vue'
import DishDetail from './DishDetail.vue'
import ImagePreview from './ImagePreview.vue'

const view = state.canteen
const canteen = computed(() => discovery.canteens.find((c) => c.id === view.id))
const outlet = computed(() => canteen.value?.outlets.find((o) => o.id === view.outlet))
const building = computed(() => canteen.value && buildingById(canteen.value.place))
const picked = computed(() => menuItems.value.find((x) => x.d.id === view.dish && x.o.id === view.outlet))
const dates = computed(() => outlet.value ? weekDates(outlet.value) : [])
const meals = computed(() => outlet.value ? menuMeals(outlet.value) : [])
const groups = computed(() => outlet.value ? menuGroups(outlet.value, view) : [])
const resultCount = computed(() => groups.value.reduce((n, g) => n + g.dishes.length, 0))
const weekOver = computed(() => dates.value.length > 0 && dateKey() > dates.value.at(-1)!)
const closures = computed(() => outlet.value?.closures.filter(([, until]) => until >= dateKey()) || [])
const crowd = computed(() => outlet.value ? crowdAt(outlet.value.id, nowTick.value) : null)
const feedbackBusy = ref(false)
const gallery = ref<string[]>([])
const galleryTitle = ref('菜单原图')
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
function openDish(id: string) { view.dish = id; openSheet(2) }
function photos(paths: string[], title: string) { gallery.value = paths; galleryTitle.value = title }
function placeDetails() { const s = placeSelection(canteen.value?.place); if (s) select(s) }
async function reportCrowd(level: 0 | 1 | 2, waitMin: number) {
  if (!outlet.value || feedbackBusy.value) return
  feedbackBusy.value = true
  try {
    await submitCrowd(outlet.value.id, level, waitMin)
    toast('已收到反馈，谢谢你帮大家避开排队')
  } catch (error) { toast(error instanceof Error ? error.message : '反馈暂时提交失败，请稍后重试') }
  finally { feedbackBusy.value = false }
}
</script>

<template>
  <div v-if="canteen" class="page canteen-detail">
    <DishDetail v-if="picked" :item="picked" @close="view.dish = ''" />
    <template v-else>
      <button type="button" class="text-back" @click="showPanel('dining')"><Ico name="back" />返回食堂与菜单</button>
      <div class="canteen-heading"><span class="hero-icon"><Ico name="dining" /></span><div><h2 class="title">{{ canteen.zh }}</h2><p class="sub">{{ canteen.en }}</p></div></div>
      <p v-if="canteen.aliases?.length" class="canteen-alias">也叫 {{ canteen.aliases.join(' · ') }}</p>
      <div class="actions wrap-actions">
        <button type="button" class="act primary" @click="navigateToPlace(canteen.place, { name: canteen.zh, point: canteen.pos })"><Ico name="walk" />到这去</button>
        <button type="button" class="act" @click="placeDetails"><Ico name="pin" />地点详情</button>
        <button v-if="building?.entrances?.length" type="button" class="act" @click="showEntrances(building.id)"><Ico name="entrance" />看入口</button>
      </div>

      <div class="outlet-tabs" aria-label="餐厅楼层">
        <button v-for="o in canteen.outlets" :key="o.id" type="button" :class="{ on: view.outlet === o.id }" :aria-pressed="view.outlet === o.id" @click="selectCanteenOutlet(o.id)"><span>{{ o.zh }}</span><i :class="`outlet-${outletTone(o)}`" /></button>
      </div>
      <template v-if="outlet">
        <article class="outlet-info">
          <div class="outlet-info-heading"><b>{{ outlet.zh }} <small>{{ outlet.floor }}</small></b><span class="pill" :class="`outlet-${outletTone(outlet)}`">{{ outletSummary(outlet) }}</span></div>
          <ul v-if="outlet.hours?.length" class="list-plain outlet-hours">
            <li v-for="[from, until, meal] in outlet.hours" :key="meal + from"><span>{{ MEAL_LABELS[meal] }}</span><b>{{ from }}–{{ until }}</b><small v-if="outlet.lastOrder?.[meal]">{{ outlet.lastOrder[meal] }} 停止点餐</small></li>
          </ul>
          <p v-else class="outlet-note">供餐时间尚未确认，可先查看已收录菜单。</p>
          <p v-for="[from, until] in closures" :key="from" class="closure-note">暂停营业：{{ from }} 至 {{ until }}</p>
          <p v-if="outlet.note" class="outlet-note">{{ outlet.note.zh }}</p>
          <div v-if="crowd" class="crowd-feedback">
            <div class="crowd-heading"><b>现在排队</b><span :class="`crowd-source ${crowd.source}`">{{ crowd.source === 'live' ? '实时反馈' : '估算' }} · {{ CROWD_LABELS[crowd.level] }}<template v-if="crowd.waitMin"> · 约 {{ crowd.waitMin }} 分钟</template></span></div>
            <div class="crowd-buttons" aria-label="反馈排队情况">
              <button type="button" :disabled="feedbackBusy" @click="reportCrowd(0, 0)">不用排</button>
              <button type="button" :disabled="feedbackBusy" @click="reportCrowd(1, 5)">排 5 分钟内</button>
              <button type="button" :disabled="feedbackBusy" @click="reportCrowd(2, 15)">排很久</button>
            </div>
          </div>
        </article>

        <section class="sec menu-section">
          <div class="menu-section-heading"><h3>窗口菜单 <span>{{ outlet.dishes.length }} 道菜</span></h3><small v-if="outlet.menuDate">更新于 {{ md(outlet.menuDate) }}</small></div>
          <p v-if="weekOver" class="week-note">{{ md(dates[0]) }}–{{ md(dates.at(-1)!) }} 的周菜单已结束，以下为历史记录；当天供应请向窗口确认。</p>
          <div v-if="dates.length" class="week-days" aria-label="周菜单日期">
            <button type="button" :class="{ on: !view.day }" :aria-pressed="!view.day" @click="view.day = ''"><b>整周</b><small>{{ md(dates[0]) }}–{{ md(dates.at(-1)!) }}</small></button>
            <button v-for="day in dates" :key="day" type="button" :class="{ on: view.day === day, past: day < dateKey() }" :aria-pressed="view.day === day" @click="view.day = day"><b>{{ dayName(day) }}</b><small>{{ md(day) }}</small></button>
          </div>
          <div v-if="meals.length > 1" class="meal-tabs" aria-label="菜单餐次"><button type="button" :class="{ on: !view.meal }" :aria-pressed="!view.meal" @click="view.meal = ''">全部餐次</button><button v-for="meal in meals" :key="meal" type="button" :class="{ on: view.meal === meal }" :aria-pressed="view.meal === meal" @click="view.meal = meal">{{ MEAL_LABELS[meal] }}</button></div>
          <div v-if="outlet.stalls.length > 1" class="counter-tabs" aria-label="食堂窗口">
            <button type="button" :class="{ on: !view.stall }" :aria-pressed="!view.stall" @click="view.stall = ''">全部窗口</button>
            <button v-for="s in outlet.stalls" :key="s.id" type="button" :class="{ on: view.stall === s.id }" :aria-pressed="view.stall === s.id" @click="view.stall = s.id">{{ s.zh }}</button>
          </div>
          <label v-if="outlet.dishes.length > 8" class="local-search"><Ico name="search" /><input v-model="view.query" type="search" placeholder="在这个餐厅搜菜品、窗口…" aria-label="搜索餐厅菜单" @focus="openSheet(2)" /></label>
          <p v-if="outlet.dishes.length" class="result-caption">{{ view.day ? md(view.day) : dates.length ? '整周' : '已收录' }} · {{ view.meal ? MEAL_LABELS[view.meal] : '全部餐次' }} · {{ resultCount }} 道菜</p>

          <section v-for="g in groups" :key="g.stall?.id || 'other'" class="counter-group">
            <header v-if="g.stall" class="counter-heading"><div><h4>{{ g.stall.zh }}<span v-if="g.stall.daily" class="pill">每日换菜</span></h4><small v-if="g.stall.en">{{ g.stall.en }}</small></div><button v-if="g.stall.photos?.length" type="button" class="text-link" @click="photos(g.stall.photos, `${g.stall.zh} · 菜单原图`)"><Ico name="book" />菜单原图</button><CommunityEntry compact :target="{ type: 'stall', id: stallCommunity(canteen.id, outlet.id, g.stall.id), name: g.stall.zh, subtitle: canteen.zh + ' · ' + outlet.zh }" /><p v-if="g.stall.note">{{ g.stall.note.zh }}</p></header>
            <template v-for="(dish, i) in g.dishes" :key="dish.id">
              <h5 v-if="dish.group && dish.group.zh !== g.dishes[i - 1]?.group?.zh" class="dish-group-label">{{ dish.group.zh }}</h5>
              <button type="button" class="counter-dish tap" :class="{ sold: dish.soldOut }" @click="openDish(dish.id)">
                <DishThumb :d="dish" :size="48" />
                <span class="grow"><b>{{ dish.zh }}</b><small v-if="dish.desc">{{ dish.desc.zh }}</small><span class="dish-mini-tags"><span v-if="dish.soldOut">已售罄</span><span v-for="tag in (dish.tags || []).slice(0, 2)" :key="tag">{{ TAG_LABELS[tag] || tag }}</span></span><small v-if="!view.day && dish.days" class="dish-schedule">{{ scheduleText(dish) }}</small><strong>{{ priceLong(dish) }}</strong></span>
                <Ico name="chevron" class="chev" />
              </button>
            </template>
            <p v-if="!g.dishes.length" class="counter-empty">{{ g.total ? '所选日期或餐次没有符合条件的菜品' : '这个窗口的菜单正在整理中' }}</p>
          </section>
          <div v-if="!groups.length || !outlet.dishes.length && !outlet.stalls.length" class="empty"><Ico name="book" /><p>{{ outlet.dishes.length ? '没有匹配的菜品，试试其他关键词或日期。' : '菜单整理中，营业信息仍可查看。' }}</p></div>
        </section>
        <p class="source-note">供餐时间来源：{{ discovery.hoursSource }}<br />菜单与价格以窗口当天实际供应为准。</p>
      </template>
    </template>
    <ImagePreview :photos="gallery" :title="galleryTitle" @close="gallery = []" />
  </div>
</template>

<style scoped>
.canteen-heading { display: flex; align-items: center; gap: 11px; margin-top: 12px; }
.hero-icon { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 14px; background: #fff1df; color: #ab691c; font-size: 24px; }
.canteen-alias { font-size: 11px; color: var(--ink-3); margin-top: 9px; }
.outlet-tabs { display: flex; gap: 4px; border-radius: 12px; background: var(--bg-2); padding: 4px; margin: 18px 0 12px; overflow-x: auto; }
.outlet-tabs button { flex: 1 0 auto; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 10px; border: 0; border-radius: 9px; background: none; font-size: 12px; cursor: pointer; }
.outlet-tabs button.on { background: #fff; color: var(--brand); box-shadow: 0 1px 4px #00000012; font-weight: 650; }
.outlet-tabs i { width: 6px; height: 6px; border-radius: 50%; background: #b3b3bb; }
.outlet-tabs i.outlet-open { background: #26945f; }.outlet-tabs i.outlet-later { background: #d39a40; }
.outlet-info { padding: 13px; border: 1px solid var(--line); border-radius: 14px; }
.outlet-info-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.outlet-info-heading b { font-size: 14px; }.outlet-info-heading b small { font-size: 11px; font-weight: 400; color: var(--ink-3); }
.outlet-info-heading .pill { font-size: 10.5px; }
.outlet-hours { display: grid; gap: 7px; margin-top: 12px; }
.outlet-hours li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; }
.outlet-hours li > span { width: 30px; color: var(--ink-2); }.outlet-hours b { font-variant-numeric: tabular-nums; font-weight: 600; }.outlet-hours small { color: var(--ink-3); font-size: 10px; }
.outlet-note, .closure-note { font-size: 12px; color: var(--ink-2); line-height: 1.6; margin-top: 10px; }.closure-note { color: #ad6918; }
.crowd-feedback { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.crowd-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 7px; }.crowd-heading b { font-size: 13px; }.crowd-source { font-size: 11px; color: var(--ink-3); }.crowd-source.live { color: #187847; }.crowd-source.guess { color: #a5681d; }
.crowd-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }.crowd-buttons button { padding: 6px 9px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--ink-2); font-size: 11px; cursor: pointer; }.crowd-buttons button:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }.crowd-buttons button:disabled { opacity: .55; cursor: wait; }
.menu-section-heading { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; gap: 8px; }.menu-section-heading h3 { font-size: 15px; }.menu-section-heading span, .menu-section-heading small { font-size: 11px; color: var(--ink-3); font-weight: 400; }
.week-note { background: #fff6e7; color: #985e11; padding: 8px 10px; border-radius: 9px; font-size: 12px; margin-bottom: 10px; }
.week-days { display: flex; gap: 5px; padding: 2px 0 8px; overflow-x: auto; }
.week-days button { flex: none; min-width: 44px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 10px; background: #fff; cursor: pointer; }
.week-days b { font-size: 12px; }.week-days small { font-size: 10px; color: var(--ink-3); }.week-days .past { opacity: .6; }.week-days .on { color: var(--brand); background: var(--brand-soft); border-color: var(--brand); opacity: 1; }
.meal-tabs { display: inline-flex; gap: 2px; background: var(--bg-2); padding: 3px; border-radius: 9px; margin: 3px 0 10px; }.meal-tabs button { padding: 5px 9px; border: 0; border-radius: 7px; background: none; font-size: 11px; cursor: pointer; }.meal-tabs .on { background: #fff; box-shadow: 0 1px 3px #0001; }
.counter-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 12px; }.counter-tabs button { padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px; background: #fff; font-size: 11px; cursor: pointer; }.counter-tabs .on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand); }
.local-search { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--bg-2); border-radius: 11px; }.local-search input { min-width: 0; width: 100%; border: 0; outline: none; background: none; font-size: 12px; }.local-search:focus-within { outline: 2px solid var(--blue); }
.counter-heading { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding: 10px; margin-top: 18px; border-radius: 10px; background: var(--bg-2); }.counter-heading h4 { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 14px; }.counter-heading small { font-size: 10px; color: var(--ink-3); }.counter-heading .pill { font-size: 10px; background: #e7e7ed; }.counter-heading .text-link { display: flex; align-items: center; gap: 3px; font-size: 11px; }.counter-heading p { width: 100%; font-size: 11px; line-height: 1.6; color: var(--ink-2); }
.dish-group-label { font-size: 11px; color: var(--ink-3); margin: 13px 0 0; }
.counter-dish { display: flex; align-items: center; gap: 9px; width: 100%; padding: 12px 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 8px; background: #fff; text-align: left; }.counter-dish b { display: block; font-size: 14px; }.counter-dish small { display: block; font-size: 11px; color: var(--ink-3); margin-top: 3px; }.counter-dish strong { display: block; font-size: 12px; color: var(--brand); margin-top: 5px; }.counter-dish.sold { opacity: .6; }.counter-dish .dish-schedule { line-height: 1.6; }
.dish-mini-tags { display: flex; gap: 4px; margin-top: 4px; }.dish-mini-tags span { font-size: 10px; color: #a55a12; background: #fdf0e3; border-radius: 5px; padding: 1px 5px; }
.counter-empty { padding: 13px 3px; color: var(--ink-3); font-size: 12px; }
</style>
