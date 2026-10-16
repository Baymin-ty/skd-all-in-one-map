// 后端只管一件事：点位（POI）的增删改，存在 SQLite 里；生产环境顺便提供 dist/ 网页。
import express from 'express'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PORT = Number(process.env.PORT) || 8790
const CATS = ['life', 'dining', 'sports', 'parking', 'transit']
const campus = JSON.parse(readFileSync(join(root, 'public/data/campus.json'), 'utf8'))

// 没设 ADMIN_PASSWORD 时第一次启动随机生成一个，写进只有本机可读的文件，不打印到日志里
function loadPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  const file = join(here, '.admin-password')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const pw = randomBytes(9).toString('base64url')
  writeFileSync(file, pw + '\n', { mode: 0o600 })
  console.log('已生成管理口令：server/.admin-password')
  return pw
}
const digest = (s) => createHash('sha256').update(String(s)).digest()
const passwordHash = digest(loadPassword())

const db = new DatabaseSync(process.env.DB_PATH ?? join(here, 'map.db'))
db.exec('create table if not exists pois (id text primary key, data text not null, updated_at integer not null)')
// 空库时用数据包里的校内点位起步；之后以数据库为准，删掉的点位不会被重新灌回来
if (db.prepare('select count(*) as n from pois').get().n === 0) {
  const { pois } = JSON.parse(readFileSync(join(root, 'public/data/places.json'), 'utf8'))
  const insert = db.prepare('insert into pois (id, data, updated_at) values (?, ?, ?)')
  for (const { id, ...rest } of pois) insert.run(id, JSON.stringify(rest), Date.now())
  console.log(`点位表初始化：${pois.length} 个`)
}

const listPois = () => db.prepare('select id, data from pois order by rowid').all().map((r) => ({ id: r.id, ...JSON.parse(r.data) }))
const getPoi = (id) => {
  const r = db.prepare('select data from pois where id = ?').get(id)
  return r ? { id, ...JSON.parse(r.data) } : null
}

class BadRequest extends Error {}
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const i18n = (v, max) => {
  const zh = text(v?.zh, max)
  const en = text(v?.en, max)
  return zh || en ? { zh, en } : null
}
/** 只留认识的字段，防止前端塞进任意内容 */
function clean(p) {
  const name = i18n(p.name, 40)
  if (!name?.zh) throw new BadRequest('名称不能为空')
  if (!CATS.includes(p.cat)) throw new BadRequest('分类不对')
  const [lng, lat] = Array.isArray(p.pos) ? p.pos.map(Number) : []
  const [[x0, y0], [x1, y1]] = campus.bounds
  if (!(lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1)) throw new BadRequest('位置不在校园地图范围内')
  const out = { name, cat: p.cat, pos: [+lng.toFixed(6), +lat.toFixed(6)], desc: i18n(p.desc, 300) }
  const hours = i18n(p.hours, 60)
  if (hours) out.hours = hours
  if (typeof p.source === 'string' && p.source) out.source = text(p.source, 100)
  return out
}

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer /, '')
  if (token && timingSafeEqual(digest(token), passwordHash)) return next()
  res.status(401).json({ error: '口令不对' })
}

const app = express()
app.use(express.json({ limit: '20kb' }))

app.get('/api/pois', (_req, res) => res.json(listPois()))
app.post('/api/auth', requireAdmin, (_req, res) => res.json({ ok: true }))

app.post('/api/pois', requireAdmin, (req, res) => {
  const data = clean(req.body ?? {})
  const id = 'p-' + randomUUID().slice(0, 8)
  db.prepare('insert into pois (id, data, updated_at) values (?, ?, ?)').run(id, JSON.stringify(data), Date.now())
  res.status(201).json({ id, ...data })
})

// 只带要改的字段即可（比如拖动只传 pos），会合并到原来的点位上
app.put('/api/pois/:id', requireAdmin, (req, res) => {
  const old = getPoi(req.params.id)
  if (!old) return res.status(404).json({ error: '点位不存在' })
  const { id, ...rest } = { ...old, ...req.body, id: old.id }
  const data = clean(rest)
  db.prepare('update pois set data = ?, updated_at = ? where id = ?').run(JSON.stringify(data), Date.now(), id)
  res.json({ id, ...data })
})

app.delete('/api/pois/:id', requireAdmin, (req, res) => {
  const { changes } = db.prepare('delete from pois where id = ?').run(req.params.id)
  if (!changes) return res.status(404).json({ error: '点位不存在' })
  res.status(204).end()
})

app.use('/api', (_req, res) => res.status(404).json({ error: '没有这个接口' }))

const dist = join(root, 'dist')
if (existsSync(dist)) app.use(express.static(dist))

app.use((err, _req, res, _next) => {
  if (err instanceof BadRequest || err.type === 'entity.parse.failed') return res.status(400).json({ error: err.message })
  console.error(err)
  res.status(500).json({ error: '服务器出错了' })
})

app.listen(PORT, () => console.log(`http://localhost:${PORT}`))
