<script setup lang="ts">
import { onMounted, ref } from 'vue'
import MapView from './components/MapView.vue'
import PlaceCard from './components/PlaceCard.vue'
import PoiForm from './components/PoiForm.vue'
import RouteCard from './components/RouteCard.vue'
import SearchBox from './components/SearchBox.vue'
import { loadData, login, logout, restoreLogin, state } from './lib/store'

const loginOpen = ref(false)
const password = ref('')
const loginError = ref('')

onMounted(async () => {
  await loadData()
  await restoreLogin()
})

async function submitLogin() {
  loginError.value = ''
  try {
    await login(password.value)
    loginOpen.value = false
    password.value = ''
  } catch (e) {
    loginError.value = (e as Error).message
  }
}
function toggleManage() {
  if (state.editing) logout()
  else loginOpen.value = !loginOpen.value
}
function startPlacing() {
  state.draft = null
  state.route.picking = null
  state.placing = true
}
function cancelPick() {
  state.placing = false
  state.route.picking = null
}
</script>

<template>
  <div v-if="state.error" class="fullscreen">{{ state.error }}</div>
  <div v-else-if="!state.ready" class="fullscreen">地图加载中…</div>
  <template v-else>
    <MapView />

    <div class="topbar">
      <div class="title-row">
        <h1>上科大一图通</h1>
        <SearchBox />
      </div>
      <div class="tools">
        <button class="chip" :class="{ on: state.route.open }" @click="state.route.open = !state.route.open">🧭 导航</button>
        <button class="chip" :class="{ on: state.showRoads }" @click="state.showRoads = !state.showRoads">🛣️ 路网</button>
        <button class="chip" :class="{ on: state.editing }" :disabled="state.readonly" :title="state.readonly ? '后端没连上，点位只读' : ''" @click="toggleManage">
          ✏️ {{ state.editing ? '退出管理' : '管理点位' }}
        </button>
        <button v-if="state.editing" class="chip add" @click="startPlacing">＋ 添加点位</button>
      </div>
      <p v-if="state.readonly" class="offline">后端没连上：地图能看，点位暂时只读</p>
    </div>

    <div v-if="state.placing || state.route.picking" class="pick-hint">
      {{ state.placing ? '点地图放置新点位' : `点地图上的楼、点位或任意位置作为${state.route.picking === 'from' ? '起点' : '终点'}` }}
      <button @click="cancelPick">取消</button>
    </div>

    <div class="sheet">
      <section v-if="loginOpen && !state.editing" class="card">
        <header class="card-head">
          <h2>管理点位</h2>
          <button class="icon-btn" aria-label="关闭" @click="loginOpen = false">✕</button>
        </header>
        <form class="form" @submit.prevent="submitLogin">
          <label>管理口令<input v-model="password" type="password" autocomplete="current-password" required /></label>
          <p v-if="loginError" class="error">{{ loginError }}</p>
          <div class="actions"><button class="btn primary" type="submit">进入管理</button></div>
        </form>
      </section>
      <PoiForm v-if="state.draft" />
      <RouteCard v-if="state.route.open" />
      <PlaceCard v-if="!state.draft" />
      <div v-if="state.showRoads" class="card legend-card">
        <p class="legend"><i class="painted" />手绘图上的路 <i class="osm" />OpenStreetMap 补的路 <i class="cov" />风雨长廊下</p>
      </div>
    </div>

    <div v-if="state.toast" class="toast" role="status">{{ state.toast }}</div>
  </template>
</template>
