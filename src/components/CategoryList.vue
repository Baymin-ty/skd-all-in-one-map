<script setup lang="ts">
import { computed } from 'vue'
import type { IconName } from '../lib/icons'
import {
  chipHasBuilding, chipHasPoi, CHIPS, groupOf, PLACE_COLORS, POI_CATS, select, setChip, state, WALKWAY_COLOR, type Selection,
} from '../lib/store'
import Ico from './Ico.vue'

type Row = { sel: Selection; name: string; sub: string; icon: IconName; color: string; count?: number }

const chip = computed(() => CHIPS.find((c) => c.id === state.chip)!)
/** 同一楼群的楼只列一行楼群 */
const rows = computed<Row[]>(() => {
  const c = state.chip!
  const out: Row[] = []
  const seen = new Set<string>()
  for (const b of state.buildings) {
    if (!chipHasBuilding(c, b)) continue
    const g = groupOf(b.id)
    if (g) {
      if (seen.has(g.id)) continue
      seen.add(g.id)
      out.push({ sel: { kind: 'group', id: g.id }, name: g.name.zh, sub: g.name.en, icon: g.cat, color: PLACE_COLORS[g.cat], count: g.members.length })
    } else {
      out.push({
        sel: { kind: 'building', id: b.id }, name: b.name.zh, sub: b.name.en,
        icon: b.walkway ? 'walkway' : b.cat, color: b.walkway ? WALKWAY_COLOR : PLACE_COLORS[b.cat],
      })
    }
  }
  for (const p of state.pois)
    if (chipHasPoi(c, p)) out.push({ sel: { kind: 'poi', id: p.id }, name: p.name.zh, sub: p.desc?.zh || POI_CATS[p.cat].zh, icon: POI_CATS[p.cat].icon, color: POI_CATS[p.cat].color })
  return out
})
</script>

<template>
  <div class="page">
    <div class="head">
      <h2 class="title"><Ico :name="chip.icon" /> {{ chip.zh }}</h2>
      <button type="button" class="close" aria-label="关闭分类" @click="setChip(null)"><Ico name="close" /></button>
    </div>
    <p class="sub">{{ rows.length }} 处，地图上已高亮</p>
    <p v-if="state.chip === 'walkway'" class="note">风雨长廊连着物质学院和信息学院一带。下雨天用「雨天导航」，路线会尽量从长廊下面走。</p>
    <ul class="list-plain rows">
      <li v-for="r in rows" :key="r.sel.kind + r.sel.id" class="tap" @click="select(r.sel)">
        <span class="ric" :class="{ round: r.sel.kind === 'poi' }" :style="{ background: r.color }"><Ico :name="r.icon" /></span>
        <div class="grow"><b class="ellipsis">{{ r.name }}</b><small class="ellipsis">{{ r.sub }}</small></div>
        <span v-if="r.count" class="pill dark">楼群 · {{ r.count }}</span>
        <Ico name="chevron" class="chev" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.title { display: flex; align-items: center; gap: 6px; }
</style>
