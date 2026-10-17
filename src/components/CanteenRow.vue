<script setup lang="ts">
import { computed } from 'vue'
import type { Canteen } from '../lib/discoveryTypes'
import { canteenSummary, outletSummary } from '../lib/canteenMenu'
import { openCanteen } from '../lib/store'
import Ico from './Ico.vue'
const props = defineProps<{ canteen: Canteen }>()
const summary = computed(() => canteenSummary(props.canteen))
</script>

<template>
  <button type="button" class="canteen-row tap" @click="openCanteen(canteen.id)">
    <span class="canteen-icon" :class="summary.tone"><Ico name="dining" /></span>
    <span class="grow">
      <b>{{ canteen.zh }}</b>
      <span class="status-line"><span class="pill" :class="`outlet-${summary.tone}`">{{ summary.best ? outletSummary(summary.best) : '营业时间待确认' }}</span><small v-if="canteen.outlets.length > 1">{{ summary.best?.zh }}</small></span>
      <small class="menu-count">{{ canteen.outlets.length }} 个餐厅<template v-if="summary.stalls"> · {{ summary.stalls }} 个窗口</template> · {{ summary.dishes ? summary.dishes + ' 道菜' : '菜单整理中' }}</small>
    </span>
    <Ico name="chevron" class="chev" />
  </button>
</template>

<style scoped>
.canteen-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 0; text-align: left; background: none; border: 0; border-bottom: 1px solid var(--line); border-radius: 8px; }
.canteen-icon { flex: none; width: 36px; height: 36px; border-radius: 11px; background: #f0f0f3; color: #77777e; display: grid; place-items: center; font-size: 18px; }
.canteen-icon.open { background: #e6f6ec; color: #167847; }
.canteen-icon.later { background: #fff3df; color: #aa6818; }
.canteen-row b { display: block; font-size: 15px; }
.status-line { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.status-line .pill { font-size: 10.5px; }
.canteen-row small { font-size: 11px; color: var(--ink-3); }
.menu-count { display: block; margin-top: 5px; }
</style>
