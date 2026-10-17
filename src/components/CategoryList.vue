<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { IconName } from '../lib/icons'
import {
  chipHasBuilding, chipHasPoi, CHIPS, endFor, groupOf, PLACE_COLORS, POI_CATS, select, setChip, setEnd, state, WALKWAY_COLOR, type Selection,
} from '../lib/store'
import { eventsIn } from '../lib/discoveryData'
import Ico from './Ico.vue'

type Row = { sel: Selection; name: string; sub: string; detail?: string; icon: IconName; color: string; count?: number; events: number; isNew?: boolean }

const chip = computed(() => CHIPS.find((c) => c.id === state.chip)!)
const query = ref('')
watch(() => state.chip, () => query.value = '')
const eventCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const e of eventsIn('upcoming')) if (e.place) counts.set(e.place, (counts.get(e.place) || 0) + 1)
  return counts
})
const hints: Record<string, string> = { academic: '学院、教学楼与科研空间', housing: '学生公寓与教授公寓，按楼群查看', sports: '球场、场馆与运动设施', service: '图书馆、校园服务与生活设施', gate: '各校门位置与地址', parking: '校园停车与车库出入口', walkway: '连接教学科研区的遮雨步行空间', dining: '食堂、咖啡与便利店' }
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
      out.push({ sel: { kind: 'group', id: g.id }, name: g.name.zh, sub: g.name.en, detail: `展开查看 ${g.members.length} 栋楼`, icon: g.cat, color: PLACE_COLORS[g.cat], count: g.members.length, events: g.members.reduce((n, id) => n + (eventCounts.value.get(id) || 0), 0) })
    } else {
      out.push({
        sel: { kind: 'building', id: b.id }, name: b.name.zh, sub: b.name.en, detail: b.hours?.zh || b.orgs.map((o) => o.zh).join(' · ') || b.info?.zh || '', isNew: b.isNew, events: eventCounts.value.get(b.id) || 0,
        icon: b.walkway ? 'walkway' : b.cat, color: b.walkway ? WALKWAY_COLOR : PLACE_COLORS[b.cat],
      })
    }
  }
  for (const p of state.pois)
    if (chipHasPoi(c, p)) out.push({ sel: { kind: 'poi', id: p.id }, name: p.name.zh, sub: p.desc?.zh || POI_CATS[p.cat].zh, detail: p.hours?.zh, icon: POI_CATS[p.cat].icon, color: POI_CATS[p.cat].color, events: eventCounts.value.get(p.id) || 0 })
  return out.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, 'zh', { numeric: true }))
})
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter((r) => !q || `${r.name} ${r.sub} ${r.detail || ''}`.toLowerCase().includes(q))
})
const sections = computed(() => [
  { title: '楼宇与楼群', items: filtered.value.filter((r) => r.sel.kind !== 'poi') },
  { title: '服务与设施', items: filtered.value.filter((r) => r.sel.kind === 'poi') },
].filter((s) => s.items.length))
function choose(sel: Selection) {
  const end = state.route.picking && endFor(sel)
  if (end) setEnd(state.route.picking!, end)
  else select(sel)
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div class="category-heading"><span class="category-icon"><Ico :name="chip.icon" /></span><div><h2 class="title">{{ chip.zh }}</h2><p class="sub">{{ hints[chip.id] }}</p></div></div>
      <button type="button" class="close" aria-label="关闭分类" @click="setChip(null)"><Ico name="close" /></button>
    </div>
    <p class="category-count">{{ rows.length }} 个地点 / 楼群 · 已在地图上高亮</p>
    <p v-if="state.chip === 'walkway'" class="note">风雨长廊连着物质学院和信息学院一带。下雨天用「雨天导航」，路线会尽量从长廊下面走。</p>
    <label v-if="rows.length > 5" class="category-search"><Ico name="search" /><input v-model="query" type="search" :placeholder="`在${chip.zh}中查找…`" aria-label="搜索当前分类" /></label>
    <section v-for="section in sections" :key="section.title" class="category-section">
      <h3 v-if="sections.length > 1">{{ section.title }} <span>{{ section.items.length }}</span></h3>
      <button v-for="r in section.items" :key="r.sel.kind + r.sel.id" type="button" class="category-row tap" @click="choose(r.sel)">
        <span class="category-row-icon" :style="{ color: r.color, background: r.color + '12' }"><Ico :name="r.icon" /></span>
        <span class="grow"><b>{{ r.name }}</b><small v-if="r.sub" class="ellipsis">{{ r.sub }}</small><span v-if="r.detail" class="category-detail">{{ r.detail }}</span><span v-if="r.count || r.isNew || r.events" class="category-badges"><span v-if="r.count" class="pill">{{ r.count }} 栋</span><span v-if="r.isNew" class="pill new">新楼</span><span v-if="r.events" class="pill activity-count">{{ r.events }} 场活动</span></span></span>
        <Ico name="chevron" class="chev" />
      </button>
    </section>
    <p v-if="!filtered.length" class="empty">没有找到这个地点，换个关键词试试。</p>
  </div>
</template>

<style scoped>
.category-heading { display: flex; align-items: center; gap: 10px; padding-top: 3px; }.category-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 12px; background: var(--brand-soft); color: var(--brand); font-size: 21px; }.category-heading .sub { font-size: 11px; }
.category-count { color: var(--ink-3); font-size: 11px; margin: 15px 0 10px; }.category-search { display: flex; align-items: center; gap: 8px; background: var(--bg-2); border-radius: 11px; padding: 9px 11px; margin-bottom: 8px; }.category-search input { width: 100%; min-width: 0; border: 0; background: none; outline: none; font-size: 12px; }.category-search:focus-within { outline: 2px solid var(--blue); }
.category-section h3 { font-size: 12px; color: var(--ink-2); margin: 18px 0 3px; }.category-section h3 span { color: var(--ink-3); font-weight: 400; margin-left: 4px; }
.category-row { width: 100%; display: flex; align-items: center; gap: 10px; border: 0; border-bottom: 1px solid var(--line); border-radius: 8px; padding: 13px 2px; background: #fff; text-align: left; }.category-row-icon { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 17px; }.category-row b { display: block; font-size: 14px; }.category-row small { display: block; color: var(--ink-3); font-size: 11px; margin-top: 3px; }.category-detail { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 11px; line-height: 1.5; color: var(--ink-2); margin-top: 5px; }.category-badges { display: flex; gap: 5px; margin-top: 6px; }.category-badges .pill { font-size: 10px; padding: 1px 6px; }.activity-count { color: var(--brand); background: var(--brand-soft); }
</style>
