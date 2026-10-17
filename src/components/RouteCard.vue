<script setup lang="ts">
import { closeRoute, computeRoute, finishUndergroundSketch, persistUndergroundSketchNow, setEnd, setRouteNetwork, startUndergroundSketch, state, undoUndergroundSketch } from '../lib/store'
import { locator, myLocationEnd, simulateWalk, startLocating } from '../lib/locate'
import Ico from './Ico.vue'
import { isEnglish, t } from '../lib/i18n'

const r = state.route
function chooseNetwork(network: 'surface' | 'underground') {
  if (network === r.network) return
  setRouteNetwork(network)
}
function swap() {
  ;[r.from, r.to] = [r.to, r.from]
  computeRoute()
}
const togglePick = (which: 'from' | 'to') => (r.picking = r.picking === which ? null : which)
/** 起点用我的位置：还没定位就先开定位，拿到位置后自动填上 */
function fromMe() {
  const me = myLocationEnd()
  if (me) setEnd('from', me)
  else {
    r.from = null
    startLocating()
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <h2 class="title">{{ r.network === 'underground' ? '地下手绘' : t('route.title') }}</h2>
      <button type="button" class="close" :aria-label="isEnglish ? 'Close directions' : '关闭导航'" @click="closeRoute"><Ico name="close" /></button>
    </div>

    <div class="route-network" role="tablist" aria-label="导航楼层">
      <button type="button" :class="{ on: r.network === 'surface' }" role="tab" :aria-selected="r.network === 'surface'" @click="chooseNetwork('surface')">地面</button>
      <button v-if="state.underground" type="button" :class="{ on: r.network === 'underground' }" role="tab" :aria-selected="r.network === 'underground'" @click="chooseNetwork('underground')">地下手绘</button>
    </div>
    <div v-if="r.network === 'underground'" class="sketch-panel">
      <p class="sketch-note">地下道路和车辆出入口、电梯、楼梯点统一在后台维护。当前手绘草稿会保存在本机，进入后台后可继续编辑并保存。</p>
      <div class="sketch-actions">
        <a class="primary-action" href="/admin/#underground" @click="persistUndergroundSketchNow">打开后台管理</a>
        <button type="button" :class="{ active: state.undergroundSketch.active }" @click="startUndergroundSketch">{{ state.undergroundSketch.active ? '继续手绘' : '补画线段' }}</button>
        <button type="button" :disabled="!state.undergroundSketch.active" @click="finishUndergroundSketch">结束</button>
        <button type="button" :disabled="!state.undergroundSketch.current.length && !state.undergroundSketch.paths.length" @click="undoUndergroundSketch">撤销</button>
      </div>
      <p class="sketch-status">{{ state.undergroundSketch.paths.length }} 条本机草稿线段<span v-if="state.undergroundSketch.active"> · 地图上逐点标记道路</span></p>
    </div>
    <div v-else class="ends">
      <button v-for="which in (['from', 'to'] as const)" :key="which" type="button" class="end" :class="{ active: r.picking === which }" @click="togglePick(which)">
        <span class="dot" :class="which" />
        <span class="grow ellipsis" :class="{ empty: !r[which] }">{{ r[which]?.name ?? (which === 'from' ? t('route.from') : t('route.to')) }}</span>
        <small>{{ r.picking === which ? (isEnglish ? 'Pick on map…' : '在地图上点选…') : (isEnglish ? 'Pick on map' : '地图上选') }}</small>
      </button>
      <button type="button" class="swap" aria-label="交换起点终点" title="交换起点终点" @click="swap"><Ico name="swap" /></button>
    </div>

    <div v-if="r.network === 'surface'" class="me-row">
      <button v-if="!r.from?.live" type="button" class="text-link" @click="fromMe"><Ico name="target" />{{ locator.status === 'locating' ? (isEnglish ? 'Locating…' : '正在定位…') : t('route.myLocation') }}</button>
      <span v-else class="live-note"><Ico name="target" />{{ isEnglish ? 'Route follows your location' : '跟着你的位置实时更新路线' }}</span>
      <button v-if="locator.mock && r.from?.live && r.result" type="button" class="text-link" :disabled="locator.simulating" @click="simulateWalk">{{ locator.simulating ? (isEnglish ? 'Simulating…' : '模拟行走中…') : (isEnglish ? 'Simulate walk' : '模拟走一遍') }}</button>
    </div>

    <label v-if="r.network === 'surface'" class="switch" :class="{ on: r.rain }">
      <input v-model="r.rain" type="checkbox" @change="computeRoute()" />
      <Ico name="rain" />
      <span class="grow">{{ isEnglish ? 'Rain mode' : '雨天模式' }}<small>{{ isEnglish ? 'Prefer covered walkways' : '优先走风雨长廊' }}</small></span>
      <i class="knob" />
    </label>

    <div v-if="r.result" class="result">
      <p class="big">{{ r.result.minutes }} {{ isEnglish ? 'min' : '分钟' }} <span>· {{ r.result.meters }} {{ isEnglish ? 'm' : '米' }}</span></p>
      <p v-if="r.result.coveredMeters" class="covered"><Ico name="walkway" /> {{ r.result.coveredMeters }} {{ isEnglish ? 'm covered' : '米在风雨长廊下' }}</p>
      <p v-else-if="r.rain" class="muted">{{ isEnglish ? 'No covered walkway on this route' : '这条路线附近没有风雨长廊' }}</p>
      <p class="legend"><i class="open" />{{ isEnglish ? 'Open air' : '露天' }} <i class="cov" />{{ isEnglish ? 'Covered' : '长廊下' }}</p>
    </div>
    <div v-else-if="r.undergroundResult" class="result underground-result">
      <p class="big">B1 <span>· {{ r.undergroundResult.meters }} {{ isEnglish ? 'm' : '米' }}</span></p>
      <p class="covered"><Ico name="road" /> 候选车行路线 · {{ r.undergroundResult.connectorIds.length }} 个上下点</p>
      <p class="legend"><i class="underground-line" />地下候选路线</p>
    </div>
    <p v-else-if="r.failed" class="note warn">{{ isEnglish ? 'No walking route found. Try another starting point.' : '没找到这两个地方之间的步行路线，换个起点试试。' }}</p>
    <p v-else-if="r.network === 'surface'" class="muted hint">{{ isEnglish ? `Pick a ${r.picking === 'to' ? 'destination' : 'starting point'} on the map.` : `点地图上的楼、点位或任意位置作为${r.picking === 'to' ? '终点' : '起点'}。` }}</p>
  </div>
</template>

<style scoped>
.route-network { display: flex; gap: 6px; margin-top: 10px; padding: 3px; border-radius: 12px; background: var(--bg-2); }
.route-network button { flex: 1; padding: 8px 6px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-2); font-size: 12px; cursor: pointer; }
.route-network button.on { background: #fff; color: var(--brand); box-shadow: 0 1px 4px #00000012; font-weight: 700; }
.sketch-panel { margin-top: 12px; padding: 12px; border: 1px dashed #c89adb; border-radius: 14px; background: #fcf7ff; }
.sketch-note { margin: 0; color: #6d5378; font-size: 12px; line-height: 1.55; }
.sketch-actions { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 6px; margin-top: 12px; }
.sketch-actions button, .sketch-actions a { display: grid; place-items: center; min-height: 34px; border: 1px solid #dfd1e7; border-radius: 9px; background: #fff; color: #714580; font-size: 12px; cursor: pointer; text-decoration: none; }
.sketch-actions button:disabled { color: #b8aabd; background: #f8f5f9; cursor: default; }
.sketch-actions .primary-action { border-color: #a24bc4; background: #a24bc4; color: #fff; font-weight: 700; }
.sketch-actions .primary-action.active { background: #71328d; }
.sketch-status { margin: 9px 0 0; color: #9578a1; font-size: 11px; }
.ends { position: relative; display: flex; flex-direction: column; gap: 6px; padding-right: 44px; margin-top: 10px; }
.end { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-2); font-size: 15px; text-align: left; cursor: pointer; }
.end.active { border-color: var(--blue); background: #f0f5fd; }
.end small { color: var(--blue); font-size: 12px; white-space: nowrap; }
.end .empty { color: var(--ink-3); }
.dot { flex: none; width: 12px; height: 12px; border-radius: 50%; border: 3px solid var(--blue); background: #fff; }
.dot.to { border-color: #d93025; background: #d93025; }
.swap { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--bg-2); display: grid; place-items: center; font-size: 18px; cursor: pointer; }
.switch { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--bg-2); cursor: pointer; font-size: 15px; font-weight: 600; }
.switch input { position: absolute; opacity: 0; pointer-events: none; }
.switch > .svgi { font-size: 20px; color: var(--ink-3); }
.switch small { display: block; font-size: 12px; font-weight: 500; color: var(--ink-3); }
.switch.on { background: #e6f4f7; }
.switch.on > .svgi { color: var(--walkway); }
.knob { flex: none; position: relative; width: 40px; height: 24px; border-radius: 12px; background: #d6d6db; transition: background 0.2s; }
.knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0000004d; transition: transform 0.2s; }
.switch.on .knob { background: var(--walkway); }
.switch.on .knob::after { transform: translateX(16px); }
.switch:focus-within { outline: 2px solid var(--blue); outline-offset: 2px; }
.result { margin-top: 14px; }
.big { margin: 0; font-size: 24px; font-weight: 750; }
.big span { font-size: 15px; font-weight: 500; color: var(--ink-2); }
.covered { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--walkway); font-weight: 600; font-size: 14px; }
.legend { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 12px; color: var(--ink-3); }
.legend i { width: 18px; height: 5px; border-radius: 3px; }
.legend i + i, .legend i:not(:first-child) { margin-left: 8px; }
.legend .open { background: var(--blue); }
.legend .cov { background: var(--walkway); }
.legend .underground-line { background: #8156a8; background-image: linear-gradient(90deg, transparent 0 45%, #fff 45% 60%, transparent 60%); }
.hint { margin-top: 12px; }
.me-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; }
.me-row .text-link, .live-note { display: inline-flex; align-items: center; gap: 4px; }
.live-note { font-size: 12.5px; color: var(--blue); font-weight: 600; }
.note.warn { background: #fdf3e5; color: #8a4b00; }
</style>
