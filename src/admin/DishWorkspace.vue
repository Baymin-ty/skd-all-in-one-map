<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import Ico from '../components/Ico.vue'
import { MEAL_LABELS } from '../lib/campusTime'
import { TAG_LABELS } from '../lib/menu'
import type { Canteen, Dish, Meal } from '../lib/discoveryTypes'
import { authorized, leaveGuards, notify } from './store'
import { createDish, fetchCanteens, removeDish, updateDish } from './adminApi'

// 菜品管理：按食堂 → 楼层 / 窗口 → 档口浏览菜单，修改菜名、价格规格、供应餐次、标签和售罄状态。
type Spec = { zh: string; en: string; price: number | null }
type Draft = { stall: string; zh: string; en: string; groupZh: string; groupEn: string; price: number | null; specs: Spec[]; unit: string; meals: Meal[]; tags: string[]; descZh: string; descEn: string; photo: string; soldOut: boolean; sample: boolean; verify: string }
const canteens = ref<Canteen[]>([]), loading = ref(false), loadError = ref('')
const pick = reactive({ canteen: '', outlet: '', stall: '', q: '', filter: '' })
const selectedId = ref(''), creating = ref(false)
const draft = ref<Draft | null>(null), baseline = ref('')
const saving = ref(false), error = ref(''), busy = ref('')

const canteen = computed(() => canteens.value.find((c) => c.id === pick.canteen) ?? canteens.value[0] ?? null)
const outlet = computed(() => canteen.value?.outlets.find((o) => o.id === pick.outlet) ?? canteen.value?.outlets[0] ?? null)
const dishCount = (c: Canteen) => c.outlets.reduce((n, o) => n + o.dishes.length, 0)
const stalls = computed(() => outlet.value?.stalls.map((s) => ({ ...s, count: outlet.value!.dishes.filter((d) => d.stall === s.zh).length })) ?? [])
const dishes = computed(() => {
  const q = pick.q.trim().toLowerCase()
  return (outlet.value?.dishes ?? []).filter((d) => {
    if (pick.stall && d.stall !== pick.stall) return false
    if (pick.filter === 'soldOut' && !d.soldOut) return false
    if (pick.filter === 'photo' && !d.photo) return false
    if (pick.filter === 'verify' && !d.verify) return false
    if (pick.filter === 'weekly' && !d.days) return false
    return !q || [d.zh, d.en, d.group?.zh, d.stall, ...(d.tags ?? []).map((t) => TAG_LABELS[t] ?? t)].join(' ').toLowerCase().includes(q)
  })
})
const groups = computed(() => {
  const map = new Map<string, Dish[]>()
  for (const d of dishes.value) {
    const key = `${pick.stall ? '' : d.stall ? `${d.stall} · ` : ''}${d.group?.zh ?? '未分组'}`
    map.set(key, [...(map.get(key) ?? []), d])
  }
  return [...map]
})
const selected = computed(() => outlet.value?.dishes.find((d) => d.id === selectedId.value) ?? null)
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
const weekDays = computed(() => Object.keys(selected.value?.days ?? {}).sort())

