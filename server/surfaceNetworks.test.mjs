import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKUP_TIMEOUT_MESSAGE, BUSY_MESSAGE, installSurfaceNetworks } from './surfaceNetworks.mjs'

const TOKEN = 'local-integration-test'
// 自制小 base grid：public/data/campus.json 的真实栅格是 172×250，测试不需要那么大
const base = { x0: 121.59421, y0: 31.18726, dx: 0.00005695, dy: 0.00004853, rows: ['1100', '1010', '0111'] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let folder, staticDb, app, server, baseUrl, locker, tokenAccepted

async function start(installOptions = {}) {
  mkdirSync(folder, { recursive: true })
  staticDb = new DatabaseSync(join(folder, 'static.db'))
  staticDb.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
  staticDb.exec('CREATE TABLE IF NOT EXISTS surface_networks (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);')
  app = express()
  app.use(express.json({ limit: '256kb' }))
  installSurfaceNetworks(app, staticDb, { grid: base }, { authorize: (req, res, next) => (tokenAccepted && req.get('authorization') === `Bearer ${TOKEN}` ? next() : res.status(401).json({ error: '管理口令不正确或登录已失效' })), ...installOptions })
  // 与 server/index.mjs 的全局 error handler 一致：SurfaceNetworkError 走 400，显式 status（503）优先于兜底 500
  app.use((err, _req, res, _next) => res.status(err.name === 'SurfaceNetworkError' ? 400 : (err.status || 500)).json({ error: err.message }))
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://127.0.0.1:${server.address().port}`
}
function releaseLock() {
  if (!locker) return
  try { locker.exec('ROLLBACK') } catch { /* 已经释放过 */ }
  locker.close(); locker = null
}
async function stop() {
  if (server) { const done = server; server = null; await new Promise((resolve) => done.close(resolve)) }
  releaseLock()
  staticDb?.close(); staticDb = null
  rmSync(folder, { recursive: true, force: true })
}
const call = (path, method = 'GET', body, auth = true) => fetch(baseUrl + path, {
  method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const putRain = (grid, auth = true) => call('/api/surface-networks/rain', 'PUT', { grid }, auth)
// 模拟「另一个没退干净的服务实例 / --write 脚本」：第二个连接持有 static.db 的写锁
function holdWriteLock() {
  locker = new DatabaseSync(join(folder, 'static.db'))
  locker.exec('PRAGMA busy_timeout = 5000')
  locker.exec('BEGIN IMMEDIATE')
  locker.prepare("insert into surface_networks (id,data,updated_at) values ('rain','{}',1) on conflict(id) do update set data=excluded.data, updated_at=excluded.updated_at").run()
}

beforeEach(async () => { folder = mkdtempSync(join(tmpdir(), 'campus-surface-networks-')); tokenAccepted = true; await start() })
afterEach(stop)

describe('surface networks rain save API', () => {
  test('saves the rain grid and reads the same content back', async () => {
    const painted = { ...base, rows: ['1111', '1010', '0111'] }
    const response = await putRain(painted)
    expect(response.status).toBe(200)
    const saved = await response.json()
    expect(saved).toMatchObject({ grid: painted, available: true })
    expect(saved.updatedAt).toBeGreaterThan(0)
    const read = await (await call('/api/surface-networks/rain')).json()
    expect(read).toMatchObject({ grid: painted, available: true, updatedAt: saved.updatedAt })
  })

  test('rejects malformed grids with a Chinese 400 message and writes nothing', async () => {
    const malformed = [
      { ...base, rows: base.rows.slice(0, 2) }, // 行数不对
      { ...base, rows: ['1120', '1010', '0111'] }, // 含非法字符 2
      { ...base, x0: base.x0 + base.dx }, // x0 与 base 不一致
    ]
    for (const grid of malformed) {
      const response = await putRain(grid)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/[\u4e00-\u9fa5]/)
    }
    expect(await (await call('/api/surface-networks/rain')).json()).toMatchObject({ grid: null, available: false })
  })

  test('requires the admin token', async () => {
    tokenAccepted = false
    expect((await putRain(base)).status).toBe(401)
    expect((await call('/api/surface-networks/rain', 'GET', undefined, false)).status).toBe(200) // 读接口不需要口令
  })

  test('returns 503 in ~2s while another connection holds the write lock and keeps the event loop alive', async () => {
    holdWriteLock()
    const startedAt = Date.now()
    const pending = putRain(base)
    await sleep(400) // 此时 PUT 一定卡在 busy 重试循环里：旧实现会同步冻住事件循环 5.5 秒
    const getStartedAt = Date.now()
    const concurrent = await call('/api/surface-networks/default')
    const getMs = Date.now() - getStartedAt
    const response = await pending
    const putMs = Date.now() - startedAt
    console.log(`[surface-networks 锁占用实测] PUT=${putMs}ms 并发 GET=${getMs}ms`)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe(BUSY_MESSAGE)
    expect(putMs).toBeGreaterThan(800) // 确实重试过多轮，不是立刻放弃
    expect(putMs).toBeLessThan(3000) // 预算约 2 秒，绝不重演 5.5 秒同步阻塞
    expect(concurrent.status).toBe(200)
    expect(getMs).toBeLessThan(500) // 事件循环没被冻死
    expect((await concurrent.json()).grid).toEqual(base)
    releaseLock()
    expect((await putRain(base)).status).toBe(200) // 连接上没有残留事务，锁一放开就能保存
  })

  test('finishes the save when the write lock is released during the retry loop', async () => {
    holdWriteLock()
    const startedAt = Date.now()
    const pending = putRain({ ...base, rows: ['0000', '1111', '0111'] })
    await sleep(350)
    releaseLock()
    const response = await pending
    expect(response.status).toBe(200)
    expect(Date.now() - startedAt).toBeGreaterThan(300)
    expect((await (await call('/api/surface-networks/rain')).json()).grid.rows[1]).toBe('1111')
  })

  test('gives up with 503 when the pre-write backup exceeds its budget', async () => {
    await stop()
    let backupFinished = false
    // 注入一个慢备份 + 极小超时：真实 backup() 只要几毫秒，没法稳定地把它拖过阈值
    await start({ backupTimeoutMs: 20, backupFn: () => sleep(500).then(() => { backupFinished = true }) })
    const startedAt = Date.now()
    const response = await putRain(base)
    const elapsed = Date.now() - startedAt
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe(BACKUP_TIMEOUT_MESSAGE)
    expect(elapsed).toBeLessThan(400) // 不等那个 500ms 的慢备份
    expect(backupFinished).toBe(false) // 原备份仍在后台跑，句柄没被强行关掉
    expect((await call('/api/surface-networks/rain')).status).toBe(200) // 事件循环仍然可用
  })
})
