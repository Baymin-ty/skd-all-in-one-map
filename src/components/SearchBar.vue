<script setup lang="ts">
import { computed, ref } from 'vue'
import { CHIPS, chooseSearch, search, setChip, state, type SearchHit } from '../lib/store'
import Ico from './Ico.vue'
import { t } from '../lib/i18n'

const q = ref('')
const focused = ref(false)
const input = ref<HTMLInputElement>()
const hits = computed(() => search(q.value))
// 分类只在「探索」里筛地图；食堂和活动有自己的功能页，不在这里重复。
const chips = CHIPS.filter((c) => c.id !== 'dining')
const showChips = computed(() => state.panel === 'home' && !state.route.open && !state.route.picking)

function choose(h: SearchHit) {
  chooseSearch(h)
  q.value = ''
  input.value?.blur()
}
</script>

<template>
  <div class="sbar">
    <div class="search-wrap">
      <div class="pillbtn search">
        <label class="field"><Ico name="search" />
        <input
          ref="input" v-model="q" type="search" :placeholder="t('search.placeholder')" :aria-label="t('search.placeholder')" enterkeyhint="search"
          @focus="focused = true" @blur="focused = false" @keydown.enter="hits[0] && choose(hits[0])" @keydown.esc="q = ''"
        /></label>
        <button v-if="q" type="button" class="clear" aria-label="清空" @mousedown.prevent="q = ''"><Ico name="close" /></button>
        <slot />
      </div>
      <ul v-if="focused && q.trim()" class="hits" role="listbox">
        <li v-for="h in hits" :key="h.sel.kind + ('id' in h.sel ? h.sel.id : 'group') + h.name" role="option" @mousedown.prevent @click="choose(h)">
          <span class="hic" :class="h.sel.kind"><Ico :name="h.icon" /></span>
          <span class="grow"><span class="hit-name">{{ h.name }}</span><small>{{ h.sub }}</small></span>
        </li>
        <li v-if="!hits.length" class="none">没有找到「{{ q.trim() }}」</li>
      </ul>
    </div>
    <nav v-if="showChips" class="chips" aria-label="按类型在地图上筛选">
      <button v-for="c in chips" :key="c.id" type="button" class="chip" :class="{ on: state.chip === c.id }" :aria-pressed="state.chip === c.id" @click="setChip(c.id)">
        <Ico :name="c.icon" />{{ c.zh }}
      </button>
    </nav>
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
.chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 2px 4px; margin: 0 -2px; }
.chips::-webkit-scrollbar { display: none; }
.chip { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; background: #fff; box-shadow: 0 1px 5px #00000029; font-size: 13px; font-weight: 600; cursor: pointer; }
.chip svg { font-size: 15px; color: var(--ink-2); }
.chip.on { background: var(--ink); color: #fff; }
.chip.on svg { color: #fff; }
</style>
