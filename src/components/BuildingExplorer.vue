<script setup lang="ts">
import { computed, ref } from 'vue'
import { EXPLORER_BUILDING_ID, EXPLORER_FLOORS, explorer, roomsForFloor, searchExplorerRooms, closeBuildingExplorer, type ExplorerRoom } from '../lib/buildingExplorer'
import { buildingById, state } from '../lib/store'
import Ico from './Ico.vue'

const building = computed(() => buildingById(EXPLORER_BUILDING_ID))
const query = ref('')
const rooms = computed(() => searchExplorerRooms(explorer.floor, query.value))
const selectedRoom = computed<ExplorerRoom | null>(() => roomsForFloor(explorer.floor).find((room) => room.code === explorer.room) ?? null)
const floorPlanImage = computed(() => explorer.floor === -1 ? '/data/spst-building-1-b1-plan-context.jpg' : explorer.floor === 5 ? '/data/spst-building-1-5f-plan-context.jpg' : '')
const floorPlanAlt = computed(() => explorer.floor === -1 ? '1号楼 B1 平面总索引' : '1号楼 5F 平面总索引')

function setFloor(floor: number, available: boolean) {
  if (!available) return
  explorer.floor = floor
  explorer.room = ''
  query.value = ''
}

function selectRoom(room: ExplorerRoom) {
  explorer.room = room.code
}

function close() {
  closeBuildingExplorer()
}

function roomStyle(room: ExplorerRoom) {
  const [left, top, width, height] = room.rect
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  }
}
</script>

<template>
  <section v-if="building && state.selected?.kind === 'building' && state.selected.id === EXPLORER_BUILDING_ID && explorer.open" class="building-explorer" aria-label="楼内平面图">
    <header class="be-head">
      <div>
        <button type="button" class="be-back" @click="close"><Ico name="back" />返回楼栋详情</button>
        <p class="be-kicker">楼内平面图</p>
        <h2>{{ building.name.zh }}</h2>
        <p class="be-sub">点击楼层或房间编号查看</p>
      </div>
      <button type="button" class="close" aria-label="关闭楼内平面图" @click="close"><Ico name="close" /></button>
    </header>

    <div class="be-body">
      <nav class="be-floors" aria-label="楼层选择">
        <p>楼层</p>
        <button v-for="floor in EXPLORER_FLOORS" :key="floor.number" type="button" :class="{ active: explorer.floor === floor.number }" :disabled="!floor.available" :aria-label="`${floor.number}楼${floor.available ? '' : '，暂未整理'}`" @click="setFloor(floor.number, floor.available)">
          <b>{{ floor.number }}F</b><small>{{ floor.available ? '平面图' : '暂未整理' }}</small>
        </button>
      </nav>

      <main class="be-main">
        <div class="be-main-head"><div><b>{{ explorer.floor === -1 ? 'B1' : `${explorer.floor}F` }} 平面总索引</b><span>BUILDING 1 · FLOOR PLAN</span></div><span v-if="rooms.length" class="be-note">点击房间查看编号</span><span v-else class="be-note">暂无房间编号</span></div>
        <div class="be-plan-wrap">
          <div v-if="floorPlanImage" class="be-plan" role="img" :aria-label="`${explorer.floor === -1 ? 'B1' : `${explorer.floor}F`}楼平面图`">
            <img class="be-plan-image" :src="floorPlanImage" :alt="floorPlanAlt" />
            <button v-for="room in roomsForFloor(explorer.floor)" :key="room.code" type="button" class="be-room" :class="{ active: explorer.room === room.code }" :style="roomStyle(room)" :aria-label="`房间 ${room.code}`" @click="selectRoom(room)">
              <span>{{ room.code }}</span>
            </button>
          </div>
          <p v-else class="be-empty">这一层暂未整理平面图</p>
        </div>

        <div class="be-room-bar">
          <label><Ico name="search" /><input v-model="query" type="search" placeholder="搜索房间编号" aria-label="搜索房间编号" /></label>
          <div v-if="rooms.length" class="be-room-list"><button v-for="room in rooms" :key="room.code" type="button" :class="{ active: explorer.room === room.code }" @click="selectRoom(room)">{{ room.code }}</button></div>
          <p v-else class="be-room-empty">当前楼层暂无房间编号</p>
        </div>

        <aside v-if="selectedRoom" class="be-detail"><div><span>房间编号</span><b>{{ selectedRoom.code }}</b></div><p>房间信息待补充</p></aside>
      </main>
    </div>
  </section>
</template>

