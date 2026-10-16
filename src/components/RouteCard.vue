<script setup lang="ts">
import { closeRoute, computeRoute, state } from '../lib/store'

const r = state.route
function swap() {
  ;[r.from, r.to] = [r.to, r.from]
  computeRoute()
}
const pickLabel = (which: 'from' | 'to') => (r.picking === which ? '点地图或楼…' : '地图上选')
</script>

<template>
  <section class="card">
    <header class="card-head">
      <h2>步行导航</h2>
      <button class="icon-btn" aria-label="关闭导航" @click="closeRoute">✕</button>
    </header>
    <div class="ends">
      <div v-for="which in (['from', 'to'] as const)" :key="which" class="end" :class="{ active: r.picking === which }">
        <span class="dot" :class="which" />
        <span class="end-name" :class="{ empty: !r[which] }">{{ r[which]?.name ?? (which === 'from' ? '选择起点' : '选择终点') }}</span>
        <button class="btn small" @click="r.picking = r.picking === which ? null : which">{{ pickLabel(which) }}</button>
      </div>
      <button class="icon-btn swap" aria-label="交换起点终点" title="交换起点终点" @click="swap">⇅</button>
    </div>

    <label class="switch">
      <input v-model="r.rain" type="checkbox" @change="computeRoute" />
      <span>🌧 雨天模式：优先走风雨长廊</span>
    </label>

    <div v-if="r.result" class="result">
      <p class="big">约 {{ r.result.minutes }} 分钟 · {{ r.result.meters }} 米</p>
      <p v-if="r.result.coveredMeters" class="covered">其中 {{ r.result.coveredMeters }} 米在风雨长廊下</p>
      <p v-else-if="r.rain" class="hint">这条路线附近没有风雨长廊</p>
      <p class="legend"><i class="open" />露天 <i class="cov" />长廊下</p>
    </div>
    <p v-else-if="r.failed" class="hint">没找到这两个地方之间的步行路线，换个起点试试。</p>
    <p v-else class="hint">点「地图上选」，再点地图上的楼、点位或任意位置。</p>
  </section>
</template>
