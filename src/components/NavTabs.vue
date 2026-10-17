<script setup lang="ts">
import { computed } from 'vue'
import { openRoute, showPanel, state } from '../lib/store'
import { closeParcelPlan, openParcelStationMap, parcel } from '../lib/parcelStation'
import { eventsIn } from '../lib/discoveryData'
import { account } from '../lib/account'
import type { IconName } from '../lib/icons'
import Ico from './Ico.vue'

// 前台唯一的功能导航：桌面竖排在左侧导航栏，手机横排在底部面板最下面。
// 「我的」同时是账号入口：登录后图标换成昵称首字。桌面竖排时「我的」移到左栏左下角（RailAccount）。
defineProps<{ vertical?: boolean }>()
type Tab = 'home' | 'events' | 'dining' | 'today' | 'me'
const TABS: { id: Tab; zh: string; icon: IconName }[] = [
  { id: 'home', zh: '地图', icon: 'pin' },
  { id: 'today', zh: '日程', icon: 'clock' },
  { id: 'events', zh: '活动', icon: 'calendar' },
  { id: 'dining', zh: '美食', icon: 'dining' },
  { id: 'me', zh: '我的', icon: 'users' },
]
const liveCount = computed(() => eventsIn('today').length)
const current = computed<Tab | ''>(() => parcel.open || (state.panel === 'home' && state.route.open) ? '' : state.panel === 'canteen' ? 'dining' : state.panel)
const initial = computed(() => account.me?.nameSet ? [...account.me.name.trim()][0]?.toUpperCase() : '')

// 桌面左栏在功能标签下面再放两个常用工具；手机上导航在搜索框里，快递站在面板里
const routing = computed(() => state.route.open)

function go(tab: Tab) {
  closeParcelPlan()
  if (tab === 'events') state.radar.place = ''
  showPanel(tab)
}
</script>

<template>
  <nav class="nav-tabs" :class="{ vertical }" :style="{ '--n': vertical ? TABS.length - 1 : TABS.length }" aria-label="功能">
    <button v-for="tab in (vertical ? TABS.filter((t) => t.id !== 'me') : TABS)" :key="tab.id" type="button" :class="{ on: current === tab.id }" :aria-current="current === tab.id ? 'page' : undefined" @click="go(tab.id)">
      <span class="nav-icon"><span v-if="tab.id === 'me' && initial" class="nav-avatar" :title="account.me?.name">{{ initial }}</span><Ico v-else :name="tab.icon" /><em v-if="tab.id === 'events' && liveCount" :aria-label="`今天 ${liveCount} 场`">{{ liveCount }}</em><i v-if="tab.id === 'me' && account.me && !account.me.nameSet" class="nav-dot" aria-label="还没起昵称" /></span>
      <span class="nav-label">{{ tab.zh }}</span>
    </button>
    <template v-if="vertical">
      <hr class="nav-sep" />
      <button type="button" :class="{ on: routing }" :aria-pressed="routing" @click="closeParcelPlan(); openRoute()"><span class="nav-icon"><Ico name="walk" /></span><span class="nav-label">导航</span></button>
      <button type="button" :class="{ on: parcel.open }" :aria-pressed="parcel.open" @click="parcel.open ? closeParcelPlan() : openParcelStationMap()"><span class="nav-icon"><Ico name="parcel" /></span><span class="nav-label">快递站</span></button>
    </template>
  </nav>
</template>

<style scoped>
.nav-tabs { display: grid; grid-template-columns: repeat(var(--n, 5), minmax(0, 1fr)); }
.nav-tabs button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 0; padding: 6px 2px; border: 0; background: none; color: var(--ink-3); font-size: 11px; font-weight: 600; cursor: pointer; }
.nav-icon { position: relative; display: grid; place-items: center; width: 52px; height: 30px; border-radius: 999px; font-size: 20px; transition: background-color 0.15s, color 0.15s; }
.nav-icon em { position: absolute; top: 0; right: 8px; min-width: 16px; height: 16px; padding: 0 4px; border: 2px solid #fff; border-radius: 999px; background: var(--brand); color: #fff; font-size: 9.5px; font-style: normal; line-height: 12px; text-align: center; }
.nav-label { white-space: nowrap; }
.nav-avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #c13a40, var(--brand)); color: #fff; font-size: 12.5px; font-weight: 700; }
.nav-dot { position: absolute; top: 3px; right: 12px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #e8890c; }
.nav-tabs button.on { color: var(--brand); }
.nav-tabs button.on .nav-icon { background: var(--brand-soft); }
@media (hover: hover) { .nav-tabs button:not(.on):hover .nav-icon { background: var(--bg-2); color: var(--ink); } }

.vertical { grid-template-columns: none; gap: 6px; }
.vertical button { padding: 4px 0; }
.vertical .nav-icon { width: 48px; height: 32px; }
.nav-sep { width: 32px; margin: 4px auto; border: 0; border-top: 1px solid var(--line); }
</style>