async function load() {
  loading.value = true; loadError.value = ''
  try {
    canteens.value = (await fetchCanteens()).canteens
    if (!pick.canteen) pick.canteen = canteens.value[0]?.id ?? ''
  } catch (e) { loadError.value = (e as Error).message }
  finally { loading.value = false }
}
const price = (d: Dish) => d.specs?.length ? d.specs.map((s) => `${s.zh} ${s.price ?? '—'}`).join(' / ') : d.price != null ? `¥${d.price}` : '—'
function draftFrom(d: Partial<Dish>): Draft {
  return {
    stall: d.stall || pick.stall || stalls.value[0]?.zh || '', zh: d.zh ?? '', en: d.en ?? '', groupZh: d.group?.zh ?? '', groupEn: d.group?.en ?? '',
    price: d.price ?? null, specs: (d.specs ?? []).map((s) => ({ zh: s.zh, en: s.en ?? '', price: s.price })), unit: d.unit ?? '',
    meals: [...(d.meals ?? [])], tags: [...(d.tags ?? [])], descZh: d.desc?.zh ?? '', descEn: d.desc?.en ?? '', photo: d.photo ?? '',
    soldOut: !!d.soldOut, sample: !!d.sample, verify: d.verify ?? '',
  }
}
function confirmLeave() { return !dirty.value || confirm('菜品修改还未保存，放弃这些修改？') }
function open(d: Dish) {
  if (d.id === selectedId.value && !creating.value) return
  if (!confirmLeave()) return
  creating.value = false; selectedId.value = d.id
  draft.value = draftFrom(d); baseline.value = JSON.stringify(draft.value); error.value = ''
}
function startCreate() {
  if (!authorized() || !confirmLeave()) return
  creating.value = true; selectedId.value = ''
  draft.value = draftFrom({ stall: pick.stall || stalls.value[0]?.zh, group: groups.value.length && pick.stall ? dishes.value.at(-1)?.group : undefined })
  baseline.value = JSON.stringify(draft.value); error.value = ''
}
function close() { if (confirmLeave()) { creating.value = false; selectedId.value = ''; draft.value = null } }
function choose(key: 'canteen' | 'outlet' | 'stall', value: string) {
  if (pick[key] === value || !confirmLeave()) return
  pick[key] = value
  if (key === 'canteen') { pick.outlet = ''; pick.stall = '' }
  if (key === 'outlet') pick.stall = ''
  creating.value = false; selectedId.value = ''; draft.value = null
}
function body(d: Draft): Partial<Dish> {
  return {
    stall: d.stall, zh: d.zh, en: d.en, group: { zh: d.groupZh, en: d.groupEn }, price: d.price,
    specs: d.specs.filter((s) => s.zh.trim()).map((s) => ({ zh: s.zh, en: s.en, price: s.price })), unit: d.unit, meals: d.meals, tags: d.tags,
    desc: { zh: d.descZh, en: d.descEn }, photo: d.photo, soldOut: d.soldOut, sample: d.sample, verify: d.verify,
  }
}
function put(next: Dish) {
  const list = outlet.value!.dishes, i = list.findIndex((d) => d.id === next.id)
  if (i < 0) list.push(next); else list.splice(i, 1, next)
}
async function save() {
  const d = draft.value, c = canteen.value, o = outlet.value
  if (!d || !c || !o || saving.value || !authorized()) return
  if (!d.zh.trim()) { error.value = '请填写菜名'; return }
  saving.value = true; error.value = ''
  try {
    const result = creating.value ? await createDish(c.id, o.id, body(d)) : await updateDish(c.id, o.id, selectedId.value, body(d))
    if (creating.value) {
      // 服务器把新菜插在同档口最后，重新读一次保证顺序一致
      await load(); creating.value = false
    } else put(result)
    selectedId.value = result.id
    draft.value = draftFrom(result); baseline.value = JSON.stringify(draft.value)
    notify(`「${result.zh}」已保存，前台刷新后可见`)
  } catch (e) { error.value = (e as Error).message }
  finally { saving.value = false }
}
async function toggleSoldOut(d: Dish) {
  const c = canteen.value, o = outlet.value
  if (!c || !o || !authorized()) return
  busy.value = d.id
  try {
    const result = await updateDish(c.id, o.id, d.id, { soldOut: !d.soldOut })
    put(result)
    if (selectedId.value === d.id && draft.value) {
      // 只同步售罄开关，不打断正在编辑的其他字段
      draft.value.soldOut = !!result.soldOut
      baseline.value = JSON.stringify({ ...JSON.parse(baseline.value), soldOut: !!result.soldOut })
    }
    notify(result.soldOut ? `「${d.zh}」已标记售罄` : `「${d.zh}」恢复供应`)
  } catch (e) { notify((e as Error).message, 'error') }
  finally { busy.value = '' }
}
async function remove() {
  const d = selected.value, c = canteen.value, o = outlet.value
  if (!d || !c || !o || !authorized()) return
  if (!confirm(`删除「${d.zh}」？前台菜单和搜索里都会消失。`)) return
  busy.value = d.id
  try {
    await removeDish(c.id, o.id, d.id)
    o.dishes.splice(o.dishes.findIndex((x) => x.id === d.id), 1)
    selectedId.value = ''; draft.value = null
    notify('菜品已删除')
  } catch (e) { notify((e as Error).message, 'error') }
  finally { busy.value = '' }
}
function toggle<T>(list: T[], value: T) { const i = list.indexOf(value); if (i < 0) list.push(value); else list.splice(i, 1) }
function keydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && draft.value && !document.querySelector('dialog[open]')) {
    event.preventDefault(); if (dirty.value || creating.value) void save()
  }
}
onMounted(() => { void load(); leaveGuards.add(confirmLeave); window.addEventListener('keydown', keydown) })
onBeforeUnmount(() => { leaveGuards.delete(confirmLeave); window.removeEventListener('keydown', keydown) })
const MEALS = Object.keys(MEAL_LABELS) as Meal[]
</script>

