<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { allMapLabels, MAP_LABEL_CATEGORIES, type MapLabelCategory, type MapLabelVisibility } from '../lib/mapLabelCategories'
import Ico from './Ico.vue'
import { setMapLabel, setMapLabels } from '../lib/mapPrefs'
import { setRouteNetwork, state } from '../lib/store'
import { setUserData } from '../lib/userData'

const props = defineProps<{ modelValue: MapLabelVisibility }>()
const emit = defineEmits<{ 'update:modelValue': [value: MapLabelVisibility]; layout: [] }>()
const root = ref<HTMLDivElement>()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
const enabled = computed(() => MAP_LABEL_CATEGORIES.filter((c) => props.modelValue[c.id]))
const hidden = computed(() => MAP_LABEL_CATEGORIES.filter((c) => !props.modelValue[c.id]))
/** 直接说出藏了哪几类，不让人去数「几类显示几类隐藏」 */
const summary = computed(() => {
  const names = (list: typeof hidden.value) => list.map((c) => c.name).join('、')
  if (!hidden.value.length) return '全部类型已显示'
  if (!enabled.value.length) return '全部类型已隐藏'
  if (hidden.value.length <= 2) return `已隐藏 ${names(hidden.value)}`
  if (enabled.value.length <= 2) return `只显示 ${names(enabled.value)}`
  return `${enabled.value.length} 类显示 · ${hidden.value.length} 类隐藏`
})

function toggle(category: MapLabelCategory) {
  emit('update:modelValue', { ...props.modelValue, [category]: !props.modelValue[category] })
  state.mapPrefs = setMapLabel(state.mapPrefs, state.mapPrefs.mode, category, !props.modelValue[category])
  setUserData('map', state.mapPrefs)
}
function setLabels(value: MapLabelVisibility) {
  emit('update:modelValue', value)
  state.mapPrefs = setMapLabels(state.mapPrefs, state.mapPrefs.mode, value)
  setUserData('map', state.mapPrefs)
}
function close() { open.value = false; trigger.value?.focus() }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
watch(open, () => emit('layout'), { flush: 'post' })
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="label-picker" :class="{ open }" @keydown.esc.stop.prevent="close">
    <button ref="trigger" type="button" class="fab picker-trigger" :class="{ on: open }" :aria-expanded="open" aria-controls="map-label-options" aria-label="地图图层与标签" title="图层与标签" @click="open = !open">
      <Ico name="grid" /><i v-if="hidden.length" class="picker-dot" aria-hidden="true" />
    </button>
      <div v-if="open" id="map-label-options" class="picker-panel" role="group" aria-label="显示或隐藏地图标签">
      <div class="panel-head"><b>图层与标签<em>{{ state.mapPrefs.mode === 'mine' ? '我的地图' : '全校地图' }}</em></b><small>{{ summary }}</small><button type="button" class="panel-close" aria-label="关闭" @click="close"><Ico name="close" /></button></div>
      <div class="picker-actions"><span>显示哪些标签</span><button type="button" :disabled="enabled.length === MAP_LABEL_CATEGORIES.length" @click="setLabels(allMapLabels(true))">全部显示</button><button type="button" :disabled="!enabled.length" @click="setLabels(allMapLabels(false))">全部隐藏</button></div>
      <div class="picker-grid">
        <button v-for="category in MAP_LABEL_CATEGORIES" :key="category.id" type="button" role="switch" class="type-toggle" :class="{ enabled: modelValue[category.id] }" :style="{ '--type-color': category.color }" :aria-checked="modelValue[category.id]" :aria-label="`${category.name}标签`" :title="`${modelValue[category.id] ? '隐藏' : '显示'}${category.name}标签`" @click="toggle(category.id)">
          <span class="type-icon"><Ico :name="category.icon" /></span><span>{{ category.name }}</span><span class="type-check"><Ico :name="modelValue[category.id] ? 'check' : 'minus'" /></span>
        </button>
      </div>
      <button type="button" role="switch" class="road-toggle" :aria-checked="state.showRoads" @click="state.showRoads = !state.showRoads"><Ico name="road" /><span class="grow">显示统一地面路网</span><span class="switch" :class="{ on: state.showRoads }" /></button>
      <button v-if="state.underground" type="button" class="road-toggle underground-toggle" @click="setRouteNetwork('underground')"><Ico name="stairs" /><span class="grow">打开地下标注窗口</span><Ico name="chevron" /></button>
      <ul class="picker-notes">
        <li>颜色和图标与地图上的标签一致，可当图例看。</li>
        <li>隐藏的类型在选中、筛选或悬停时仍会显示。</li>
        <li>活动挂在举办地点名称下方；打开活动雷达时总会显示。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.label-picker { position: relative; }
