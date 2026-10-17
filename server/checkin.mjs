import express from 'express'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { communitySession } from './community.mjs'

const SLOT = 5 * 60_000
const CAMPUS_OFFSET = 8 * 60 * 60_000
const stamp = (value) => Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}+08:00`)
const eventEnd = (event) => event.end ? stamp(event.end) : event.allDay ? stamp(event.start.slice(0, 10)) + 86_400_000 : stamp(event.start) + 90 * 60_000
const slotOf = (time) => Math.floor(time / SLOT)

export function checkinCode(eventId, slot, secret) {
  return createHmac('sha256', secret).update(`${eventId}:${slot}`).digest('hex')
}
function loadSecret(root) {
  if (process.env.CHECKIN_SECRET) return process.env.CHECKIN_SECRET
  const file = join(root, 'server/.checkin-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const value = randomBytes(32).toString('base64url')
  writeFileSync(file, value + '\n', { mode: 0o600 })
  return value
}
function eventFrom(db, id) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events')
  if (!row) return null
  try { return JSON.parse(row.data).find((event) => event.id === id) ?? null } catch { return null }
}
function accountFor(req, db) {
  const session = communitySession(req, db)
  if (!session) return null
  return { ...session, account: db.prepare('SELECT email, role FROM accounts WHERE user_id=?').get(session.id) ?? null }
}
function sameOrigin(req) {
  if (req.get('X-Community-Request') !== '1') return false
  const origin = req.get('origin')
  if (!origin) return true
  try { return new URL(origin).host === req.get('host') } catch { return false }
}
function safeEqual(a, b) {
  const aa = Buffer.from(a), bb = Buffer.from(b)
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

export function installCheckin(app, db, root, { demoMode = process.env.DEMO_MODE === 'true', isAdmin = () => false } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_checkins (
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES community_users(id),
    at INTEGER NOT NULL,
    PRIMARY KEY(event_id, user_id)
  );`)
  const secret = loadSecret(root)
  const router = express.Router()
  router.use(express.json({ limit: '16kb' }))
  // Demo links use the same simulated clock as the rest of the walkthrough.
  // Keep this override unavailable on normal deployments so a client cannot
  // move the attendance window backwards or forwards.
  const requestNow = (req) => {
    const requested = demoMode && typeof req.query.at === 'string' ? Number(req.query.at) : NaN
    return Number.isFinite(requested) && requested >= 0 ? requested : Date.now()
  }
  router.get('/:id/checkin-code', (req, res) => {
    const event = eventFrom(db, req.params.id)
    if (!event) return res.status(404).json({ error: '活动不存在' })
    const me = isAdmin(req) ? { id: 'admin', account: { role: 'admin' } } : accountFor(req, db)
    const owner = db.prepare('SELECT owner FROM custom_events WHERE id=?').get(req.params.id)?.owner
    if (!me?.account || !['admin', 'organizer'].includes(me.account.role) || (me.account.role === 'organizer' && owner !== me.id)) return res.status(403).json({ error: '只有活动主办方可以打开签到码' })
    const slot = slotOf(requestNow(req))
    res.json({ eventId: event.id, slot, code: checkinCode(event.id, slot, secret), expiresAt: (slot + 1) * SLOT })
  })
  router.get('/:id/checkins', (req, res) => {
    const event = eventFrom(db, req.params.id)
    if (!event) return res.status(404).json({ error: '活动不存在' })
    const me = accountFor(req, db)
    const row = db.prepare('SELECT count(*) AS count FROM event_checkins WHERE event_id=?').get(event.id)
    res.json({ count: row.count, me: !!me?.account && !!db.prepare('SELECT 1 FROM event_checkins WHERE event_id=? AND user_id=?').get(event.id, me.id) })
  })
  router.post('/:id/checkin', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请从校园页面操作' })
    const event = eventFrom(db, req.params.id)
    if (!event) return res.status(404).json({ error: '活动不存在' })
    const me = accountFor(req, db)
    if (!me?.account) return res.status(401).json({ error: '请先登录校园账号' })
    const now = requestNow(req), start = stamp(event.start), end = eventEnd(event)
    if (now < start - 30 * 60_000 || now > end) return res.status(400).json({ error: '当前不在签到时间内' })
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    const slot = slotOf(now)
    if (![slot, slot - 1].some((value) => safeEqual(code, checkinCode(event.id, value, secret)))) return res.status(400).json({ error: '签到码已过期或不正确' })
    const existing = db.prepare('SELECT at FROM event_checkins WHERE event_id=? AND user_id=?').get(event.id, me.id)
    if (existing) return res.json({ eventId: event.id, checkedIn: true, at: existing.at, duplicate: true })
    db.prepare('INSERT INTO event_checkins (event_id,user_id,at) VALUES (?,?,?)').run(event.id, me.id, now)
    const count = db.prepare('SELECT count(*) AS count FROM event_checkins WHERE event_id=?').get(event.id).count
    res.status(201).json({ eventId: event.id, checkedIn: true, at: now, count })
  })
  app.use('/api/events', router)
  return { secret }
}

export { SLOT }
