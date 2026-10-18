<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IconName } from '../lib/icons'
import Ico from '../components/Ico.vue'
import PlaceWorkspace from './PlaceWorkspace.vue'
import UndergroundWorkspace from './UndergroundWorkspace.vue'
import TimeMachineLauncher from './TimeMachineLauncher.vue'
import EventWorkspace from './EventWorkspace.vue'
import DishWorkspace from './DishWorkspace.vue'
import SystemPanel from './SystemPanel.vue'
import AccountDialog from '../components/AccountDialog.vue'
import { loadPipeline, pipeline } from './eventPipeline'
import { rainDirty } from './rainStore'
import {
  admin, cancelRemove, closeLogin, confirmRemove, create, draftDirty,
  load, loadUnderground, login, logout, navigate, notify,
  restore, setKind, undergroundDirty, VIEWS, type Kind, type View,
} from './store'

const nav: { view: View; views: View[]; label: string; icon: IconName; description: string }[] = [
  { view: 'overview', views: ['overview'], label: '地点管理', icon: 'pin', description: '查找地点，在地图上定位，随时修改信息与位置。' },
  { view: 'underground', views: ['underground'], label: '地下标注', icon: 'road', description: '标记地下道路（紫色）和出入口（红色），拖动调整，右键删除。' },
  { view: 'events', views: ['events'], label: '活动管理', icon: 'calendar', description: '整理官网与邮件抓取来的活动：修改、置顶、隐藏、审核，并管理同学讨论。' },
  { view: 'dishes', views: ['dishes'], label: '菜品管理', icon: 'dining', description: '按食堂维护菜单：菜名、价格规格、供应餐次、标签和售罄状态。' },
  { view: 'data', views: ['data'], label: '数据与备份', icon: 'chart', description: '服务运行状态、各类数据规模与关键配置，导出 JSON 副本。' },
]
const pendingReview = computed(() => pipeline.status?.review.pending ?? 0)
const current = computed(() => nav.find((n) => n.views.includes(admin.view)) || nav[0])
const mapPage = computed(() => admin.view === 'overview' || admin.view === 'underground')
const password = ref(''), loginError = ref(''), signingIn = ref(false)
const loginDialog = ref<HTMLDialogElement>(), deleteDialog = ref<HTMLDialogElement>(), createDialog = ref<HTMLDialogElement>()
const system = ref<InstanceType<typeof SystemPanel>>()
function startCreate(kind: Kind) { createDialog.value?.close(); create(kind) }
async function submitLogin() {
  if (signingIn.value) return
  signingIn.value = true; loginError.value = ''
  try { await login(password.value); password.value = '' }
  catch (e) { loginError.value = (e as Error).message }
  finally { signingIn.value = false }
}
function navigateAdmin(view: View) {
  if (admin.view === 'rain' && rainDirty.value && !confirm('避雨路网还未保存，放弃这些修改？')) return
  navigate(view)
}
async function refresh() {
  if (draftDirty.value || undergroundDirty.value || rainDirty.value || admin.saving || admin.undergroundSaving) return notify('请先保存或撤销当前修改')
  await load()
  if (admin.view === 'data') await system.value?.reload()
  notify(admin.error ? admin.error : admin.offline ? '服务未连接，当前显示离线数据' : '数据已更新')
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (draftDirty.value || undergroundDirty.value || rainDirty.value || admin.saving || admin.undergroundSaving) { e.preventDefault(); e.returnValue = '' }
}
function hashChange() {
  const hash = location.hash.slice(1)
  if (hash === 'buildings' || hash === 'pois') {
    navigate('overview'); setKind(hash === 'buildings' ? 'building' : 'poi')
  } else if ((VIEWS as string[]).includes(hash) && hash !== admin.view) navigate(hash as View)
  if (location.hash !== `#${admin.view}`) location.hash = admin.view
}
watch(() => admin.loginOpen, (value) => {
  if (value) { loginError.value = ''; loginDialog.value?.showModal() }
  else loginDialog.value?.close()
}, { flush: 'post' })
watch(() => admin.deleteTarget, (value) => { if (value) deleteDialog.value?.showModal(); else deleteDialog.value?.close() }, { flush: 'post' })
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload); window.addEventListener('hashchange', hashChange)
  await load(); await loadUnderground(); await restore(); void loadPipeline(true)
})
watch(() => admin.loggedIn, (value) => { if (value) void loadPipeline(true) })
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('hashchange', hashChange)
})
</script>

