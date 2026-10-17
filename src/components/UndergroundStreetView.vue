<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { nextStreetViewPoint, previousStreetViewPoint, startStreetViewNavigation, stopStreetViewNavigation, state } from '../lib/store'
import StreetViewImage from './StreetViewImage.vue'
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
    <div class="street-head"><b>地下街景导航</b><span>第 {{ session.index + 1 }} / {{ session.points.length }} 个街景点</span><button @click="stopStreetViewNavigation">退出</button></div>
    <div class="street-stage">
      <StreetViewImage v-if="point" class="street-img" :urls="urls" :index="session.index" />
      <div class="ground-nav">
        <span v-if="isLast" class="exit-label">到达出口，返回地图</span>
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
.street-view{position:fixed;z-index:3000;inset:0;display:flex;flex-direction:column;padding:24px;gap:12px;background:#111;color:#fff}.street-stage{position:relative;flex:1;min-height:0}.street-view .street-img{width:100%;height:100%;object-fit:contain;min-height:0}.street-head{display:flex;gap:18px;align-items:center}.street-head span{color:#bbb}.street-head button{margin-left:auto}.street-progress{height:6px;background:#444;border-radius:5px}.street-progress i{display:block;height:100%;background:#6aa8ff;border-radius:5px}button{border:0;border-radius:10px;padding:9px 15px;cursor:pointer}.primary{background:#2f6fd6;color:white}button:disabled{opacity:.4}
@media (max-width:700px){.street-view{padding:12px}}
/* 仿 Google 街景：箭头经 3D 透视平铺在地面上 */
.ground-nav{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);perspective:520px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.ground-plane{display:flex;flex-direction:column;align-items:center;gap:6px;transform:rotateX(64deg);transform-style:preserve-3d}
.ground-arrow{pointer-events:auto;background:none;padding:0;border-radius:50%;display:grid;place-items:center;transition:transform .18s ease,opacity .18s ease}
.ground-arrow svg{width:100%;height:100%;overflow:visible}
.ground-arrow path{fill:rgba(255,255,255,.82);stroke:rgba(0,0,0,.45);stroke-width:3;stroke-linejoin:round;filter:drop-shadow(0 4px 3px rgba(0,0,0,.55))}
.ground-arrow.forward{width:120px;height:84px}
.ground-arrow.back{width:84px;height:58px;opacity:.6}
.ground-arrow:hover,.ground-arrow:focus-visible{transform:scale(1.12);opacity:1}
.ground-arrow:hover path,.ground-arrow:focus-visible path{fill:#fff;stroke:#2f6fd6}
.ground-arrow:focus-visible{outline:3px solid #6aa8ff;outline-offset:4px}
.exit-label{margin-bottom:-10px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.6);font-size:13px;white-space:nowrap}
@media (max-width:700px){.ground-arrow{padding:0 6px}.ground-arrow.forward{width:110px;height:140px}.ground-arrow.back{width:90px;height:130px}}
@media (prefers-reduced-motion:reduce){.ground-arrow{transition:none}.ground-arrow:hover,.ground-arrow:focus-visible{transform:none}}
</style>