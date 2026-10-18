<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { nextStreetViewPoint, previousStreetViewPoint, startStreetViewNavigation, stopStreetViewNavigation, state } from '../lib/store'
import StreetViewImage from './StreetViewImage.vue'
// TEMP DEMO(indoor-503)
import { DEMO_INDOOR_503_DESTINATION, demoIndoor503Arrived } from '../lib/demoIndoor503'
import { finishDemoIndoor503 } from '../lib/store'
const plan = computed(() => point.value?.minimap?.kind === 'plan' ? point.value.minimap : null)
const planZoom = ref(false)
const stageInfo = computed(() => {
  const stage = point.value?.stage
  if (!stage) return null
  const same = session.value.points.map((p, i) => [p, i] as const).filter(([p]) => p.stage === stage)
  return { stage, n: same.findIndex(([, i]) => i === session.value.index) + 1, total: same.length }
})
const hasDemo = computed(() => session.value.points.at(-1)?.minimap?.kind === 'plan')
const session = computed(() => state.route.streetView)
const point = computed(() => session.value.points[session.value.index])
const urls = computed(() => session.value.points.map((p) => p.imageUrl))
function onKeydown(event: KeyboardEvent) {
  if (!session.value.open) return
  if (event.key === 'Escape') stopStreetViewNavigation()
  else if (event.key === 'ArrowUp') { event.preventDefault(); nextStreetViewPoint() }
  else if (event.key === 'ArrowDown' && session.value.index > 0) { event.preventDefault(); previousStreetViewPoint() }
}
const isLast = computed(() => session.value.index === session.value.points.length - 1)
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
<template>
  <div v-if="session.pending" class="street-confirm" role="dialog" aria-modal="true">
    <div class="street-card"><h2>启动地下街景导航？</h2><p>地下区域没有 GPS 信号，是否启动地下街景导航？</p><div><button @click="stopStreetViewNavigation">取消</button><button class="primary" @click="startStreetViewNavigation">开始导航</button></div></div>
  </div>
  <div v-if="session.open" class="street-view" role="dialog" aria-label="地下街景导航">
    <div class="street-head"><button class="street-exit" aria-label="退出地下街景导航" title="退出（Esc）" @click="stopStreetViewNavigation">✕ 退出</button><b>{{ stageInfo ? '室内导航' : '地下街景导航' }}</b><span v-if="stageInfo">{{ stageInfo.stage }} · 第 {{ stageInfo.n }} / {{ stageInfo.total }} 张</span><span v-else>第 {{ session.index + 1 }} / {{ session.points.length }} 个街景点</span></div>
    <!-- TEMP DEMO(indoor-503): 平面图小窗覆盖在地图小窗上 -->
    <Teleport to="body"><button v-if="plan" type="button" class="demo-plan" :class="{ zoom: planZoom }" :title="plan.label" @click="planZoom = !planZoom">
      <span class="demo-plan-inner"><span class="demo-plan-fit"><img :src="plan.src" :alt="plan.label" /><i v-if="plan.highlight" class="demo-room" :style="{ left: plan.highlight[0] + '%', top: plan.highlight[1] + '%', width: plan.highlight[2] + '%', height: plan.highlight[3] + '%' }">503</i></span></span>
      <small>{{ plan.label }}</small>
    </button></Teleport>
    <div v-if="demoIndoor503Arrived" class="demo-arrived" role="status"><div><b>已到达目的地：{{ DEMO_INDOOR_503_DESTINATION }}</b><button class="primary" @click="finishDemoIndoor503">完成</button></div></div>
    <div class="street-stage">
      <StreetViewImage v-if="point" class="street-img" :urls="urls" :index="session.index" />
      <div class="ground-nav">
        <span v-if="isLast" class="exit-label">{{ hasDemo ? '到达目的地' : '到达出口，返回地图' }}</span>
        <div class="ground-plane">
          <button class="ground-arrow forward" aria-label="前进" :title="isLast ? '完成并返回地图' : '前进'" @click="nextStreetViewPoint"><svg viewBox="0 0 100 70" aria-hidden="true"><path d="M10 62 L50 14 L90 62 L70 62 L50 38 L30 62 Z" /></svg></button>
          <button v-if="session.index > 0" class="ground-arrow back" aria-label="后退" title="后退" @click="previousStreetViewPoint"><svg viewBox="0 0 100 70" aria-hidden="true"><path d="M10 8 L50 56 L90 8 L70 8 L50 32 L30 8 Z" /></svg></button>
        </div>
      </div>
    </div>
    <div class="street-progress"><i :style="{ width: `${(session.index + 1) / session.points.length * 100}%` }" /></div>
  </div>