<template>
  <div class="admin-shell">
    <header class="app-header">
      <a href="/admin/" class="admin-brand"><span class="brand-mark"><Ico name="building" /></span><span>上科大一图通<small>地图管理工作台</small></span></a>
      <nav class="admin-nav" aria-label="管理导航">
        <button v-for="item in nav" :key="item.view" :class="{ active: item.views.includes(admin.view) }" :aria-current="item.views.includes(admin.view) ? 'page' : undefined" @click="!item.views.includes(admin.view) && navigateAdmin(item.view)"><Ico :name="item.icon" />{{ item.label }}<span v-if="item.view === 'events' && pendingReview" class="nav-badge" :title="`${pendingReview} 条活动待审核`">{{ pendingReview }}</span></button>
      </nav>
      <div class="header-links">
        <TimeMachineLauncher /><a href="/" target="_blank" rel="noopener">查看前台<Ico name="external" /></a>
        <span v-if="admin.ready && admin.offline" class="connection-state offline"><i />离线只读</span>
        <div v-if="admin.loggedIn" class="session-chip"><span><i />管理员已登录</span><button class="text-button" @click="logout">退出</button></div>
        <button v-else class="account-button login-cta" @click="admin.loginOpen = true"><Ico name="lock" />管理员登录</button>
      </div>
    </header>
    <main class="admin-main" :class="{ 'map-page': mapPage }">
      <header v-if="!mapPage" class="page-toolbar">
        <div><h1>{{ current.label }}</h1><p>{{ current.description }}</p></div>
        <div class="toolbar-actions">
          <button v-if="admin.view === 'data'" class="button secondary refresh-button" title="刷新数据" aria-label="刷新数据" :disabled="admin.loading || admin.saving" @click="refresh"><Ico name="refresh" /><span>刷新</span></button>
        </div>
      </header>
      <div v-if="admin.offline" class="offline-banner" role="status">数据服务未连接，当前为只读。<button class="text-button" @click="refresh">重新连接</button></div>
      <div v-if="admin.error" class="empty-state" role="alert"><h3>数据加载失败</h3><p>{{ admin.error }}</p><button class="button primary" @click="refresh">重试</button></div>
      <div v-else-if="!admin.ready" class="empty-state">正在加载校园地图…</div>
      <template v-else>
        <PlaceWorkspace v-if="admin.view === 'overview'" @create="createDialog?.showModal()" @refresh="refresh" />
        <UndergroundWorkspace v-else-if="admin.view === 'underground'" />
        <EventWorkspace v-else-if="admin.view === 'events'" />
        <DishWorkspace v-else-if="admin.view === 'dishes'" />
        <SystemPanel v-else ref="system" />
      </template>
    </main>
    <dialog ref="createDialog" class="admin-dialog create-dialog" aria-labelledby="create-title" @click="(e) => { if (e.target === createDialog) createDialog?.close() }">
      <button class="icon-button dialog-close" aria-label="关闭新增地点" @click="createDialog?.close()"><Ico name="close" /></button>
      <span class="dialog-eyebrow">添加到校园地图</span><h2 id="create-title">你想添加哪种地点？</h2><p>根据地点的形态选择，之后可以随时修改信息。</p>
      <div class="create-options">
        <button @click="startCreate('poi')"><span class="create-icon"><Ico name="pin" /></span><span><b>新增点位</b><small>快递柜、饮水机、停车点等设施</small><em>在地图上点一下，放置位置</em></span><Ico name="chevron" /></button>
        <button @click="startCreate('building')"><span class="create-icon building"><Ico name="building" /></span><span><b>新增建筑 / 区域</b><small>楼宇、运动场、校门、风雨长廊等</small><em>在地图上描绘范围，可标注出入口</em></span><Ico name="chevron" /></button>
      </div>
    </dialog>
    <dialog ref="loginDialog" class="admin-dialog login-dialog" aria-labelledby="login-title" @cancel.prevent="!signingIn && closeLogin()" @click="(e) => { if (e.target === loginDialog && !signingIn) closeLogin() }">
      <button class="icon-button dialog-close" aria-label="关闭登录" :disabled="signingIn" @click="closeLogin"><Ico name="close" /></button>
      <span class="dialog-eyebrow">校园地图管理</span><h2 id="login-title">管理员登录</h2><p>输入管理口令，登录后继续刚才的操作。</p>
      <form @submit.prevent="submitLogin"><label for="admin-password">管理口令</label><input id="admin-password" v-model="password" type="password" autocomplete="current-password" required :disabled="signingIn" autofocus /><p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p><button class="button primary full" :disabled="signingIn">{{ signingIn ? '验证中…' : '登录并继续' }}</button></form>
    </dialog>
    <dialog ref="deleteDialog" class="admin-dialog delete-dialog" aria-labelledby="delete-title" @cancel.prevent="cancelRemove" @click="(e) => { if (e.target === deleteDialog) cancelRemove() }">
      <template v-if="admin.deleteTarget">
        <span class="delete-symbol"><Ico name="trash" /></span><h2 id="delete-title">删除这个地点？</h2><p class="delete-name">{{ admin.deleteTarget.data.name.zh }}</p><p>删除后，该地点{{ admin.deleteTarget.kind === 'building' ? '及其轮廓、出入口' : '' }}将从校园地图移除。此操作无法撤销。</p>
        <p v-if="admin.deleteError" class="editor-error" role="alert">{{ admin.deleteError }}</p>
        <div class="dialog-actions"><button class="button secondary" :disabled="admin.saving" autofocus @click="cancelRemove">保留地点</button><button class="button destructive" :disabled="admin.saving" @click="confirmRemove">{{ admin.saving ? '删除中…' : '确认删除' }}</button></div>
      </template>
    </dialog>
    <div v-if="admin.notice" class="admin-toast" :class="admin.noticeTone" :role="admin.noticeTone === 'error' ? 'alert' : 'status'"><Ico :name="admin.noticeTone === 'error' ? 'close' : 'check'" />{{ admin.notice }}</div>
    <AccountDialog />
  </div>
</template>
