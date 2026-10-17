import { backup, DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class SurfaceNetworkError extends Error {}
const clone = (v) => JSON.parse(JSON.stringify(v))
export function validateGrid(value, base) {
  const g = value?.grid ?? value
  if (!g || typeof g !== 'object') throw new SurfaceNetworkError('rain 路网必须是 grid 对象')
  for (const key of ['x0', 'y0', 'dx', 'dy']) if (typeof g[key] !== 'number' || !Number.isFinite(g[key])) throw new SurfaceNetworkError('栅格坐标参数无效')
  for (const key of ['x0', 'y0', 'dx', 'dy']) if (g[key] !== base[key]) throw new SurfaceNetworkError('rain 路网坐标参数必须与普通路网一致')
  if (!Array.isArray(g.rows) || g.rows.length !== base.rows.length) throw new SurfaceNetworkError('rain 路网行数不正确')
  if (!g.rows.every((row) => typeof row === 'string' && row.length === base.rows[0].length && /^[01]$/.test(row[0] || '') && [...row].every((ch) => ch === '0' || ch === '1'))) throw new SurfaceNetworkError('rain 路网行列或字符不正确（只能使用 0/1）')
  return { x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy, rows: [...g.rows] }
}
async function backupBeforeWrite(db) {
  const path = join(tmpdir(), `surface-network-${randomUUID()}.db`)
  let snapshot
  try {
    await backup(db, path)
    snapshot = new DatabaseSync(path)
    const check = snapshot.prepare('pragma quick_check').get()
    if (!check || Object.values(check)[0] !== 'ok') throw new Error('static.db 备份完整性检查失败')
  } finally { snapshot?.close(); for (const s of ['', '-wal', '-shm']) rmSync(path + s, { force: true }) }
}
export function installSurfaceNetworks(app, staticDb, campus, { authorize } = {}) {
  const base = campus.grid
  const defaultGrid = () => clone(base)
  app.get('/api/surface-networks', (_req, res) => {
    const row = staticDb.prepare('select data, updated_at from surface_networks where id=?').get('rain')
    res.json({ default: defaultGrid(), rain: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? 0 })
  })
  app.get('/api/surface-networks/:version', (req, res) => {
    if (req.params.version === 'default') return res.json({ grid: defaultGrid(), updatedAt: 0, available: true })
    if (req.params.version !== 'rain') return res.status(404).json({ error: '没有这个路网版本' })
    const row = staticDb.prepare('select data, updated_at from surface_networks where id=?').get('rain')
    return res.json({ grid: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? 0, available: !!row })
  })
  app.put('/api/surface-networks/rain', authorize || ((_req, _res, next) => next()), (req, res, next) => {
    try {
      const grid = validateGrid(req.body, base)
      return backupBeforeWrite(staticDb).then(() => {
        const now = Date.now()
        staticDb.exec('BEGIN IMMEDIATE')
        try {
          staticDb.prepare('insert into surface_networks (id,data,updated_at) values (?,?,?) on conflict(id) do update set data=excluded.data, updated_at=excluded.updated_at').run('rain', JSON.stringify(grid), now)
          staticDb.exec('COMMIT')
        } catch (e) { staticDb.exec('ROLLBACK'); throw e }
        res.json({ grid, updatedAt: now, available: true })
      }).catch(next)
    } catch (e) { next(e) }
  })
}
export { SurfaceNetworkError }
