<script setup lang="ts">
import { computed, ref } from 'vue'
import { editDraft, login, logout, mapApi, POI_CATS, state } from '../lib/store'
import type { Poi, PoiCat } from '../lib/types'
import Ico from './Ico.vue'
import PoiForm from './PoiForm.vue'

const password = ref('')
const loginError = ref('')
const filter = ref('')

async function submit() {
  loginError.value = ''
  try {
    await login(password.value)
    password.value = ''
  } catch (e) {
    loginError.value = (e as Error).message
  }
}
function startPlacing() {
  state.draft = null
  state.placing = true
}
function open(p: Poi) {
  editDraft(p)
  mapApi.focus(p.pos, 19)
}

/** 按分类分组的点位列表，可按名称 / 介绍筛选 */
const sections = computed(() => {
  const k = filter.value.trim().toLowerCase()
  const list = state.pois.filter((p) => !k || p.name.zh.toLowerCase().includes(k) || p.name.en.toLowerCase().includes(k) || p.desc?.zh.toLowerCase().includes(k))
  return (Object.keys(POI_CATS) as PoiCat[]).map((c) => ({ cat: c, items: list.filter((p) => p.cat === c) })).filter((s) => s.items.length)
})
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h2 class="title">管理后台</h2>
        <p class="sub">点位的增删改，改完所有人立即看到</p>
      </div>
      <a href="#" class="act small"><Ico name="back" />返回地图</a>
    </div>

    <p v-if="state.readonly" class="note warn">后端没连上，点位暂时只读。先运行 <code>npm run server</code>。</p>

    <form v-else-if="!state.loggedIn" class="form login" @submit.prevent="submit">
      <label>管理口令<input v-model="password" type="password" autocomplete="current-password" required placeholder="见 server/.admin-password" /></label>
      <p v-if="loginError" class="error">{{ loginError }}</p>
      <div class="actions"><button class="act primary" type="submit"><Ico name="lock" />登录</button></div>
    </form>

    <div v-else-if="state.draft" class="sec"><PoiForm /></div>

    <template v-else>
      <div class="actions">
        <button type="button" class="act primary" :class="{ on: state.placing }" @click="startPlacing"><Ico name="plus" />添加点位</button>
        <button type="button" class="act" @click="logout">退出登录</button>
      </div>
      <p class="muted">地图上的点位可以直接拖动改位置；点列表里的一项编辑。</p>
      <input v-model="filter" class="filter" type="search" placeholder="筛选点位" aria-label="筛选点位" />
      <section v-for="s in sections" :key="s.cat" class="sec">
        <h3>{{ POI_CATS[s.cat].zh }} <span class="muted">{{ s.items.length }}</span></h3>
        <ul class="list-plain rows">
          <li v-for="p in s.items" :key="p.id" class="tap" :class="{ sel: state.selected?.id === p.id }" @click="open(p)">
            <span class="ric round" :style="{ background: POI_CATS[p.cat].color }"><Ico :name="POI_CATS[p.cat].icon" /></span>
            <div class="grow"><b class="ellipsis">{{ p.name.zh }}</b><small class="ellipsis">{{ p.desc?.zh || p.hours?.zh || '—' }}</small></div>
            <Ico name="edit" class="chev" />
          </li>
        </ul>
      </section>
      <p v-if="!sections.length" class="empty">没有匹配的点位</p>
    </template>
  </div>
</template>

<style scoped>
.login { margin-top: 14px; }
.filter { width: 100%; height: 38px; margin-top: 12px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-2); font-size: 14px; outline: none; }
.filter:focus { border-color: var(--blue); background: #fff; }
.rows li.sel { background: #fbeeee; }
code { font-size: 12px; background: #fff8; padding: 1px 4px; border-radius: 4px; }
.note.warn { background: #fdf3e5; color: #8a4b00; }
</style>
