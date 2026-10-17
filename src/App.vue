<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CommunityDialog from './components/CommunityDialog.vue'
import { community } from './lib/community'
import BottomSheet from './components/BottomSheet.vue'
import MapView from './components/MapView.vue'
import SearchBar from './components/SearchBar.vue'
import SidePanel from './components/SidePanel.vue'
import { endFor, hydratePlanPlaces, loadData, navigateToPlace, openEvent, openRoom, placeSelection, select, setEnd, showPanel, state } from './lib/store'
import { parseDeepLink, share } from './lib/deepLink'
import { locateOnLoad, startLocating } from './lib/locate'
import ShareDialog from './components/ShareDialog.vue'
import TimeMachine from './components/TimeMachine.vue'
import { openTimeMachine, tm } from './lib/timeMachine'
import { loadDiscovery } from './lib/discoveryData'
import { loadCrowd } from './lib/crowd'
import { clockText, configureDemoClock, demoClockEnabled, demoNow, nowTick, speed } from './lib/campusTime'
import { initPlan } from './lib/today'
import { computeAnchors, measureSafeArea, setSideWidth, SIDEBAR_W, ui } from './lib/ui'
import AccountDialog from './components/AccountDialog.vue'
import NavTabs from './components/NavTabs.vue'
import MapChips from './components/MapChips.vue'
import { loadAccount } from './lib/account'
import { loadUserData } from './lib/userData'
import { applyMapPrefs, presetMapMode } from './lib/profile'
import { parcel } from './lib/parcelStation'
import BuildingExplorer from './components/BuildingExplorer.vue'

// 快递站货架平面图用得少，点开时再加载
const ParcelPlan = defineAsyncComponent(() => import('./components/ParcelPlan.vue'))

let clock = 0
let crowdClock = 0
// 手机顶部栏的实际高度（含刘海安全区、是否显示筛选条），地图留边和标签避让都按它算
const topbar = ref<HTMLElement>()
const topObserver = new ResizeObserver(() => {
  const el = topbar.value
  if (el) ui.topH = Math.round(el.getBoundingClientRect().bottom + 6)
})
watch(topbar, (el, old) => {
  if (old) topObserver.unobserve(old)
  if (el) topObserver.observe(el)
}, { flush: 'post' })
const hideDemoClock = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('clean')
onMounted(async () => {
  const simulated = configureDemoClock(window.location.search)
  if (simulated) nowTick.value = demoNow()
  measureSafeArea()
  computeAnchors()
  await loadAccount()
  await loadUserData()
  initPlan()
  presetMapMode()
  window.addEventListener('resize', computeAnchors)
  clock = window.setInterval(() => { nowTick.value = demoNow() }, simulated && speed.value > 1 ? 1_000 : 30_000)
  await Promise.all([loadData(), loadDiscovery(), loadCrowd()])
  hydratePlanPlaces()
  applyMapPrefs()
  crowdClock = window.setInterval(() => { void loadCrowd() }, 60_000)
  // 分享链接：?event= 活动详情，?place= 地点详情，?to= 直接导航（起点用我的位置），?timemachine 全屏播放活动
  const link = parseDeepLink(window.location.search)
  if (link?.kind === 'timemachine') openTimeMachine(link.start)
  else if (link?.kind === 'checkin') {
    void import('./lib/checkin').then(({ handleCheckinLink }) => handleCheckinLink(link.id, link.code))
  }
  else if (link?.kind === 'event') openEvent(link.id)
  else if (link) {
    const sel = placeSelection(link.place)
    if (link.kind === 'place' && sel) {
      if (sel.kind === 'building' && link.room) openRoom(sel.id, link.room)
      else select(sel)
    } else if (link.kind === 'to' && sel) {
      if (link.from) { const from = placeSelection(link.from); const start = from && endFor(from); if (start) setEnd('from', start) }
      navigateToPlace(link.place)
      if (link.room && state.route.to) state.route.to = { ...state.route.to, name: `${state.route.to.name} ${link.room}` }
      startLocating()
    }
  }
  locateOnLoad()
})
onBeforeUnmount(() => { clearInterval(clock); clearInterval(crowdClock); topObserver.disconnect(); window.removeEventListener('resize', computeAnchors) })