.picker-trigger { position: relative; }
.picker-dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: var(--brand); }
.fab.on .picker-dot { border-color: var(--ink); }
.picker-panel { position: absolute; right: 54px; bottom: 0; width: 310px; max-width: calc(100vw - 80px); max-height: calc(100dvh - 180px); overflow-y: auto; padding: 4px 12px 12px; border-radius: 16px; background: #fff; box-shadow: 0 10px 32px #263b2e2e, 0 0 0 1px #0000000a; }
.panel-head { position: relative; padding: 10px 30px 4px 2px; }
.panel-head b { display: block; font-size: 14px; }
.panel-head small { display: block; margin-top: 2px; color: var(--ink-3); font-size: 11px; }
.panel-close { position: absolute; top: 8px; right: -4px; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--bg-2); color: var(--ink-2); font-size: 14px; cursor: pointer; }
.panel-head b em { margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: var(--bg-2); color: var(--ink-2); font-size: 10.5px; font-style: normal; font-weight: 600; }
.picker-actions { display: flex; align-items: center; gap: 10px; padding: 11px 0 8px; font-size: 11px; }.picker-actions > span { flex: 1; color: #7c877f; }.picker-actions button { border: 0; padding: 3px 0; background: none; color: var(--blue); font-size: 11px; cursor: pointer; }.picker-actions button:disabled { color: #b2b9b3; cursor: default; }
.picker-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.type-toggle { position: relative; min-height: 62px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 7px; padding: 10px; border: 1px solid #e7eae5; border-radius: 10px; background: #f7f8f5; color: #909a93; font-size: 11.5px; cursor: pointer; transition: background-color 150ms, border-color 150ms; }
.type-toggle.enabled { border-color: color-mix(in srgb, var(--type-color) 38%, #fff); background: color-mix(in srgb, var(--type-color) 14%, #fff); color: color-mix(in srgb, var(--type-color) 75%, #1f3027); }
.type-icon { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: #e3e7e2; color: #a0a8a2; font-size: 14px; }.enabled .type-icon { background: var(--type-color); color: #fff; }.type-check { position: absolute; top: 9px; right: 8px; width: 14px; height: 14px; display: grid; place-items: center; border-radius: 50%; background: #e7ebe5; color: #9ca59e; font-size: 9px; }.enabled .type-check { background: var(--type-color); color: #fff; }
.road-toggle { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 10px; padding: 10px; border: 1px solid #e7eae5; border-radius: 10px; background: #fff; font-size: 13px; text-align: left; cursor: pointer; }
.road-toggle > .svgi { font-size: 17px; color: var(--ink-2); }
.underground-toggle > .svgi { color: #b47a22; }
.switch { position: relative; flex: none; width: 34px; height: 20px; border-radius: 999px; background: #d9dcd8; transition: background-color 150ms; }
.switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0003; transition: transform 150ms; }
.switch.on { background: var(--green); }.switch.on::after { transform: translateX(14px); }
.picker-notes { margin: 11px 0 0; padding: 0 0 0 14px; color: #8a958d; font-size: 10.5px; line-height: 1.7; }
.label-picker button:focus-visible { outline: 2px solid var(--blue); outline-offset: -3px; }
@media (hover: hover) { .type-toggle:hover { border-color: var(--type-color); } .road-toggle:hover { background: #fafbf8; } }
@media (prefers-reduced-motion: reduce) { .type-toggle, .switch, .switch::after { transition: none; } }
</style>