<template>
  <div class="dish-workspace">
    <div v-if="loadError" class="data-card empty-state"><b>菜单读取失败</b><p>{{ loadError }}</p><button class="button secondary" @click="load">重试</button></div>
    <p v-else-if="loading && !canteens.length" class="data-card empty-state">正在读取食堂菜单…</p>
    <template v-else-if="canteen">
      <div class="canteen-tabs" role="tablist" aria-label="食堂">
        <button v-for="c in canteens" :key="c.id" role="tab" :aria-selected="canteen.id === c.id" :class="{ active: canteen.id === c.id }" @click="choose('canteen', c.id)">
          <Ico name="dining" /><span><b>{{ c.zh }}</b><small>{{ c.outlets.length }} 个窗口区 · {{ dishCount(c) }} 道菜</small></span>
        </button>
      </div>

      <div class="dish-columns">
        <aside class="data-card stall-panel" aria-label="楼层与档口">
          <div v-if="canteen.outlets.length > 1" class="kind-filters outlet-switch">
            <button v-for="o in canteen.outlets" :key="o.id" :class="{ active: outlet?.id === o.id }" :aria-pressed="outlet?.id === o.id" @click="choose('outlet', o.id)">{{ o.zh }}<span>{{ o.dishes.length }}</span></button>
          </div>
          <div v-if="outlet" class="outlet-meta">
            <b>{{ canteen.outlets.length > 1 ? outlet.zh : canteen.zh }}</b>
            <small>{{ outlet.floor || '—' }}<template v-if="outlet.menuDate"> · 菜单 {{ outlet.menuDate }}</template><template v-if="outlet.menuPending"> · 菜单待录入</template></small>
            <small v-if="outlet.hours?.length">{{ outlet.hours.map(([from, to, meal]) => `${MEAL_LABELS[meal]} ${from}–${to}`).join('　') }}</small>
          </div>
          <div class="stall-list">
            <button :class="{ active: !pick.stall }" @click="choose('stall', '')"><span>全部档口</span><small>{{ outlet?.dishes.length ?? 0 }}</small></button>
            <button v-for="s in stalls" :key="s.id" :class="{ active: pick.stall === s.zh }" :title="s.note?.zh" @click="choose('stall', s.zh)"><span>{{ s.zh }}<em v-if="s.daily">每日更新</em></span><small>{{ s.count }}</small></button>
            <p v-if="!stalls.length" class="muted">这个窗口区没有细分档口。</p>
          </div>
        </aside>

        <section class="data-card dish-list" aria-label="菜品列表">
          <div class="dish-toolbar">
            <div class="search-field"><Ico name="search" /><input v-model="pick.q" type="search" placeholder="搜索菜名、分组或标签…" aria-label="搜索菜品" /></div>
            <select v-model="pick.filter" aria-label="筛选"><option value="">全部菜品</option><option value="soldOut">已售罄</option><option value="photo">有实拍</option><option value="weekly">周菜单</option><option value="verify">待核对</option></select>
            <button class="button primary" :disabled="!outlet" @click="startCreate"><Ico name="plus" />新增菜品</button>
          </div>
          <div class="dish-scroll">
            <div v-if="!dishes.length" class="empty-state"><Ico name="dining" /><b>{{ pick.q || pick.filter ? '没有符合条件的菜品' : '这里还没有菜品' }}</b><p>点右上「新增菜品」录入第一道菜。</p></div>
            <template v-for="[group, list] in groups" :key="group">
              <h3 class="group-heading">{{ group }}<small>{{ list.length }}</small></h3>
              <div v-for="d in list" :key="d.id" class="dish-row" :class="{ active: selectedId === d.id, sold: d.soldOut }">
                <button class="dish-open" :aria-pressed="selectedId === d.id" @click="open(d)">
                  <span class="dish-thumb"><img v-if="d.photo" :src="d.photo.startsWith('http') ? d.photo : `/${d.photo}`" alt="" loading="lazy" /><Ico v-else name="dining" /></span>
                  <span class="dish-name"><b>{{ d.zh }}</b><small>{{ d.en || ' ' }}</small></span>
                  <span class="dish-price">{{ price(d) }}<small v-if="d.unit">/{{ d.unit }}</small></span>
                  <span class="dish-chips">
                    <em v-if="d.days" class="weekly">周菜单</em>
                    <em v-for="m in d.meals ?? []" :key="m">{{ MEAL_LABELS[m] }}</em>
                    <em v-if="d.verify" class="verify" :title="d.verify">待核对</em>
                    <em v-if="d.sample" class="verify">样例</em>
                  </span>
                </button>
                <button class="sold-toggle" :class="{ on: d.soldOut }" :disabled="busy === d.id" :title="d.soldOut ? '点击恢复供应' : '点击标记售罄'" @click="toggleSoldOut(d)">{{ d.soldOut ? '售罄' : '供应中' }}</button>
              </div>
            </template>
          </div>
        </section>

        <section v-if="draft" class="data-card dish-editor" aria-label="菜品编辑">
          <header class="inspector-header"><span>{{ creating ? '新增菜品' : '编辑菜品' }}</span><span class="draft-state" :class="{ dirty: dirty || creating }">{{ dirty || creating ? '待保存' : '未修改' }}</span><button class="icon-button" aria-label="关闭编辑" @click="close"><Ico name="close" /></button></header>
          <form id="dish-form" class="dish-form" @submit.prevent="save">
            <fieldset :disabled="saving">
              <div class="editor-section">
                <h3>基本信息</h3>
                <label>菜名<input v-model="draft.zh" required maxlength="80" placeholder="例如：酸菜牛肉面" /></label>
                <label>英文名<span class="optional">选填</span><input v-model="draft.en" maxlength="160" placeholder="Pickled-cabbage beef noodles" /></label>
                <div class="field-pair">
                  <label v-if="stalls.length">档口<select v-model="draft.stall" required><option v-for="s in stalls" :key="s.id" :value="s.zh">{{ s.zh }}</option></select></label>
                  <label>分组<span class="optional">如 大荤 / 天天有</span><input v-model="draft.groupZh" maxlength="40" /></label>
                </div>
              </div>
              <div class="editor-section">
                <h3>价格</h3>
                <div class="field-pair">
                  <label v-if="!draft.specs.length">价格（元）<input v-model.number="draft.price" type="number" min="0" max="10000" step="0.5" placeholder="不填表示菜单上没写" /></label>
                  <label>计价单位<span class="optional">如 碗 / 50g / 12只</span><input v-model="draft.unit" maxlength="20" /></label>
                </div>
                <div v-for="(s, i) in draft.specs" :key="i" class="spec-row">
                  <input v-model="s.zh" maxlength="40" placeholder="规格，如 大份" aria-label="规格名称" />
                  <input v-model.number="s.price" type="number" min="0" max="10000" step="0.5" placeholder="价格" aria-label="规格价格" />
                  <button type="button" class="icon-button danger" aria-label="删除规格" @click="draft.specs.splice(i, 1)"><Ico name="close" /></button>
                </div>
                <button type="button" class="text-button" @click="draft.specs.push({ zh: '', en: '', price: draft.specs.length ? null : draft.price })"><Ico name="plus" />{{ draft.specs.length ? '再加一个规格' : '分大小份 / 多规格' }}</button>
                <p v-if="draft.specs.length" class="field-help">有规格时，前台显示最低价。</p>
              </div>
              <div class="editor-section">
                <h3>供应与标签</h3>
                <p class="field-help">不选供应餐次表示窗口营业时都有。</p>
                <div class="chip-picker"><button v-for="m in MEALS" :key="m" type="button" :class="{ on: draft.meals.includes(m) }" :aria-pressed="draft.meals.includes(m)" @click="toggle(draft.meals, m)">{{ MEAL_LABELS[m] }}</button></div>
                <div class="chip-picker tags"><button v-for="(label, tag) in TAG_LABELS" :key="tag" type="button" :class="{ on: draft.tags.includes(tag) }" :aria-pressed="draft.tags.includes(tag)" @click="toggle(draft.tags, tag)">{{ label }}</button></div>
                <p v-if="weekDays.length" class="field-help weekly-note">周菜单：{{ weekDays.map((d) => d.slice(5).replace('-', '/')).join('、') }}（由菜单导入维护）</p>
                <div class="check-row">
                  <label><input v-model="draft.soldOut" type="checkbox" />今日售罄</label>
                  <label><input v-model="draft.sample" type="checkbox" />样例菜单（待食堂提供）</label>
                </div>
              </div>
              <details class="editor-section editor-more" :open="!!(draft.descZh || draft.photo || draft.verify)">
                <summary>介绍、照片与备注</summary>
                <label>介绍<textarea v-model="draft.descZh" rows="2" maxlength="500" /></label>
                <label>照片地址<span class="optional">photos/dishes/… 或 https://</span><input v-model="draft.photo" maxlength="300" /></label>
                <img v-if="draft.photo" class="photo-preview" :src="draft.photo.startsWith('http') ? draft.photo : `/${draft.photo}`" alt="菜品照片预览" />
                <label>待核对备注<span class="optional">只在后台显示</span><input v-model="draft.verify" maxlength="200" placeholder="例如：价格看不清" /></label>
              </details>
            </fieldset>
            <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
          </form>
          <footer class="editor-footer">
            <div class="editor-save-row">
              <button type="button" class="button secondary" :disabled="saving" @click="close">{{ dirty || creating ? '取消' : '关闭' }}</button>
              <button class="button primary" type="submit" form="dish-form" :disabled="saving || (!creating && !dirty)"><Ico name="check" />{{ saving ? '保存中…' : creating ? '添加菜品' : '保存修改' }}</button>
            </div>
            <div class="editor-footer-meta"><span>⌘ / Ctrl S 快速保存</span><button v-if="!creating" class="text-button danger" :disabled="!!busy" @click="remove"><Ico name="trash" />删除菜品</button></div>
          </footer>
        </section>
        <section v-else class="data-card dish-editor empty">
          <div class="empty-state"><Ico name="edit" /><b>选择一道菜进行编辑</b><p>点列表右侧的「供应中 / 售罄」可以直接切换售罄状态。</p></div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dish-workspace { display: grid; gap: 16px; }
