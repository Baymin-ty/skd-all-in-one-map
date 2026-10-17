<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { discovery, loadDiscovery } from '../lib/discoveryData'
import { availableNow, groupByCanteen, menuItems, priceShort, searchMenu, TAG_FILTERS, TAG_LABELS, visibleDayHint } from '../lib/menu'
import { nowTick, outletText } from '../lib/campusTime'
import { CROWD_LABELS, crowdAt, crowdRevision } from '../lib/crowd'
import { mapApi, navigateToPlace, openCanteen, placeSelection, state } from '../lib/store'
import { openSheet } from '../lib/ui'
import DishDetail from './DishDetail.vue'
import DishThumb from './DishThumb.vue'
import Ico from './Ico.vue'
import CanteenRow from './CanteenRow.vue'

const filters = state.menu
const prices: Record<string, [number | null, number | null]> = { '': [null, null], u10: [null, 10], u15: [null, 15], u20: [null, 20], o20: [20, null] }
const shown = ref(40)
const active = computed(() => !!(filters.query.trim() || filters.canteen || filters.outlet || filters.tags.length || filters.price || filters.openNow || filters.sort !== 'best'))
const result = computed(() => searchMenu(filters.query, { canteen: filters.canteen, outlet: filters.outlet, stall: filters.stall, tags: filters.tags, min: prices[filters.price]?.[0], max: prices[filters.price]?.[1], openNow: filters.openNow, sort: filters.sort }))
const rows = computed(() => result.value.items.slice(0, shown.value))
const picked = computed(() => menuItems.value.find((x) => x.d.id === filters.dish && (!filters.outlet || x.o.id === filters.outlet)))
const canteen = computed(() => discovery.canteens.find((c) => c.id === filters.canteen))
const outlet = computed(() => canteen.value?.outlets.find((o) => o.id === filters.outlet))
const distribution = computed(() => {
  void crowdRevision.value
  return state.dishFocus ? groupByCanteen(searchMenu(state.dishFocus).items) : []
})
watch(picked, (item) => {
  if (!item) return
  state.selected = placeSelection(item.c.place)
  mapApi.focus(item.c.pos, 19)
  openSheet(2)
}, { immediate: true })
watch(canteen, (c) => {
  state.selected = placeSelection(c?.place)
  if (c) mapApi.focus(c.pos, 19)
})
const parsed = computed(() => {
  const q = result.value.parsed
  return [q.min != null && q.max != null ? `${q.min}–${q.max} 元` : q.max != null ? `${q.max} 元以内` : q.min != null ? `${q.min} 元以上` : '', ...q.tags.map((t) => TAG_LABELS[t]), q.cheap ? '价格从低到高' : ''].filter(Boolean).join(' · ')
})
watch(() => [filters.query, filters.canteen, filters.outlet, filters.stall, filters.tags.join(), filters.price, filters.openNow, filters.sort], () => { shown.value = 40 })
function toggle(tag: string) {
  filters.tags = filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags.filter((t) => !(tag === 'mild' && t === 'spicy') && !(tag === 'spicy' && t === 'mild')), tag]
}
function reset() { Object.assign(filters, { query: '', canteen: '', outlet: '', stall: '', tags: [], price: '', openNow: false, sort: 'best' }) }
function selectCanteen(id: string) { filters.canteen = id; filters.outlet = ''; filters.stall = '' }
</script>

