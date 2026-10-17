<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import CommunityDialog from './components/CommunityDialog.vue'
import { community } from './lib/community'
import BottomSheet from './components/BottomSheet.vue'
import MapView from './components/MapView.vue'
import SearchBar from './components/SearchBar.vue'
import SidePanel from './components/SidePanel.vue'
import { endFor, loadData, navigateToPlace, openEvent, openRoom, placeSelection, select, setEnd, showPanel, state } from './lib/store'
import { openShare, parseDeepLink, share } from './lib/deepLink'
import { startLocating } from './lib/locate'
import ShareDialog from './components/ShareDialog.vue'
import TimeMachine from './components/TimeMachine.vue'
import Ico from './components/Ico.vue'
import { openTimeMachine, tm } from './lib/timeMachine'
import { loadDiscovery } from './lib/discoveryData'
import { loadCrowd } from './lib/crowd'
import { clockText, configureDemoClock, demoClockEnabled, demoNow, nowTick, speed } from './lib/campusTime'
import { initPlan } from './lib/today'
import { computeAnchors, ui } from './lib/ui'
import AccountDialog from './components/AccountDialog.vue'
import NavTabs from './components/NavTabs.vue'
import { loadAccount } from './lib/account'
import { loadUserData } from './lib/userData'
import { applyMapPrefs } from './lib/profile'

let clock = 0
let crowdClock = 0
const hideDemoClock = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('clean')
onMounted(async () => {
  const simulated = configureDemoClock(window.location.search)
  if (simulated) nowTick.value = demoNow()
  computeAnchors()
  await loadAccount()
  await loadUserData()
  initPlan()
  window.addEventListener('resize', computeAnchors)
  clock = window.setInterval(() => { nowTick.value = demoNow() }, simulated && speed.value > 1 ? 1_000 : 30_000)
  await Promise.all([loadData(), loadDiscovery(), loadCrowd()])
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
})
onBeforeUnmount(() => { clearInterval(clock); clearInterval(crowdClock); window.removeEventListener('resize', computeAnchors) })

function cancelPick() {
  state.route.picking = null
}
function shareSite() {
  openShare({ title: '上科大一图通', links: [{ label: '首页', url: `${window.location.origin}/`, hint: '用手机扫码打开校园地图' }] })
}
</script>

<template>
  <div class="app" :class="{ desktop: ui.desktop }" :inert="!!community.target">
    <MapView v-if="state.ready" />
    <div v-else class="boot">
      <p v-if="state.error" class="muted">{{ state.error }}</p>
      <p v-else class="muted">地图加载中…</p>
    </div>

    <header v-if="!ui.desktop && !tm.open" class="topbar">
      <SearchBar />
    </header>

    <template v-if="ui.desktop">
      <nav class="rail" :class="{ away: tm.open }" :inert="tm.open" aria-label="上科大一图通">
        <a href="/" class="rail-logo" title="上科大一图通" @click.prevent="showPanel('home')"><img src="/favicon.svg" alt="上科大一图通" width="34" height="34" /></a>
        <NavTabs vertical />
        <span class="grow" />
        <button type="button" class="rail-tool" title="手机扫码使用" @click="shareSite"><Ico name="grid" /><span>扫码</span></button>
      </nav>
      <aside class="sidebar" :class="{ away: tm.open }" :inert="tm.open">
        <div class="side-head">
          <div class="brand"><b>上科大一图通</b><small>校园地图 · 活动 · 食堂</small></div>
          <SearchBar />
        </div>
        <div class="side-scroll"><SidePanel v-if="state.ready" /></div>
      </aside>
    </template>
    <BottomSheet v-else-if="state.ready" v-show="!tm.open">
      <SidePanel />
      <template #footer><NavTabs /></template>
    </BottomSheet>
    <TimeMachine v-if="state.ready && tm.open" />

    <ShareDialog v-if="share.target" :key="share.target.title" />
    <CommunityDialog v-if="community.target" :key="community.target.type + community.target.id" :target="community.target" />
    <AccountDialog />

    <div v-if="state.route.picking" class="pick-hint" role="status">
      {{ state.route.network === 'underground' ? '地下手绘模式：在窗口中点击“开始手绘”，再在地图上逐点标记道路' : `点地图上的楼、点位或任意位置作为${state.route.picking === 'from' ? '起点' : '终点'}` }}
      <button type="button" @click="cancelPick">取消</button>
    </div>
    <div v-if="demoClockEnabled && !hideDemoClock" class="demo-clock" role="status">演示时间 {{ clockText(nowTick) }}</div>
    <div v-if="state.toast" class="toast" role="status">{{ state.toast }}</div>
  </div>
