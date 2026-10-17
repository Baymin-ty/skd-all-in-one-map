<script setup lang="ts">
import { computed } from 'vue'
import Ico from '../components/Ico.vue'
import { admin, assets, navigate } from './store'

// 「地图数据」的两层：地上（建筑、点位）和地下（B1 路网）。两层共用同一套目录 + 地图 + 详情布局。
const layers = computed(() => [
  { view: 'overview' as const, label: '地上', icon: 'building' as const, count: `${assets.value.length} 个地点` },
  { view: 'underground' as const, label: '地下', icon: 'road' as const, count: admin.undergroundGraph ? `${admin.undergroundGraph.nodes.length} 个节点` : 'B1 路网' },
])
</script>

<template>
  <div class="layer-switch" role="tablist" aria-label="地图数据分层">
    <button
      v-for="l in layers" :key="l.view" type="button" role="tab" :class="[l.view, { active: admin.view === l.view }]"
      :aria-selected="admin.view === l.view" :aria-label="`${l.label}数据 · ${l.count}`" @click="navigate(l.view)"
    ><Ico :name="l.icon" /><span><b>{{ l.label }}</b><small>{{ l.count }}</small></span></button>
  </div>
</template>
