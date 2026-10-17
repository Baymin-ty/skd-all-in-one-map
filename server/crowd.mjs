import express from 'express'
import { randomUUID } from 'node:crypto'
import { communitySession } from './community.mjs'

const WINDOW_MS = 30 * 60_000
const HALF_LIFE_MS = 10 * 60_000
const REPORT_COOLDOWN_MS = 10 * 60_000
const DEFAULT_WAIT_MIN = [0, 5, 30]

class CrowdError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new CrowdError(status, message) }

/** 将最近反馈按十分钟半衰期折算为每个窗口的当前排队情况。 */
export function aggregateCrowd(reports, now = Date.now()) {
  const grouped = new Map()
  for (const report of reports) {
    const createdAt = Number(report.createdAt ?? report.created_at)
    const outletId = report.outletId ?? report.outlet_id
    const level = Number(report.level)
    const waitMin = Number(report.waitMin ?? report.wait_min)
    if (!outletId || !Number.isFinite(createdAt) || !Number.isInteger(level) || level < 0 || level > 2 || !Number.isFinite(waitMin) || waitMin < 0 || createdAt > now || now - createdAt > WINDOW_MS) continue
    const age = Math.max(0, now - createdAt)
    const decay = 2 ** (-age / HALF_LIFE_MS)
    const sourceWeight = report.source === 'staff' ? 2 : 1
    const weight = decay * sourceWeight
    const item = grouped.get(outletId) ?? { level: 0, wait: 0, weight: 0, reports: 0, updatedAt: 0 }
    item.level += level * weight
    item.wait += waitMin * weight
    item.weight += weight
    item.reports++
    item.updatedAt = Math.max(item.updatedAt, createdAt)
    grouped.set(outletId, item)
  }
  return Object.fromEntries([...grouped].map(([outletId, item]) => [outletId, {
    level: Math.max(0, Math.min(2, Math.round(item.level / item.weight))),
    waitMin: Math.max(0, Math.round(item.wait / item.weight)),
    reports: item.reports,
    updatedAt: item.updatedAt,
  }]))
}

function outletExists(db, outletId) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('canteens')
  if (!row) return false
  try {
    const catalog = JSON.parse(row.data)
    return catalog.canteens?.some(c => c.outlets?.some(o => o.id === outletId)) ?? false
  } catch { return false }
}

function checkSameOrigin(req) {
  if (req.get('X-Community-Request') !== '1') fail(403, '请从校园页面操作')
  const origin = req.get('origin')
  if (!origin) return
  try {
    if (new URL(origin).host !== req.get('host')) fail(403, '不允许跨站操作')
  } catch { fail(403, '不允许跨站操作') }
}

export function installCrowd(app, db, { demoMode = process.env.DEMO_MODE === 'true' } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS crowd_reports (
    id TEXT PRIMARY KEY,
    outlet_id TEXT NOT NULL,
    level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 2),
    wait_min INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES community_users(id),
    source TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS crowd_reports_outlet_time ON crowd_reports(outlet_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS crowd_reports_user_time ON crowd_reports(user_id, outlet_id, created_at DESC);`)
  const columns = db.prepare('PRAGMA table_info(crowd_reports)').all().map(column => column.name)
  if (!columns.includes('source')) db.exec("ALTER TABLE crowd_reports ADD COLUMN source TEXT NOT NULL DEFAULT 'user'")

  const router = express.Router()
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.use(express.json({ limit: '32kb' }))
  router.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try { checkSameOrigin(req); next() } catch (error) { next(error) }
    } else next()
  })
  router.get('/', (req, res) => {
    // A simulated timestamp is intentionally accepted only by a demo server.
    // Public deployments must always aggregate against their actual clock.
    const requestedAt = demoMode && typeof req.query.at === 'string' ? Number(req.query.at) : NaN
    const now = Number.isFinite(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now()
    const since = now - WINDOW_MS
    const rows = db.prepare('SELECT outlet_id AS outletId, level, wait_min AS waitMin, source, created_at AS createdAt FROM crowd_reports WHERE created_at >= ? ORDER BY created_at').all(since)
    res.json(aggregateCrowd(rows, now))
  })
  router.post('/:outlet', (req, res, next) => {
    try {
      const outletId = String(req.params.outlet)
      if (!outletExists(db, outletId)) fail(404, '这个食堂窗口不存在')
      const me = communitySession(req, db)
      if (!me) fail(401, '会话已失效，请重新打开交流区')
      const body = req.body ?? {}
      if (!Number.isInteger(body.level) || body.level < 0 || body.level > 2) fail(400, '排队程度不正确')
      const waitMin = body.waitMin === undefined ? DEFAULT_WAIT_MIN[body.level] : body.waitMin
      if (!Number.isInteger(waitMin) || waitMin < 0 || waitMin > 720) fail(400, '预计等待时间不正确')
      const now = Date.now()
      db.exec('BEGIN IMMEDIATE')
      try {
        if (db.prepare('SELECT 1 FROM crowd_reports WHERE user_id=? AND outlet_id=? AND created_at>? LIMIT 1').get(me.id, outletId, now - REPORT_COOLDOWN_MS)) fail(429, '同一窗口十分钟内只能反馈一次')
        db.prepare('INSERT INTO crowd_reports (id,outlet_id,level,wait_min,user_id,source,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), outletId, body.level, waitMin, me.id, 'user', now)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      res.status(201).json({ outletId, level: body.level, waitMin, reports: 1, updatedAt: now, source: 'live' })
    } catch (error) { next(error) }
  })
  router.use((error, _req, res, next) => {
    if (error instanceof CrowdError) return res.status(error.status).json({ error: error.message })
    next(error)
  })
  app.use('/api/crowd', router)
}

export { HALF_LIFE_MS, WINDOW_MS, REPORT_COOLDOWN_MS }
