<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { account, logoutAccount, openAccount, ROLE_LABELS, updateNickname } from '../lib/account'
import { dateKey } from '../lib/campusTime'
import { openShare } from '../lib/deepLink'
import { clearHomePlace, favorites, HOME_ROLES, homePlace, placeLabel, profileUi, removePlace, setHomePlace, type HomeRole } from '../lib/profile'
import { navigateToPlace, placeName, placeSelection, select, showPanel, state, toast } from '../lib/store'
import type { PlaceCat } from '../lib/types'
import { clearClasses, endMin, fromMin, isWeeklyClass, plan, removeItem, startMin, type PlanItem } from '../lib/today'
import Ico from './Ico.vue'
import ScheduleImport from './ScheduleImport.vue'
import TodayItemForm from './TodayItemForm.vue'

// 「我的」：账号与昵称、常用地点、课表集中在这里管理；其他页面只负责使用这些数据。
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const root = ref<HTMLElement>()

// ---------- 账号与昵称 ----------
const initial = computed(() => account.me?.nameSet ? [...account.me.name.trim()][0]?.toUpperCase() : '')
const joined = computed(() => account.me ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long' }).format(account.me.createdAt) : '')
const nick = reactive({ editing: false, value: '', busy: false, error: '' })
function editNickname() {
  nick.editing = true
  nick.value = account.me?.nameSet ? account.me.name : ''
  nick.error = ''
}
async function saveNickname() {
  if (nick.busy) return
  nick.busy = true; nick.error = ''
  try { await updateNickname(nick.value); nick.editing = false; toast('昵称已保存') }
  catch (e) { nick.error = e instanceof Error ? e.message : '昵称保存失败' }
  finally { nick.busy = false }
}
async function logout() {
  if (!confirm('退出登录？课表和地点仍保存在账号里，下次登录会回来。')) return
  await logoutAccount()
  toast('已退出登录')
}

// ---------- 常用地点 ----------
const pickable = computed(() => state.buildings.filter((b) => !b.walkway && b.cat !== 'gate'))
const byName = (a: { name: { zh: string } }, b: { name: { zh: string } }) => a.name.zh.localeCompare(b.name.zh, 'zh-Hans-CN', { numeric: true })
/** 寝室只列住宿楼；实验室、办公室按分类分组，教学科研排最前 */
function optionGroups(role: HomeRole) {
  const cats: PlaceCat[] = role === 'dorm' ? ['housing'] : ['academic', 'service', 'sports', 'dining', 'housing']
  return cats.map((cat) => ({ cat, zh: state.categories[cat]?.zh ?? cat, items: pickable.value.filter((b) => b.cat === cat).sort(byName) })).filter((g) => g.items.length)
}
const placeForm = reactive({ role: '' as HomeRole | '', place: '', room: '' })
function editPlace(role: HomeRole) {
  const current = homePlace(role)
  placeForm.role = role
  placeForm.place = current?.place ?? ''
  placeForm.room = current?.room ?? ''
}
function savePlace() {
  if (!placeForm.role || !placeForm.place) return
  setHomePlace(placeForm.role, placeForm.place, placeForm.room)
  toast(`已设置${HOME_ROLES.find((r) => r.role === placeForm.role)?.zh}`)
  placeForm.role = ''
}
function clearPlace(role: HomeRole) {
  clearHomePlace(role)
  placeForm.role = ''
}
function showPlace(id: string) {
  const sel = placeSelection(id)
  if (sel) select(sel)
}

// ---------- 课表 ----------
const classes = computed(() => plan.items.filter(isWeeklyClass))
const week = computed(() => WEEKDAYS.map((zh, i) => ({ zh, items: classes.value.filter((c) => c.weekdays!.includes(i + 1)).sort((a, b) => startMin(a) - startMin(b)) })).filter((d) => d.items.length))
const editing = ref<PlanItem | 'new' | null>(null)
const where = (i: PlanItem) => {
  const sel = placeSelection(i.place)
  return [sel && placeName(sel), i.room].filter(Boolean).join(' · ')
}
function removeClass(i: PlanItem) {
  if (!confirm(`删除「${i.title}」？每周的这门课都会删除。`)) return
  removeItem(i.id)
  toast('已删除这门课')
}
function clearAll() {
  if (!confirm(`清空课表里的 ${classes.value.length} 门课？`)) return
  clearClasses()
  toast('课表已清空')
}

function shareSite() {
  openShare({ title: '上科大一图通', links: [{ label: '首页', url: `${window.location.origin}/`, hint: '用手机扫码打开校园地图' }] })
}

onMounted(async () => {
  const focus = profileUi.focus
  profileUi.focus = ''
  if (!focus) return
  await nextTick()
  root.value?.querySelector(`#me-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
})
</script>

<template>
  <div ref="root" class="page me-page">
    <h2 class="title">我的</h2>

    <!-- 账号 -->
    <section v-if="account.me" class="me-card">
      <div class="me-who">
        <span class="me-avatar" :class="{ blank: !initial }"><template v-if="initial">{{ initial }}</template><Ico v-else name="users" /></span>
        <div class="grow">
          <b class="me-name ellipsis">{{ account.me.nameSet ? account.me.name : '还没起昵称' }}</b>
          <small class="ellipsis">{{ account.me.email }}</small>
          <small><span class="pill">{{ ROLE_LABELS[account.me.role] }}</span> {{ joined }}加入</small>
        </div>
        <button v-if="!nick.editing" type="button" class="act small" @click="editNickname"><Ico name="edit" />{{ account.me.nameSet ? '改昵称' : '起昵称' }}</button>
      </div>
      <p v-if="!account.me.nameSet && !nick.editing" class="me-warn">起好昵称后才能发笔记和评论，昵称和账号绑定，换设备也一样。</p>
      <form v-if="nick.editing" class="form me-nick" @submit.prevent="saveNickname">
        <label>昵称<input v-model="nick.value" autocomplete="nickname" minlength="2" maxlength="16" placeholder="2–16 个字，不能和别人重名" required :disabled="nick.busy" /></label>
        <p class="muted">发笔记、评论时显示这个昵称。</p>
        <p v-if="nick.error" class="error" role="alert">{{ nick.error }}</p>
        <div class="row-actions">
          <button class="act primary small" :disabled="nick.busy">{{ nick.busy ? '保存中…' : '保存' }}</button>
          <button type="button" class="act small" :disabled="nick.busy" @click="nick.editing = false">取消</button>
        </div>
      </form>
    </section>
    <section v-else class="me-card guest">
      <div class="me-who">
        <span class="me-avatar blank"><Ico name="users" /></span>
        <div class="grow"><b class="me-name">未登录</b><small>现在设置的寝室和课表只存在这台设备</small></div>
      </div>
      <p class="me-copy">用校园邮箱登录后，昵称、课表和寝室跟着账号走，换手机也在；这台设备上已有的内容会自动并入账号。</p>
      <button type="button" class="act primary" @click="openAccount()"><Ico name="users" />校园邮箱登录</button>
    </section>

    <!-- 常用地点 -->
    <section id="me-places" class="sec">
      <h3>常用地点 <span class="muted">首页一键导航</span></h3>
      <ul class="list-plain me-rows">
        <li v-for="r in HOME_ROLES" :key="r.role">
          <div class="me-row">
            <span class="me-ic"><Ico :name="r.icon" /></span>
            <div class="grow">
              <b>{{ r.zh }}</b>
              <small v-if="homePlace(r.role)" class="ellipsis">{{ placeLabel(homePlace(r.role)!) }}</small>
              <small v-else>未设置 · {{ r.hint }}</small>
            </div>
            <button v-if="homePlace(r.role) && placeForm.role !== r.role" type="button" class="act small" @click="navigateToPlace(homePlace(r.role)!.place)"><Ico name="walk" />到这去</button>
            <button v-if="placeForm.role !== r.role" type="button" class="text-link" @click="editPlace(r.role)">{{ homePlace(r.role) ? '修改' : '设置' }}</button>
          </div>
          <form v-if="placeForm.role === r.role" class="form me-place-form" @submit.prevent="savePlace">
            <label>{{ r.role === 'dorm' ? '住在哪栋楼' : '哪栋楼' }}
              <select v-model="placeForm.place" required>
                <option value="" disabled>选择楼宇</option>
                <optgroup v-for="g in optionGroups(r.role)" :key="g.cat" :label="g.zh">
                  <option v-for="b in g.items" :key="b.id" :value="b.id">{{ b.name.zh }}</option>
                </optgroup>
              </select>
            </label>
            <label>{{ r.role === 'dorm' ? '房间号' : '房间号或楼层' }}<input v-model="placeForm.room" maxlength="20" :placeholder="r.role === 'dorm' ? '可不填，如 302' : '可不填，如 1A-108'" /></label>
            <div class="row-actions">
              <button class="act primary small" :disabled="!placeForm.place">保存</button>
              <button type="button" class="act small" @click="placeForm.role = ''">取消</button>
              <button v-if="homePlace(r.role)" type="button" class="text-link danger" @click="clearPlace(r.role)">清除</button>
            </div>
          </form>
        </li>
      </ul>
      <h4 class="me-sub">收藏的地点</h4>
      <ul v-if="favorites().length" class="list-plain me-rows">
        <li v-for="f in favorites()" :key="f.id" class="me-row">
          <span class="me-ic fav"><Ico name="bookmark" /></span>
          <button type="button" class="grow me-link ellipsis" @click="showPlace(f.place)">{{ placeLabel(f) }}</button>
          <button type="button" class="act small" @click="navigateToPlace(f.place)"><Ico name="walk" />到这去</button>
          <button type="button" class="icon-btn" :aria-label="`取消收藏 ${placeLabel(f)}`" @click="removePlace(f.id)"><Ico name="close" /></button>
        </li>
      </ul>
      <p v-else class="muted me-empty">在地图上点开一个地点，点「收藏」就会出现在这里。</p>
    </section>

    <!-- 课表 -->
    <section id="me-schedule" class="sec">
      <h3>我的课表 <span v-if="classes.length" class="muted">{{ classes.length }} 门课 · 每周重复</span></h3>
      <p class="muted">课表会按星期出现在「我的今天」里，自动推荐下课后去哪吃饭、提醒出发时间。</p>
      <div class="me-tools">
        <ScheduleImport />
        <button v-if="editing !== 'new'" type="button" class="act small" @click="editing = 'new'"><Ico name="plus" />手动添加</button>
      </div>
      <TodayItemForm v-if="editing" :key="editing === 'new' ? 'new' : editing.id" :item="editing === 'new' ? null : editing" :date="dateKey()" class-only @done="editing = null" />
      <div v-for="d in week" :key="d.zh" class="me-day">
        <h4 class="me-sub">{{ d.zh }}</h4>
        <ul class="list-plain me-rows">
          <li v-for="c in d.items" :key="c.id" class="me-row class-row">
            <span class="me-time"><b>{{ c.start }}</b><small>{{ fromMin(endMin(c)) }}</small></span>
            <button type="button" class="grow me-link" @click="editing = c">
              <b class="ellipsis">{{ c.title }}</b>
              <small class="ellipsis">{{ where(c) || '地点未填' }}<template v-if="c.weekdays!.length > 1"> · 每周{{ c.weekdays!.map((w) => WEEKDAYS[w - 1].slice(1)).join('、') }}</template></small>
            </button>
            <button type="button" class="icon-btn" :aria-label="`编辑 ${c.title}`" @click="editing = c"><Ico name="edit" /></button>
            <button type="button" class="icon-btn danger" :aria-label="`删除 ${c.title}`" @click="removeClass(c)"><Ico name="trash" /></button>
          </li>
        </ul>
      </div>
      <p v-if="!classes.length && !editing" class="muted me-empty">还没有课表。导入教务系统的课表截图最快，也可以手动一门门加。</p>
      <button v-if="classes.length" type="button" class="text-link danger me-clear" @click="clearAll">清空课表</button>
    </section>

    <!-- 更多 -->
    <section class="sec">
      <h3>更多</h3>
      <ul class="list-plain me-rows">
        <li><button type="button" class="me-row me-nav" @click="showPanel('today')"><span class="me-ic"><Ico name="clock" /></span><span class="grow">我的今天</span><Ico name="chevron" class="chev" /></button></li>
        <li><button type="button" class="me-row me-nav" @click="shareSite"><span class="me-ic"><Ico name="grid" /></span><span class="grow">手机扫码使用</span><Ico name="chevron" class="chev" /></button></li>
        <li v-if="account.me && account.me.role !== 'student'"><a class="me-row me-nav" href="/admin/" target="_blank" rel="noopener"><span class="me-ic"><Ico name="lock" /></span><span class="grow">管理后台</span><Ico name="external" class="chev" /></a></li>
        <li v-if="account.me"><button type="button" class="me-row me-nav danger" :disabled="account.busy" @click="logout"><span class="me-ic"><Ico name="back" /></span><span class="grow">退出登录</span></button></li>
      </ul>
    </section>

    <p class="me-foot">{{ account.me ? '昵称、课表和地点保存在校园账号里，换设备登录也能看到。' : '未登录时，课表和地点只保存在这台设备的浏览器里。' }}</p>
  </div>
</template>

<style scoped>
.me-card { margin-top: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: linear-gradient(160deg, #fff 55%, var(--brand-soft)); }
.me-card.guest { background: var(--bg-2); border-color: transparent; }
.me-who { display: flex; align-items: center; gap: 12px; }
.me-avatar { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #c13a40, var(--brand)); color: #fff; font-size: 20px; font-weight: 700; }
.me-avatar.blank { background: #e4e4ea; color: var(--ink-3); font-size: 22px; }
.me-who small { display: block; margin-top: 2px; color: var(--ink-3); font-size: 12px; }
.me-who small .pill { padding: 0 6px; font-size: 10.5px; }
.me-name { display: block; font-size: 17px; }
.me-warn { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: #fff4e5; color: #8a4b08; font-size: 12.5px; line-height: 1.5; }
.me-copy { margin: 10px 0 12px; color: var(--ink-2); font-size: 13px; line-height: 1.6; }
.me-nick { margin-top: 12px; }
.row-actions { display: flex; align-items: center; gap: 8px; }
.row-actions .text-link { margin-left: auto; }
.error { color: #b3261e; font-size: 13px; }
.me-sub { margin: 14px 0 4px; font-size: 12.5px; font-weight: 650; color: var(--ink-3); }
.me-rows > li { border-bottom: 1px solid var(--line); }
.me-rows > li:last-child { border-bottom: 0; }
.me-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; }
.me-row b { display: block; font-size: 14.5px; }
.me-row small { display: block; margin-top: 1px; color: var(--ink-3); font-size: 12px; }
.me-ic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: #f3eefb; color: #6d4c9c; font-size: 17px; }
.me-ic.fav { background: var(--brand-soft); color: var(--brand); }
.me-place-form { margin: 0 0 12px 42px; }
.me-link { min-width: 0; padding: 0; border: 0; background: none; color: var(--ink); font-size: 14px; text-align: left; cursor: pointer; }
.me-link:hover b, .me-link:hover { color: var(--brand); }
.icon-btn { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 50%; background: none; color: var(--ink-3); font-size: 15px; cursor: pointer; }
.icon-btn:hover { background: var(--bg-2); color: var(--ink); }
.icon-btn.danger:hover, .text-link.danger, .me-nav.danger { color: #b3261e; }
.me-empty { padding: 6px 0; }
.me-tools { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin-top: 10px; }
.me-tools .schedule-import { display: contents; }
.me-tools :deep(.schedule-preview) { flex-basis: 100%; margin-top: 0; }
.class-row { padding: 8px 0; }
.me-time { flex: none; display: flex; flex-direction: column; align-items: flex-end; width: 40px; font-variant-numeric: tabular-nums; }
.me-time b { font-size: 13px; }
.me-time small { font-size: 11px; color: var(--ink-3); }
.me-clear { margin-top: 10px; font-size: 13px; }
.me-nav { border: 0; background: none; color: var(--ink); font-size: 14.5px; text-align: left; cursor: pointer; }
.me-nav .me-ic { background: var(--bg-2); color: var(--ink-2); }
.me-nav.danger .me-ic { background: #fdecea; color: #b3261e; }
@media (hover: hover) { .me-nav:hover { background: #f9f9fb; } }
.me-foot { margin-top: 22px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--ink-3); font-size: 11.5px; line-height: 1.6; }
</style>
