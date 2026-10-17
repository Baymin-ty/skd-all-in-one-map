import express from 'express'
import { randomUUID } from 'node:crypto'
import { communitySession, ensureEventTopics } from './community.mjs'

const CATS = new Set(['lecture', 'conference', 'culture', 'student', 'career', 'library', 'international', 'wellbeing', 'campus', 'other'])
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const eventEnd = (value) => value == null || value === '' ? null : text(value, 40)
function accountFor(req, db) {
  const session = communitySession(req, db)
  if (!session) return null
  const account = db.prepare('SELECT email, role FROM accounts WHERE user_id=?').get(session.id)
  return account ? { ...session, account } : null
}
function requireRole(req, res, db, isAdmin, roles = ['organizer', 'admin']) {
  // 后台管理口令与主办方校园账号都能管理活动；口令登录视为管理员。
  const me = isAdmin(req) ? { id: 'admin', account: { role: 'admin' } } : accountFor(req, db)
  if (!me || !roles.includes(me.account.role)) { res.status(401).json({ error: '请使用主办方校园账号登录' }); return null }
  return me
}
function readCatalog(db) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events')
  try { return row ? JSON.parse(row.data) : [] } catch { return [] }
}
function writeCatalog(db, events) {
  db.prepare('INSERT INTO discovery_catalog(kind,data) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET data=excluded.data').run('events', JSON.stringify(events))
  ensureEventTopics(db, events)
}
function normalize(id, body, old = {}, owner) {
  const title = text(body.title ?? old.title, 160)
  const start = text(body.start ?? old.start, 40)
  if (!title || !start) throw new Error('活动标题和开始时间不能为空')
  const category = CATS.has(body.category ?? old.category) ? body.category ?? old.category : 'other'
  return {
    id,
    title,
    title_en: text(body.title_en ?? old.title_en, 160),
    desc_en: text(body.desc_en ?? old.desc_en, 4000),
    start,
    end: eventEnd(body.end ?? old.end),
    allDay: !!(body.allDay ?? old.allDay),
    venueRaw: text(body.venueRaw ?? old.venueRaw, 240),
    place: text(body.place ?? old.place, 64) || null,
    room: text(body.room ?? old.room, 80),
    floor: Number.isInteger(body.floor ?? old.floor) ? body.floor ?? old.floor : null,
    unmapped: text(body.unmapped ?? old.unmapped, 160),
    organizer: text(body.organizer ?? old.organizer, 120),
    speaker: text(body.speaker ?? old.speaker, 160),
    category,
    source: 'organizer',
    owner,
    status: old.status === 'cancelled' ? 'cancelled' : 'active',
    url: text(body.url ?? old.url, 500),
  }
}
function updateEventCatalog(db, event, remove = false) {
  const events = readCatalog(db).filter((item) => item.id !== event.id)
  if (!remove) events.push(event)
  events.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  writeCatalog(db, events)
}

export function installOrganizer(app, db, { isAdmin = () => false } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS custom_events (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`)
  // Recover custom events into the catalog after a crash or when a demo DB was copied.
  const existing = db.prepare('SELECT data FROM custom_events').all().map((row) => JSON.parse(row.data))
  if (existing.length) {
    const catalog = readCatalog(db)
    const byId = new Map(catalog.map((event) => [event.id, event]))
    for (const event of existing) byId.set(event.id, event)
    writeCatalog(db, [...byId.values()])
  }
  const router = express.Router()
  router.use(express.json({ limit: '128kb' }))
  router.get('/', (req, res) => {
    const me = requireRole(req, res, db, isAdmin)
    if (!me) return
    const rows = db.prepare(me.account.role === 'admin' ? 'SELECT data FROM custom_events ORDER BY created_at DESC' : 'SELECT data FROM custom_events WHERE owner=? ORDER BY created_at DESC').all(...(me.account.role === 'admin' ? [] : [me.id]))
    res.json(rows.map((row) => JSON.parse(row.data)))
  })
  router.post('/', (req, res) => {
    const me = requireRole(req, res, db, isAdmin)
    if (!me) return
    let event
    try { event = normalize(`org-${randomUUID().slice(0, 12)}`, req.body || {}, {}, me.id) } catch (error) { return res.status(400).json({ error: error.message }) }
    const now = Date.now()
    db.prepare('INSERT INTO custom_events (id,owner,data,created_at,updated_at) VALUES (?,?,?,?,?)').run(event.id, me.id, JSON.stringify(event), now, now)
    updateEventCatalog(db, event)
    res.status(201).json(event)
  })
  router.put('/:id', (req, res) => {
    const me = requireRole(req, res, db, isAdmin)
    if (!me) return
    const row = db.prepare('SELECT data,owner FROM custom_events WHERE id=?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '自定义活动不存在' })
    if (me.account.role !== 'admin' && row.owner !== me.id) return res.status(403).json({ error: '只能修改自己发布的活动' })
    let event
    try { event = normalize(req.params.id, req.body || {}, JSON.parse(row.data), row.owner) } catch (error) { return res.status(400).json({ error: error.message }) }
    db.prepare('UPDATE custom_events SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(event), Date.now(), event.id)
    updateEventCatalog(db, event)
    res.json(event)
  })
  router.delete('/:id', (req, res) => {
    const me = requireRole(req, res, db, isAdmin)
    if (!me) return
    const row = db.prepare('SELECT data,owner FROM custom_events WHERE id=?').get(req.params.id)
    if (!row) return res.status(404).json({ error: '自定义活动不存在' })
    if (me.account.role !== 'admin' && row.owner !== me.id) return res.status(403).json({ error: '只能删除自己发布的活动' })
    db.prepare('DELETE FROM custom_events WHERE id=?').run(req.params.id)
    updateEventCatalog(db, JSON.parse(row.data), true)
    res.status(204).end()
  })
  app.use('/api/organizer/events', router)
}