function cancelPick() {
  state.route.picking = null
}
// 侧栏和地图之间的分隔线：拖动调宽度，双击恢复默认，聚焦后可用左右方向键微调
let dragFrom = 0
function startResize(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragFrom = e.clientX - ui.sideW
  ui.resizingSide = true
}
function onResize(e: PointerEvent) {
  if (ui.resizingSide) setSideWidth(e.clientX - dragFrom, false)
}
function endResize() {
  if (!ui.resizingSide) return
  ui.resizingSide = false
  setSideWidth(ui.sideW)
}
function resizeByKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 64 : 16
  if (e.key === 'ArrowLeft') setSideWidth(ui.sideW - step)
  else if (e.key === 'ArrowRight') setSideWidth(ui.sideW + step)
  else if (e.key === 'Home' || e.key === 'Enter') setSideWidth(SIDEBAR_W)
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="app" :class="{ desktop: ui.desktop, 'resizing-side': ui.resizingSide }" :style="{ '--side-w': ui.sideW + 'px' }" :inert="!!community.target || (parcel.open && !ui.desktop)">
    <MapView v-if="state.ready" />
    <div v-else class="boot">
      <p v-if="state.error" class="muted">{{ state.error }}</p>
      <p v-else class="muted">地图加载中…</p>
    </div>

    <header v-if="!ui.desktop && !tm.open" ref="topbar" class="topbar">
      <SearchBar />
    </header>

    <template v-if="ui.desktop">
      <nav class="rail" :class="{ away: tm.open }" :inert="tm.open" aria-label="上科大一图通">
        <a href="/" class="rail-logo" title="上科大一图通" @click.prevent="showPanel('home')"><img src="/favicon.svg" alt="上科大一图通" width="34" height="34" /></a>
        <NavTabs vertical />
        <span class="grow" />
      </nav>
      <aside class="sidebar" :class="{ away: tm.open }" :inert="tm.open">
        <div class="side-head">
          <div class="brand"><b>上科大一图通</b><small>校园地图 · 活动 · 食堂</small></div>
          <SearchBar />
        </div>
        <div class="side-scroll">
          <div v-show="!parcel.open" class="side-content"><SidePanel v-if="state.ready" /></div>
          <!-- 快递站打开时，平面图的常用位置和结果卡片放到这里，右边只换地图 -->
          <div v-show="parcel.open" id="parcel-side" />
        </div>
      </aside>
      <MapChips v-if="state.ready && !tm.open && !parcel.open && state.panel === 'home' && !state.route.open && !state.route.picking" class="map-chips-float" />
      <div
        v-show="!tm.open"
        class="side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        :aria-valuenow="ui.sideW"
        tabindex="0"
        title="拖动调整宽度，双击恢复默认"
        @pointerdown="startResize"
        @pointermove="onResize"
        @pointerup="endResize"
        @pointercancel="endResize"
        @lostpointercapture="endResize"
        @dblclick="setSideWidth(SIDEBAR_W)"
        @keydown="resizeByKey"
      />
    </template>
    <BottomSheet v-else-if="state.ready" v-show="!tm.open">
      <SidePanel />
      <template #footer><NavTabs /></template>
    </BottomSheet>
    <TimeMachine v-if="state.ready && tm.open" />

    <ShareDialog v-if="share.target" :key="share.target.title" />
    <CommunityDialog v-if="community.target" :key="community.target.type + community.target.id" :target="community.target" />
    <AccountDialog />
    <ParcelPlan v-if="parcel.open" />
    <BuildingExplorer />

    <div v-if="state.route.picking" class="pick-hint" role="status" :style="ui.desktop ? undefined : { top: ui.topH + 4 + 'px' }">
      {{ state.route.network === 'underground' ? '地下标注模式：在窗口中逐点标记道路或上下连接点' : `点地图上的楼、点位或任意位置作为${state.route.picking === 'from' ? '起点' : '终点'}` }}
      <button type="button" @click="cancelPick">取消</button>
    </div>
    <div v-if="demoClockEnabled && !hideDemoClock" class="demo-clock" role="status" :style="ui.desktop ? undefined : { top: ui.topH + 'px' }">演示时间 {{ clockText(nowTick) }}</div>
    <div v-if="state.toast" class="toast" role="status" :style="ui.desktop ? undefined : { bottom: Math.min(ui.sheet, ui.anchors[1]) + 16 + 'px' }">{{ state.toast }}</div>
  </div>
