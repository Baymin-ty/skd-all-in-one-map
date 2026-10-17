<script setup lang="ts">
import { closeRoute, computeRoute, finishUndergroundSketch, persistUndergroundSketchNow, setEnd, setRainMode, startUndergroundSketch, state, undoUndergroundSketch } from '../lib/store'
import { locator, myLocationEnd, simulateWalk, startLocating } from '../lib/locate'
import Ico from './Ico.vue'
import { isEnglish, t } from '../lib/i18n'

const r = state.route
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

    <div v-if="r.network === 'surface'" class="rain-row">
      <label class="rain-toggle"><input type="checkbox" :checked="state.rainMode" :disabled="!state.rainAvailable" @change="setRainMode(($event.target as HTMLInputElement).checked)" /><span>我要避雨！</span><small>{{ state.rainAvailable ? '使用避雨路网' : '暂无避雨版本' }}</small></label>
    </div>
    <div v-if="r.network === 'surface'" class="me-row">
      <button v-if="!r.from?.live" type="button" class="text-link" @click="fromMe"><Ico name="target" />{{ locator.status === 'locating' ? (isEnglish ? 'Locating…' : '正在定位…') : t('route.myLocation') }}</button>
      <span v-else class="live-note"><Ico name="target" />{{ isEnglish ? 'Route follows your location' : '跟着你的位置实时更新路线' }}</span>
      <button v-if="locator.mock && r.from?.live && r.result" type="button" class="text-link" :disabled="locator.simulating" @click="simulateWalk">{{ locator.simulating ? (isEnglish ? 'Simulating…' : '模拟行走中…') : (isEnglish ? 'Simulate walk' : '模拟走一遍') }}</button>
    </div>

    <div v-if="r.result" class="result">
      <p class="big">{{ r.result.minutes }} {{ isEnglish ? 'min' : '分钟' }} <span>· {{ r.result.meters }} {{ isEnglish ? 'm' : '米' }}</span></p>
      <p v-if="r.result.undergroundMeters" class="under"><Ico name="stairs" /> {{ r.result.undergroundMeters }} {{ isEnglish ? 'm underground' : '米在地下' }}</p>
      <div v-if="r.result.transitions.length" class="transitions" aria-label="地上地下分界点">
        <span v-for="transition in r.result.transitions" :key="`${transition.connectorId}-${transition.kind}`"><i :class="transition.kind" />{{ transition.label }}</span>
      </div>
      <p class="legend"><i class="open" />{{ isEnglish ? 'Surface' : '地面' }} <i v-if="r.result.undergroundMeters" class="ug" />{{ r.result.undergroundMeters ? (isEnglish ? 'Underground' : '地下') : '' }}</p>
    </div>
    <div v-else-if="r.undergroundResult" class="result underground-result">
      <p class="big">B1 <span>· {{ r.undergroundResult.meters }} {{ isEnglish ? 'm' : '米' }}</span></p>
      <p class="under"><Ico name="road" /> 候选车行路线 · {{ r.undergroundResult.connectorIds.length }} 个上下点</p>
      <p class="legend"><i class="underground-line" />地下候选路线</p>
    </div>
    <p v-else-if="r.failed" class="note warn">{{ isEnglish ? 'No walking route found. Try another starting point.' : '没找到这两个地方之间的步行路线，换个起点试试。' }}</p>
    <p v-else-if="r.network === 'surface'" class="muted hint">{{ isEnglish ? `Pick a ${r.picking === 'to' ? 'destination' : 'starting point'} on the map.` : `点地图上的楼、点位或任意位置作为${r.picking === 'to' ? '终点' : '起点'}。` }}</p>
  </div>
</template>

<style scoped>
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
.result { margin-top: 14px; }
.big { margin: 0; font-size: 24px; font-weight: 750; }
.big span { font-size: 15px; font-weight: 500; color: var(--ink-2); }
.under { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; color: #8156a8; font-weight: 650; font-size: 14px; }
.transitions { display: grid; gap: 4px; margin-top: 8px; color: #9a621d; font-size: 12px; }
.transitions span { display: flex; align-items: center; gap: 6px; }
.transitions i { display: inline-block; width: 9px; height: 9px; border: 2px solid #e89a31; border-radius: 50%; background: #fff7e8; }
.transitions i.exit { background: #e89a31; }
.legend { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 12px; color: var(--ink-3); }
.legend i { width: 18px; height: 5px; border-radius: 3px; }
.legend i + i, .legend i:not(:first-child) { margin-left: 8px; }
.legend .open { background: var(--blue); }
.legend .ug { background: #8156a8; background-image: linear-gradient(90deg, transparent 0 45%, #fff 45% 60%, transparent 60%); }
.legend .underground-line { background: #8156a8; background-image: linear-gradient(90deg, transparent 0 45%, #fff 45% 60%, transparent 60%); }
.hint { margin-top: 12px; }
.rain-row { margin-top: 10px; padding: 9px 11px; border-radius: 10px; background: #eef8ff; }
.rain-toggle { display: flex; align-items: center; gap: 8px; color: #17628d; font-weight: 700; font-size: 13px; cursor: pointer; }
.rain-toggle input { accent-color: #168bd0; }
.rain-toggle small { margin-left: auto; color: #6b8798; font-weight: 400; font-size: 11px; }
.me-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; }
.me-row .text-link, .live-note { display: inline-flex; align-items: center; gap: 4px; }
.live-note { font-size: 12.5px; color: var(--blue); font-weight: 600; }
.note.warn { background: #fdf3e5; color: #8a4b00; }
</style>
