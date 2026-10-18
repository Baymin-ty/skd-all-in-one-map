<script setup lang="ts">
import { computed } from 'vue'
import { hasMyMap } from '../lib/profile'
import { setMapView, state } from '../lib/store'
import Ico from './Ico.vue'

// 我的地图是默认视图，全校地图是从这里临时看一眼：打开后所有地点都恢复显示，面板换成全校信息，再点一次回去。
// 没登录也没课表时本来就在全校地图，不显示；只在地图首页出现，活动、美食等页面的地图不受我的 / 全校影响。
const on = computed(() => state.mapPrefs.mode === 'all')
const shown = computed(() => hasMyMap.value && state.panel === 'home' && !state.route.open && !state.route.picking)
</script>

<template>
  <button v-if="shown" type="button" class="fab campus-toggle" :class="{ on }" :aria-pressed="on" :title="on ? '回到我的地图' : '看全校地图'" @click="setMapView(on ? 'mine' : 'all')">
    <Ico name="building" /><span>全校</span>
  </button>
</template>

<style scoped>
.fab.campus-toggle { position: relative; }
.campus-toggle > span:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.fab.campus-toggle.on { background: var(--brand); color: #fff; }
</style>
