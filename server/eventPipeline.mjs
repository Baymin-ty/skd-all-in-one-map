import express from 'express'
import { ensureEventTopics } from './community.mjs'
import { extractMailEvents, mailExcerpt } from './mailEvents.mjs'

// 活动数据自动更新：多个数据源按各自的周期定时运行，结果去重合并进 discovery_catalog；
// 解析不了或可疑的条目进入待审核队列，由管理员在后台确认后才上线。

const MINUTE = 60_000
const CATS = new Set(['lecture', 'conference', 'culture', 'student', 'career', 'library', 'international', 'wellbeing', 'campus', 'other'])
const REVIEW_FIELDS = ['title', 'start', 'end', 'allDay', 'venueRaw', 'place', 'room', 'floor', 'organizer', 'category', 'url']
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const json = (value, fallback) => { try { return value ? JSON.parse(value) : fallback } catch { return fallback } }
const titleKey = (value) => String(value ?? '').toLowerCase().replace(/^【[^】]*】/, '').replace(/[\s\p{P}\p{S}]/gu, '')
const minutes = (value, fallback) => Number.isFinite(Number(value)) && Number(value) >= 5 ? Number(value) : fallback

export function mailConfigFromEnv(env = process.env) {
  const url = text(env.EVENT_IMAP_URL, 1000)
  return {
    url,
    mailbox: text(env.EVENT_IMAP_MAILBOX, 200) || 'INBOX',
    sinceDays: minutes(env.EVENT_IMAP_SINCE_DAYS, 30),
    senders: text(env.EVENT_MAIL_SENDERS, 500) || 'shanghaitech\\.edu\\.cn',
    intervalMinutes: minutes(env.EVENT_IMAP_INTERVAL_MIN, 30),
    maxMessages: 200,
  }
}

/** 通过 IMAP 拉取新邮件，只返回解析活动需要的字段。 */
export async function fetchImapMessages({ url, mailbox = 'INBOX', cursor = null, sinceDays = 30, maxMessages = 200 }) {
  const [{ ImapFlow }, { simpleParser }] = await Promise.all([import('imapflow'), import('mailparser')])
  const target = new URL(url)
  const client = new ImapFlow({
    host: target.hostname, port: Number(target.port) || (target.protocol === 'imap:' ? 143 : 993), secure: target.protocol !== 'imap:',
    auth: { user: decodeURIComponent(target.username), pass: decodeURIComponent(target.password) },
    // 163 邮箱要求先发送 ID 命令才允许 SELECT；imapflow 会在服务器支持时自动发送。
    clientInfo: { name: 'shanghaitech-map', version: '0.1.0', vendor: 'shanghaitech-map' },
    logger: false, socketTimeout: 60_000,
  })
  client.on('error', () => {})
  await client.connect()
  const messages = []
  let next = cursor
  try {
    const lock = await client.getMailboxLock(mailbox)
    try {
      const uidValidity = String(client.mailbox.uidValidity)
      const sameBox = cursor && cursor.uidValidity === uidValidity
      const uids = sameBox
        ? (await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true }) || []).filter((uid) => uid > cursor.lastUid)
        : await client.search({ since: new Date(Date.now() - sinceDays * 86_400_000) }, { uid: true }) || []
      const batch = uids.sort((a, b) => a - b).slice(0, maxMessages)
      for await (const message of batch.length ? client.fetch(batch, { uid: true, source: true }, { uid: true }) : []) {
        const parsed = await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true })
        messages.push({
          uid: message.uid, messageId: parsed.messageId || `uid-${uidValidity}-${message.uid}`,
          subject: parsed.subject || '', from: parsed.from?.text || '', date: parsed.date || new Date(), text: parsed.text || '',
        })
      }
      const lastUid = Math.max(sameBox ? cursor.lastUid : 0, ...batch, 0)
      next = { uidValidity, lastUid, more: uids.length > batch.length }
    } finally { lock.release() }
  } finally { await client.logout().catch(() => client.close()) }
  return { messages, cursor: next }
}

