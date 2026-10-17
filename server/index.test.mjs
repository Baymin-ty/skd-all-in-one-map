import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'

const directory = mkdtempSync(join(tmpdir(), 'campus-admin-test-'))
const dbPath = join(directory, 'map.db')
const password = 'local-integration-test'
const seed = JSON.parse(readFileSync(resolve('public/data/places.json'), 'utf8'))
let server, base
async function start() {
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: resolve('.'), env: { ...process.env, PORT: '0', DB_PATH: dbPath, ADMIN_PASSWORD: password, EVENT_SYNC_ON_START: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  base = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`server startup timed out: ${output}`)), 8000)
    server.once('error', (e) => { clearTimeout(timer); reject(e) })
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)) })
    server.stderr.on('data', (chunk) => output += chunk)
    server.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/http:\/\/localhost:\d+/)
      if (match) { clearTimeout(timer); resolve(match[0]) }
    })
  })
}
async function stop() {
  if (server && server.exitCode === null) { const done = once(server, 'exit'); server.kill('SIGTERM'); await done }
}
async function call(path, method = 'GET', body, auth = true) {
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${password}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
beforeAll(start)
afterAll(async () => { await stop(); rmSync(directory, { recursive: true, force: true }) })

describe('campus management API', () => {
  test('map opacity settings require authentication and persist across restart', async () => {
    const defaults = { background: 0.2, selectable: 0.5, selected: 1 }
    expect(await (await call('/api/map-settings', 'GET', undefined, false)).json()).toEqual(defaults)
    const settings = { background: 0.3, selectable: 0.65, selected: 0.9 }
    expect((await call('/api/map-settings', 'PUT', settings, false)).status).toBe(401)
    expect(await (await call('/api/map-settings', 'PUT', settings)).json()).toEqual(settings)
    await stop(); await start()
    expect(await (await call('/api/map-settings', 'GET', undefined, false)).json()).toEqual(settings)
    await call('/api/map-settings', 'PUT', defaults)
  })
  test('map opacity rejects invalid input without changing settings and accepts the full range', async () => {
    const defaults = { background: 0.2, selectable: 0.5, selected: 1 }
    for (const data of [{}, { ...defaults, background: -0.1 }, { ...defaults, selected: 1.01 }, { ...defaults, selectable: '0.5' }, { ...defaults, background: null }]) {
      expect((await call('/api/map-settings', 'PUT', data)).status).toBe(400)
      expect(await (await call('/api/map-settings')).json()).toEqual(defaults)
    }
    for (const settings of [{ background: 1, selectable: 1, selected: 1 }, { background: 0, selectable: 0, selected: 0 }, { background: 0.8, selectable: 0.3, selected: 0.6 }])
      expect(await (await call('/api/map-settings', 'PUT', settings)).json()).toEqual(settings)
    await call('/api/map-settings', 'PUT', defaults)
  })
  test('public data combines seeded buildings and POIs; writes require authentication', async () => {
    const data = await (await call('/api/places', 'GET', undefined, false)).json()
    expect(data.buildings).toHaveLength(seed.buildings.length)
    expect(data.pois).toHaveLength(seed.pois.length)
    expect((await call('/api/auth', 'POST', undefined, false)).status).toBe(401)
    for (const resource of ['pois', 'buildings']) {
      expect((await call(`/api/${resource}`, 'POST', {}, false)).status).toBe(401)
      expect((await call(`/api/${resource}/missing`, 'PUT', {}, false)).status).toBe(401)
      expect((await call(`/api/${resource}/missing`, 'DELETE', undefined, false)).status).toBe(401)
    }
  })
  test('creates, updates and deletes a POI without changing the original data', async () => {
    const input = { name: { zh: '测试点位', en: 'Test' }, cat: 'life', pos: [121.601, 31.183] }
    const res = await call('/api/pois', 'POST', input)
    expect(res.status).toBe(201)
    const p = await res.json()
    const moved = await (await call(`/api/pois/${p.id}`, 'PUT', { pos: [121.602, 31.184] })).json()
    expect(moved.name).toEqual(input.name)
    expect(moved.pos).toEqual([121.602, 31.184])
    expect((await call(`/api/pois/${p.id}`, 'DELETE')).status).toBe(204)
    expect((await call(`/api/pois/${p.id}`, 'DELETE')).status).toBe(404)
  })
  test('parking POIs can be marked as garage ramp, stairs or elevator; other categories cannot', async () => {
    const stairs = await call('/api/pois', 'POST', { name: { zh: '车库楼梯' }, cat: 'parking', kind: 'garage-stairs', pos: [121.6015, 31.1832] })
    expect(stairs.status).toBe(201)
    const p = await stairs.json()
    expect(p.kind).toBe('garage-stairs')
    expect((await call('/api/pois', 'POST', { name: { zh: '错误' }, cat: 'life', kind: 'garage-stairs', pos: [121.6015, 31.1832] })).status).toBe(400)
    expect((await call('/api/pois', 'POST', { name: { zh: '错误' }, cat: 'parking', kind: 'rocket', pos: [121.6015, 31.1832] })).status).toBe(400)
    // 改成其他分类时必须同时去掉细分
    expect((await call(`/api/pois/${p.id}`, 'PUT', { cat: 'life' })).status).toBe(400)
    expect((await (await call(`/api/pois/${p.id}`, 'PUT', { cat: 'life', kind: null })).json()).kind).toBeUndefined()
  })
  test('building edits persist across restart and preserve geometry, entrances and room data', async () => {
    const input = { ...seed.buildings[0], parts: seed.buildings.find((b) => b.id === 'dbe3b0a1').parts, name: { zh: '测试楼宇', en: 'Test building' }, entrances: [{ pos: [121.6039, 31.184], zh: '东入口' }], rooms: [{ number: '101' }] }
    const res = await call('/api/buildings', 'POST', input)
    expect(res.status).toBe(201)
    const b = await res.json()
    expect(b.id).not.toBe(input.id)
    const updated = await (await call(`/api/buildings/${b.id}`, 'PUT', { hours: { zh: '08:00–20:00' }, aliases: ['测试别名'] })).json()
    expect(updated.poly).toEqual(input.poly)
    expect(updated.parts).toEqual(input.parts)
    expect(updated.entrances[0].zh).toBe('东入口')
    expect(updated.rooms).toEqual(input.rooms)
    await stop(); await start()
    const places = await (await call('/api/places')).json()
    expect(places.buildings.find((item) => item.id === b.id)).toEqual(updated)
    expect((await call(`/api/buildings/${b.id}`, 'DELETE')).status).toBe(204)
  })
  test('rejects malformed coordinates, incomplete geometry and invalid categories', async () => {
    for (const pos of [[0, 0], ['121.601', 31.183], [null, 31.183], [121.601]]) {
      expect((await call('/api/pois', 'POST', { name: { zh: '错误' }, cat: 'life', pos })).status).toBe(400)
    }
    for (const changes of [{ poly: [] }, { parts: [[]] }, { parts: [[[121.601, 31.183], [121.602, 31.183], [121.603, 31.183]]] }, { poly: [[121.601, 31.183], [121.602, 31.183], [121.603, 31.183]] }, { cat: 'invalid' }, { entrances: [{ pos: [0, 0] }] }, { name: { zh: '' } }]) {
      expect((await call('/api/buildings', 'POST', { ...seed.buildings[0], ...changes })).status).toBe(400)
    }
  })
  test.skipIf(!existsSync(resolve('dist/admin/index.html')))('production admin URL is separate and does not redirect in a loop', async () => {
    const res = await fetch(base + '/admin', { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/admin/')
    const admin = await fetch(base + '/admin/', { redirect: 'manual' })
    expect(admin.status).toBe(200)
    expect(await admin.text()).toContain('校园空间管理')
    expect(await (await fetch(base + '/')).text()).not.toContain('校园空间管理')
  })
  test('deleting every record remains empty after restart', async () => {
    await stop()
    const db = new DatabaseSync(dbPath)
    db.exec('delete from buildings; delete from pois;')
    db.close()
    await start()
    const data = await (await call('/api/places')).json()
    expect(data.buildings).toEqual([])
    expect(data.pois).toEqual([])
  })
})
