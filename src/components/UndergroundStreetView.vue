<script setup lang="ts">
import { computed } from 'vue'
import { nextStreetViewPoint, previousStreetViewPoint, startStreetViewNavigation, stopStreetViewNavigation, state } from '../lib/store'
const session = computed(() => state.route.streetView)
const point = computed(() => session.value.points[session.value.index])
</script>
<template>
  <div v-if="session.pending" class="street-confirm" role="dialog" aria-modal="true">
    <div class="street-card"><h2>启动地下街景导航？</h2><p>地下区域没有 GPS 信号，是否启动地下街景导航？</p><div><button @click="stopStreetViewNavigation">取消</button><button class="primary" @click="startStreetViewNavigation">开始导航</button></div></div>
  </div>
  <div v-if="session.open" class="street-view" role="dialog" aria-label="地下街景导航">
    <div class="street-head"><b>地下街景导航</b><span>第 {{ session.index + 1 }} / {{ session.points.length }} 个街景点</span><button @click="stopStreetViewNavigation">退出</button></div>
    <img v-if="point" :src="point.imageUrl" alt="地下街景" />
    <div class="street-progress"><i :style="{ width: `${(session.index + 1) / session.points.length * 100}%` }" /></div>
    <div class="street-controls"><button :disabled="session.index === 0" @click="previousStreetViewPoint">上一个</button><button class="primary" @click="nextStreetViewPoint">{{ session.index === session.points.length - 1 ? '完成并返回地图' : '下一个' }}</button></div>
  </div>
</template>
<style scoped>
.street-confirm{position:fixed;z-index:3000;inset:0;display:grid;place-items:center;background:#111b;color:#fff}.street-card{background:#fff;color:#222;border-radius:18px;padding:24px;max-width:360px;box-shadow:0 12px 40px #0005}.street-card h2{margin:0 0 8px}.street-card p{color:#667;line-height:1.6}.street-card div:last-child,.street-controls{display:flex;justify-content:flex-end;gap:10px}
/* 以右侧大卡片展示街景，左侧保留缩小后的路线地图作为当前位置参考。 */
.street-view{position:fixed;z-index:3000;inset:0;display:flex;flex-direction:column;padding:24px;gap:12px;background:#111;color:#fff}.street-view img{width:100%;height:calc(100% - 100px);object-fit:contain;min-height:0}.street-head{display:flex;gap:18px;align-items:center}.street-head span{color:#bbb}.street-head button{margin-left:auto}.street-progress{height:6px;background:#444;border-radius:5px}.street-progress i{display:block;height:100%;background:#6aa8ff;border-radius:5px}.street-controls{justify-content:center}button{border:0;border-radius:10px;padding:9px 15px;cursor:pointer}.primary{background:#2f6fd6;color:white}button:disabled{opacity:.4}
@media (max-width:700px){.street-view{padding:12px}.street-view img{height:calc(100% - 106px)}}
</style>