</template>

<style scoped>
.app { position: fixed; inset: 0; --rail-w: 72px; --side-w: 440px; }
.boot { position: absolute; inset: 0; display: grid; place-items: center; }
.topbar { position: absolute; z-index: 1001; top: calc(env(safe-area-inset-top) + 8px); left: 10px; right: 10px; pointer-events: none; }
.topbar > * { pointer-events: auto; }

/* 桌面：左侧导航栏只放功能切换（含「我的」），内容面板放搜索和详情 */
.rail { position: absolute; z-index: 1003; top: 0; bottom: 0; left: 0; width: var(--rail-w); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 0 16px; background: #fbfbfc; border-right: 1px solid var(--line); transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); }
.rail-logo { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; border-radius: 12px; }
.rail .nav-tabs { width: 100%; }
.sidebar { position: absolute; z-index: 1002; top: 0; bottom: 0; left: var(--rail-w); width: calc(var(--side-w) - var(--rail-w)); background: #fff; box-shadow: 2px 0 18px #0000001c; display: flex; flex-direction: column; transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); }
/* 时光机全屏：侧栏滑出，保留里面的浏览状态 */
.sidebar.away, .rail.away { transform: translateX(calc(-1 * var(--side-w) - 20px)); }
/* 分隔线：热区比线宽，悬停或拖动时显出一条蓝线 */
.side-resizer { position: absolute; z-index: 1004; top: 0; bottom: 0; left: calc(var(--side-w) - 5px); width: 10px; cursor: col-resize; touch-action: none; outline: none; }
.side-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: var(--blue); opacity: 0; transition: opacity 0.15s; }
.side-resizer:hover::after, .side-resizer:focus-visible::after, .resizing-side .side-resizer::after { opacity: 1; transition-delay: 0.1s; }
.resizing-side .side-resizer::after { transition-delay: 0s; }
.resizing-side { cursor: col-resize; user-select: none; }
.resizing-side :deep(.map) { pointer-events: none; }
.side-head { padding: 16px 14px 10px; border-bottom: 1px solid var(--line); }
.side-head :deep(.pillbtn) { box-shadow: none; background: var(--bg-2); }
.side-head :deep(.pillbtn:focus-within) { box-shadow: 0 0 0 2px var(--blue); background: #fff; }
.brand { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 12px; color: var(--ink); }
.brand b { font-size: 17px; letter-spacing: -0.01em; }
.brand small { color: var(--ink-3); font-size: 12px; }
/* 桌面分类条浮在地图左上角，宽度不够时横向滑动 */
.map-chips-float { position: absolute; z-index: 1001; top: 14px; left: calc(var(--side-w) + 14px); right: 160px; flex: none; }
.side-scroll { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding-top: 4px; }
/* 撑满侧栏高度，首页的版权行才能贴底 */
.side-content { flex: 1 0 auto; display: flex; flex-direction: column; }
.pick-hint {
  position: absolute; z-index: 1003; top: calc(env(safe-area-inset-top) + 120px); left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; max-width: calc(100% - 24px); padding: 8px 8px 8px 14px; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: 13px; box-shadow: var(--shadow);
}
.desktop .pick-hint { top: 16px; left: calc(var(--side-w) + (100% - var(--side-w)) / 2); white-space: nowrap; }
.pick-hint button { flex: none; border: 0; border-radius: 999px; padding: 4px 12px; background: #ffffff2e; color: #fff; cursor: pointer; }
.toast { position: absolute; z-index: 1100; left: 50%; bottom: 50%; transform: translateX(-50%); max-width: calc(100% - 32px); padding: 9px 16px; border-radius: 999px; background: #1d1d1fe6; color: #fff; font-size: 14px; text-align: center; pointer-events: none; transition: bottom 0.25s; }
.desktop .toast { left: calc(var(--side-w) + (100% - var(--side-w)) / 2); bottom: 40px; }
.demo-clock { position: absolute; z-index: 1100; top: calc(env(safe-area-inset-top) + 10px); right: 12px; padding: 5px 9px; border: 1px solid #f4d89a; border-radius: 999px; background: #fffaf0e8; color: #805b13; font-size: 11px; pointer-events: none; }
.desktop .demo-clock { top: 14px; right: 16px; }
.app:not(.desktop) .demo-clock { right: 10px; }
</style>
