// 地图管理使用管理口令；社区使用独立的匿名会话与内容所有权。
import express from 'express'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { installCommunity } from './community.mjs'
import { installCrowd } from './crowd.mjs'
import { installEventSync, loadVenueResolver } from './eventSync.mjs'
import { installEventPipeline } from './eventPipeline.mjs'
import { installAccount } from './account.mjs'
import { installCheckin } from './checkin.mjs'
import { installOrganizer } from './organizer.mjs'
import { installSchedule } from './schedule.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'))
const campus = JSON.parse(readFileSync(join(root, 'public/data/campus.json'), 'utf8'))
const seed = JSON.parse(readFileSync(join(root, 'public/data/places.json'), 'utf8'))
const defaultUnderground = JSON.parse(readFileSync(join(root, 'public/data/underground.json'), 'utf8'))
const defaultMapSettings = JSON.parse(readFileSync(join(root, 'public/data/map-settings.json'), 'utf8'))
function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  const file = join(here, '.admin-password')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const pw = randomBytes(18).toString('base64url')
  writeFileSync(file, pw + '\n', { mode: 0o600 })
  console.log('已生成管理口令：server/.admin-password')
  return pw
}
const digest = (s) => createHash('sha256').update(String(s)).digest()
const passwordHash = digest(loadPassword())
const db = new DatabaseSync(process.env.DB_PATH ?? join(here, 'map.db'))
db.exec(`pragma journal_mode = WAL;
  create table if not exists meta (key text primary key, value text not null);
  create table if not exists pois (id text primary key, data text not null, updated_at integer not null);
  create table if not exists buildings (id text primary key, data text not null, updated_at integer not null);`)
