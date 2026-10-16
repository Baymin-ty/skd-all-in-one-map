<script setup lang="ts">
import { computed } from 'vue'
import {
  buildingById, canEdit, deletePoi, editDraft, endFor, groupOf, mapApi, poiById, POI_CATS, select, setEnd, state, toast,
} from '../lib/store'
import Ico from './Ico.vue'

const b = computed(() => (state.selected?.kind === 'building' ? buildingById(state.selected.id) : undefined))
const poi = computed(() => (state.selected?.kind === 'poi' ? poiById(state.selected.id) : undefined))
const group = computed(() => (b.value ? groupOf(b.value.id) : undefined))
const place = computed(() => b.value ?? poi.value)
const kind = computed(() => {
  if (b.value) return b.value.walkway ? '风雨长廊' : state.categories[b.value.cat]?.zh
  return poi.value && POI_CATS[poi.value.cat]?.zh
})
const hours = computed(() => b.value?.hours?.zh || poi.value?.hours?.zh)

function routeHere(which: 'from' | 'to') {
  const end = state.selected && endFor(state.selected)
  if (!end) return
  setEnd(which, end)
  // 收起详情，让出地方给导航卡片和路线
  select(null)
}
async function remove() {
  const p = poi.value
  if (!p || !confirm(`删除点位「${p.name.zh}」？`)) return
  await deletePoi(p.id).catch((e) => toast(`删除失败：${e.message}`))
}
</script>

<template>
  <div v-if="place" class="page">
    <button v-if="group" type="button" class="crumb" @click="select({ kind: 'group', id: group.id })">
      <Ico name="back" />{{ group.name.zh }} · {{ group.members.length }} 栋
    </button>
    <div class="head">
      <div class="row kick">
        <span class="pill" :class="{ walkway: b?.walkway }">{{ kind }}</span>
        <span v-if="b?.isNew" class="pill new">新楼</span>
      </div>
      <button type="button" class="close" aria-label="关闭" @click="select(null)"><Ico name="close" /></button>
    </div>
    <h2 class="title">{{ place.name.zh }}</h2>
    <p v-if="place.name.en" class="sub">{{ place.name.en }}</p>

    <div class="actions">
      <button type="button" class="act primary" @click="routeHere('to')"><Ico name="walk" />到这去</button>
      <button type="button" class="act" @click="routeHere('from')">从这出发</button>
      <template v-if="poi && canEdit()">
        <button type="button" class="act" @click="editDraft(poi)"><Ico name="edit" />编辑</button>
        <button type="button" class="act danger" @click="remove"><Ico name="trash" />删除</button>
      </template>
    </div>

    <div v-if="hours" class="kv">
      <span class="ic"><Ico name="clock" /></span>
      <div class="v"><small>开放时间</small>{{ hours }}</div>
    </div>

    <section v-if="b && b.cat !== 'gate' && !b.walkway" class="ents">
      <h4><Ico name="entrance" />出入口</h4>
      <div v-if="b.entrances?.length" class="tags">
        <button v-for="(e, i) in b.entrances" :key="i" type="button" class="echip" @click="mapApi.focus(e.pos, 19)">{{ e.zh || '入口' }}</button>
      </div>
      <p v-else class="muted">还没标出入口，导航会带到楼旁边</p>
    </section>

    <p v-if="b?.walkway" class="note rain"><Ico name="rain" /> 下雨天打开导航里的「雨天模式」，路线会优先从长廊下面走。</p>
    <p v-if="b?.info" class="note">{{ b.info.zh }}</p>
    <p v-if="b?.note" class="note">{{ b.note.zh }}</p>
    <p v-if="poi?.desc?.zh" class="note">{{ poi.desc.zh }}</p>

    <section v-if="b?.orgs.length" class="sec">
      <h3>单位</h3>
      <div class="tags"><span v-for="o in b.orgs" :key="o.zh" class="pill">{{ o.zh }}</span></div>
    </section>
    <section v-if="b?.aliases.length" class="sec">
      <h3>也叫</h3>
      <div class="tags"><span v-for="a in b.aliases" :key="a" class="pill">{{ a }}</span></div>
    </section>
    <p v-if="b?.rooms.length" class="muted top">有 {{ b.rooms.length }} 间教室 / 房间的数据</p>
    <p v-if="poi?.source" class="muted top">来源：{{ poi.source }}</p>
    <p v-if="poi && canEdit()" class="muted top">在地图上直接拖动这个点位也能改位置。</p>
  </div>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 2px; margin: 2px 0 2px -4px; padding: 3px 8px 3px 2px; border: 0; border-radius: 999px; background: none; color: var(--blue); font-size: 13px; font-weight: 600; cursor: pointer; }
.crumb:hover { background: var(--bg-2); }
.ents { margin-top: 14px; }
.ents h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 13.5px; color: var(--ink-2); }
.echip { border: 1px solid #bfe5cf; background: #eefaf3; color: #146c3c; border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
.pill.walkway { background: var(--walkway); color: #fff; }
.note.rain { background: #eaf6f9; color: #0b6577; display: flex; gap: 6px; align-items: flex-start; }
.top { margin-top: 10px; }
</style>
