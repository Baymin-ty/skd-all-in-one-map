<script setup lang="ts">
import { computed } from 'vue'
import { DEFAULT_MAP_SETTINGS, validMapSettings, type MapSettings } from '../lib/mapSettings'
import { admin, saveMapSettings, settingsDirty } from './store'
import MapAppearancePreview from './MapAppearancePreview.vue'

const fields: { key: keyof MapSettings; label: string; detail: string }[] = [
  { key: 'background', label: '背景透明度', detail: '建筑轮廓之外的道路、绿地和底图背景。' },
  { key: 'selectable', label: '可选对象透明度', detail: '底图上未选中的建筑。地点标签保持实底，保证文字清晰。' },
  { key: 'selected', label: '选中对象透明度', detail: '底图上已选中或悬停的建筑、楼群。' },
]
const valid = computed(() => validMapSettings(admin.mapSettingsDraft))
const preview = computed(() => valid.value ? admin.mapSettingsDraft : admin.mapSettings)
function setValue(key: keyof MapSettings, event: Event) {
  const input = event.target as HTMLInputElement
  admin.mapSettingsDraft[key] = input.value === '' ? NaN : input.valueAsNumber / 100
}
function value(key: keyof MapSettings) {
  const n = admin.mapSettingsDraft[key]
  return Number.isFinite(n) ? Math.round(n * 100) : ''
}
</script>

<template>
  <div class="appearance-layout">
    <section class="data-card appearance-controls">
      <header><h2>三层透明度</h2><span class="count-tag">{{ !admin.settingsReady ? '尚未读取设置' : settingsDirty ? '有未保存的修改' : '当前已保存' }}</span></header>
      <p>0% 为完全透明，100% 为完全显示。调整后立即查看预览效果。</p>
      <form @submit.prevent="saveMapSettings">
        <fieldset :disabled="admin.settingsSaving">
          <div v-for="field in fields" :key="field.key" class="opacity-field">
            <div class="opacity-field-heading"><label :for="`opacity-${field.key}`">{{ field.label }}</label><div class="opacity-number"><input :id="`opacity-${field.key}`" type="number" min="0" max="100" step="1" required :value="value(field.key)" @input="setValue(field.key, $event)" /><span>%</span></div></div>
            <p>{{ field.detail }}</p>
            <input type="range" min="0" max="100" step="1" :aria-label="`${field.label}滑块`" :value="value(field.key)" @input="setValue(field.key, $event)" />
            <div class="opacity-scale"><span>透明 0%</span><span>清晰 100%</span></div>
          </div>
        </fieldset>
        <p class="appearance-note">边缘始终柔和羽化。悬停时与选中一样亮，点击才选中；悬停不切换详情，也不改变已选中的建筑。</p>
        <p v-if="!valid" role="alert" class="appearance-error">请输入 0–100 之间的整数百分比。</p>
        <p v-if="admin.settingsError" role="alert" class="appearance-error">{{ admin.settingsError }}</p>
        <div class="appearance-actions">
          <button type="button" class="button secondary" :disabled="admin.settingsSaving" @click="admin.mapSettingsDraft = { ...DEFAULT_MAP_SETTINGS }">恢复默认值</button>
          <button type="button" class="button subtle" :disabled="!settingsDirty || admin.settingsSaving" @click="admin.mapSettingsDraft = { ...admin.mapSettings }">撤销修改</button>
          <button type="submit" class="button primary full" :disabled="!valid || !settingsDirty || !admin.settingsReady || admin.offline || admin.settingsSaving">{{ admin.settingsSaving ? '保存中…' : admin.loggedIn ? '保存显示设置' : '登录以保存' }}</button>
        </div>
        <small>保存后刷新前台地图即可生效；恢复默认值也需要保存。</small>
      </form>
    </section>
    <section class="data-card appearance-preview">
      <header class="section-heading"><div><span class="section-indicator" /><h2>实时预览</h2></div><span class="count-tag">{{ settingsDirty ? '未保存的预览' : '当前效果' }}</span></header>
      <MapAppearancePreview :settings="preview" />
      <footer>预览使用真实地图与相同的边缘羽化效果，可悬停查看高亮，点击比较选中前后。</footer>
    </section>
  </div>
</template>

<style scoped>
.appearance-layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 20px; align-items: start; }
.appearance-controls { padding: 24px; }
.appearance-controls>header { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.appearance-controls>p { margin: 10px 0 24px; color: var(--muted); font-size: 12px; line-height: 1.8; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.opacity-field + .opacity-field { margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--line); }
.opacity-field-heading { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.opacity-field label { font-size: 13px; font-weight: 600; }
.opacity-number { display: flex; align-items: center; gap: 5px; font-size: 12px; }
.opacity-number input { width: 67px; padding: 6px 7px; font-variant-numeric: tabular-nums; }
.opacity-field p { font-size: 11px; color: var(--muted); margin: 8px 0 14px; line-height: 1.7; }
.opacity-field input[type=range] { width: 100%; margin: 0; padding: 0; accent-color: #557949; cursor: pointer; box-shadow: none; }
.opacity-scale { display: flex; justify-content: space-between; font-size: 9px; color: var(--muted); }
.appearance-note { margin: 25px 0 16px; padding: 10px 12px; font-size: 11px; background: #f2f6ed; color: #657853; border-radius: 6px; line-height: 1.8; }
.appearance-error { font-size: 12px; color: #b3261e; margin: 12px 0; }
.appearance-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.appearance-actions .full { margin-top: 4px; }
.appearance-controls small { display: block; color: var(--muted); font-size: 10px; margin-top: 12px; line-height: 1.8; }
.appearance-preview footer { padding: 14px 20px; color: var(--muted); border-top: 1px solid var(--line); font-size: 11px; }
@media (min-width: 701px) and (max-width: 1100px) {
  .appearance-layout { grid-template-columns: 260px minmax(0, 1fr); gap: 14px; }
  .appearance-controls { padding: 18px; }
  .appearance-controls>header { flex-wrap: wrap; }
}
@media (max-width: 700px) {
  .appearance-layout { grid-template-columns: 1fr; }
  .appearance-controls { padding: 20px; }
  .appearance-preview { grid-row: 1; }
}
</style>
