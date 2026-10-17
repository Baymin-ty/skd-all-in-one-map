import { backup, DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须显式写 name：`class X extends Error {}` 不会自动把 name 设成 'X'，index.mjs 靠 err.name 判 400。
class SurfaceNetworkError extends Error { constructor(message) { super(message); this.name = 'SurfaceNetworkError' } }
/** 写锁被别的连接占住：可重试的临时故障，前端会据此自动重试一次 */
class SurfaceNetworkBusyError extends Error { constructor(message) { super(message); this.name = 'SurfaceNetworkBusyError'; this.status = 503 } }
const clone = (v) => JSON.parse(JSON.stringify(v))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// node:sqlite 抛的是 `database is locked`（code 统一为 ERR_SQLITE_ERROR，只有 errcode=5/6 能区分），所以以消息正则为主、errcode 为辅。
const isBusy = (error) => /locked|busy/i.test(String(error?.message ?? '')) || error?.errcode === 5 || error?.errcode === 6
const restoreBusyTimeout = (db) => { try { db.exec('PRAGMA busy_timeout = 5000') } catch { /* 连接已不可用时忽略 */ } }
// BEGIN IMMEDIATE 失败时事务并没有开启，盲目 ROLLBACK 会抛 "no transaction is active" 盖掉真实错误。
const rollbackQuietly = (db) => { try { db.exec('ROLLBACK') } catch { /* 没有活动事务，忽略 */ } }
export const BUSY_MESSAGE = '数据库正被其他连接占用（可能有另一个服务实例或脚本在写 static.db），请稍后重试'
export const BACKUP_TIMEOUT_MESSAGE = '数据库备份超时，请稍后重试'
/**
 * BEGIN IMMEDIATE 是同步阻塞调用：配合 databases.mjs 的 busy_timeout=5000，写锁被占时会同步卡 5.5 秒并冻死整个事件循环。
 * 这里改成「短 busy_timeout + 多次尝试 + 尝试之间 await 让出事件循环」，最长约 2 秒内一定给出结论，期间其他请求照常处理。
 * 返回实际尝试次数，便于日志区分「一次成功」和「重试多次才拿到锁」。
 */
async function beginImmediate(db, { attempts = 10, busyTimeoutMs = 150, waitMs = 120, budgetMs = 2000 } = {}) {
  const started = Date.now()
  // Windows 上 sqlite 默认 busy handler 的 sleep 粒度会把 150ms 放大到 ~220ms，所以再叠一层总预算，保证 PUT 不会顶穿前端超时。
  for (let attempt = 1; attempt <= attempts && Date.now() - started < budgetMs; attempt++) {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
    try {
      db.exec('BEGIN IMMEDIATE')
      return attempt // busy_timeout 保持短值到 COMMIT + checkpoint 之后再恢复，避免检查点被别人的写锁阻塞 5 秒
    } catch (error) {
      restoreBusyTimeout(db)
      if (!isBusy(error)) throw error // 约束冲突等错误立刻抛出，不重试
      if (attempt === attempts || Date.now() - started >= budgetMs) break
      await sleep(waitMs) // 让出事件循环：其他请求和心跳在这里跑
    }
  }
  console.error(`[surface-networks] static.db 写锁被占用，${Date.now() - started}ms 内多次尝试（每次 busy_timeout=${busyTimeoutMs}ms + 等待 ${waitMs}ms）仍未拿到，放弃本次保存`)
  throw new SurfaceNetworkBusyError(BUSY_MESSAGE)
}
export function validateGrid(value, base) {
  const g = value?.grid ?? value
  if (!g || typeof g !== 'object') throw new SurfaceNetworkError('rain 路网必须是 grid 对象')
  for (const key of ['x0', 'y0', 'dx', 'dy']) if (typeof g[key] !== 'number' || !Number.isFinite(g[key])) throw new SurfaceNetworkError('栅格坐标参数无效')
  for (const key of ['x0', 'y0', 'dx', 'dy']) if (g[key] !== base[key]) throw new SurfaceNetworkError('rain 路网坐标参数必须与普通路网一致')
  if (!Array.isArray(g.rows) || g.rows.length !== base.rows.length) throw new SurfaceNetworkError('rain 路网行数不正确')
  if (!g.rows.every((row) => typeof row === 'string' && row.length === base.rows[0].length && /^[01]$/.test(row[0] || '') && [...row].every((ch) => ch === '0' || ch === '1'))) throw new SurfaceNetworkError('rain 路网行列或字符不正确（只能使用 0/1）')
  return { x0: g.x0, y0: g.y0, dx: g.dx, dy: g.dy, rows: [...g.rows] }
}
// 给任何备份实现兜一个上限：超时后原 backup 仍在后台跑完并在自己的 finally 里清理，不要强行 close 句柄。
function withTimeout(task, timeoutMs, message) {
  let timer
  task.catch(() => {}) // 超时后它在后台失败也不该变成 unhandledRejection
  return Promise.race([task, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new SurfaceNetworkBusyError(message)), timeoutMs) })])
    .finally(() => clearTimeout(timer))
}
// 备份走 WAL 快照，不需要写锁；实测 4-7ms，但仍然给它一个上限，不能让它无限拖住保存请求。
async function backupBeforeWrite(db, timeoutMs = 4000) {
  const path = join(tmpdir(), `surface-network-${randomUUID()}.db`)
  let snapshot
  return withTimeout((async () => {
    try {
      await backup(db, path)
      snapshot = new DatabaseSync(path)
      const check = snapshot.prepare('pragma quick_check').get()
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('static.db 备份完整性检查失败')
    } finally { snapshot?.close(); for (const s of ['', '-wal', '-shm']) rmSync(path + s, { force: true }) }
  })(), timeoutMs, BACKUP_TIMEOUT_MESSAGE)
}
export function installSurfaceNetworks(app, staticDb, campus, { authorize, backupTimeoutMs = 4000, backupFn = backupBeforeWrite, busyAttempts = 10, busyTimeoutMs = 150, busyWaitMs = 120, busyBudgetMs = 2000 } = {}) {
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
    let grid
    try { grid = validateGrid(req.body, base) } catch (e) { return next(e) }
    const startedAt = Date.now()
    ;(async () => {
      // 外层再兜一次超时：注入的 backupFn 不一定遵守 timeoutMs，保存请求无论如何不能挂在备份上
      await withTimeout(backupFn(staticDb, backupTimeoutMs), backupTimeoutMs, BACKUP_TIMEOUT_MESSAGE)
      const backupMs = Date.now() - startedAt
      const now = Date.now()
      const tries = await beginImmediate(staticDb, { attempts: busyAttempts, busyTimeoutMs, waitMs: busyWaitMs, budgetMs: busyBudgetMs })
      try {
        staticDb.prepare('insert into surface_networks (id,data,updated_at) values (?,?,?) on conflict(id) do update set data=excluded.data, updated_at=excluded.updated_at').run('rain', JSON.stringify(grid), now)
        staticDb.exec('COMMIT')
        try { staticDb.exec('PRAGMA wal_checkpoint(PASSIVE)') } catch { /* PASSIVE 非阻塞，这次没做成下次再说，不能让 WAL 无限增长 */ }
      } catch (e) { rollbackQuietly(staticDb); throw e }
      finally { restoreBusyTimeout(staticDb) }
      const totalMs = Date.now() - startedAt
      const writeMs = totalMs - backupMs
      if (totalMs > 500) console.warn(`[surface-networks] 保存偏慢 backup=${backupMs}ms write=${writeMs}ms total=${totalMs}ms tries=${tries}`)
      res.json({ grid, updatedAt: now, available: true })
    })().catch(next)
  })
}
export { SurfaceNetworkError, SurfaceNetworkBusyError }