</template>
<style scoped>
.street-confirm{position:fixed;z-index:3000;inset:0;display:grid;place-items:center;background:#111b;color:#fff}.street-card{background:#fff;color:#222;border-radius:18px;padding:24px;max-width:360px;box-shadow:0 12px 40px #0005}.street-card h2{margin:0 0 8px}.street-card p{color:#667;line-height:1.6}.street-card div:last-child{display:flex;justify-content:flex-end;gap:10px}
/* 以右侧大卡片展示街景，左侧保留缩小后的路线地图作为当前位置参考。 */
.street-view{position:fixed;z-index:3000;inset:0;display:flex;flex-direction:column;padding:24px;gap:12px;background:#111;color:#fff}.street-stage{position:relative;flex:1;min-height:0}.street-view .street-img{width:100%;height:100%;object-fit:contain;min-height:0}.street-head{display:flex;gap:18px;align-items:center}.street-head span{color:#bbb}.street-exit{display:inline-flex;align-items:center;gap:4px;min-height:40px;padding:8px 14px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;font-size:14px}.street-exit:hover,.street-exit:focus-visible{background:rgba(255,255,255,.22)}.street-progress{height:6px;background:#444;border-radius:5px}.street-progress i{display:block;height:100%;background:#6aa8ff;border-radius:5px}button{border:0;border-radius:10px;padding:9px 15px;cursor:pointer}.primary{background:#2f6fd6;color:white}button:disabled{opacity:.4}
@media (max-width:700px){.street-view{padding:12px}}
/* 仿 Google 街景：箭头经 3D 透视平铺在地面上 */
.ground-nav{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);perspective:520px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.ground-plane{display:flex;flex-direction:column;align-items:center;gap:56px;transform:rotateX(64deg);transform-style:preserve-3d}
.ground-arrow{pointer-events:auto;background:none;padding:0;border-radius:50%;display:grid;place-items:center;transition:transform .18s ease,opacity .18s ease}
.ground-arrow svg{width:100%;height:100%;overflow:visible}
.ground-arrow path{fill:rgba(255,255,255,.82);stroke:rgba(0,0,0,.45);stroke-width:3;stroke-linejoin:round;filter:drop-shadow(0 4px 3px rgba(0,0,0,.55))}
.ground-arrow.forward{width:120px;height:84px}
.ground-arrow.back{width:84px;height:58px;opacity:.6}
.ground-arrow:hover,.ground-arrow:focus-visible{transform:scale(1.12);opacity:1}
.ground-arrow:hover path,.ground-arrow:focus-visible path{fill:#fff;stroke:#2f6fd6}
.ground-arrow:focus-visible{outline:3px solid #6aa8ff;outline-offset:4px}
.exit-label{margin-bottom:-10px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);font-size:13px;white-space:nowrap}
@media (max-width:700px){.ground-plane{gap:90px}.ground-arrow{padding:0 6px}.ground-arrow.forward{width:110px;height:140px}.ground-arrow.back{width:90px;height:130px}}
@media (prefers-reduced-motion:reduce){.ground-arrow{transition:none}.ground-arrow:hover,.ground-arrow:focus-visible{transform:none}}
.demo-plan{position:fixed;z-index:3002;top:18px;right:18px;width:min(34vw,420px);height:min(30vh,260px);padding:0;border:3px solid #fff;border-radius:16px;background:#fff;box-shadow:0 8px 28px #0008;overflow:hidden;display:flex;flex-direction:column}.demo-plan.zoom{width:min(92vw,1100px);height:min(80vh,800px)}
.demo-plan-inner{flex:1;min-height:0;display:grid;place-items:center;container-type:size}.demo-plan-fit{position:relative;display:block}.demo-plan-inner img{max-width:100cqw;max-height:100cqh;object-fit:contain;display:block}
@media (max-width:700px){.demo-plan{top:calc(64px + env(safe-area-inset-top));right:12px}}
.demo-plan small{color:#333;font-size:12px;padding:2px 0 4px}
.demo-room{position:absolute;display:grid;place-items:center;border:2px solid #e23;background:#e2333330;color:#e23;font-style:normal;font-weight:700;font-size:12px;animation:demo-pulse 1.2s infinite alternate}
@keyframes demo-pulse{to{background:#e2333366}}
.demo-arrived{position:fixed;z-index:3005;inset:0;display:grid;place-items:center;background:#0008}.demo-arrived div{background:#fff;color:#222;border-radius:18px;padding:24px 28px;display:flex;flex-direction:column;gap:16px;align-items:center;font-size:18px}
</style>