function readCatalog(db) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events')
  if (!row) throw new Error('活动目录尚未初始化')
  return JSON.parse(row.data)
}
function writeCatalog(db, events, changed) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE discovery_catalog SET data=? WHERE kind=?').run(JSON.stringify(events), 'events')
    if (changed.length && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_topics'").get()) ensureEventTopics(db, changed)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

/** 已在目录里的同一场活动（不同来源或换了标题写法的提醒邮件）。 */
export function findDuplicate(catalog, event) {
  const key = titleKey(event.title)
  const day = String(event.start).slice(0, 10)
  const time = event.allDay ? '' : String(event.start).slice(11, 16)
  return catalog.find((item) => {
    if (item.id === event.id || item.status === 'cancelled' || String(item.start).slice(0, 10) !== day) return false
    if (time && !item.allDay && String(item.start).slice(11, 16) !== time) return false
    const other = titleKey(item.title)
    return other === key || (key.length >= 6 && other.length >= 6 && (other.includes(key) || key.includes(other)))
  }) ?? null
}

/** 把一批活动按 id 合并进目录；已有条目保留管理员改过的字段与隐藏状态。 */
export function mergeCatalogEvents(db, incoming) {
  const catalog = readCatalog(db)
  const index = new Map(catalog.map((event, i) => [event.id, i]))
  let added = 0, updated = 0
  const changed = []
  for (const event of incoming) {
    const at = index.get(event.id)
    if (at === undefined) { index.set(event.id, catalog.length); catalog.push(event); changed.push(event); added++; continue }
    const old = catalog[at]
    const merged = { ...old, ...event, ...(old.manualOverrides ?? {}), ...(old.hidden ? { hidden: true } : {}) }
    if (JSON.stringify(old) !== JSON.stringify(merged)) { catalog[at] = merged; changed.push(merged); updated++ }
  }
  if (changed.length) {
    catalog.sort((a, b) => String(a.start).localeCompare(String(b.start)))
    writeCatalog(db, catalog, changed)
  }
  return { added, updated }
}

function validStart(value) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(/[+-]\d\d:\d\d$|Z$/.test(value) ? value : `${value}+08:00`)) }
function normaliseTime(value) {
  const raw = text(value, 40)
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00+08:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw}+08:00`
  return raw
}

export function installEventPipeline(app, db, {
  authorize = (_req, _res, next) => next(), eventSync, resolver, mail = mailConfigFromEnv(), fetchMail = fetchImapMessages,
  schedule = true, initialRun = process.env.EVENT_SYNC_ON_START !== 'false', officialIntervalMinutes = minutes(process.env.EVENT_OFFICIAL_INTERVAL_MIN, 120),
} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_pipeline_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, trigger TEXT NOT NULL, started_at INTEGER NOT NULL,
      finished_at INTEGER, status TEXT NOT NULL, added INTEGER DEFAULT 0, updated INTEGER DEFAULT 0, cancelled INTEGER DEFAULT 0, review INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0, scanned INTEGER DEFAULT 0, error TEXT DEFAULT '', warnings TEXT DEFAULT '[]');
    CREATE INDEX IF NOT EXISTS event_pipeline_runs_source ON event_pipeline_runs(source, id);
    CREATE TABLE IF NOT EXISTS event_review (id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, reasons TEXT NOT NULL, event TEXT NOT NULL,
      context TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, decided_at INTEGER, run_id INTEGER);
    CREATE INDEX IF NOT EXISTS event_review_status ON event_review(status, created_at);`)
  // 进程重启时把上次中断的运行标记为失败，避免后台一直显示“运行中”。
  db.prepare("UPDATE event_pipeline_runs SET status='error', error='服务重启，运行被中断', finished_at=? WHERE status='running'").run(Date.now())

  const meta = {
    get: (key) => json(db.prepare('SELECT value FROM event_sync_meta WHERE key=?').get(key)?.value, null),
    set: (key, value) => db.prepare('INSERT INTO event_sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)),
  }
  const queue = db.prepare(`INSERT INTO event_review (id, source, status, reasons, event, context, created_at, updated_at, run_id) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`)
  const enqueue = (runId, { id, source, reasons, event, context }) => {
    const now = Date.now()
    return queue.run(id, source, JSON.stringify(reasons), JSON.stringify(event), JSON.stringify(context), now, now, runId).changes
  }

  const sources = [
    {
      id: 'official', label: '学校官网活动日历', kind: 'web', target: 'www.shanghaitech.edu.cn',
      description: '学术讲座、会议、文化活动栏目，前后 60 天窗口；官网删除的活动会标记为取消。',
      intervalMinutes: officialIntervalMinutes, configured: () => !!eventSync, hint: '',
      async run(runId) {
        const result = await eventSync.sync()
        if (result.lastError) throw new Error(result.lastError)
        let review = 0
        for (const { raw, error } of result.failed ?? []) {
          review += enqueue(runId, {
            id: `review-o-${raw?.id ?? Math.random().toString(36).slice(2)}`, source: 'official', reasons: [error],
            event: { id: raw?.id != null ? `o-${raw.id}` : '', sourceId: raw?.id != null ? String(raw.id) : undefined, title: text(raw?.title, 160), start: '', end: null, allDay: false,
              venueRaw: text(raw?.f5, 240), place: null, room: '', floor: null, organizer: text(raw?.f6, 120), speaker: text(raw?.f2, 160), category: 'other', source: 'official', url: text(raw?.url, 500) },
            context: { kind: 'official', fields: { 日期: raw?.f1, 开始: raw?.f3, 结束: raw?.f4, 地点: raw?.f5 } },
          })
        }
        return { added: result.added, updated: result.updated, cancelled: result.cancelled, review, scanned: result.fetched ?? 0, warnings: result.warnings ?? [] }
      },
    },
    {
      id: 'email', label: '学校通知邮件', kind: 'email', target: mail.url ? (() => { try { const u = new URL(mail.url); return `${decodeURIComponent(u.username)} · ${mail.mailbox}` } catch { return '' } })() : '',
      description: `通过 IMAP 读取新邮件，只处理 ${mail.senders.replace(/\\/g, '')} 发出的通知；能确定时间和校内地点的活动直接上线，其余进入待审核。`,
      intervalMinutes: mail.intervalMinutes, configured: () => !!mail.url, hint: '在 .env 设置 EVENT_IMAP_URL=imaps://账号:授权码@imap.example.com:993',
      async run(runId) {
        const senderPattern = new RegExp(mail.senders, 'i')
        const { messages, cursor } = await fetchMail({ ...mail, cursor: meta.get('mail.cursor') })
        const publish = [], warnings = []
        let review = 0, skipped = 0
        const catalog = readCatalog(db)
        const reviewed = new Set(db.prepare('SELECT id FROM event_review').all().map((row) => row.id))
        for (const message of messages) {
          if (!senderPattern.test(message.from)) { skipped++; continue }
          let parsed
          try { parsed = extractMailEvents(message, resolver) } catch (error) { warnings.push(`「${message.subject}」解析出错：${error.message}`); continue }
          const context = { kind: 'email', subject: message.subject, from: message.from, date: new Date(message.date).getTime(), messageId: message.messageId, excerpt: mailExcerpt(message.text) }
          if (!parsed.events.length) {
            // 有时间和地点字样却没解析出活动，交给人工；普通通知直接忽略。
            if (parsed.looksLikeEvent) review += enqueue(runId, { id: `review-mail-${message.messageId}`.slice(0, 200), source: 'email', reasons: ['邮件像活动通知，但没能解析出日期和地点'],
              event: { id: '', title: parsed.title, start: '', end: null, allDay: false, venueRaw: '', place: null, room: '', floor: null, organizer: parsed.organizer, category: parsed.category, source: 'email' }, context })
            else skipped++
            continue
          }
          for (const { event, reasons } of parsed.events) {
            const duplicate = findDuplicate([...catalog, ...publish], event)
            if (duplicate && duplicate.id !== event.id) { skipped++; continue }
            if (reasons.length || reviewed.has(`review-${event.id}`)) {
              if (!catalog.some((item) => item.id === event.id)) review += enqueue(runId, { id: `review-${event.id}`, source: 'email', reasons, event, context })
              continue
            }
            publish.push(event)
          }
        }
        const merged = publish.length ? mergeCatalogEvents(db, publish) : { added: 0, updated: 0 }
        meta.set('mail.cursor', cursor)
        if (cursor?.more) warnings.push('新邮件较多，本次只处理了一部分，下次运行会继续')
        return { ...merged, cancelled: 0, review, skipped, scanned: messages.length, warnings }
      },
    },
  ]

  const running = new Map()
  const nextRunAt = new Map()
  const startRun = db.prepare("INSERT INTO event_pipeline_runs (source, trigger, started_at, status) VALUES (?, ?, ?, 'running')")
  const finishRun = db.prepare('UPDATE event_pipeline_runs SET finished_at=?, status=?, added=?, updated=?, cancelled=?, review=?, skipped=?, scanned=?, error=?, warnings=? WHERE id=?')
  async function runSource(source, trigger) {
    if (running.has(source.id)) return running.get(source.id)
    if (!source.configured()) {
      const id = Number(startRun.run(source.id, trigger, Date.now()).lastInsertRowid)
      finishRun.run(Date.now(), 'skipped', 0, 0, 0, 0, 0, 0, '数据源未配置', '[]', id)
      return null
    }
    const task = (async () => {
      const id = Number(startRun.run(source.id, trigger, Date.now()).lastInsertRowid)
      try {
        const r = await source.run(id)
        finishRun.run(Date.now(), 'ok', r.added ?? 0, r.updated ?? 0, r.cancelled ?? 0, r.review ?? 0, r.skipped ?? 0, r.scanned ?? 0, '', JSON.stringify((r.warnings ?? []).slice(0, 50)), id)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const message = /auth|login|credentials|LOGIN/i.test(detail) ? `邮箱登录失败：${detail}` : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|timeout/i.test(detail) ? `网络连接失败：${detail}` : detail
        finishRun.run(Date.now(), 'error', 0, 0, 0, 0, 0, 0, message.slice(0, 500), '[]', id)
        console.error(`活动数据源「${source.label}」运行失败：${message}`)
      } finally { running.delete(source.id) }
    })()
    running.set(source.id, task)
    return task
  }
  const runAll = (trigger, only) => Promise.all(sources.filter((s) => !only || s.id === only).map((s) => runSource(s, trigger)))

  const lastRun = db.prepare('SELECT * FROM event_pipeline_runs WHERE source=? ORDER BY id DESC LIMIT 1')
  const lastOk = db.prepare("SELECT finished_at FROM event_pipeline_runs WHERE source=? AND status='ok' ORDER BY id DESC LIMIT 1")
  const runRow = (row) => row && ({ id: row.id, source: row.source, trigger: row.trigger, startedAt: row.started_at, finishedAt: row.finished_at, status: row.status,
    added: row.added, updated: row.updated, cancelled: row.cancelled, review: row.review, skipped: row.skipped, scanned: row.scanned, error: row.error, warnings: json(row.warnings, []) })
  function status() {
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM event_review GROUP BY status').all().map((row) => [row.status, row.n]))
    let catalog = []
    try { catalog = readCatalog(db) } catch { /* 目录未初始化 */ }
    const bySource = {}
    for (const event of catalog) if (event.status !== 'cancelled') bySource[event.source] = (bySource[event.source] ?? 0) + 1
    return {
      schedule,
      sources: sources.map((s) => ({ id: s.id, label: s.label, kind: s.kind, target: s.target, description: s.description, configured: s.configured(), hint: s.configured() ? '' : s.hint,
        intervalMinutes: s.intervalMinutes, running: running.has(s.id), nextRunAt: schedule && s.configured() ? nextRunAt.get(s.id) ?? null : null,
        lastRun: runRow(lastRun.get(s.id)) ?? null, lastSuccessAt: lastOk.get(s.id)?.finished_at ?? null })),
      runs: db.prepare('SELECT * FROM event_pipeline_runs ORDER BY id DESC LIMIT 30').all().map(runRow),
      review: { pending: counts.pending ?? 0, approved: counts.approved ?? 0, rejected: counts.rejected ?? 0 },
      catalog: { total: catalog.filter((e) => e.status !== 'cancelled').length, bySource },
    }
  }

  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))
  router.get('/pipeline', authorize, (_req, res) => res.json(status()))
  router.post('/pipeline/run', authorize, (req, res) => {
    const only = text(req.body?.source, 40)
    if (only && !sources.some((s) => s.id === only)) return res.status(400).json({ error: '没有这个数据源' })
    const target = sources.find((s) => s.id === only)
    if (target && !target.configured()) return res.status(400).json({ error: `「${target.label}」还没有配置：${target.hint}` })
    void runAll('manual', only || null)
    res.status(202).json(status())
  })
  router.get('/review', authorize, (req, res) => {
    const state = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending'
    const rows = db.prepare('SELECT * FROM event_review WHERE status=? ORDER BY created_at DESC LIMIT 200').all(state)
    res.json(rows.map((row) => ({ id: row.id, source: row.source, status: row.status, reasons: json(row.reasons, []), event: json(row.event, {}), context: json(row.context, {}),
      createdAt: row.created_at, decidedAt: row.decided_at })))
  })
  router.post('/review/:id/approve', authorize, (req, res) => {
    const row = db.prepare('SELECT * FROM event_review WHERE id=?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '待审核条目不存在' })
    if (row.status !== 'pending') return res.status(409).json({ error: '这条已经处理过了' })
    const base = json(row.event, {})
    const edits = req.body?.event ?? {}
    const event = { ...base }
    for (const field of REVIEW_FIELDS) if (Object.hasOwn(edits, field)) event[field] = edits[field]
    event.title = text(event.title, 160)
    event.start = normaliseTime(event.start)
    event.end = normaliseTime(event.end) || null
    event.venueRaw = text(event.venueRaw, 240)
    event.place = text(event.place, 64) || null
    event.room = text(event.room, 80)
    event.organizer = text(event.organizer, 120)
    event.allDay = !!event.allDay
    event.category = CATS.has(event.category) ? event.category : 'other'
    event.floor = Number.isInteger(event.floor) ? event.floor : null
    event.unmapped = event.place ? '' : event.venueRaw
    if (!event.title || !validStart(event.start)) return res.status(400).json({ error: '请填写活动标题和有效的开始时间' })
    if (event.end && !validStart(event.end)) return res.status(400).json({ error: '结束时间格式不正确' })
    event.id ||= `m-${row.id.replace(/^review-/, '').replace(/[^\w-]/g, '').slice(-12)}`
    event.status = 'active'
    event.reviewedAt = Date.now()
    const result = mergeCatalogEvents(db, [event])
    db.prepare("UPDATE event_review SET status='approved', event=?, decided_at=?, updated_at=? WHERE id=?").run(JSON.stringify(event), Date.now(), Date.now(), row.id)
    res.json({ event, ...result })
  })
  router.post('/review/:id/reject', authorize, (req, res) => {
    const changes = db.prepare("UPDATE event_review SET status='rejected', decided_at=?, updated_at=? WHERE id=? AND status='pending'").run(Date.now(), Date.now(), req.params.id).changes
    if (!changes) return res.status(404).json({ error: '待审核条目不存在或已处理' })
    res.json({ ok: true })
  })
  app.use('/api/events', router)

  const timers = []
  if (schedule) {
    for (const source of sources) {
      const every = source.intervalMinutes * MINUTE
      nextRunAt.set(source.id, Date.now() + (initialRun ? 5_000 : every))
      const tick = () => { nextRunAt.set(source.id, Date.now() + every); void runSource(source, 'schedule') }
      if (initialRun) { const first = setTimeout(() => { if (source.configured()) tick() }, 5_000); first.unref?.(); timers.push(first) }
      const timer = setInterval(() => { if (source.configured()) tick() }, every)
      timer.unref?.(); timers.push(timer)
    }
  }
  return { run: runAll, status, close: () => { for (const timer of timers) { clearTimeout(timer); clearInterval(timer) } } }
}