<style scoped>
.building-explorer { position: fixed; z-index: 1000; inset: 0 0 0 var(--side-w); display: flex; flex-direction: column; overflow: hidden; background: var(--bg); color: var(--ink); box-shadow: -2px 0 16px #00000012; animation: be-in .2s ease both; }
.be-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 18px 24px 16px; border-bottom: 1px solid var(--line); background: #fff; }
.be-back { display: inline-flex; align-items: center; gap: 2px; margin: -2px 0 10px -5px; padding: 3px 8px 3px 3px; border: 0; border-radius: 999px; background: none; color: var(--blue); font-size: 13px; cursor: pointer; }.be-back:hover { background: var(--bg-2); }
.be-kicker { color: var(--ink-3); font-size: 12px; }.be-head h2 { margin-top: 3px; font-size: 22px; }.be-sub { margin-top: 2px; color: var(--ink-2); font-size: 13px; }
.be-body { display: flex; flex: 1; min-height: 0; }.be-floors { flex: none; width: 126px; padding: 20px 12px; border-right: 1px solid var(--line); background: #fafafa; }.be-floors p { margin: 0 6px 9px; color: var(--ink-3); font-size: 12px; }.be-floors button { display: flex; flex-direction: column; gap: 1px; width: 100%; margin-bottom: 6px; padding: 9px 8px; border: 1px solid transparent; border-radius: 11px; background: transparent; text-align: left; cursor: pointer; }.be-floors button:hover:not(:disabled) { background: #f1f1f4; }.be-floors button.active { border-color: #e9c8cb; background: var(--brand-soft); color: var(--brand); }.be-floors button:disabled { color: #b6b6bc; cursor: not-allowed; }.be-floors b { font-size: 16px; }.be-floors small { font-size: 11px; }
.be-main { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; padding: 20px 24px 24px; overflow: auto; }.be-main-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }.be-main-head b { display: block; font-size: 17px; }.be-main-head span { display: block; margin-top: 2px; color: var(--ink-3); font-size: 11px; }.be-note { flex: none; color: var(--brand) !important; font-size: 12px !important; }
.be-plan-wrap { position: relative; display: grid; place-items: center; margin-top: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: #fbfbfc; }.be-plan { position: relative; width: min(100%, 1050px); overflow: hidden; }.be-plan-image { display: block; width: 100%; height: auto; }.be-room { position: absolute; display: grid; place-items: center; padding: 0; border: 2px solid #b33135; border-radius: 6px; background: #b3313510; color: #b33135; font: inherit; cursor: pointer; transition: background .15s, border-color .15s; }.be-room span { padding: 2px 6px; border-radius: 4px; background: #fff9; font-size: clamp(12px, 1.45vw, 18px); font-weight: 700; }.be-room:hover, .be-room.active { border-color: var(--brand); background: #b3313524; }.be-room.active span { background: #fff; color: var(--brand); }.be-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-3); font-size: 14px; }
.be-room-bar { display: flex; align-items: center; gap: 12px; margin-top: 14px; }.be-room-bar label { display: flex; align-items: center; gap: 7px; flex: none; width: 190px; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-2); color: var(--ink-3); }.be-room-bar input { min-width: 0; width: 100%; border: 0; outline: 0; background: none; font-size: 13px; }.be-room-list { display: flex; flex-wrap: wrap; gap: 6px; }.be-room-list button { min-width: 48px; padding: 7px 11px; border: 1px solid var(--line); border-radius: 9px; background: #fff; color: var(--ink-2); font-weight: 650; cursor: pointer; }.be-room-list button.active, .be-room-list button:hover { border-color: #e1b5b8; background: var(--brand-soft); color: var(--brand); }.be-room-empty { color: var(--ink-3); font-size: 12px; }
.be-detail { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; padding: 12px 14px; border: 1px solid #ecd2d3; border-radius: 12px; background: #fffaf9; }.be-detail span { display: block; color: var(--ink-3); font-size: 11px; }.be-detail b { display: block; margin-top: 2px; color: var(--brand); font-size: 20px; }.be-detail p { color: var(--ink-2); font-size: 13px; }
@keyframes be-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 700px) { .building-explorer { inset: 0; }.be-head { padding: calc(env(safe-area-inset-top) + 14px) 16px 14px; }.be-floors { width: 92px; padding-left: 8px; padding-right: 8px; }.be-main { padding: 16px 12px 20px; }.be-main-head { display: block; }.be-note { margin-top: 4px; }.be-plan-wrap { min-height: 240px; padding: 8px; }.be-room-bar { display: block; }.be-room-bar label { width: 100%; }.be-room-list { margin-top: 8px; }.be-detail { align-items: flex-start; flex-direction: column; gap: 5px; } }
@media (prefers-reduced-motion: reduce) { .building-explorer { animation: none; } }
</style>
