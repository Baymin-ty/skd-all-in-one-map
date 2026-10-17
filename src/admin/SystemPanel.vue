<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { admin, edit, exportData, missingEntrances, navigate, notify } from './store'
import { formatTime, relativeTime, SOURCE_LABELS } from './eventPipeline'
import { bytes, download, fetchCanteens, fetchEvents, fetchSystem, today, type SystemInfo } from './adminApi'

// 数据与备份：系统运行状态、各类数据规模、关键配置，以及导出 JSON 副本。
const info = ref<SystemInfo | null>(null), loading = ref(false), error = ref('')
async function load() {
  if (!admin.loggedIn) return
  loading.value = true; error.value = ''
  try { info.value = await fetchSystem() } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
onMounted(load)
watch(() => admin.loggedIn, (value) => { if (value) void load() })
defineExpose({ reload: load })

const pct = (n: number | undefined) => n == null ? '—' : `${Math.round(n * 100)}%`
const uptime = computed(() => {
  if (!info.value) return '—'
  const minutes = Math.floor((info.value.generatedAt - info.value.server.startedAt) / 60_000)
  return minutes < 60 ? `${minutes} 分钟` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时`
})
const dbTotal = computed(() => info.value?.databases.reduce((n, d) => n + d.size + d.wal, 0) ?? 0)
const scale = computed(() => {
  const s = info.value
  if (!s) return []
  return [
    { title: '地上地点', icon: 'building' as const, view: 'overview' as const, rows: [['建筑 / 区域', s.map.buildings], ['独立点位', s.map.pois], ['建筑出入口', s.map.entrances]], foot: s.map.updatedAt ? `最近修改 ${formatTime(s.map.updatedAt)}` : '' },
    { title: '地下路网', icon: 'road' as const, view: 'underground' as const, rows: [['节点', s.map.underground?.nodes ?? 0], ['路段', s.map.underground?.edges ?? 0], ['上下连接点', s.map.underground?.connectors ?? 0], ['图片点', s.map.underground?.points ?? 0]], foot: s.map.underground?.updatedAt ? `最近保存 ${formatTime(s.map.underground.updatedAt)}` : '使用打包的初始路网' },
    { title: '活动', icon: 'calendar' as const, view: 'events' as const, rows: [['目录总数', s.events.total], ['未结束', s.events.upcoming], ['置顶', s.events.pinned], ['已隐藏', s.events.hidden], ['已取消', s.events.cancelled], ['人工改过', s.events.edited]], foot: Object.entries(s.events.bySource).map(([k, n]) => `${SOURCE_LABELS[k] ?? k} ${n}`).join(' · ') },
    { title: '食堂菜单', icon: 'dining' as const, view: 'dishes' as const, rows: [['食堂', s.dining.canteens], ['窗口区', s.dining.outlets], ['档口', s.dining.stalls], ['菜品', s.dining.dishes], ['售罄', s.dining.soldOut], ['有实拍', s.dining.photos]], foot: s.dining.latestMenu ? `最新菜单 ${s.dining.latestMenu}` : '' },
    { title: '同学与互动', icon: 'users' as const, view: 'events' as const, rows: [['校园账号', s.users.accounts], ['主办方 / 管理员', s.users.organizers], ['讨论笔记', s.users.posts], ['评论', s.users.comments], ['活动签到', s.users.checkins], ['24 小时排队反馈', s.users.crowd24h]], foot: `${s.users.sessions} 个有效浏览会话` },
  ]
})
const config = computed(() => {
  const c = info.value?.config
  if (!c) return []
  return [
    { label: '管理口令', value: c.passwordSource, ok: true },
    { label: '活动自动更新', value: c.eventSchedule === false ? '已关闭' : '按数据源周期运行', ok: c.eventSchedule !== false },
    { label: '通知邮件活动源', value: c.mail ? '已配置 IMAP' : '未配置 EVENT_IMAP_URL', ok: c.mail },
    { label: '登录验证码邮件', value: c.mailLogin ? '已配置 SMTP' : c.demoMode ? '演示模式：验证码打印在服务日志' : '未配置 SMTP_URL / MAIL_FROM，无法发送验证码', ok: c.mailLogin || c.demoMode },
    { label: 'AI 讨论总结', value: c.aiSummary ? `已启用 · ${c.aiModel}` : '未配置 DEEPSEEK_API_KEY', ok: c.aiSummary },
    { label: '课表截图识别', value: c.scheduleVision ? '已启用' : '未配置识别模型密钥', ok: c.scheduleVision },
    { label: '演示模式', value: c.demoMode ? '开启（允许模拟时间签到）' : '关闭', ok: true },
  ]
})

const exporting = ref('')
async function exportKind(kind: 'places' | 'underground' | 'events' | 'canteens') {
  exporting.value = kind
  try {
    if (kind === 'places') exportData()
    else if (kind === 'underground') { if (!admin.underground) throw new Error('地下路网尚未加载'); download(`campus-underground-${today()}.json`, admin.underground); notify('已导出地下路网') }
    else if (kind === 'events') { download(`campus-events-${today()}.json`, (await fetchEvents()).events); notify('已导出活动目录（含隐藏与人工修改）') }
    else { download(`campus-canteens-${today()}.json`, await fetchCanteens()); notify('已导出食堂菜单') }
  } catch (e) { notify((e as Error).message, 'error') }
  finally { exporting.value = '' }
}
</script>

<template>
  <div class="system">
    <section v-if="!admin.loggedIn" class="data-card system-locked">
      <span class="lock-icon"><Ico name="lock" /></span>
      <div><h2>登录后查看系统数据</h2><p>服务运行状态、数据库、各类数据规模和关键配置需要管理口令。地点导出和数据质量检查无需登录。</p></div>
      <button class="button primary" @click="admin.loginOpen = true">管理员登录</button>
    </section>
    <div v-else-if="error" class="data-card empty-state"><b>系统数据读取失败</b><p>{{ error }}</p><button class="button secondary" @click="load">重试</button></div>

    <template v-if="info">
      <div class="health">
        <div><small>服务</small><b class="ok"><i />运行中</b><span>已运行 {{ uptime }} · Node {{ info.server.node }}</span></div>
        <div><small>数据库</small><b>{{ bytes(dbTotal) }}</b><span>{{ info.databases.map((d) => `${d.label} ${bytes(d.size + d.wal)}`).join(' · ') }}</span></div>
        <div><small>活动最近成功更新</small><b>{{ info.events.lastSuccess ? relativeTime(info.events.lastSuccess, info.generatedAt) : '还没有' }}</b><span>{{ info.events.sources.map((s) => `${s.label}${s.configured ? (s.lastRun?.status === 'error' ? ' 失败' : '') : ' 未配置'}`).join(' · ') }}</span></div>
        <div :class="{ attention: info.events.review?.pending }"><small>待审核活动</small><b>{{ info.events.review?.pending ?? 0 }}</b><span>已通过 {{ info.events.review?.approved ?? 0 }} · 已拒绝 {{ info.events.review?.rejected ?? 0 }}</span></div>
      </div>

      <div class="scale-grid">
        <section v-for="card in scale" :key="card.title" class="data-card scale-card">
          <header><span class="scale-icon"><Ico :name="card.icon" /></span><h2>{{ card.title }}</h2><button class="text-button" @click="navigate(card.view)">管理<Ico name="chevron" /></button></header>
          <dl><div v-for="[label, n] in card.rows" :key="label"><dt>{{ label }}</dt><dd>{{ n }}</dd></div></dl>
          <footer v-if="card.foot">{{ card.foot }}</footer>
        </section>
      </div>
    </template>

    <div class="system-columns">
      <div class="system-main">
        <section v-if="info" class="data-card">
          <header class="section-heading"><h2>关键配置</h2><span class="count-tag">来自 .env 与配置文件</span></header>
          <ul class="config-list">
            <li v-for="c in config" :key="c.label"><span>{{ c.label }}</span><b :class="{ off: !c.ok }"><i />{{ c.value }}</b></li>
            <li class="map-config">
              <span>地图显示<small>固定配置 public/data/map-settings.json</small></span>
              <b class="pills"><em>背景 {{ pct(info.config.mapSettings?.background) }}</em><em>可选对象 {{ pct(info.config.mapSettings?.selectable) }}</em><em>选中对象 {{ pct(info.config.mapSettings?.selected) }}</em></b>
            </li>
          </ul>
        </section>
        <section v-if="info" class="data-card">
          <header class="section-heading"><h2>运行环境与数据库</h2><span class="count-tag">{{ formatTime(info.generatedAt) }} 采样</span></header>
          <dl class="env-list">
            <div><dt>启动时间</dt><dd>{{ formatTime(info.server.startedAt) }}</dd></div>
            <div><dt>运行平台</dt><dd>{{ info.server.platform }} · 端口 {{ info.server.port }}</dd></div>
            <div><dt>内存占用</dt><dd>{{ bytes(info.server.memory) }}</dd></div>
            <div v-for="d in info.databases" :key="d.name"><dt>{{ d.label }}</dt><dd>{{ d.name }} · {{ bytes(d.size) }}<template v-if="d.wal"> + WAL {{ bytes(d.wal) }}</template></dd></div>
          </dl>
        </section>
      </div>

      <div class="system-side">
        <section class="data-card side-card">
          <h2>导出 JSON 副本</h2>
          <p>下载当前数据，用于备份或交给其他工具处理。</p>
          <div class="export-list">
            <button class="button secondary" :disabled="!!exporting" @click="exportKind('places')"><Ico name="building" />地上地点</button>
            <button class="button secondary" :disabled="!!exporting || !admin.underground" @click="exportKind('underground')"><Ico name="road" />地下路网</button>
            <button class="button secondary" :disabled="!!exporting || !admin.loggedIn" @click="exportKind('events')"><Ico name="calendar" />活动目录</button>
            <button class="button secondary" :disabled="!!exporting" @click="exportKind('canteens')"><Ico name="dining" />食堂菜单</button>
          </div>
        </section>
        <section class="data-card side-card quality-card">
          <div class="section-title"><h2>待补充出入口</h2><span class="count-tag">{{ missingEntrances.length }}</span></div>
          <p>补充入口，让导航带到楼门口。</p>
          <button v-for="b in missingEntrances.slice(0, 8)" :key="b.id" @click="edit({ kind: 'building', data: b })"><span>{{ b.name.zh }}</span><Ico name="edit" /></button>
          <p v-if="!missingEntrances.length">全部建筑已标注入口。</p>
        </section>
        <section v-if="info?.backups.length" class="data-card side-card">
          <div class="section-title"><h2>服务器备份文件</h2><span class="count-tag">server/backups</span></div>
          <ul class="backup-list"><li v-for="b in info.backups" :key="b.name"><span :title="b.name">{{ b.name }}</span><small>{{ bytes(b.size) }} · {{ formatTime(b.modifiedAt) }}</small></li></ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system { display: grid; gap: 18px; }
.system-locked { display: flex; align-items: center; gap: 16px; padding: 20px 22px; }
.system-locked > div { flex: 1; }
.system-locked p { margin-top: 4px; color: var(--muted); font-size: 13px; }
.lock-icon { display: grid; place-items: center; flex: none; width: 46px; height: 46px; border-radius: 12px; background: #edf4ef; color: #28634e; font-size: 22px; }
.health { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border: 1px solid var(--line); border-radius: 10px; background: var(--line); overflow: hidden; }
.health > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 16px 20px; background: #fff; }
.health small { color: var(--muted); font-size: 12px; }
.health b { display: flex; align-items: center; gap: 8px; color: #1f3d30; font-size: 22px; font-weight: 650; }
.health b.ok { color: #2e7a4f; }
.health b i { width: 9px; height: 9px; border-radius: 50%; background: #4f9a6c; box-shadow: 0 0 0 4px #4f9a6c22; }
.health span { overflow: hidden; color: #7a877f; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.health .attention { box-shadow: inset 3px 0 #c0533f; }
.health .attention b { color: #b0472f; }
.scale-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.scale-card { display: flex; flex-direction: column; padding: 16px 18px; }
.scale-card header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.scale-card h2 { flex: 1; font-size: 14px; }
.scale-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #edf4ef; color: #28634e; font-size: 16px; }
.scale-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0; }
.scale-card dl div { padding: 7px 10px; border-radius: 7px; background: #f6f8f7; }
.scale-card dt { color: var(--muted); font-size: 11px; }
.scale-card dd { margin: 1px 0 0; color: #1f3d30; font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.scale-card footer { margin-top: auto; padding-top: 10px; color: #8a988e; font-size: 11px; }
.system-columns { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); gap: 18px; align-items: start; }
.system-main, .system-side { display: grid; gap: 18px; }
.config-list { margin: 0; padding: 6px 20px 10px; list-style: none; }
.config-list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid #eef2ef; font-size: 13px; }
.config-list li:last-child { border: 0; }
.config-list li > span { color: #4f6155; }
.config-list small { display: block; color: #9aa79e; font-size: 11px; }
.config-list b { display: flex; align-items: center; gap: 7px; color: #2e7a4f; font-size: 12px; font-weight: 500; text-align: right; }
.config-list b i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.config-list b.off { color: #a17d3e; }
.config-list .pills { gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.config-list .pills em { padding: 2px 8px; border-radius: 5px; background: #f1f5f2; color: #3d5246; font-style: normal; }
.env-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin: 0; padding: 6px 20px 14px; }
.env-list div { padding: 10px 0; border-bottom: 1px solid #eef2ef; }
.env-list dt { color: var(--muted); font-size: 11px; }
.env-list dd { margin: 2px 0 0; color: #34493e; font-size: 13px; overflow-wrap: anywhere; }
.side-card { padding: 20px 22px; }
.side-card > p { margin: 8px 0 14px; color: #85986d; font-size: 13px; line-height: 1.7; }
.export-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.export-list .button { justify-content: flex-start; }
.backup-list { margin: 10px 0 0; padding: 0; list-style: none; }
.backup-list li { display: grid; padding: 8px 0; border-bottom: 1px solid #eef2ef; font-size: 12px; }
.backup-list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backup-list small { color: #8a988e; font-size: 11px; }
@media (max-width: 1100px) { .health { grid-template-columns: 1fr 1fr; } .system-columns { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .health { grid-template-columns: 1fr; } .env-list { grid-template-columns: 1fr; } .system-locked { flex-wrap: wrap; } }
</style>