<template>
  <div class="page dining-page">
    <DishDetail v-if="picked" :item="picked" @close="filters.dish = ''" />
    <template v-else>
      <h2 class="title">今天吃什么</h2>
      <p class="sub">搜菜名、窗口、口味，也可以输入「15元以内的牛肉」</p>
      <p class="dining-overview"><span><Ico name="dining" />{{ discovery.canteens.length }} 处餐饮</span><span><Ico name="book" />{{ menuItems.length }} 道菜</span><span>先找菜，再找到窗口</span></p>
      <label class="menu-search"><Ico name="search" /><input v-model="filters.query" type="search" placeholder="搜菜品、窗口、价格…" aria-label="搜索菜品" @focus="openSheet(2)" /><button v-if="filters.query" type="button" aria-label="清空菜品搜索" @click="filters.query = ''"><Ico name="close" /></button></label>
      <div class="filter-chips" aria-label="食堂筛选"><button type="button" :class="{ on: !filters.canteen }" @click="selectCanteen('')">全部食堂</button><button v-for="c in discovery.canteens" :key="c.id" type="button" :class="{ on: filters.canteen === c.id }" @click="selectCanteen(c.id)">{{ c.zh }}</button></div>
      <div v-if="canteen" class="filter-chips secondary-chips" aria-label="餐厅楼层"><button type="button" :class="{ on: !filters.outlet }" @click="filters.outlet = ''; filters.stall = ''">全部楼层</button><button v-for="o in canteen.outlets" :key="o.id" type="button" :class="{ on: filters.outlet === o.id }" @click="filters.outlet = o.id; filters.stall = ''">{{ o.zh }}</button></div>
      <div v-if="outlet?.stalls.length" class="filter-chips secondary-chips" aria-label="窗口筛选"><button type="button" :class="{ on: !filters.stall }" @click="filters.stall = ''">全部窗口</button><button v-for="s in outlet.stalls" :key="s.id" type="button" :class="{ on: filters.stall === s.id }" @click="filters.stall = s.id">{{ s.zh }}</button></div>
      <div class="filter-chips secondary-chips" aria-label="口味类型"><button type="button" :class="{ on: filters.openNow }" :aria-pressed="filters.openNow" @click="filters.openNow = !filters.openNow">当前供餐</button><button v-for="tag in Object.keys(TAG_FILTERS)" :key="tag" type="button" :class="{ on: filters.tags.includes(tag) }" :aria-pressed="filters.tags.includes(tag)" @click="toggle(tag)">{{ TAG_LABELS[tag] }}</button></div>
      <div class="menu-options"><select v-model="filters.price" aria-label="价格筛选"><option value="">不限价格</option><option value="u10">10 元以内</option><option value="u15">15 元以内</option><option value="u20">20 元以内</option><option value="o20">20 元以上</option></select><select v-model="filters.sort" aria-label="菜品排序"><option value="best">综合排序</option><option value="asc">价格从低到高</option><option value="desc">价格从高到低</option></select><button v-if="active" type="button" class="text-link" @click="reset">重置</button></div>

      <p v-if="discovery.diningLoading" class="empty" role="status">菜单加载中…</p>
      <div v-else-if="discovery.diningError" class="empty"><p>{{ discovery.diningError }}</p><button type="button" class="act" @click="loadDiscovery('dining')">重新加载</button></div>
      <template v-else-if="active">
        <section v-if="distribution.length" class="distribution"><div class="distribution-head"><b>全校分布 · {{ state.dishFocus }}</b><button type="button" class="text-link" @click="state.dishFocus = ''">返回菜品列表</button></div><article v-for="group in distribution" :key="group.c.id" class="distribution-row"><div class="grow"><b>{{ group.c.zh }}</b><small>{{ group.outlets.map((item) => `${item.o.floor} · ${item.o.zh}`).join('、') }}</small><span class="distribution-meta">{{ group.lo == null ? '价格待确认' : group.lo === group.hi ? `¥${group.lo}` : `¥${group.lo}–${group.hi}` }} · {{ CROWD_LABELS[crowdAt(group.c.id, nowTick).level] }} · 命中 {{ group.hitCount }} 道</span></div><button type="button" class="act small" @click="navigateToPlace(group.c.place, { name: group.c.zh, point: group.c.pos })"><Ico name="walk" />到这去</button></article></section>
        <div v-if="canteen" class="canteen-summary"><button type="button" class="canteen-detail-link" @click="openCanteen(canteen.id, filters.outlet, filters.stall)"><b>{{ canteen.zh }}<template v-if="outlet"> · {{ outlet.zh }}</template><Ico name="chevron" /></b><small v-if="outlet">{{ outlet.floor }} · {{ outletText(outlet) }}</small><small v-else>查看楼层、供餐时间与窗口菜单</small></button><button type="button" class="act small" @click="navigateToPlace(canteen.place, { name: canteen.zh, point: canteen.pos })"><Ico name="walk" />到这去</button></div>
        <p class="result-caption" aria-live="polite">找到 {{ result.items.length }} 道菜<span v-if="parsed" class="parsed">已识别：{{ parsed }}</span></p>
        <div class="dish-results">
          <button v-for="x in rows" :key="x.o.id + x.d.id" type="button" class="dish-row tap" :class="{ sold: x.d.soldOut }" @click="filters.dish = x.d.id">
            <DishThumb :d="x.d" :size="48" /><span class="grow"><b>{{ x.d.zh }}</b><small>{{ x.c.zh }} · {{ x.o.zh }}<template v-if="x.d.stall"> · {{ x.d.stall }}</template></small><span class="dish-tags"><span v-if="x.d.soldOut" class="mini">已售罄</span><span v-if="visibleDayHint(x.d, x.s)" class="mini">{{ visibleDayHint(x.d, x.s)?.text }}</span><span v-for="tag in (x.d.tags || []).slice(0, 2)" :key="tag" class="mini">{{ TAG_LABELS[tag] || tag }}</span></span></span><span class="price-column"><b>{{ priceShort(x.d) }}</b><small>{{ x.d.specs?.length ? x.d.specs.map((s) => s.zh).join(' / ') : x.d.unit }}</small><i :class="{ on: availableNow(x) }" :title="availableNow(x) ? '按菜单记录，当前供餐' : '当前供应未确认'" /></span>
          </button>
        </div>
        <button v-if="result.items.length > shown" type="button" class="more-button" @click="shown += 40">再看 {{ Math.min(40, result.items.length - shown) }} 道菜</button>
        <div v-if="!result.items.length" class="empty"><Ico name="dining" /><p>{{ outlet && !outlet.dishes.length ? '这个餐厅的菜单还在整理中' : '没有找到符合条件的菜品' }}</p><button type="button" class="text-link" @click="reset">清空筛选，浏览全部食堂</button></div>
        <p v-if="filters.openNow" class="source-note">按已记录的供餐时段和周菜单筛选，不代表实时库存；周菜单过期的菜品不会计入。</p>
      </template>
      <template v-else>
        <div class="section-heading"><h3>按食堂找菜单</h3><span>{{ menuItems.length }} 道菜</span></div>
        <article v-for="c in discovery.canteens" :key="c.id" class="canteen-card">
          <CanteenRow :canteen="c" />
          <div v-for="o in c.outlets" :key="o.id" class="outlet-browse">
            <button type="button" class="outlet-name" @click="openCanteen(c.id, o.id)">{{ o.zh }}<small>{{ o.floor }}</small></button>
            <div class="stall-chips">
              <span v-if="!o.dishes.length" class="pill">菜单整理中</span>
              <button v-for="s in o.stalls" :key="s.id" type="button" @click="openCanteen(c.id, o.id, s.id)">{{ s.zh }}<small>{{ o.dishes.filter((d) => d.stall === s.zh).length || '' }}</small></button>
              <button v-if="o.dishes.length && !o.stalls.length" type="button" @click="openCanteen(c.id, o.id)">查看 {{ o.dishes.length }} 道菜</button>
            </div>
          </div>
        </article>
      </template>
      <p v-if="discovery.hoursSource" class="source-note">供餐时间来源：{{ discovery.hoursSource }}<br />菜单、价格和照片为已收录的记录，以窗口当天供应为准。</p>
    </template>
  </div>
