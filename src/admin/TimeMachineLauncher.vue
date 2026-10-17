<script setup lang="ts">
import { computed, ref } from 'vue'
import Ico from '../components/Ico.vue'
import { clockText, dateKey, nowTick } from '../lib/campusTime'
import { buildLink } from '../lib/deepLink'
import { discovery, loadDiscovery } from '../lib/discoveryData'
import { busiestWindow, eventsInWindow, floorHour, isLong, WINDOW_HOURS, windowLabel, windowStart } from '../lib/timeMachine'
import { notify } from './store'

/** 后台入口：选好 48 小时窗口，在新标签页打开前台全屏播放（比赛展示用） */
type Mode = 'best' | 'now' | 'custom'
const dialog = ref<HTMLDialogElement>()
const mode = ref<Mode>('best')
const custom = ref('')

const best = computed(() => busiestWindow(discovery.events))
const count = (from: number | null) => from === null ? 0 : eventsInWindow(discovery.events, from).filter((e) => !isLong(e)).length
const options = computed(() => {
  const now = floorHour(nowTick.value)
  return [
    { mode: 'best' as const, title: '活动最多的 48 小时', from: best.value, hint: '推荐比赛演示使用' },
    { mode: 'now' as const, title: '从现在开始', from: now, hint: '接下来两天的真实活动' },
  ]
})
/** 指定时间按校园时间（UTC+8）理解，和前台一致；没改过时跟着「活动最多」的起点 */
const customValue = computed({
  get: () => {
    if (custom.value) return custom.value
    const from = best.value ?? floorHour(nowTick.value)
    return `${dateKey(from)}T${clockText(from)}`
  },
  set: (value: string) => { custom.value = value },
})
const customFrom = computed(() => windowStart(customValue.value, discovery.events, nowTick.value))
const start = computed(() => mode.value === 'best' ? 'best' : mode.value === 'now' ? 'now' : customValue.value)
const url = computed(() => buildLink({ kind: 'timemachine', start: start.value }, `${location.origin}/`))
const selectedCount = computed(() => count(mode.value === 'best' ? best.value : mode.value === 'now' ? options.value[1].from : customFrom.value))

function open() {
  nowTick.value = Date.now()
  if (!discovery.events.length && !discovery.eventsLoading) void loadDiscovery('events')
  dialog.value?.showModal()
}
function play() {
  window.open(url.value, '_blank', 'noopener')
  dialog.value?.close()
}
async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
    notify('已复制时光机链接')
  } catch {
    notify('复制失败，请手动复制链接')
  }
}
</script>

<template>
  <button type="button" class="account-button time-machine-entry" @click="open"><Ico name="history" />活动时光机</button>
  <dialog ref="dialog" class="admin-dialog time-machine-dialog" aria-labelledby="time-machine-title" @click="(e) => { if (e.target === dialog) dialog?.close() }">
    <button type="button" class="icon-button dialog-close" aria-label="关闭活动时光机" @click="dialog?.close()"><Ico name="close" /></button>
    <span class="dialog-eyebrow">比赛展示</span>
    <h2 id="time-machine-title">活动时光机</h2>
    <p>在前台地图上全屏自动播放 {{ WINDOW_HOURS }} 小时内的活动：越临近开始越醒目，活动开始时镜头跟过去，底图按时间昼夜变化。</p>
    <p v-if="discovery.eventsLoading" class="time-machine-status" role="status">活动加载中…</p>
    <p v-else-if="discovery.eventsError" class="editor-error" role="alert">{{ discovery.eventsError }} <button type="button" class="text-button" @click="loadDiscovery('events')">重试</button></p>
    <div class="time-machine-options" role="radiogroup" aria-label="播放的时间段">
      <label v-for="o in options" :key="o.mode" :class="{ active: mode === o.mode }">
        <input v-model="mode" type="radio" name="time-machine-window" :value="o.mode" />
        <span><b>{{ o.title }}</b><small>{{ o.from === null ? '暂无活动数据' : windowLabel(o.from) }} · {{ o.hint }}</small></span>
        <em>{{ count(o.from) }} 场</em>
      </label>
      <label :class="{ active: mode === 'custom' }">
        <input v-model="mode" type="radio" name="time-machine-window" value="custom" />
        <span><b>指定开始时间</b><small>校园时间（北京时间）</small>
          <input v-model="customValue" type="datetime-local" class="time-machine-date" aria-label="开始时间" @focus="mode = 'custom'" />
        </span>
        <em>{{ count(customFrom) }} 场</em>
      </label>
    </div>
    <p class="time-machine-keys">播放页：空格暂停，← → 前后 10 分钟，Esc 退出；右下角可全屏或扫码在手机上看。</p>
    <div class="dialog-actions">
      <button type="button" class="button secondary" @click="copy"><Ico name="external" />复制链接</button>
      <button type="button" class="button primary" :disabled="!selectedCount && !discovery.eventsLoading" @click="play"><Ico name="play" />开始播放</button>
    </div>
  </dialog>
</template>
