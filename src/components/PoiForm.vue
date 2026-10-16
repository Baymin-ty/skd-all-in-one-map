<script setup lang="ts">
import { computed, ref } from 'vue'
import { deletePoi, POI_CATS, saveDraft, state, toast } from '../lib/store'
import type { PoiCat } from '../lib/types'
import Ico from './Ico.vue'

const saving = ref(false)
// 每次都从 state 取：换一个点位编辑、或连续新建时表单跟着换
const d = computed(() => state.draft!)
const cats = Object.entries(POI_CATS) as [PoiCat, (typeof POI_CATS)[PoiCat]][]

async function save() {
  if (!d.value.name.zh.trim()) return toast('先填名称')
  saving.value = true
  await saveDraft().catch((e) => toast(`保存失败：${e.message}`))
  saving.value = false
}
async function remove() {
  if (!confirm(`删除点位「${d.value.name.zh}」？`)) return
  await deletePoi(d.value.id).catch((e) => toast(`删除失败：${e.message}`))
}
</script>

<template>
  <div class="head">
    <h2 class="title">{{ d.id ? '编辑点位' : '新点位' }}</h2>
    <button type="button" class="close" aria-label="取消" @click="state.draft = null"><Ico name="close" /></button>
  </div>
  <form class="form" @submit.prevent="save">
    <label>名称<input v-model="d.name.zh" maxlength="40" required placeholder="例如：自助打印" /></label>
    <label>英文名<input v-model="d.name.en" maxlength="40" placeholder="可不填" /></label>
    <label>分类
      <select v-model="d.cat">
        <option v-for="[k, c] in cats" :key="k" :value="k">{{ c.zh }}</option>
      </select>
    </label>
    <label>介绍<textarea v-model="d.desc!.zh" maxlength="300" rows="2" placeholder="在哪、有什么" /></label>
    <label>开放时间<input v-model="d.hours!.zh" maxlength="60" placeholder="例如：8:00–20:00" /></label>
    <p class="muted">位置 {{ d.pos[0].toFixed(6) }}, {{ d.pos[1].toFixed(6) }} · 在地图上拖动点位调整</p>
    <div class="actions">
      <button class="act primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
      <button class="act" type="button" @click="state.draft = null">取消</button>
      <button v-if="d.id" class="act danger" type="button" @click="remove"><Ico name="trash" />删除</button>
    </div>
  </form>
</template>
