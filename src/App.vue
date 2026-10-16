<script setup lang="ts">
import { onMounted } from 'vue'
import BottomSheet from './components/BottomSheet.vue'
import MapView from './components/MapView.vue'
import SearchBar from './components/SearchBar.vue'
import SidePanel from './components/SidePanel.vue'
import { loadData, restoreLogin, state, syncAdminFromHash } from './lib/store'
import { computeAnchors, ui } from './lib/ui'

onMounted(async () => {
  computeAnchors()
  window.addEventListener('resize', computeAnchors)
  window.addEventListener('hashchange', syncAdminFromHash)
  await loadData()
  await restoreLogin()
})

function cancelPick() {
  state.placing = false
  state.route.picking = null
}
</script>

<template>
  <div class="app" :class="{ desktop: ui.desktop }">
    <MapView v-if="state.ready" />
    <div v-else class="boot">
      <p v-if="state.error" class="muted">{{ state.error }}</p>
      <p v-else class="muted">地图加载中…</p>
    </div>

    <header v-if="!ui.desktop" class="topbar"><SearchBar /></header>

    <aside v-if="ui.desktop" class="sidebar">
      <div class="side-head">
        <a href="#" class="brand">
          <img src="/favicon.svg" alt="" width="30" height="30" />
          <div>
            <b>上科大一图通</b>
            <small>{{ state.admin ? '管理后台' : '楼宇 · 点位 · 步行导航 · 风雨长廊' }}</small>
          </div>
        </a>
        <SearchBar />
      </div>
      <div class="side-scroll"><SidePanel v-if="state.ready" /></div>
    </aside>
    <BottomSheet v-else-if="state.ready"><SidePanel /></BottomSheet>

    <div v-if="state.placing || state.route.picking" class="pick-hint" role="status">
      {{ state.placing ? '点地图放置新点位' : `点地图上的楼、点位或任意位置作为${state.route.picking === 'from' ? '起点' : '终点'}` }}
      <button type="button" @click="cancelPick">取消</button>
    </div>
    <div v-if="state.toast" class="toast" role="status">{{ state.toast }}</div>
  </div>
</template>

<style scoped>
.app { position: fixed; inset: 0; }
.boot { position: absolute; inset: 0; display: grid; place-items: center; }
.topbar { position: absolute; z-index: 1001; top: calc(env(safe-area-inset-top) + 10px); left: 12px; right: 12px; }
.sidebar { position: absolute; z-index: 1002; top: 0; bottom: 0; left: 0; width: 400px; background: #fff; box-shadow: 2px 0 18px #00000024; display: flex; flex-direction: column; }
.side-head { padding: 14px 14px 8px; border-bottom: 1px solid var(--line); }
.side-head :deep(.pillbtn) { box-shadow: none; background: var(--bg-2); }
.side-head :deep(.pillbtn:focus-within) { box-shadow: 0 0 0 2px var(--blue); background: #fff; }
.side-head :deep(.chip) { box-shadow: none; background: var(--bg-2); }
.side-head :deep(.chip.on) { background: var(--ink); }
.brand { display: flex; align-items: center; gap: 10px; color: var(--ink); margin-bottom: 12px; }
.brand b { display: block; font-size: 17px; }
.brand small { color: var(--ink-3); font-size: 12px; }
.side-scroll { flex: 1; overflow-y: auto; padding-top: 6px; }
.pick-hint {
  position: absolute; z-index: 1003; top: calc(env(safe-area-inset-top) + 120px); left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px; max-width: calc(100% - 24px); padding: 8px 8px 8px 14px; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: 13px; box-shadow: var(--shadow);
}
.desktop .pick-hint { top: 16px; left: calc(400px + (100% - 400px) / 2); white-space: nowrap; }
.pick-hint button { flex: none; border: 0; border-radius: 999px; padding: 4px 12px; background: #ffffff2e; color: #fff; cursor: pointer; }
.toast { position: absolute; z-index: 1100; left: 50%; bottom: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; background: #1d1d1fe6; color: #fff; font-size: 14px; pointer-events: none; }
.desktop .toast { left: calc(400px + (100% - 400px) / 2); bottom: 40px; }
</style>
