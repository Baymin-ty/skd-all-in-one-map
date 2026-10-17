<script setup lang="ts">
import { computed } from 'vue'
import Ico from '../components/Ico.vue'
import AdminMap from './AdminMap.vue'
import EditorWorkspace from './EditorWorkspace.vue'
import PlaceDetails from './PlaceDetails.vue'
import { admin, assets, category, categoryOptions, clearFilters, filtered, selectAsset, setKind, type Kind } from './store'

defineEmits<{ create: []; refresh: [] }>()
const filters: { kind: Kind | ''; label: string }[] = [{ kind: '', label: '全部' }, { kind: 'building', label: '建筑' }, { kind: 'poi', label: '点位' }]
const hasFilter = computed(() => !!(admin.search || admin.category || admin.kind))
const selectedHidden = computed(() => admin.selected && !filtered.value.some((a) => a.kind === admin.selected!.kind && a.data.id === admin.selected!.data.id))
</script>

<template>
  <section class="place-workspace" :class="{ 'has-inspector': admin.selected || admin.draft }" aria-label="地点编辑工作台">
    <aside class="asset-explorer">
      <div class="explorer-head">
        <div class="explorer-title"><h2>地点目录</h2><div class="explorer-actions"><button class="icon-button" title="刷新数据" aria-label="刷新数据" :disabled="admin.loading || admin.saving" @click="$emit('refresh')"><Ico name="refresh" /></button><button class="button primary" :disabled="admin.offline || admin.saving" aria-label="新增地点" @click="$emit('create')"><Ico name="plus" />新增</button></div></div>
        <div class="search-field"><Ico name="search" /><input v-model="admin.search" type="search" placeholder="搜索名称、简称或别名…" aria-label="搜索地点" /></div>
        <div class="kind-filters" aria-label="地点类型筛选">
          <button v-for="f in filters" :key="f.kind" :class="{ active: admin.kind === f.kind }" :aria-pressed="admin.kind === f.kind" @click="setKind(f.kind)">{{ f.label }}<span>{{ f.kind === 'building' ? admin.places.buildings.length : f.kind === 'poi' ? admin.places.pois.length : assets.length }}</span></button>
        </div>
        <select v-model="admin.category" aria-label="地点分类"><option value="">全部分类</option><option v-for="c in categoryOptions" :key="c.key" :value="c.key">{{ c.zh }}{{ !admin.kind ? ` · ${c.key.startsWith('poi:') ? '点位' : '建筑'}` : '' }}</option></select>
        <div class="explorer-result"><span>{{ hasFilter ? `找到 ${filtered.length} 个地点` : '选择地点，查看与修改' }}</span><button v-if="hasFilter" class="text-button" @click="clearFilters">清除筛选</button></div>
      </div>
      <div class="asset-list">
        <button v-for="a in filtered" :key="`${a.kind}:${a.data.id}`" :class="{ selected: admin.selected?.kind === a.kind && admin.selected?.data.id === a.data.id }" :aria-pressed="admin.selected?.kind === a.kind && admin.selected?.data.id === a.data.id" @click="selectAsset(a)">
          <span class="asset-icon" :style="{ color: category(a).color, background: `${category(a).color}12` }"><Ico :name="category(a).icon" /></span>
          <span class="asset-list-name"><b>{{ a.data.name.zh }}</b><small>{{ category(a).zh }}<span>·</span>{{ a.kind === 'building' ? '建筑' : '点位' }}</small></span><Ico name="chevron" />
        </button>
        <div v-if="!filtered.length" class="empty-state"><Ico name="search" /><b>没有找到匹配地点</b><p>换个关键词，或清除筛选再试试。</p><button class="button secondary" @click="clearFilters">显示全部地点</button></div>
      </div>
      <div class="explorer-footer"><Ico :name="admin.loggedIn ? 'check' : 'lock'" />{{ admin.loggedIn ? '已登录 · 可编辑校园地点' : '浏览无需登录，编辑时验证身份' }}</div>
    </aside>
    <AdminMap />
    <EditorWorkspace v-if="admin.draft" :key="admin.draftVersion" />
    <PlaceDetails v-else-if="admin.selected" />
    <div v-if="selectedHidden && !admin.draft" class="selection-outside"><span>当前地点不在筛选结果中</span><button class="text-button" @click="clearFilters">显示全部</button></div>
  </section>
</template>
