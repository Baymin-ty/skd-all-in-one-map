<script setup lang="ts">
import { computed } from 'vue'
import { buildingById, deletePoi, editDraft, endFor, poiById, POI_CATS, select, setEnd, state, toast } from '../lib/store'

const building = computed(() => (state.selected?.kind === 'building' ? buildingById(state.selected.id) : undefined))
const poi = computed(() => (state.selected?.kind === 'poi' ? poiById(state.selected.id) : undefined))
const tag = computed(() => {
  if (building.value) return building.value.walkway ? '风雨长廊' : state.categories[building.value.cat]?.zh
  return poi.value && POI_CATS[poi.value.cat]?.zh
})

function routeHere(which: 'from' | 'to') {
  const end = state.selected && endFor(state.selected)
  if (!end) return
  setEnd(which, end)
  // 收起详情，让出地方给导航卡片和路线
  select(null, false)
}
async function remove() {
  const p = poi.value
  if (!p || !confirm(`删除点位「${p.name.zh}」？`)) return
  await deletePoi(p.id).catch((e) => toast(`删除失败：${e.message}`))
}
</script>

<template>
  <section v-if="building || poi" class="card">
    <header class="card-head">
      <div>
        <h2>{{ (building ?? poi)!.name.zh }}</h2>
        <p class="en">{{ (building ?? poi)!.name.en }}</p>
      </div>
      <button class="icon-btn" aria-label="关闭" @click="select(null)">✕</button>
    </header>
    <span class="tag" :class="{ walkway: building?.walkway }">{{ tag }}</span>

    <template v-if="building">
      <p v-if="building.info">{{ building.info.zh }}</p>
      <p v-if="building.walkway" class="hint">🌧 打开导航里的「雨天模式」，路线会优先从长廊下面走。</p>
      <dl>
        <template v-if="building.aliases.length"><dt>别名</dt><dd>{{ building.aliases.join('、') }}</dd></template>
        <template v-if="building.orgs.length"><dt>单位</dt><dd>{{ building.orgs.map((o) => o.zh).join('、') }}</dd></template>
        <template v-if="building.hours"><dt>开放</dt><dd>{{ building.hours.zh }}</dd></template>
        <template v-if="building.entrances?.length"><dt>入口</dt><dd>{{ building.entrances.map((e) => e.zh).join('、') }}</dd></template>
        <template v-if="building.rooms.length"><dt>房间</dt><dd>{{ building.rooms.length }} 间有房间号数据</dd></template>
      </dl>
      <p v-if="building.note" class="hint">{{ building.note.zh }}</p>
    </template>

    <template v-if="poi">
      <p v-if="poi.desc?.zh">{{ poi.desc.zh }}</p>
      <dl>
        <template v-if="poi.hours?.zh"><dt>开放</dt><dd>{{ poi.hours.zh }}</dd></template>
        <template v-if="poi.source"><dt>来源</dt><dd>{{ poi.source }}</dd></template>
      </dl>
    </template>

    <div class="actions">
      <button class="btn primary" @click="routeHere('to')">到这去</button>
      <button class="btn" @click="routeHere('from')">从这出发</button>
      <template v-if="poi && state.editing">
        <button class="btn" @click="editDraft(poi)">编辑</button>
        <button class="btn danger" @click="remove">删除</button>
      </template>
    </div>
    <p v-if="poi && state.editing" class="hint">也可以直接在地图上拖动这个点位改位置。</p>
  </section>
</template>