</template>

<style scoped>
.dining-overview { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; font-size: 11px; color: var(--ink-3); }
.dining-overview span { display: inline-flex; align-items: center; gap: 4px; }.dining-overview span:first-child, .dining-overview span:nth-child(2) { color: var(--ink-2); }
.canteen-detail-link { text-align: left; border: 0; background: none; padding: 0; cursor: pointer; }.canteen-detail-link b { display: flex; align-items: center; gap: 4px; }
.menu-search { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 12px; border-radius: 12px; background: var(--bg-2); border: 1px solid transparent; }
.menu-search:focus-within { border-color: var(--blue); }
.menu-search input { width: 0; flex: 1; border: 0; background: transparent; outline: none; font-size: 14px; }
.menu-search input::-webkit-search-cancel-button { display: none; }
.menu-search button { display: grid; place-items: center; background: none; border: 0; cursor: pointer; }
.menu-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.menu-options select { min-width: 0; max-width: 48%; border: 1px solid var(--line); border-radius: 8px; padding: 6px; background: #fff; font-size: 12px; }
.menu-options .text-link { margin-left: auto; font-size: 12px; }
.parsed { display: block; margin-top: 3px; color: var(--brand); }
.distribution { margin: 10px 0 14px; padding: 11px; border: 1px solid #ecd7bc; border-radius: 13px; background: #fffaf3; }.distribution-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px; }.distribution-head b { font-size:13px; }.distribution-row { display:flex; align-items:center; gap:8px; padding:10px 0; border-top:1px solid #f0e4d2; }.distribution-row b,.distribution-row small,.distribution-meta { display:block; }.distribution-row small { margin-top:3px; color:var(--ink-2); font-size:11px; }.distribution-meta { margin-top:4px; color:#a4621f; font-size:11px; }
.dish-row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 12px 0; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 8px; background: #fff; }
.dish-row.sold { opacity: .6; }
.dish-row b { display: block; font-size: 14px; line-height: 1.4; }
.dish-row small { display: block; color: var(--ink-3); font-size: 11px; margin-top: 3px; }
.dish-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.mini { padding: 1px 5px; font-size: 10px; background: #fdf0e3; color: #a55a12; border-radius: 5px; }
.price-column { flex: none; max-width: 30%; text-align: right; }
.price-column b { color: var(--brand); white-space: nowrap; }
.price-column i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #d4d4d8; }
.price-column i.on { background: var(--green); }
.canteen-summary { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px; background: var(--bg-2); border-radius: 10px; }
.canteen-summary b { font-size: 13px; }
.canteen-summary small { display: block; color: var(--ink-3); font-size: 11px; }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; margin: 22px 0 10px; }
.section-heading h3 { font-size: 15px; }
.section-heading span { font-size: 12px; color: var(--ink-3); }
.canteen-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; margin-bottom: 12px; }
.canteen-title { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 0 0 7px; border: 0; background: none; font-weight: 700; cursor: pointer; }
.canteen-title span { display: flex; align-items: center; gap: 6px; }
.canteen-title span .svgi { color: var(--brand); }
.outlet-browse { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px; padding-top: 10px; }
.outlet-name { align-self: start; border: 0; background: none; text-align: left; padding: 4px 0; font-size: 12px; color: var(--ink-2); cursor: pointer; }
.outlet-name small { display: block; font-size: 10px; color: var(--ink-3); }
.stall-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.stall-chips button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border: 0; border-radius: 12px; background: var(--bg-2); font-size: 11.5px; cursor: pointer; }
.stall-chips small { color: var(--ink-3); font-size: 10px; }
</style>