.canteen-tabs { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
.canteen-tabs button { display: flex; align-items: center; gap: 10px; flex: none; min-width: 170px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fff; text-align: left; }
.canteen-tabs button:hover:not(.active) { border-color: #c9d9ce; }
.canteen-tabs button.active { border-color: #28634e; background: #f2f8f4; box-shadow: 0 0 0 1px #28634e; }
.canteen-tabs .svgi { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: #fdf1e6; color: #c26a2a; font-size: 17px; }
.canteen-tabs b, .canteen-tabs small { display: block; }
.canteen-tabs b { font-size: 14px; font-weight: 600; }
.canteen-tabs small { color: #8a988e; font-size: 11px; }
.dish-columns { display: grid; grid-template-columns: 220px minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
.stall-panel { position: sticky; top: 14px; display: flex; flex-direction: column; max-height: calc(100dvh - 300px); }
.outlet-switch { margin: 12px 12px 0; }
.outlet-meta { display: grid; gap: 2px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.outlet-meta b { font-size: 14px; }
.outlet-meta small { color: #8a988e; font-size: 11px; line-height: 1.6; }
.stall-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; scrollbar-width: thin; }
.stall-list button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; border-radius: 7px; background: transparent; text-align: left; font-size: 13px; color: #3d5246; }
.stall-list button:hover:not(.active) { background: #f6f8f5; }
.stall-list button.active { background: #edf5ef; color: #1f4d3a; font-weight: 600; }
.stall-list em { margin-left: 6px; padding: 0 5px; border-radius: 4px; background: #eef4fb; color: #3d679b; font-size: 10px; font-style: normal; font-weight: 400; }
.stall-list small { color: #9aa79e; font-variant-numeric: tabular-nums; }
.muted { padding: 6px 10px; color: var(--muted); font-size: 12px; }
.dish-list { display: flex; flex-direction: column; height: calc(100dvh - 300px); min-height: 460px; }
.dish-toolbar { flex: none; display: grid; grid-template-columns: minmax(0, 1fr) 120px auto; gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
.dish-toolbar select { font-size: 12px; padding: 7px 8px; }
.dish-toolbar .button { min-height: 36px; padding: 6px 12px; font-size: 12px; }
.dish-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 12px; scrollbar-width: thin; }
.group-heading { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; gap: 6px; margin: 0 -8px; padding: 10px 16px 6px; background: #fffffff2; color: #627569; font-size: 12px; font-weight: 600; }
.group-heading small { color: #a0aca4; font-weight: 400; }
.dish-row { display: flex; align-items: center; gap: 8px; padding-right: 6px; border: 1px solid transparent; border-radius: 8px; }
.dish-row:hover { background: #f6f8f5; }
.dish-row.active { background: #edf5ef; border-color: #d2e3d6; }
.dish-row.sold .dish-name b { color: #9aa79e; text-decoration: line-through #c9d1cb; }
.dish-open { flex: 1; min-width: 0; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 10px; align-items: center; padding: 7px 8px; background: transparent; text-align: left; }
.dish-thumb { grid-row: 1 / 3; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 8px; background: #f6f3ee; color: #c8a98b; overflow: hidden; }
.dish-thumb img { width: 100%; height: 100%; object-fit: cover; }
.dish-name { min-width: 0; }
.dish-name b, .dish-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dish-name b { font-size: 13px; font-weight: 550; }
.dish-name small { color: #9aa79e; font-size: 11px; }
.dish-price { justify-self: end; color: #b15a24; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dish-price small { color: #a69584; font-weight: 400; }
.dish-chips { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.dish-chips:empty { display: none; }
.dish-chips em { padding: 0 6px; border-radius: 4px; background: #eef2ef; color: #5b6f62; font-size: 10.5px; font-style: normal; line-height: 18px; }
.dish-chips em.weekly { background: #eef4fb; color: #3d679b; }
.dish-chips em.verify { background: #fbefd3; color: #8a6420; }
.sold-toggle { flex: none; width: 56px; padding: 5px 0; border-radius: 20px; background: #e7f3eb; color: #2e7a4f; font-size: 11px; }
.sold-toggle:hover:not(:disabled) { background: #d6ebdd; }
.sold-toggle.on { background: #fbe9e6; color: #a8412f; }
.sold-toggle.on:hover:not(:disabled) { background: #f6d8d2; }
.dish-editor { position: sticky; top: 14px; display: flex; flex-direction: column; max-height: calc(100dvh - 300px); min-height: 460px; }
.dish-editor.empty { display: grid; place-items: center; }
.dish-form { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.dish-form fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.dish-form .editor-section { padding: 16px 18px; }
.dish-form .editor-section label { margin-top: 12px; }
.dish-form .editor-section h3 + label { margin-top: 10px; }
.optional { margin-left: 6px; color: #9aa59e; font-size: 11px; }
.spec-row { display: grid; grid-template-columns: minmax(0, 1fr) 90px 28px; gap: 6px; align-items: center; margin-top: 8px; }
.spec-row input { margin: 0 !important; }
.spec-row + .text-button, .editor-section > .text-button { margin-top: 8px; }
.chip-picker { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip-picker.tags { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e3e9e4; }
.chip-picker button { padding: 4px 10px; border: 1px solid #dce4df; border-radius: 20px; background: #fff; color: #5b6f62; font-size: 12px; }
.chip-picker button.on { border-color: #28634e; background: #28634e; color: #fff; }
.weekly-note { margin-bottom: 0; color: #3d679b; }
.check-row { margin-top: 12px; }
.photo-preview { display: block; width: 100%; max-height: 180px; margin-top: 10px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
@media (max-width: 1300px) { .dish-columns { grid-template-columns: 200px minmax(0, 1fr) 340px; } }
@media (max-width: 1100px) {
  .dish-columns { grid-template-columns: 200px minmax(0, 1fr); }
  .dish-editor { grid-column: 1 / -1; position: static; max-height: none; min-height: 0; }
  .dish-editor.empty { display: none; }
}
@media (max-width: 760px) {
  .dish-columns { grid-template-columns: 1fr; }
  .stall-panel { position: static; max-height: 260px; }
  .dish-list { height: 520px; }
  .dish-toolbar { grid-template-columns: 1fr auto; }
  .dish-toolbar .search-field { grid-column: 1 / -1; }
}
</style>
