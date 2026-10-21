<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addOutlinePart, admin, draftOutline, entranceDirection, locateEntrance, mapControl, redrawOutline, removeEntrance, removeOutlinePart, setMode, setPosition, toggleEntranceMode } from './store'
import { POI_CATS, POI_KINDS } from '../lib/catalog'
import type { Building, LngLat, Poi } from '../lib/types'
import Ico from '../components/Ico.vue'

const emit = defineEmits<{ save: [] }>()
const nameInput = ref<HTMLInputElement>()
onMounted(() => nameInput.value?.focus({ preventScroll: true }))
const d = computed(() => admin.draft!)
const b = computed(() => d.value.kind === 'building' ? d.value.data as Building : null)
const p = computed(() => d.value.kind === 'poi' ? d.value.data as Poi : null)
const aliases = ref(d.value.data.aliases?.join('、') || '')
const orgs = ref(b.value?.orgs.map((o) => o.zh).join('、') || '')
const originalOrgs = b.value?.orgs || []
const split = (value: string) => value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean)
watch(aliases, (value) => { d.value.data.aliases = split(value) })
watch(orgs, (value) => {
  if (b.value) b.value.orgs = split(value).map((zh) => ({ zh, en: originalOrgs.find((o) => o.zh === zh)?.en || '' }))
})
// 车库设施细分只属于停车点位，换分类时清掉；用 null 才能覆盖服务器上原记录的细分
watch(() => p.value?.cat, (cat) => { if (p.value?.kind && cat !== 'parking') p.value.kind = null })
const position = computed(() => p.value ? p.value.pos : b.value!.center)
function changeCoordinate(axis: 0 | 1, event: Event) {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  const bounds = admin.campus!.bounds
  if (!Number.isFinite(value) || value < bounds[0][axis] || value > bounds[1][axis]) {
    admin.editError = '坐标应在校园地图范围内'
    input.value = String(position.value[axis])
    return
  }
  const point: LngLat = [...position.value]
  point[axis] = +value.toFixed(6)
  setPosition(point)
  admin.mode = ''
}
function focus() { mapControl.focus(d.value) }
const ENTRANCE_NAME_SUGGESTIONS = ['主入口', '次入口', '北门', '南门', '东门', '西门', '侧门', '货梯口']
const entranceList = ref<HTMLElement>()
const direction = (pos: LngLat) => b.value ? entranceDirection(b.value, pos) : ''
function selectEntrance(index: number) { admin.selectedEntrance = index }
function locate(index: number) {
  const entrance = b.value?.entrances?.[index]
  if (!entrance) return
  admin.selectedEntrance = index
  mapControl.focusEntrance(entrance.pos)
}
function relocate(index: number) { locate(index); locateEntrance(index) }
// 在地图上点选入口时，把列表里对应的一行滚进视野
watch(() => admin.selectedEntrance, (index) => {
  if (index === null) return
  void nextTick(() => (entranceList.value?.children[index] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
})
</script>

<template>
  <div class="asset-editor">
    <div v-if="admin.editError" class="editor-error" role="alert">{{ admin.editError }}</div>
    <form id="asset-edit-form" class="asset-form" @submit.prevent="emit('save')">
      <fieldset :disabled="admin.saving">
        <section class="editor-section editor-basics">
          <h3 class="editor-section-title"><span>01</span>基本信息</h3>
          <label>地点名称 <em>*</em><input ref="nameInput" v-model="d.data.name.zh" required maxlength="120" :placeholder="b ? '例如：学生服务中心' : '例如：图书馆北门饮水机'" /></label>
          <div class="field-pair">
            <label>分类
              <select v-model="d.data.cat">
                <template v-if="b"><option v-for="(c, key) in admin.places.categories" :key="key" :value="key">{{ c.zh }}</option></template>
                <template v-else><option v-for="(c, key) in POI_CATS" :key="key" :value="key">{{ c.zh }}</option></template>
              </select>
            </label>
            <label v-if="b">地图简称<input v-model="b.short.zh" maxlength="40" placeholder="默认使用名称" /></label>
            <label v-else-if="d.data.cat === 'parking'">车库设施
              <select v-model="p!.kind">
                <option :value="null">不细分</option>
                <option v-for="(k, key) in POI_KINDS" :key="key" :value="key">{{ k.zh }}</option>
              </select>
            </label>
          </div>

        </section>

        <section class="editor-section">
          <div class="section-title"><h3 class="editor-section-title"><span>02</span>{{ b ? '建筑范围' : '地图位置' }}<em>*</em></h3><button class="text-button" type="button" :disabled="!admin.positionSet && !!p" @click="focus"><Ico name="target" />定位</button></div>
          <template v-if="b">
            <label v-if="b.parts?.length">当前轮廓<select v-model="admin.outlinePart" @change="admin.selectedVertex = null"><option :value="0">主体</option><option v-for="(_, i) in b.parts" :key="i" :value="i + 1">附属部分 {{ i + 1 }}</option></select></label>
            <p class="field-help">{{ draftOutline.length < 3 ? '在地图上依次点击，描出建筑边界，至少选 3 个点。' : '拖动白色方点调整边界；点击边上圆点加点，选中顶点后可删除。' }}</p>
            <div class="geometry-summary"><Ico name="building" /><span>{{ draftOutline.length }} 个顶点</span><b>{{ draftOutline.length >= 3 ? '已绘制' : '待绘制' }}</b></div>
            <div class="button-row">
              <button class="button secondary" :class="{ active: admin.mode === 'vertices' || admin.mode === 'polygon' }" type="button" @click="setMode(draftOutline.length < 3 ? 'polygon' : 'vertices')"><Ico name="edit" />{{ draftOutline.length < 3 ? '画轮廓' : '调整轮廓' }}</button>
              <button v-if="draftOutline.length" class="text-button" type="button" @click="redrawOutline">重新画</button>
            </div>
            <div class="outline-extra"><button class="text-button" type="button" @click="addOutlinePart"><Ico name="plus" />添加附属轮廓</button><button v-if="admin.outlinePart" class="text-button danger" type="button" @click="removeOutlinePart">删除此轮廓</button></div>
          </template>
          <template v-else>
            <div class="position-status" :class="{ placed: admin.positionSet }"><Ico :name="admin.positionSet ? 'check' : 'pin'" />{{ admin.positionSet ? '已标记位置' : '等待在地图上放置' }}</div>
            <p class="field-help">{{ admin.positionSet ? '拖动地图上的标记即可调整位置。' : '在左侧地图点击目标位置，也可以展开下方精确坐标手动填写。' }}</p>
            <button class="button secondary full" :class="{ active: admin.mode === 'position' }" type="button" @click="setMode('position')"><Ico name="pin" />{{ admin.mode === 'position' ? '正在地图上选位置…' : admin.positionSet ? '重新选择位置' : '在地图上选位置' }}</button>
          </template>
        </section>

        <section v-if="b" class="editor-section entrance-section">
          <div class="section-title">
            <h3 class="editor-section-title"><span>03</span><Ico name="entrance" />出入口<small v-if="b.entrances?.length">{{ b.entrances.length }} 个</small></h3>
            <button class="button secondary entrance-add" :class="{ active: admin.mode === 'entrance' && admin.entranceTarget === null }" type="button" :disabled="admin.saving" @click="toggleEntranceMode"><Ico :name="admin.mode === 'entrance' && admin.entranceTarget === null ? 'check' : 'plus'" />{{ admin.mode === 'entrance' && admin.entranceTarget === null ? '完成标注' : b.entrances?.length ? '继续添加' : '标注出入口' }}</button>
          </div>
          <p v-if="admin.mode === 'entrance'" class="field-help entrance-help">
            <template v-if="admin.entranceTarget !== null">点击地图上的新位置，把第 {{ admin.entranceTarget + 1 }} 个入口移过去。按 Esc 取消。</template>
            <template v-else>点击地图上的楼门即可添加，可以连续标注多个；靠近轮廓时会自动贴到墙边。按 Esc 或「完成标注」结束。</template>
          </p>
          <div v-if="!b.entrances?.length && admin.mode !== 'entrance'" class="entrance-empty">
            <span class="entrance-empty-icon"><Ico name="entrance" /></span>
            <p><b>还没有标注出入口</b><span>标好后，导航会把同学直接带到楼门口。</span></p>
            <button class="button primary" type="button" :disabled="admin.saving" @click="toggleEntranceMode"><Ico name="plus" />开始标注</button>
          </div>
          <template v-else>
            <ul ref="entranceList" class="entrance-list">
              <li v-for="(e, i) in b.entrances" :key="i" class="entrance-row" :class="{ active: admin.selectedEntrance === i, targeting: admin.entranceTarget === i }" @click="selectEntrance(i)">
                <button class="entrance-number" type="button" :title="`在地图上定位入口 ${i + 1}`" :aria-label="`在地图上定位入口 ${i + 1}`" @click.stop="locate(i)">{{ i + 1 }}</button>
                <div class="entrance-main">
                  <input v-model="e.zh" :disabled="admin.saving" list="entrance-name-options" maxlength="60" :placeholder="`入口名称，如${direction(e.pos)}入口`" :aria-label="`入口 ${i + 1} 名称`" @focus="selectEntrance(i)" />
                  <span class="entrance-meta">{{ direction(e.pos) }}<template v-if="admin.entranceTarget === i"> · 等待在地图上点选新位置</template></span>
                </div>
                <button class="icon-button" type="button" :disabled="admin.saving" :title="`把入口 ${i + 1} 移到地图上的新位置`" :aria-label="`重新定位入口 ${i + 1}`" @click.stop="relocate(i)"><Ico name="target" /></button>
                <button class="icon-button danger" type="button" :disabled="admin.saving" :aria-label="`删除入口 ${i + 1}`" @click.stop="removeEntrance(i)"><Ico name="close" /></button>
              </li>
            </ul>
            <datalist id="entrance-name-options"><option v-for="name in ENTRANCE_NAME_SUGGESTIONS" :key="name" :value="name" /></datalist>
            <p class="field-help">点编号可在地图上定位；拖动地图上的编号能微调位置；选中一行后按 ⌫ 删除。</p>
          </template>
        </section>

        <section class="editor-section">
          <h3 class="editor-section-title"><span>{{ b ? '04' : '03' }}</span>补充信息<small>选填</small></h3>
          <label>开放时间<input v-model="d.data.hours!.zh" maxlength="120" placeholder="例如 08:00–22:00，可不填" /></label>
          <label>介绍
            <textarea v-if="b" v-model="b.info!.zh" rows="3" maxlength="2000" placeholder="填写建筑用途、位置说明等" />
            <textarea v-else v-model="p!.desc!.zh" rows="3" maxlength="2000" placeholder="填写服务内容、位置说明等" />
          </label>
        </section>
        <details class="editor-section editor-more">
          <summary>搜索别名与更多信息</summary>
          <label>搜索别名<input v-model="aliases" placeholder="多个别名用顿号分隔" /></label>
          <label>英文名称<input v-model="d.data.name.en" maxlength="120" /></label>
          <template v-if="b">
            <label>英文简称<input v-model="b.short.en" maxlength="60" /></label>
            <label>入驻单位<input v-model="orgs" placeholder="多个单位用顿号分隔" /></label>
            <label>备注<textarea v-model="b.note!.zh" rows="2" maxlength="2000" /></label>
            <div class="check-row"><label><input v-model="b.isNew" type="checkbox" />新建建筑</label></div>
          </template>
          <label v-else>数据来源<input v-model="p!.source" maxlength="100" /></label>
        </details>
        <details class="editor-section editor-more">
          <summary>{{ b ? '名称标签位置与精确坐标' : '精确坐标（手动输入）' }}</summary><p class="field-help">经度在前，纬度在后。坐标使用校园底图的 BD-09 坐标系。</p>
          <div class="field-pair">
            <label>经度<input :value="position[0]" type="number" step="any" @change="changeCoordinate(0, $event)" /></label>
            <label>纬度<input :value="position[1]" type="number" step="any" @change="changeCoordinate(1, $event)" /></label>
          </div>
          <button v-if="b" class="button secondary full" type="button" @click="setMode('position')">在地图上放置名称标签</button>
        </details>
      </fieldset>
    </form>
  </div>
</template>
