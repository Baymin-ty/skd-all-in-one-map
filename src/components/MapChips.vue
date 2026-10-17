<script setup lang="ts">
import { CHIPS, setChip, state } from '../lib/store'
import Ico from './Ico.vue'

// 只留常用的几类；食堂和活动有自己的功能页，风雨长廊在导航的雨天模式里，停车很少有人找。
// 手机放在搜索框下面，桌面浮在地图左上角。
const CHIP_IDS = ['academic', 'housing', 'sports', 'service', 'gate']
const chips = CHIPS.filter((c) => CHIP_IDS.includes(c.id))
</script>

<template>
  <nav class="chips" aria-label="按类型在地图上筛选">
    <button v-for="c in chips" :key="c.id" type="button" class="chip" :class="{ on: state.chip === c.id }" :aria-pressed="state.chip === c.id" @click="setChip(c.id)">
      <Ico :name="c.icon" />{{ c.zh }}
    </button>
  </nav>
</template>

<style scoped>
.chips { flex: 1; min-width: 0; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 4px; margin: 0 -2px; }
.chips::-webkit-scrollbar { display: none; }
.chip { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 12px; border: 0; border-radius: 999px; background: #fff; box-shadow: 0 1px 5px #00000029; color: var(--ink); font-size: 13px; font-weight: 600; cursor: pointer; }
.chip svg { font-size: 15px; color: var(--ink-2); }
.chip.on { background: var(--ink); color: #fff; }
.chip.on svg { color: #fff; }
@media (hover: hover) { .chip:not(.on):hover { background: #f4f4f6; } }
</style>
