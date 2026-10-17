import { beforeEach, afterEach, describe, expect, test } from 'vitest'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installCommunity } from './community.mjs'
import { aggregateCrowd, installCrowd } from './crowd.mjs'

const root = resolve('.')
const dining = JSON.parse(readFileSync(join(root, 'public/data/canteens.json'), 'utf8'))
const outlet = dining.canteens[0].outlets[0]
let db, server, base, folder, cookie

async function start() {
  db = new DatabaseSync(join(folder, 'test.db'))
  const app = express()
  installCommunity(app, db, root)
  installCrowd(app, db)
  app.use((err, _req, res, _next) => res.status(err.type === 'entity.too.large' ? 413 : err.status || 500).json({ error: err.message || 'request failed' }))
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
  const session = await fetch(base + '/api/community/session', { method: 'POST', headers: { 'X-Community-Request': '1' } })
  expect(session.headers.get('set-cookie')).toMatch(/Path=\/api(?:;|$)/)
  cookie = session.headers.get('set-cookie').split(';')[0]
}
async function stop() {
  await new Promise(resolve => server.close(resolve))
  db.close()
}
const call = (path, method = 'GET', body, token = cookie, headers = {}) => fetch(base + path, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1', ...(token ? { Cookie: token } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'campus-crowd-'))
  await start()
})
afterEach(async () => {
  await stop()
  rmSync(folder, { recursive: true, force: true })
})

describe('crowd aggregation', () => {
  test('weights recent reports more heavily with a ten minute half-life', () => {
    const now = 1_700_000_000_000
    const result = aggregateCrowd([
      { outletId: outlet.id, level: 0, waitMin: 0, createdAt: now },
      { outletId: outlet.id, level: 2, waitMin: 30, createdAt: now - 10 * 60_000 },
    ], now)
    expect(result[outlet.id].reports).toBe(2)
    expect(result[outlet.id].level).toBe(1)
    expect(result[outlet.id].waitMin).toBe(10)
    expect(result[outlet.id].updatedAt).toBe(now)
  })

  test('ignores reports older than thirty minutes', () => {
    const now = 1_700_000_000_000
    expect(aggregateCrowd([{ outletId: outlet.id, level: 2, waitMin: 30, createdAt: now - 30 * 60_000 - 1 }], now)).toEqual({})
  })
})

describe('crowd API', () => {
  test('requires an anonymous session and accepts one report per outlet per ten minutes', async () => {
    const renewed = await call('/api/community/session', 'POST', undefined, cookie)
    expect((renewed.headers.getSetCookie?.() ?? []).join(';')).toMatch(/Path=\/api(?:;|$)/)
    expect((await call(`/api/crowd/${outlet.id}`, 'POST', { level: 1, waitMin: 5 }, '')).status).toBe(401)
    expect((await call(`/api/crowd/${outlet.id}`, 'POST', { level: 1, waitMin: 5 })).status).toBe(201)
    expect((await call(`/api/crowd/${outlet.id}`, 'POST', { level: 2, waitMin: 30 })).status).toBe(429)
    const data = await (await call('/api/crowd')).json()
    expect(data[outlet.id].level).toBe(1)
    expect(data[outlet.id].waitMin).toBe(5)
  })

  test('rejects unknown outlets and malformed levels', async () => {
    expect((await call('/api/crowd/missing', 'POST', { level: 1, waitMin: 5 })).status).toBe(404)
    for (const body of [{}, { level: -1 }, { level: 3 }, { level: 1.5 }, { level: 1, waitMin: -2 }, { level: 1, waitMin: '5' }]) {
      expect((await call(`/api/crowd/${outlet.id}`, 'POST', body)).status).toBe(400)
    }
  })

  test('rejects cross-origin writes', async () => {
    expect((await call(`/api/crowd/${outlet.id}`, 'POST', { level: 0, waitMin: 0 }, cookie, { Origin: 'https://evil.example' })).status).toBe(403)
  })
})
