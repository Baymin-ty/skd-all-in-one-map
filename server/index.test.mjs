import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { addNode, connect, createRoadPoint, graphFromMap, graphToMap } from '../src/lib/undergroundGraph.ts'

const directory = mkdtempSync(join(tmpdir(), 'campus-admin-test-'))
const dbPath = join(directory, 'map.db')
const staticPath = `${dbPath}.static.db`
const password = 'local-integration-test'
const seed = JSON.parse(readFileSync(resolve('public/data/places.json'), 'utf8'))
const undergroundSeed = JSON.parse(readFileSync(resolve('public/data/underground.json'), 'utf8'))
const undergroundSample = undergroundSeed
let server, base
async function start() {
  server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: resolve('.'), env: { ...process.env, PORT: '0', DB_PATH: dbPath, DYNAMIC_DB_PATH: dbPath, STATIC_DB_PATH: staticPath, ADMIN_PASSWORD: password, EVENT_SYNC_ON_START: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  test('accepts schedule requests larger than the general JSON limit', async () => {
    const response = await call('/api/schedule/parse', 'POST', { padding: 'x'.repeat(300_000) }, false)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '请上传课表图片' })
  })

  test('地下手绘需要管理员保存，并在重启后保留道路和连接点', async () => {
    const initial = await (await call('/api/underground', 'GET', undefined, false)).json()
    expect(initial.edges).toHaveLength(undergroundSeed.edges.length)
    expect(initial.connectors).toHaveLength(undergroundSeed.connectors.length)
    expect((await call('/api/underground', 'PUT', initial, false)).status).toBe(401)
    const changed = {
      ...initial,
      nodes: [{ id: 'na', pos: [121.5963, 31.1832] }, { id: 'nb', pos: [121.5964, 31.1837] }],
      edges: [{ id: 'ab', a: 'na', b: 'nb' }],
      points: [],
      connectors: [{ id: 'off', floorFrom: 0, floorTo: -1, pos: [121.597, 31.184], kind: 'ramp', note: '后台保存测试' }],
    }
    const saved = await (await call('/api/underground', 'PUT', changed)).json()
    expect(saved.edges).toEqual(changed.edges)
    expect(saved.nodes).toEqual(changed.nodes)
    expect(saved.connectors[0].pos).toEqual(changed.connectors[0].pos)
    expect(saved.connectors[0]).not.toHaveProperty('node')
    expect(saved.connectors[0].note).toBe('后台保存测试')
    expect([...saved.edges, ...saved.connectors].every((entity) => !Object.hasOwn(entity, 'status'))).toBe(true)
    expect(saved.sources).toEqual(initial.sources)
    const database = new DatabaseSync(staticPath)
    const stored = JSON.parse(database.prepare('select data from underground_maps where id = ?').get('default').data)
    database.close()
    expect(stored).toEqual(saved)
    await stop(); await start()
    expect(await (await call('/api/underground', 'GET', undefined, false)).json()).toEqual(saved)
    await call('/api/underground', 'PUT', undergroundSeed)
  })

  test('后台路网标注拆成的道路能通过校验，重新载入后路口不丢', async () => {
    const graph = graphFromMap(undergroundSample)
    const junction = graph.nodes[1].id
    const branch = addNode(graph, [121.5975, 31.1835])
    connect(graph, junction, branch)
    const point = createRoadPoint(graph, graph.edges[0].id, [121.59635, 31.18345], 'garage-sign-1')
    graph.entrances.push({ id: 'ug-entrance-test', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.5975, 31.1835], source: 'admin' })
    const response = await call('/api/underground', 'PUT', graphToMap(graph, undergroundSeed))
    expect(response.status).toBe(200)
    const saved = await response.json()
    const reloaded = graphFromMap(saved)
    expect(reloaded.nodes).toHaveLength(graph.nodes.length)
    expect(reloaded.edges).toHaveLength(graph.edges.length)
    expect(saved.points).toEqual([point])
    const reloadedResponse = await (await call('/api/underground')).json()
    expect(reloadedResponse.points).toEqual([point])
    expect(reloaded.entrances.at(-1)).toMatchObject({ id: 'ug-entrance-test', kind: 'stairs' })
    await call('/api/underground', 'PUT', undergroundSeed)
  })

  test('地下图严格拒绝非法边、节点、引用和旧字段，失败不写入', async () => {
    const initial = await (await call('/api/underground')).json()
    const edge = initial.edges[0], node = initial.nodes[0]
    const invalid = [
      { version: 1 }, { roads: [] }, { nodes: null }, { edges: null },
      { edges: [{ ...edge, b: edge.a }] }, { edges: [{ ...edge, b: 'missing' }] },
      { edges: [edge, { id: 'duplicate', a: edge.b, b: edge.a }] },
      { nodes: [{ ...node, pos: [0, 0] }] },
      { connectors: [{ ...initial.connectors[0], node: 'missing' }] },
      ...['path', 'mode', 'direction', 'source', 'note'].map((key) => ({ edges: [{ ...edge, [key]: 'removed' }] })),
      { edges: [{ ...edge, id: node.id }] },
    ]
    for (const patch of invalid) {
      expect((await call('/api/underground', 'PUT', { ...initial, ...patch })).status).toBe(400)
      expect(await (await call('/api/underground')).json()).toEqual(initial)
    }
  })
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
  test('place community topics resolve the separate static database', async () => {
    const id = seed.buildings[0].id
    const response = await call(`/api/community/topics/place/${id}/posts`, 'GET', undefined, false)
    expect(response.status).toBe(200)
    expect((await response.json()).total).toBe(0)
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
    const db = new DatabaseSync(staticPath)
    db.exec('delete from buildings; delete from pois;')
    db.close()
    await start()
    const data = await (await call('/api/places')).json()
    expect(data.buildings).toEqual([])
    expect(data.pois).toEqual([])
  })
})
