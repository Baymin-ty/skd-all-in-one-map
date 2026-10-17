<script setup lang="ts">
import { computed } from 'vue'
import Ico from '../components/Ico.vue'
import type { Building, Poi } from '../lib/types'
import { admin, category, edit, mapControl, remove } from './store'
const a = computed(() => admin.selected!)
const b = computed(() => a.value.kind === 'building' ? a.value.data as Building : null)
const description = computed(() => b.value ? b.value.info?.zh : (a.value.data as Poi).desc?.zh)
const position = computed(() => b.value?.center || (a.value.data as Poi).pos)
</script>

<template>
  <aside class="place-details">
    <header class="inspector-header"><span>地点详情</span><button class="icon-button" aria-label="关闭地点详情" @click="admin.selected = null"><Ico name="close" /></button></header>
    <div class="detail-scroll">
      <div class="detail-intro">
        <span class="detail-symbol" :style="{ color: category(a).color, background: `${category(a).color}12` }"><Ico :name="category(a).icon" /></span>
        <div class="detail-tags"><span>{{ a.kind === 'building' ? '建筑 / 区域' : '独立点位' }}</span><span>{{ category(a).zh }}</span></div>
        <h2>{{ a.data.name.zh }}</h2><p v-if="a.data.name.en" class="detail-english">{{ a.data.name.en }}</p>
        <button class="button primary full" :disabled="admin.offline" @click="edit(a)"><Ico name="edit" />编辑这个地点</button>
      </div>
      <dl class="detail-facts">
        <div><dt><Ico name="clock" />开放时间</dt><dd>{{ a.data.hours?.zh || '暂未填写' }}</dd></div>
        <div><dt><Ico name="book" />地点介绍</dt><dd>{{ description || '暂未填写，可在编辑中补充用途、服务或位置说明。' }}</dd></div>
        <template v-if="b">
          <div v-if="b.aliases.length"><dt>搜索别名</dt><dd>{{ b.aliases.join('、') }}</dd></div>
          <div v-if="b.orgs.length"><dt>入驻单位</dt><dd>{{ b.orgs.map((o) => o.zh).join('、') }}</dd></div>
          <div><dt><Ico name="entrance" />出入口</dt><dd v-if="b.entrances?.length" class="detail-entrances"><span v-for="(e, i) in b.entrances" :key="i"><i>{{ i + 1 }}</i>{{ e.zh || `入口 ${i + 1}` }}</span></dd><dd v-else>暂未标注入口</dd></div>
          <div><dt><Ico name="building" />建筑范围</dt><dd>{{ 1 + (b.parts?.length || 0) }} 个轮廓 · {{ b.poly.length + (b.parts?.reduce((n, p) => n + p.length, 0) || 0) }} 个顶点</dd></div>
        </template>
        <div><dt><Ico name="pin" />地图位置<button class="text-button" @click="mapControl.focus(a)">重新定位</button></dt><dd class="coordinate-text">{{ position.map((n) => n.toFixed(6)).join(', ') }}</dd></div>
      </dl>
    </div>
    <footer class="detail-footer"><span>修改后保存，前台刷新生效</span><button class="text-button danger" :disabled="admin.offline" @click="remove(a)"><Ico name="trash" />删除地点</button></footer>
  </aside>
</template>
