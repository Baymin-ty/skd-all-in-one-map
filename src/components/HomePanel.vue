<script setup lang="ts">
import { computed } from 'vue'
import { openRoute, PLACE_COLORS, select, setChip, state } from '../lib/store'
import Ico from './Ico.vue'

const gates = computed(() => state.buildings.filter((b) => b.cat === 'gate'))
</script>

<template>
  <div class="page">
    <h2 class="title">探索校园</h2>
    <p class="sub">点地图上的楼、楼群或点位看详情，或者直接导航</p>
    <div class="actions">
      <button type="button" class="act primary" @click="openRoute()"><Ico name="walk" />步行导航</button>
      <button type="button" class="act rain" @click="openRoute(true)"><Ico name="rain" />雨天导航</button>
      <button type="button" class="act" @click="setChip('walkway')"><Ico name="walkway" />风雨长廊</button>
    </div>

    <section class="sec">
      <h3>楼群 <span class="muted">点开看每一栋</span></h3>
      <ul class="list-plain rows">
        <li v-for="g in state.groups" :key="g.id" class="tap" @click="select({ kind: 'group', id: g.id })">
          <span class="ric" :style="{ background: PLACE_COLORS[g.cat] }"><Ico :name="g.cat" /></span>
          <div class="grow"><b>{{ g.name.zh }}</b><small>{{ g.name.en }}</small></div>
          <span class="pill">{{ g.members.length }} 栋</span>
          <Ico name="chevron" class="chev" />
        </li>
      </ul>
    </section>

    <section class="sec">
      <h3>校门</h3>
      <div class="tags">
        <button v-for="b in gates" :key="b.id" type="button" class="tagbtn" @click="select({ kind: 'building', id: b.id })">{{ b.name.zh }}</button>
      </div>
    </section>

    <footer class="foot">
      <p class="muted">底图、楼宇、点位来自上海科技大学校园地图；部分道路 © OpenStreetMap contributors</p>
      <a href="#admin" class="admin-link"><Ico name="lock" />管理后台</a>
    </footer>
  </div>
</template>

<style scoped>
.act.rain { color: var(--walkway); border-color: #bfe3ea; background: #eef8fa; }
.foot { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.foot .muted { font-size: 11.5px; }
.admin-link { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--ink-2); }
.tagbtn { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 13px; cursor: pointer; }
.tagbtn:hover { background: var(--bg-2); }
</style>
