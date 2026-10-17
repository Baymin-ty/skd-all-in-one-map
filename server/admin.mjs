// 后台专用接口：活动目录整理、讨论管理、菜品维护与系统数据。全部需要管理口令。
import express from 'express'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ensureEventTopics, ensureStallTopics } from './community.mjs'

class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new AdminError(status, message) }
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const i18n = (value, max) => ({ zh: text(value?.zh, max), en: text(value?.en, max) })
const CATS = new Set(['lecture', 'conference', 'culture', 'student', 'career', 'library', 'international', 'wellbeing', 'campus', 'other'])
const MEALS = new Set(['breakfast', 'lunch', 'dinner', 'allday', 'night'])
const EVENT_FIELDS = ['title', 'title_en', 'desc_en', 'start', 'end', 'allDay', 'venueRaw', 'place', 'room', 'organizer', 'speaker', 'category', 'url', 'status']
const stamp = (value) => Date.parse(/[+-]\d\d:\d\d$|Z$/.test(value) ? value : `${value}+08:00`)
const validTime = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(stamp(value))
function eventTime(value) {
  const raw = text(value, 40)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw}:00+08:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw}+08:00`
  return raw
}
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
const count = (db, sql, ...args) => db.prepare(sql).get(...args)?.n ?? 0

function readCatalog(db, kind) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get(kind)
  if (!row) fail(503, kind === 'events' ? '活动目录尚未初始化' : '菜单尚未初始化')
  return JSON.parse(row.data)
}
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE')
  try { const result = action(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
}
function writeEvents(db, events, changed) {
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  transaction(db, () => {
    db.prepare('UPDATE discovery_catalog SET data=? WHERE kind=?').run(JSON.stringify(events), 'events')
    if (changed.length) ensureEventTopics(db, changed)
    // 主办方活动重启时会从 custom_events 恢复进目录，后台改动要一起写回去。
    if (hasTable(db, 'custom_events')) {
      const update = db.prepare('UPDATE custom_events SET data=?, updated_at=? WHERE id=?')
      for (const event of changed) if (event.source === 'organizer') update.run(JSON.stringify(event), Date.now(), event.id)
    }
  })
}

/** 只校验并返回请求里出现的字段。 */
function eventPatch(body, old) {
  const patch = {}
  for (const field of EVENT_FIELDS) if (Object.hasOwn(body, field)) patch[field] = body[field]
  if ('title' in patch) { patch.title = text(patch.title, 160); if (!patch.title) fail(400, '活动标题不能为空') }
  if ('title_en' in patch) patch.title_en = text(patch.title_en, 160)
  if ('desc_en' in patch) patch.desc_en = text(patch.desc_en, 4000)
  if ('start' in patch) { patch.start = eventTime(patch.start); if (!validTime(patch.start)) fail(400, '开始时间格式不正确') }
  if ('end' in patch) { patch.end = eventTime(patch.end) || null; if (patch.end && !validTime(patch.end)) fail(400, '结束时间格式不正确') }
  const start = patch.start ?? old.start, end = 'end' in patch ? patch.end : old.end
  if (end && validTime(start) && stamp(end) < stamp(start)) fail(400, '结束时间不能早于开始时间')
  if ('allDay' in patch) patch.allDay = !!patch.allDay
  if ('venueRaw' in patch) patch.venueRaw = text(patch.venueRaw, 240)
  if ('place' in patch) patch.place = text(patch.place, 64) || null
  if ('room' in patch) patch.room = text(patch.room, 80)
  if ('organizer' in patch) patch.organizer = text(patch.organizer, 120)
  if ('speaker' in patch) patch.speaker = text(patch.speaker, 160)
  if ('category' in patch && !CATS.has(patch.category)) fail(400, '活动分类不正确')
  if ('url' in patch) patch.url = text(patch.url, 500)
  if ('status' in patch && !['active', 'cancelled'].includes(patch.status)) fail(400, '活动状态不正确')
  if ('place' in patch || 'venueRaw' in patch) patch.unmapped = (patch.place ?? old.place) ? '' : (patch.venueRaw ?? old.venueRaw ?? '')
  return patch
}

function cleanDish(body, old, outlet) {
  const zh = text(body.zh, 80)
  if (!zh) fail(400, '菜名不能为空')
  const stall = text(body.stall, 80)
  if (outlet.stalls.length && !outlet.stalls.some((s) => s.zh === stall)) fail(400, '请选择所属档口')
  const price = (value) => {
    if (value === null || value === '' || value === undefined) return null
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 10000) fail(400, '价格需要是 0–10000 之间的数字')
    return Math.round(n * 100) / 100
  }
  if (body.specs != null && (!Array.isArray(body.specs) || body.specs.length > 12)) fail(400, '规格最多 12 个')
  const specs = (body.specs ?? []).map((s) => ({ zh: text(s?.zh, 40), ...(text(s?.en, 60) ? { en: text(s.en, 60) } : {}), price: price(s?.price) })).filter((s) => s.zh)
  const prices = specs.map((s) => s.price).filter((n) => n !== null)
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((t) => text(t, 20)).filter(Boolean))].slice(0, 12) : []
  const meals = Array.isArray(body.meals) ? [...new Set(body.meals.filter((m) => MEALS.has(m)))] : []
  const group = i18n(body.group, 40), desc = i18n(body.desc, 500)
  const photo = text(body.photo, 300)
  if (photo && !/^(photos\/|https:\/\/)/.test(photo)) fail(400, '照片地址需要以 photos/ 或 https:// 开头')
  // 周菜单日期和数据来源由导入脚本维护，后台保留原值。
  const keep = Object.fromEntries(['days', 'source', 'referencePrice', 'photoDate'].filter((key) => old?.[key] !== undefined).map((key) => [key, old[key]]))
  return {
    ...keep,
    ...(stall ? { stall } : {}), zh, ...(text(body.en, 160) ? { en: text(body.en, 160) } : {}),
    price: prices.length ? Math.min(...prices) : price(body.price),
    ...(specs.length ? { specs } : {}),
    ...(text(body.unit, 20) ? { unit: text(body.unit, 20) } : {}),
    ...(tags.length ? { tags } : {}), ...(meals.length ? { meals } : {}),
    ...(group.zh ? { group } : {}), ...(desc.zh || desc.en ? { desc } : {}),
    ...(photo ? { photo } : {}), ...(photo && photo === old?.photo && old.photoDate ? { photoDate: old.photoDate } : {}),
    ...(body.soldOut ? { soldOut: true } : {}), ...(body.sample ? { sample: true } : {}),
    ...(text(body.verify, 200) ? { verify: text(body.verify, 200) } : {}),
  }
}

function fileSize(path) { try { return statSync(path).size } catch { return 0 } }

export function installAdmin(app, { db, staticDb, authorize, root, paths = {}, pipelineStatus = () => null, config = {} }) {
  const startedAt = Date.now()
  const router = express.Router()
  router.use(authorize)
  router.use(express.json({ limit: '256kb' }))
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  // —— 活动目录 ——
  const discussionCounts = () => Object.fromEntries(hasTable(db, 'community_posts')
    ? db.prepare("SELECT substr(topic_id, 7) AS id, count(*) AS n FROM community_posts WHERE topic_id LIKE 'event:%' GROUP BY topic_id").all().map((r) => [r.id, r.n]) : [])
  router.get('/events', (_req, res) => res.json({ events: readCatalog(db, 'events'), discussions: discussionCounts() }))
  router.put('/events/:id', (req, res) => {
    const events = readCatalog(db, 'events')
    const index = events.findIndex((event) => event.id === req.params.id)
    if (index < 0) fail(404, '活动不存在或已被删除')
    const old = events[index], body = req.body ?? {}
    const patch = eventPatch(body, old)
    const next = { ...old, ...patch }
    if (Object.hasOwn(body, 'hidden')) { if (body.hidden) next.hidden = true; else delete next.hidden }
    if (old.source !== 'organizer') {
      // 自动同步的活动：改过的字段记进 manualOverrides，下次同步不会被覆盖。
      const manual = { ...(old.manualOverrides ?? {}) }
      for (const [field, value] of Object.entries(patch)) if (JSON.stringify(old[field]) !== JSON.stringify(value) || Object.hasOwn(manual, field)) manual[field] = value
      if (Object.keys(manual).length) next.manualOverrides = manual
    }
    if (next.status === 'cancelled' && old.status !== 'cancelled') next.cancelledAt = Date.now()
    if (next.status !== 'cancelled') delete next.cancelledAt
    next.editedAt = Date.now()
    events[index] = next
    writeEvents(db, events, [next])
    res.json(next)
  })
  /** 置顶顺序：ids 依次排在前台活动列表最前面，不在列表里的取消置顶。 */
  router.put('/event-pins', (req, res) => {
    const ids = req.body?.ids
    if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string')) fail(400, '置顶列表不正确（最多 50 场）')
    const rank = new Map(ids.map((id, i) => [id, i + 1]))
    const events = readCatalog(db, 'events'), changed = []
    for (let i = 0; i < events.length; i++) {
      const event = events[i], pin = rank.get(event.id)
      if ((event.pin ?? null) === (pin ?? null)) continue
      const next = { ...event }
      if (pin) next.pin = pin; else delete next.pin
      events[i] = next; changed.push(next)
    }
    if (changed.length) writeEvents(db, events, changed)
    res.json({ pins: events.filter((event) => event.pin).sort((a, b) => a.pin - b.pin).map((event) => event.id) })
  })

  // —— 讨论管理 ——
  const topicName = (topicId) => db.prepare('SELECT name, type FROM community_topics WHERE id=?').get(topicId) ?? { name: topicId, type: topicId.split(':')[0] }
  const postJson = (p) => ({
    id: p.id, title: p.title, content: p.content, tag: p.tag, createdAt: p.created_at,
    author: db.prepare('SELECT id, name FROM community_users WHERE id=?').get(p.user_id) ?? { id: p.user_id, name: '已注销用户' },
    topic: { id: p.topic_id, ...topicName(p.topic_id) },
    images: db.prepare('SELECT id FROM community_images WHERE post_id=? ORDER BY rowid').all(p.id).map((x) => `/api/community/images/${x.id}`),
    likes: count(db, "SELECT count(*) AS n FROM community_reactions WHERE post_id=? AND kind='like'", p.id),
    comments: count(db, 'SELECT count(*) AS n FROM community_comments WHERE post_id=?', p.id),
  })
  router.get('/community', (req, res) => {
    if (!hasTable(db, 'community_posts')) return res.json({ posts: [], total: 0, hasMore: false, stats: {} })
    const type = ['event', 'stall', 'place'].includes(req.query.type) ? req.query.type : ''
    const topic = typeof req.query.topic === 'string' ? req.query.topic.slice(0, 200) : ''
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
    const offset = /^\d{1,6}$/.test(String(req.query.offset ?? '0')) ? Number(req.query.offset ?? 0) : 0
    const where = "(?='' OR p.topic_id LIKE ? || ':%') AND (?='' OR p.topic_id=?) AND (?='' OR instr(p.title,?)>0 OR instr(p.content,?)>0 OR instr(t.name,?)>0)"
    const args = [type, type, topic, topic, q, q, q, q]
    const from = 'FROM community_posts p LEFT JOIN community_topics t ON t.id=p.topic_id'
    const posts = db.prepare(`SELECT p.* ${from} WHERE ${where} ORDER BY p.created_at DESC, p.rowid DESC LIMIT 30 OFFSET ?`).all(...args, offset)
    const total = count(db, `SELECT count(*) AS n ${from} WHERE ${where}`, ...args)
    const day = Date.now() - 86_400_000
    res.json({
      posts: posts.map(postJson), total, hasMore: offset + posts.length < total,
      stats: {
        posts: count(db, 'SELECT count(*) AS n FROM community_posts'),
        comments: count(db, 'SELECT count(*) AS n FROM community_comments'),
        today: count(db, 'SELECT count(*) AS n FROM community_posts WHERE created_at>?', day) + count(db, 'SELECT count(*) AS n FROM community_comments WHERE created_at>?', day),
        byType: Object.fromEntries(db.prepare("SELECT substr(topic_id, 1, instr(topic_id, ':') - 1) AS type, count(*) AS n FROM community_posts GROUP BY type").all().map((r) => [r.type, r.n])),
      },
    })
  })
  router.get('/community/posts/:id/comments', (req, res) => {
    if (!db.prepare('SELECT 1 FROM community_posts WHERE id=?').get(req.params.id)) fail(404, '这篇笔记已被删除')
    const rows = db.prepare('SELECT * FROM community_comments WHERE post_id=? ORDER BY created_at, rowid LIMIT 500').all(req.params.id)
    res.json(rows.map((c) => ({ id: c.id, content: c.content, createdAt: c.created_at, parentId: c.parent_id, author: db.prepare('SELECT id, name FROM community_users WHERE id=?').get(c.user_id) ?? { id: c.user_id, name: '已注销用户' } })))
  })
  router.delete('/community/posts/:id', (req, res) => {
    const post = db.prepare('SELECT * FROM community_posts WHERE id=?').get(req.params.id) ?? fail(404, '这篇笔记已被删除')
    transaction(db, () => {
      db.prepare('DELETE FROM community_posts WHERE id=?').run(post.id)
      db.prepare('DELETE FROM community_summaries WHERE topic_id=?').run(post.topic_id)
    })
    res.status(204).end()
  })
  router.delete('/community/comments/:id', (req, res) => {
    const comment = db.prepare('SELECT c.id, p.topic_id FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.id=?').get(req.params.id) ?? fail(404, '评论已被删除')
    transaction(db, () => {
      db.prepare('DELETE FROM community_comments WHERE id=?').run(comment.id)
      db.prepare('DELETE FROM community_summaries WHERE topic_id=?').run(comment.topic_id)
    })
    res.status(204).end()
  })

  // —— 菜品 ——
  function withOutlet(req, change) {
    const dining = readCatalog(db, 'canteens')
    const canteen = dining.canteens.find((c) => c.id === req.params.canteen) ?? fail(404, '食堂不存在')
    const outlet = canteen.outlets.find((o) => o.id === req.params.outlet) ?? fail(404, '这个楼层或窗口不存在')
    const result = change(outlet, canteen)
    transaction(db, () => {
      db.prepare('UPDATE discovery_catalog SET data=? WHERE kind=?').run(JSON.stringify(dining), 'canteens')
      if (hasTable(db, 'community_topics')) ensureStallTopics(db, [{ ...canteen, outlets: [outlet] }])
    })
    return result
  }
  const dishPath = '/canteens/:canteen/outlets/:outlet/dishes'
  router.post(dishPath, (req, res) => {
    const dish = withOutlet(req, (outlet) => {
      const data = cleanDish(req.body ?? {}, null, outlet)
      const stall = outlet.stalls.find((s) => s.zh === data.stall)
      const dish = { id: `${stall?.id ?? outlet.id}-${randomBytes(3).toString('hex').slice(0, 5)}`, ...data }
      // 新菜放在同档口最后一道菜后面，前台按档口分组时位置自然
      const after = outlet.dishes.findLastIndex((d) => d.stall === dish.stall)
      outlet.dishes.splice(after < 0 ? outlet.dishes.length : after + 1, 0, dish)
      delete outlet.menuPending
      return dish
    })
    res.status(201).json(dish)
  })
  router.put(`${dishPath}/:dish`, (req, res) => {
    const dish = withOutlet(req, (outlet) => {
      const index = outlet.dishes.findIndex((d) => d.id === req.params.dish)
      if (index < 0) fail(404, '菜品不存在')
      const next = { id: outlet.dishes[index].id, ...cleanDish({ ...outlet.dishes[index], ...req.body }, outlet.dishes[index], outlet) }
      outlet.dishes[index] = next
      return next
    })
    res.json(dish)
  })
  router.delete(`${dishPath}/:dish`, (req, res) => {
    withOutlet(req, (outlet) => {
      const index = outlet.dishes.findIndex((d) => d.id === req.params.dish)
      if (index < 0) fail(404, '菜品不存在')
      outlet.dishes.splice(index, 1)
    })
    res.status(204).end()
  })

  // —— 系统数据 ——
  router.get('/system', (_req, res) => {
    const now = Date.now()
    const list = (table) => hasTable(staticDb, table) ? staticDb.prepare(`SELECT data, updated_at FROM ${table}`).all() : []
    const buildings = list('buildings'), pois = list('pois')
    const ugRow = hasTable(staticDb, 'underground_maps') ? staticDb.prepare('SELECT data, updated_at FROM underground_maps WHERE id=?').get('default') : null
    const underground = ugRow ? JSON.parse(ugRow.data) : config.defaultUnderground ?? null
    const events = readCatalog(db, 'events')
    const upcoming = events.filter((e) => !e.hidden && e.status !== 'cancelled' && stamp(e.end || e.start) > now)
    const dining = readCatalog(db, 'canteens')
    const outlets = dining.canteens.flatMap((c) => c.outlets)
    const dishes = outlets.flatMap((o) => o.dishes)
    const pipeline = pipelineStatus()
    const backupDir = join(root, 'server/backups')
    const databases = [['地图库', 'static.db', paths.staticPath], ['业务库', 'dynamic.db', paths.dynamicPath]].filter(([, , path]) => path).map(([label, name, path]) => ({
      label, name: basename(path) || name, size: fileSize(path), wal: fileSize(`${path}-wal`),
    }))
    res.json({
      generatedAt: now,
      server: { startedAt, node: process.version, platform: `${process.platform} ${process.arch}`, memory: process.memoryUsage().rss, port: Number(process.env.PORT ?? 8790) },
      config: {
        mapSettings: config.mapSettings ?? null,
        passwordSource: process.env.ADMIN_PASSWORD ? '环境变量 ADMIN_PASSWORD' : 'server/.admin-password',
        aiSummary: !!process.env.DEEPSEEK_API_KEY, aiModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        mail: !!process.env.EVENT_IMAP_URL, mailLogin: !!(process.env.SMTP_URL && process.env.MAIL_FROM),
        scheduleVision: !!(process.env.SCHEDULE_VISION_API_KEY || process.env.DEEPSEEK_API_KEY),
        eventSchedule: pipeline?.schedule ?? null,
        demoMode: process.env.DEMO_MODE === 'true',
      },
      databases,
      map: {
        buildings: buildings.length, pois: pois.length,
        entrances: buildings.reduce((n, row) => n + (JSON.parse(row.data).entrances?.length ?? 0), 0),
        updatedAt: Math.max(0, ...buildings.map((r) => r.updated_at), ...pois.map((r) => r.updated_at)) || null,
        underground: underground ? { nodes: underground.nodes?.length ?? 0, edges: underground.edges?.length ?? 0, connectors: underground.connectors?.length ?? 0, points: underground.points?.length ?? 0, updatedAt: ugRow?.updated_at ?? null } : null,
      },
      events: {
        total: events.length, upcoming: upcoming.length,
        hidden: events.filter((e) => e.hidden).length, pinned: events.filter((e) => e.pin).length,
        cancelled: events.filter((e) => e.status === 'cancelled').length,
        edited: events.filter((e) => e.manualOverrides || e.editedAt).length,
        bySource: events.reduce((all, e) => ({ ...all, [e.source]: (all[e.source] ?? 0) + 1 }), {}),
        review: pipeline?.review ?? null,
        lastSuccess: Math.max(0, ...(pipeline?.sources ?? []).map((s) => s.lastSuccessAt ?? 0)) || null,
        sources: (pipeline?.sources ?? []).map((s) => ({ id: s.id, label: s.label, configured: s.configured, lastRun: s.lastRun ? { status: s.lastRun.status, startedAt: s.lastRun.startedAt } : null })),
      },
      dining: {
        canteens: dining.canteens.length, outlets: outlets.length, stalls: outlets.reduce((n, o) => n + o.stalls.length, 0),
        dishes: dishes.length, soldOut: dishes.filter((d) => d.soldOut).length, photos: dishes.filter((d) => d.photo).length,
        latestMenu: outlets.map((o) => o.menuDate).filter(Boolean).sort().at(-1) ?? null,
      },
      users: {
        accounts: hasTable(db, 'accounts') ? count(db, 'SELECT count(*) AS n FROM accounts') : 0,
        organizers: hasTable(db, 'accounts') ? count(db, "SELECT count(*) AS n FROM accounts WHERE role IN ('organizer','admin')") : 0,
        sessions: hasTable(db, 'community_sessions') ? count(db, 'SELECT count(*) AS n FROM community_sessions WHERE expires_at>?', now) : 0,
        posts: hasTable(db, 'community_posts') ? count(db, 'SELECT count(*) AS n FROM community_posts') : 0,
        comments: hasTable(db, 'community_comments') ? count(db, 'SELECT count(*) AS n FROM community_comments') : 0,
        checkins: hasTable(db, 'event_checkins') ? count(db, 'SELECT count(*) AS n FROM event_checkins') : 0,
        crowd24h: hasTable(db, 'crowd_reports') ? count(db, 'SELECT count(*) AS n FROM crowd_reports WHERE created_at>?', now - 86_400_000) : 0,
      },
      backups: existsSync(backupDir) ? readdirSync(backupDir).filter((name) => !name.startsWith('.')).map((name) => {
        const stat = statSync(join(backupDir, name))
        return { name, size: stat.size, modifiedAt: stat.mtimeMs }
      }).sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 20) : [],
    })
  })

  router.use((err, _req, res, next) => {
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message })
    next(err)
  })
  app.use('/api/admin', router)
}
