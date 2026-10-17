<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { chooseSearch, openRoute, search, state, type SearchHit } from '../lib/store'
import { ui } from '../lib/ui'
import Ico from './Ico.vue'
import MapChips from './MapChips.vue'
import { t } from '../lib/i18n'
import { closeParcelPlan, parcel } from '../lib/parcelStation'

const text = ref('')
// 桌面打开快递站时，侧栏搜索框只搜快递站：直接驱动右边的货架平面图，不弹出全局结果
const parcelMode = computed(() => ui.desktop && parcel.open)
const q = computed({
  get: () => parcelMode.value ? parcel.query : text.value,
  set: (v: string) => { if (parcelMode.value) parcel.query = v; else text.value = v },
})
const placeholder = computed(() => parcelMode.value ? '取件码 / 货架号，如 15-3-2045' : t('search.placeholder'))
watch(parcelMode, async (on) => {
  if (!on) return
  await nextTick()
  input.value?.focus()
})
function onEnter() {
  if (parcelMode.value) return
  if (hits.value[0]) choose(hits.value[0])
}
function onEsc() {
  if (parcelMode.value && !q.value) closeParcelPlan()
  else q.value = ''
}
const focused = ref(false)
const input = ref<HTMLInputElement>()
const hits = computed(() => search(q.value))
// 手机上分类条放在搜索框下面；桌面侧栏放不下，浮到地图左上角（见 App）。我的 / 全校地图的切换在地图右侧按钮
const showChips = computed(() => !ui.desktop && !parcelMode.value && state.panel === 'home' && !state.route.open && !state.route.picking)
function choose(h: SearchHit) {
  chooseSearch(h)
  // 选择货架结果时 chooseSearch 会同步打开货架模式；此时 q 的 setter
  // 已经指向 parcel.query，清空 q 会把刚写入的取件码一起清掉。全局搜索
  // 文本独立清空，保留货架图的查询以便高亮并自动定位。
  text.value = ''
  input.value?.blur()
}
</script>

<template>
  <div class="sbar">
    <div class="search-wrap">
      <div class="pillbtn search" :class="{ parcel: parcelMode }">
        <label class="field"><Ico :name="parcelMode ? 'parcel' : 'search'" />
        <input
          ref="input" v-model="q" type="search" :placeholder="placeholder" :aria-label="placeholder" enterkeyhint="search"
          @focus="focused = true" @blur="focused = false" @keydown.enter="onEnter" @keydown.esc.stop="onEsc"
        /></label>
        <button v-if="q" type="button" class="clear" aria-label="清空" @mousedown.prevent="q = ''"><Ico name="close" /></button>
        <button v-if="!ui.desktop" type="button" class="route-btn" aria-label="步行导航" title="步行导航" @click="openRoute()"><Ico name="walk" /></button>
      </div>
      <ul v-if="focused && q.trim() && !parcelMode" class="hits" role="listbox">
        <li v-for="h in hits" :key="h.sel.kind + ('id' in h.sel ? h.sel.id : 'group') + h.name" role="option" @mousedown.prevent @click="choose(h)">
          <span class="hic" :class="h.sel.kind"><Ico :name="h.icon" /></span>
          <span class="grow"><span class="hit-name">{{ h.name }}</span><small>{{ h.sub }}</small></span>
        </li>
        <li v-if="!hits.length" class="none">没有找到「{{ q.trim() }}」</li>
      </ul>
    </div>
    <div v-if="showChips" class="chip-row">
      <MapChips />
    </div>
  </div>
</template>

<style scoped>
.sbar { display: flex; flex-direction: column; gap: 8px; }
.search-wrap { position: relative; }
.pillbtn { display: flex; align-items: center; gap: 8px; height: 46px; border-radius: 999px; background: #fff; box-shadow: var(--shadow); padding: 0 5px 0 16px; color: var(--ink-3); cursor: text; }
.pillbtn svg { font-size: 18px; color: var(--ink-2); }
.field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; align-self: stretch; cursor: text; }
.pillbtn input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font-size: 15px; color: var(--ink); }
.pillbtn input::-webkit-search-cancel-button { display: none; }
.pillbtn:focus-within { box-shadow: 0 0 0 2px var(--blue), var(--shadow); }
.clear { flex: none; width: 30px; height: 30px; border: 0; border-radius: 50%; background: var(--bg-2); display: grid; place-items: center; cursor: pointer; }
.clear svg { font-size: 14px; }
.hits { position: absolute; z-index: 10; top: 50px; left: 0; right: 0; margin: 0; padding: 6px; list-style: none; max-height: 60vh; overflow: auto; background: #fff; border-radius: 14px; box-shadow: 0 6px 24px #00000029; }
.hits li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; cursor: pointer; font-size: 14px; }
.hits li:hover { background: var(--bg-2); }
.hit-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hits small { display: block; color: var(--ink-3); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hits .none { color: var(--ink-3); cursor: default; }
.hic { flex: none; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--bg-2); color: var(--ink-2); font-size: 15px; }
.hic.group { background: var(--ink); color: #fff; }
.hic.parcel { background: var(--brand-soft); color: var(--brand); }
.chip-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.route-btn { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--brand); color: #fff; font-size: 18px; cursor: pointer; }
.route-btn svg { color: #fff; }
</style>