// 初始化标记与记录同一事务提交，清空一个分类后重启也不会把已删除内容重新导入。
for (const table of ['pois', 'buildings']) {
  if (!db.prepare('select 1 from meta where key = ?').get(`${table}.seeded`)) {
    db.exec('begin immediate')
    try {
      if (!db.prepare(`select 1 from ${table} limit 1`).get()) {
        const insert = db.prepare(`insert into ${table} (id, data, updated_at) values (?, ?, ?)`)
        for (const { id, ...data } of seed[table]) insert.run(id, JSON.stringify(data), Date.now())
      }
      db.prepare('insert into meta (key, value) values (?, ?)').run(`${table}.seeded`, '1')
      db.exec('commit')
    } catch (error) { db.exec('rollback'); throw error }
  }
}
const list = (table) => db.prepare(`select id, data from ${table} order by rowid`).all().map((r) => ({ id: r.id, ...JSON.parse(r.data) }))
const get = (table, id) => {
  const r = db.prepare(`select data from ${table} where id = ?`).get(id)
  return r ? { id, ...JSON.parse(r.data) } : null
}
class BadRequest extends Error {}
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const i18n = (v, max) => ({ zh: text(v?.zh, max), en: text(v?.en, max) })
function position(v) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new BadRequest('坐标必须是两个有效数字')
  const [lng, lat] = v
  const [[x0, y0], [x1, y1]] = campus.bounds
  if (!(lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1)) throw new BadRequest('位置不在校园地图范围内')
  return [+lng.toFixed(6), +lat.toFixed(6)]
}
function clean(table, p) {
  const name = i18n(p.name, 120)
  if (!name.zh) throw new BadRequest('中文名称不能为空')
  if (table === 'pois') {
    if (!['life', 'dining', 'sports', 'parking', 'transit'].includes(p.cat)) throw new BadRequest('点位分类不正确')
    // 停车点位可细分为地下车库的车行坡道、步行楼梯、电梯
    if (p.kind != null && (p.cat !== 'parking' || !['garage-ramp', 'garage-stairs', 'garage-elevator'].includes(p.kind))) throw new BadRequest('点位细分不正确')
    return { name, cat: p.cat, ...(p.kind ? { kind: p.kind } : {}), pos: position(p.pos), desc: i18n(p.desc, 2000), hours: i18n(p.hours, 120), source: text(p.source, 100),
      ...(p.aliases ? { aliases: Array.isArray(p.aliases) ? p.aliases.map((s) => text(s, 120)).filter(Boolean).slice(0, 100) : [] } : {}) }
  }
  if (!Object.hasOwn(seed.categories, p.cat)) throw new BadRequest('楼宇分类不正确')
  if (!Array.isArray(p.poly) || p.poly.length < 3 || p.poly.length > 500) throw new BadRequest('楼宇轮廓需要 3–500 个顶点')
  const poly = p.poly.map(position)
  const area = Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + (a[0] - poly[0][0]) * (b[1] - poly[0][1]) - (b[0] - poly[0][0]) * (a[1] - poly[0][1]) }, 0))
  if (area < 1e-12) throw new BadRequest('楼宇轮廓面积不能为零')
  if (p.parts != null && (!Array.isArray(p.parts) || p.parts.length > 32)) throw new BadRequest('附属轮廓数据不正确')
  const parts = (p.parts ?? []).map((ring) => {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > 500) throw new BadRequest('附属轮廓需要 3–500 个顶点')
    const points = ring.map(position)
    const area = Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + (a[0] - points[0][0]) * (b[1] - points[0][1]) - (b[0] - points[0][0]) * (a[1] - points[0][1]) }, 0))
    if (area < 1e-12) throw new BadRequest('附属轮廓面积不能为零')
    return points
  })
  if (p.entrances != null && (!Array.isArray(p.entrances) || p.entrances.length > 100)) throw new BadRequest('出入口数据不正确')
  return {
    name, short: { zh: text(p.short?.zh, 40) || name.zh, en: text(p.short?.en, 60) || name.en }, cat: p.cat,
    aliases: Array.isArray(p.aliases) ? p.aliases.map((s) => text(s, 120)).filter(Boolean).slice(0, 100) : [],
    center: position(p.center), poly, ...(p.parts !== undefined ? { parts } : {}),
    orgs: Array.isArray(p.orgs) ? p.orgs.map((o) => i18n(o, 120)).filter((o) => o.zh || o.en).slice(0, 100) : [],
    rooms: Array.isArray(p.rooms) ? p.rooms.slice(0, 1000) : [],
    info: i18n(p.info, 2000), note: i18n(p.note, 2000), hours: i18n(p.hours, 120),
    entrances: (p.entrances ?? []).map((e) => ({ pos: position(e?.pos), zh: text(e?.zh, 60), en: text(e?.en, 100) })),
    walkway: !!p.walkway, isNew: !!p.isNew,
  }
}
function undergroundStatus(value) {
  if (!['candidate', 'confirmed', 'rejected'].includes(value)) throw new BadRequest('地下数据状态不正确')
  return value
}
function undergroundPoint(value) { return position(value) }
function cleanUnderground(p) {
  if (!p || typeof p !== 'object') throw new BadRequest('地下手绘数据格式不正确')
  const floor = Number.isInteger(p.floor) ? p.floor : -1
  if (!Array.isArray(p.bounds) || p.bounds.length !== 2) throw new BadRequest('地下地图范围不正确')
  const bounds = p.bounds.map(undergroundPoint)
  const sources = Array.isArray(p.sources) ? p.sources.map((source) => {
    if (!source?.id || !source?.image || !Array.isArray(source.anchors) || source.anchors.length < 2) throw new BadRequest('地下图纸来源不完整')
    return {
      id: text(source.id, 120), title: text(source.title, 160), image: text(source.image, 500), floor: Number.isInteger(source.floor) ? source.floor : floor,
      anchors: source.anchors.map((anchor) => {
        if (!Array.isArray(anchor?.image) || anchor.image.length !== 2 || anchor.image.some((value) => typeof value !== 'number' || value < 0 || value > 1)) throw new BadRequest('地下图纸锚点不正确')
        return { image: [+anchor.image[0], +anchor.image[1]], pos: undergroundPoint(anchor.pos) }
      }),
      ...(source.alignment ? { alignment: source.alignment === 'reviewed' ? 'reviewed' : 'approximate' } : {}),
      ...(source.note ? { note: text(source.note, 2000) } : {}),
    }
  }) : []
  const ids = new Set()
  const id = (value, prefix) => {
    const result = text(value, 120)
    if (!result || ids.has(result)) throw new BadRequest('地下对象 id 重复或为空')
    ids.add(result); return result || prefix
  }
  const nodes = Array.isArray(p.nodes) ? p.nodes.map((node) => ({ id: id(node?.id, 'ug-node'), pos: undergroundPoint(node?.pos) })) : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const roads = Array.isArray(p.roads) ? p.roads.map((road) => {
    if (!Array.isArray(road?.path) || road.path.length < 2 || road.path.length > 1000) throw new BadRequest('地下道路至少需要两个点')
    if (!['car', 'walk'].includes(road.mode)) throw new BadRequest('地下道路模式不正确')
    const direction = ['in', 'out', 'both'].includes(road.direction) ? road.direction : 'both'
    return { id: id(road.id, 'ug-road'), floor: Number.isInteger(road.floor) ? road.floor : floor, mode: road.mode, direction, status: undergroundStatus(road.status), path: road.path.map(undergroundPoint),
      ...(road.source ? { source: text(road.source, 120) } : {}), ...(road.note ? { note: text(road.note, 2000) } : {}) }
  }) : []
  const connectors = Array.isArray(p.connectors) ? p.connectors.map((connector) => {
    if (!['ramp', 'stairs', 'elevator', 'unknown'].includes(connector.kind)) throw new BadRequest('地下连接点类型不正确')
    const floorFrom = Number.isInteger(connector.floorFrom) ? connector.floorFrom : 0
    const floorTo = Number.isInteger(connector.floorTo) ? connector.floorTo : floor
    if (floorFrom === floorTo) throw new BadRequest('地下连接点楼层不能相同')
    return { id: id(connector.id, 'ug-connector'), floorFrom, floorTo, kind: connector.kind, status: undergroundStatus(connector.status), pos: undergroundPoint(connector.pos),
      ...(connector.source ? { source: text(connector.source, 120) } : {}), ...(connector.linkedPoiId ? { linkedPoiId: text(connector.linkedPoiId, 120) } : {}), ...(connector.note ? { note: text(connector.note, 2000) } : {}) }
  }) : []
  const points = Array.isArray(p.points) ? p.points.map((point) => {
    const pointId = id(point?.id, 'ug-point')
    if (!nodeIds.has(point?.endpointId1) || !nodeIds.has(point?.endpointId2) || point.endpointId1 === point.endpointId2) throw new BadRequest('地下图片点端点不正确')
    const weights = [point.endpointWeight1, point.endpointWeight2]
    if (!weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1) || Math.abs(weights[0] + weights[1] - 1) > 1e-6) throw new BadRequest('地下图片点权重不正确')
    const imageId = text(point.imageId, 200)
    if (!imageId) throw new BadRequest('地下图片点必须绑定图片 ID')
    return { id: pointId, endpointId1: point.endpointId1, endpointWeight1: +weights[0].toFixed(6), endpointId2: point.endpointId2, endpointWeight2: +weights[1].toFixed(6), imageId }
  }) : []
  return { version: Number.isInteger(p.version) ? p.version : 1, floor, bounds, sources, nodes, roads, connectors, points }
}
function isAdmin(req) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer /, '')
  const tokenDigest = token && digest(token)
  return !!tokenDigest && tokenDigest.length === passwordHash.length && timingSafeEqual(tokenDigest, passwordHash)
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next()
  res.status(401).json({ error: '管理口令不正确或登录已失效' })
}
const app = express()
app.disable('x-powered-by')
app.enable('strict routing')
installCommunity(app, db, root)
installAccount(app, db)
// 课表截图使用独立的 6 MB JSON 限制，必须先于通用 256 KB 解析器挂载。
installSchedule(app)
app.use(express.json({ limit: '256kb' }))
installCrowd(app, db)
// 官网同步由活动数据管道统一定时运行；/api/events/sync 仍保留给旧的手动入口。
const venueResolver = loadVenueResolver(root)
const eventSync = installEventSync(app, db, root, { authorize: requireAdmin, resolver: venueResolver, schedule: false, initialSync: false })
const eventPipeline = installEventPipeline(app, db, { authorize: requireAdmin, eventSync, resolver: venueResolver })
installCheckin(app, db, root, { isAdmin })
installOrganizer(app, db, { isAdmin })
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
app.get('/api/places', (_req, res) => res.json({ categories: seed.categories, buildings: list('buildings'), pois: list('pois') }))
app.post('/api/auth', requireAdmin, (_req, res) => res.json({ ok: true }))
app.get('/api/map-settings', (_req, res) => {
  const row = db.prepare('select value from meta where key = ?').get('map.settings')
  res.json(row ? JSON.parse(row.value) : defaultMapSettings)
})
app.get('/api/underground', (_req, res) => {
  const row = db.prepare('select value from meta where key = ?').get('underground.map')
  res.json(row ? JSON.parse(row.value) : defaultUnderground)
})
app.put('/api/underground', requireAdmin, (req, res) => {
  const map = cleanUnderground(req.body ?? {})
  db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .run('underground.map', JSON.stringify(map))
  res.json(map)
})
app.put('/api/map-settings', requireAdmin, (req, res) => {
  const settings = {}
  for (const key of Object.keys(defaultMapSettings)) {
    const value = req.body?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      throw new BadRequest('三项透明度都必须是 0%–100% 的有效数字')
    settings[key] = value
  }
  db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .run('map.settings', JSON.stringify(settings))
  res.json(settings)
})
for (const table of ['pois', 'buildings']) {
  app.get(`/api/${table}`, (_req, res) => res.json(list(table)))
  app.post(`/api/${table}`, requireAdmin, (req, res) => {
    const data = clean(table, req.body ?? {})
    const id = (table === 'pois' ? 'p-' : 'b-') + randomUUID().slice(0, 8)
    db.prepare(`insert into ${table} (id, data, updated_at) values (?, ?, ?)`).run(id, JSON.stringify(data), Date.now())
    res.status(201).json({ id, ...data })
  })
  app.put(`/api/${table}/:id`, requireAdmin, (req, res) => {
    const old = get(table, req.params.id)
    if (!old) return res.status(404).json({ error: '记录不存在' })
    const data = clean(table, { ...old, ...req.body })
    db.prepare(`update ${table} set data = ?, updated_at = ? where id = ?`).run(JSON.stringify(data), Date.now(), old.id)
    res.json({ id: old.id, ...data })
  })
  app.delete(`/api/${table}/:id`, requireAdmin, (req, res) => {
    if (!db.prepare(`delete from ${table} where id = ?`).run(req.params.id).changes) return res.status(404).json({ error: '记录不存在' })
    res.status(204).end()
  })
}
app.use('/api', (_req, res) => res.status(404).json({ error: '没有这个接口' }))
app.get('/admin', (_req, res) => res.redirect(302, '/admin/'))
const dist = join(root, 'dist')
if (existsSync(dist)) app.use(express.static(dist))
app.use((err, _req, res, _next) => {
  if (err instanceof BadRequest || err.type === 'entity.parse.failed') return res.status(400).json({ error: err instanceof BadRequest ? err.message : 'JSON 格式不正确' })
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '数据过大，请减少内容后重试' })
  console.error(err)
  res.status(500).json({ error: '服务器出错了' })
})
const server = app.listen(Number(process.env.PORT ?? 8790))
server.once('listening', () => console.log(`http://localhost:${server.address()?.port ?? process.env.PORT ?? 8790}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { eventPipeline.close(); server.close(() => { db.close(); process.exit(0) }) })
