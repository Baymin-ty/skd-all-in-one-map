<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Ico from '../components/Ico.vue'
import AssetEditor from './AssetEditor.vue'
import type { Building } from '../lib/types'
import { admin, deleteVertex, discard, draftDirty, draftIssue, redoGeometry, remove, save, undoGeometry } from './store'

const root = ref<HTMLElement>()
const isNew = computed(() => !admin.draft!.data.id)
const continueAdding = ref(false)
function submit() { const next = continueAdding.value; continueAdding.value = false; void save(next) }
function submitNext() {
  const form = root.value?.querySelector<HTMLFormElement>('form')
  if (!form?.reportValidity()) return
  continueAdding.value = true; form.requestSubmit()
}
function keydown(event: KeyboardEvent) {
  if (admin.loginOpen || admin.deleteTarget || admin.saving || document.querySelector('dialog[open]')) return
  const typing = event.target instanceof HTMLElement && !!event.target.closest('input, textarea, select, [contenteditable="true"]')
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (isNew.value || draftDirty.value) root.value?.querySelector<HTMLFormElement>('form')?.requestSubmit()
  } else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); event.shiftKey ? redoGeometry() : undoGeometry()
  } else if (!typing && (event.key === 'Delete' || event.key === 'Backspace') && admin.selectedVertex !== null) {
    event.preventDefault(); deleteVertex()
  } else if (event.key === 'Escape') {
    admin.mode = ''; admin.selectedVertex = null
  } else if (!typing && event.key === 'Enter' && admin.mode === 'polygon') {
    event.preventDefault()
    const b = admin.draft?.data as Building
    if ((admin.outlinePart ? b.parts?.[admin.outlinePart - 1] : b.poly)!.length >= 3) admin.mode = 'vertices'
  }
}
onMounted(() => window.addEventListener('keydown', keydown))
onBeforeUnmount(() => window.removeEventListener('keydown', keydown))
</script>

<template>
  <aside ref="root" class="editor-workspace">
    <header class="inspector-header"><span>{{ isNew ? '新增' : '编辑' }}{{ admin.draft!.kind === 'building' ? '建筑 / 区域' : '点位' }}</span><span class="draft-state" :class="{ dirty: draftDirty || isNew }">{{ draftDirty || isNew ? '待保存' : '未修改' }}</span><button class="icon-button" aria-label="关闭编辑" :disabled="admin.saving" @click="discard"><Ico name="close" /></button></header>
    <AssetEditor @save="submit" />
    <footer class="editor-footer">
      <div class="save-hint" :class="{ ready: !draftIssue }"><Ico :name="draftIssue ? 'edit' : 'check'" /><span>{{ draftIssue || (draftDirty || isNew ? '信息已就绪，可以保存' : '修改信息或拖动地图标记') }}</span></div>
      <div class="editor-save-row"><button class="button secondary" :disabled="admin.saving" @click="discard">{{ draftDirty || isNew ? '取消' : '返回详情' }}</button><button class="button primary" type="submit" form="asset-edit-form" :disabled="admin.saving || (!isNew && !draftDirty)" title="保存（⌘ / Ctrl S）"><Ico name="check" />{{ admin.saving ? '保存中…' : isNew ? '保存地点' : '保存修改' }}</button></div>
      <button v-if="isNew" class="text-button full" :disabled="admin.saving" @click="submitNext">保存并继续新增<Ico name="plus" /></button>
      <div v-else class="editor-footer-meta"><span>⌘ / Ctrl S 快速保存</span><button class="text-button danger" :disabled="admin.saving" @click="remove(admin.draft!)"><Ico name="trash" />删除地点</button></div>
    </footer>
  </aside>
</template>