</template>

<style scoped>
.app { position: fixed; inset: 0; --rail-w: 72px; --side-w: 440px; }
.boot { position: absolute; inset: 0; display: grid; place-items: center; }
.topbar { position: absolute; z-index: 1001; top: calc(env(safe-area-inset-top) + 10px); left: 12px; right: 12px; }

/* 桌面：左侧导航栏只放功能切换（含「我的」），内容面板放搜索和详情 */
.rail { position: absolute; z-index: 1003; top: 0; bottom: 0; left: 0; width: var(--rail-w); display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 0 16px; background: #fbfbfc; border-right: 1px solid var(--line); transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); }
.rail-logo { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; border-radius: 12px; }
.rail .nav-tabs { width: 100%; }
.rail-tool { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 0; border: 0; background: none; color: var(--ink-3); font-size: 10.5px; cursor: pointer; }
.rail-tool .svgi { display: grid; place-items: center; width: 40px; height: 30px; border-radius: 999px; font-size: 18px; color: var(--ink-2); }
@media (hover: hover) { .rail-tool:hover .svgi { background: var(--bg-2); } }
.sidebar { position: absolute; z-index: 1002; top: 0; bottom: 0; left: var(--rail-w); width: calc(var(--side-w) - var(--rail-w)); background: #fff; box-shadow: 2px 0 18px #0000001c; display: flex; flex-direction: column; transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); }
/* 时光机全屏：侧栏滑出，保留里面的浏览状态 */
.sidebar.away, .rail.away { transform: translateX(calc(-1 * var(--side-w) - 20px)); }
.side-head { padding: 16px 14px 10px; border-bottom: 1px solid var(--line); }
.side-head :deep(.pillbtn) { box-shadow: none; background: var(--bg-2); }
.side-head :deep(.pillbtn:focus-within) { box-shadow: 0 0 0 2px var(--blue); background: #fff; }
.side-head :deep(.chip) { box-shadow: none; background: var(--bg-2); }
.side-head :deep(.chip.on) { background: var(--ink); }
.brand { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 12px; color: var(--ink); }
.brand b { font-size: 17px; letter-spacing: -0.01em; }
.brand small { color: var(--ink-3); font-size: 12px; }
.side-scroll { flex: 1; overflow-y: auto; padding-top: 4px; }
.pick-hint {
  position: absolute; z-index: 1003; top: calc(env(safe-area-inset-top) + 120px); left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; max-width: calc(100% - 24px); padding: 8px 8px 8px 14px; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: 13px; box-shadow: var(--shadow);
}
.desktop .pick-hint { top: 16px; left: calc(var(--side-w) + (100% - var(--side-w)) / 2); white-space: nowrap; }
.pick-hint button { flex: none; border: 0; border-radius: 999px; padding: 4px 12px; background: #ffffff2e; color: #fff; cursor: pointer; }
.toast { position: absolute; z-index: 1100; left: 50%; bottom: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; background: #1d1d1fe6; color: #fff; font-size: 14px; pointer-events: none; }
.desktop .toast { left: calc(var(--side-w) + (100% - var(--side-w)) / 2); bottom: 40px; }
.demo-clock { position: absolute; z-index: 1100; top: calc(env(safe-area-inset-top) + 10px); right: 12px; padding: 5px 9px; border: 1px solid #f4d89a; border-radius: 999px; background: #fffaf0e8; color: #805b13; font-size: 11px; pointer-events: none; }
.desktop .demo-clock { top: 14px; right: 16px; }
.app:not(.desktop) .demo-clock { top: calc(env(safe-area-inset-top) + 112px); }
</style>
