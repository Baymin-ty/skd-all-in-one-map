<script setup lang="ts">
import { computed } from 'vue'
import { buildingById, groupById, PLACE_COLORS, select, state } from '../lib/store'
import Ico from './Ico.vue'

const g = computed(() => (state.selected?.kind === 'group' ? groupById(state.selected.id) : undefined))
const members = computed(() => g.value?.members.map((id) => buildingById(id)!).filter(Boolean) ?? [])
const orgs = computed(() => [...new Set(members.value.flatMap((b) => b.orgs.map((o) => o.zh)))])
/** 楼号：名字里的数字 */
const num = (zh: string) => /(\d+)号楼/.exec(zh)?.[1] ?? ''
/** 名字里楼号后面的部分（比如「科道书院」） */
const extra = (zh: string) => zh.split('·')[1]?.trim() ?? ''
</script>

<template>
  <div v-if="g" class="page">
    <div class="head">
      <div class="row kick">
        <span class="pill">{{ state.categories[g.cat]?.zh }}</span>
        <span class="pill dark">楼群 · {{ members.length }} 栋</span>
      </div>
      <button type="button" class="close" aria-label="关闭" @click="select(null)"><Ico name="close" /></button>
    </div>
    <h2 class="title">{{ g.name.zh }}</h2>
    <p class="sub">{{ g.name.en }}</p>
    <p class="note">地图上已经展开，点楼名或下面的列表看每一栋。</p>

    <ul class="list-plain rows">
      <li v-for="b in members" :key="b.id" class="tap" @click="select({ kind: 'building', id: b.id })">
        <span class="num" :style="{ background: PLACE_COLORS[b.cat] }">{{ num(b.name.zh) }}</span>
        <div class="grow">
          <b>{{ b.short.zh }}</b>
          <small v-if="extra(b.name.zh) || b.entrances?.length">
            {{ [extra(b.name.zh), b.entrances?.length ? `${b.entrances.length} 个入口` : ''].filter(Boolean).join(' · ') }}
          </small>
        </div>
        <span v-if="b.isNew" class="pill new">新</span>
        <Ico name="chevron" class="chev" />
      </li>
    </ul>

    <section v-if="orgs.length" class="sec">
      <h3>单位</h3>
      <div class="tags"><span v-for="o in orgs" :key="o" class="pill">{{ o }}</span></div>
    </section>
  </div>
</template>

<style scoped>
.num { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
</style>
