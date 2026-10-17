import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installCommunity } from './community.mjs'
import { installAccount } from './account.mjs'

const root = resolve('.')
const events = JSON.parse(readFileSync(join(root, 'public/data/events.json'), 'utf8'))
const dining = JSON.parse(readFileSync(join(root, 'public/data/canteens.json'), 'utf8'))
const c = dining.canteens[0], o = c.outlets[0], s = o.stalls[0]
const eventPath = `/topics/event/${events[0].id}`
const stallPath = `/topics/stall/${encodeURIComponent(`${c.id}:${o.id}:${s.id}`)}`
let db, server, base, folder, fetchAI, cookie
const completion = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ overview: '根据已收录资料整理；暂无同学反馈。', highlights: ['以活动原始通知为准'], questions: ['报名方式尚待确认'] }) } }] }), { status: 200 })
async function start() {
  db = new DatabaseSync(join(folder, 'test.db'))
  const app = express()
  installCommunity(app, db, root, { fetchAI })
  installAccount(app, db, { demoMode: false, sendCode: async () => {} })
  app.use((err, _req, res, _next) => res.status(err.type === 'entity.too.large' ? 413 : 500).json({ error: 'request failed' }))
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}/api/community`
}
async function stop() { await new Promise(resolve => server.close(resolve)); db.close() }
const call = (path, method = 'GET', body, token = cookie, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1', ...(token ? { Cookie: token } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
// 发帖、评论、传图都要求已登录且起好昵称的校园账号：直接给新会话绑定一条 accounts 记录
async function newUser() {
  const res = await call('/session', 'POST', undefined, ''), user = await res.json()
  db.prepare('INSERT INTO accounts (user_id,email,role,created_at,nickname_at) VALUES (?,?,?,?,?)').run(user.id, `${user.id}@shanghaitech.edu.cn`, 'student', Date.now(), Date.now())
  return { cookie: res.headers.get('set-cookie').split(';')[0], user }
}
async function createPost(path = eventPath, body = {}, token = cookie) { const res = await call(path + '/posts', 'POST', { title: '来分享活动见闻', content: '这是测试笔记内容，欢迎一起讨论。', tag: '分享', ...body }, token); expect(res.status).toBe(201); return res.json() }
async function upload(token = cookie) {
  const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const res = await call('/images', 'POST', { data }, token); expect(res.status).toBe(201); return res.json()
}
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'campus-community-'))
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-not-real'); vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-flash')
  fetchAI = vi.fn(async () => completion())
  await start(); cookie = (await newUser()).cookie
})
afterEach(async () => { await stop(); rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('community data, ownership, and persistence', () => {
  test('place topics are created on demand for existing buildings and POIs, and follow place edits', async () => {
    const placePath = '/topics/place/lib-1'
    expect((await call(placePath + '/posts')).status).toBe(404)
    db.exec('CREATE TABLE buildings (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    db.prepare('INSERT INTO buildings VALUES (?, ?, ?)').run('lib-1', JSON.stringify({ name: { zh: '图书馆', en: 'Library' }, hours: { zh: '8:00–22:00' } }), 0)
    expect((await (await call(placePath + '/posts')).json()).total).toBe(0)
    await createPost(placePath, { tag: '测评', title: '三楼自习区很安静' })
    expect((await (await call(placePath + '/posts')).json()).total).toBe(1)
    expect(db.prepare("SELECT name FROM community_topics WHERE id='place:lib-1'").get().name).toBe('图书馆')
    db.prepare('UPDATE buildings SET data=? WHERE id=?').run(JSON.stringify({ name: { zh: '图书信息中心', en: 'Library' } }), 'lib-1')
    await call(placePath + '/posts')
    expect(db.prepare("SELECT name FROM community_topics WHERE id='place:lib-1'").get().name).toBe('图书信息中心')
    // 地点删除后已有讨论仍可查看；不存在、也从没有讨论过的地点仍是 404
    db.prepare('DELETE FROM buildings WHERE id=?').run('lib-1')
    expect((await (await call(placePath + '/posts')).json()).total).toBe(1)
    expect((await call('/topics/place/' + encodeURIComponent('../x') + '/posts')).status).toBe(404)
  })
  test('imports every event and stall and exposes database catalog, with isolated feeds', async () => {
    const expected = events.length + dining.canteens.reduce((n, c) => n + c.outlets.reduce((m, o) => m + o.stalls.length, 0), 0)
    expect(db.prepare('SELECT count(*) AS n FROM community_topics').get().n).toBe(expected)
    await createPost(); await createPost(stallPath)
    expect((await (await call(eventPath + '/posts')).json()).total).toBe(1)
    expect((await (await call(stallPath + '/posts')).json()).total).toBe(1)
    expect((await call('/topics/event/missing/posts')).status).toBe(404)
    expect((await (await fetch(base.replace('/community', '') + '/events')).json()).length).toBe(events.length)
  })
  test('session uses httpOnly cookie and ignores spoofed author identity', async () => {
    const res = await call('/session', 'POST', undefined, '')
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=Lax/)
    const me = await (await call('/session', 'POST')).json()
    const p = await createPost(eventPath, { userId: 'fake', author: { id: 'fake', name: '冒充' } })
    expect(p.author.id).toBe(me.id)
    const other = await newUser()
    expect((await call(`/posts/${p.id}`, 'DELETE', undefined, other.cookie)).status).toBe(403)
    expect((await call(eventPath + '/posts', 'POST', {}, '')).status).toBe(401)
    expect((await call('/session', 'POST', undefined, '', { 'X-Community-Request': '' })).status).toBe(403)
    expect((await call('/session', 'POST', undefined, '', { Origin: 'https://external.example' })).status).toBe(403)
  })
  test('validates posts, comments, topic and images and isolates image ownership', async () => {
    for (const body of [{ title: '' }, { content: ' ' }, { title: '字'.repeat(61) }, { content: '字'.repeat(4001) }]) {
      expect((await call(eventPath + '/posts', 'POST', { title: '标题', content: '内容', ...body })).status).toBe(400)
    }
    const img = await upload(), other = await newUser()
    expect((await call(img.url.replace('/api/community', ''), 'GET', undefined, other.cookie)).status).toBe(404)
    expect((await call(eventPath + '/posts', 'POST', { title: '标题', content: '内容', images: [img.id] }, other.cookie)).status).toBe(400)
    const p = await createPost(eventPath, { images: [img.id] })
    expect(p.images).toHaveLength(1)
    const image = await call(img.url.replace('/api/community', ''), 'GET', undefined, '')
    expect(image.headers.get('content-type')).toContain('image/png'); expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(20)
    expect((await call('/images', 'POST', { data: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400)
    const comment = await call(`/posts/${p.id}/comments`, 'POST', { content: '怎么报名？' })
    const cid = (await comment.json()).id
    const p2 = await createPost(stallPath)
    expect((await call(`/posts/${p2.id}/comments`, 'POST', { content: '跨帖回复', parentId: cid })).status).toBe(400)
    expect((await call(`/comments/${cid}`, 'DELETE', undefined, other.cookie)).status).toBe(403)
  })
  test('likes are idempotent; replies, bookmarks, search and sorting work', async () => {
    const p = await createPost(), p2 = await createPost(eventPath, { title: '另外一篇' })
    for (let i = 0; i < 2; i++) expect((await (await call(`/posts/${p.id}/reactions/like`, 'PUT', { active: true })).json()).likes).toBe(1)
    await call(`/posts/${p.id}/reactions/save`, 'PUT', { active: true })
    expect((await (await call(eventPath + '/posts?sort=saved')).json()).posts.map(p => p.id)).toEqual([p.id])
    expect((await (await call(eventPath + '/posts?sort=hot')).json()).posts[0].id).toBe(p.id)
    expect((await (await call(eventPath + '/posts?q=' + encodeURIComponent('另外'))).json()).posts[0].id).toBe(p2.id)
    const comment = await (await call(`/posts/${p.id}/comments`, 'POST', { content: '问一个问题' })).json()
    const reply = await (await call(`/posts/${p.id}/comments`, 'POST', { content: '回复', parentId: comment.id })).json()
    expect(reply.replyTo).toBeTruthy()
    await call(`/comments/${comment.id}`, 'DELETE')
    const list = await (await call(`/posts/${p.id}/comments`)).json()
    expect(list.comments[0].parentId).toBeNull()
    expect((await call(eventPath + '/posts?offset=-1')).status).toBe(400)
  })
  test('posts, blobs, comments, users, reactions, summaries survive restart; deletion cascades', async () => {
    const image = await upload(), p = await createPost(eventPath, { images: [image.id] })
    await call(`/posts/${p.id}/comments`, 'POST', { content: '保留这条评论' })
    await call(`/posts/${p.id}/reactions/save`, 'PUT', { active: true })
    expect((await call(eventPath + '/summary', 'POST')).status).toBe(200)
    await stop(); await start()
    const found = await (await call(`/posts/${p.id}`)).json()
    expect(found.mine).toBe(true); expect(found.saved).toBe(true); expect(found.comments).toBe(1); expect(found.images).toHaveLength(1)
    expect((await (await call(eventPath + '/summary')).json()).summary.stale).toBe(false)
    expect((await call(`/posts/${p.id}`, 'DELETE')).status).toBe(204)
    for (const table of ['community_images', 'community_comments', 'community_reactions', 'community_summaries']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n).toBe(0)
    await stop(); await start()
    expect((await (await call(eventPath + '/posts')).json()).total).toBe(0)
  })
})

describe('DeepSeek summaries', () => {
  test('uses official API, omits user identities, caches results and invalidates on discussion changes', async () => {
    const p = await createPost()
    let response = await call(eventPath + '/summary', 'POST')
    expect(response.status).toBe(200); expect((await response.json()).sampled.posts).toBe(1)
    const [url, init] = fetchAI.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    const request = JSON.parse(init.body), source = JSON.parse(request.messages[1].content)
    expect(request.response_format.type).toBe('json_object'); expect(source.posts[0].title).toBe(p.title)
    expect(init.body).not.toContain(p.author.id); expect(init.body).not.toContain(p.author.name)
    await call(eventPath + '/summary', 'POST'); expect(fetchAI).toHaveBeenCalledTimes(1)
    await call(`/posts/${p.id}/comments`, 'POST', { content: '新的问题' })
    expect((await (await call(eventPath + '/summary')).json()).summary.stale).toBe(true)
    await call(eventPath + '/summary', 'POST'); expect(fetchAI).toHaveBeenCalledTimes(2)
  })
  test('does not fabricate summaries when key, upstream balance or response is invalid', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    expect((await call(eventPath + '/summary', 'POST')).status).toBe(503)
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key-not-real')
    fetchAI.mockResolvedValueOnce(new Response('{}', { status: 402 }))
    expect((await (await call(eventPath + '/summary', 'POST')).json()).error).toContain('余额不足')
    fetchAI.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'invalid json' } }] })))
    expect((await call(eventPath + '/summary', 'POST')).status).toBe(502)
    fetchAI.mockRejectedValueOnce(new Error('network'))
    expect((await call(eventPath + '/summary', 'POST')).status).toBe(504)
    expect(db.prepare('SELECT count(*) AS n FROM community_summaries').get().n).toBe(0)
  })
  test('deduplicates concurrent calls and refuses to save a summary after content changes', async () => {
    let resolveAI
    fetchAI.mockImplementationOnce(() => new Promise(resolve => { resolveAI = resolve }))
    const p = await createPost()
    const first = call(eventPath + '/summary', 'POST')
    await vi.waitFor(() => expect(fetchAI).toHaveBeenCalledTimes(1))
    const second = call(eventPath + '/summary', 'POST')
    await call(`/posts/${p.id}`, 'DELETE')
    resolveAI(completion())
    expect((await first).status).toBe(409); expect((await second).status).toBe(409)
    expect(fetchAI).toHaveBeenCalledTimes(1)
    expect(db.prepare('SELECT count(*) AS n FROM community_summaries').get().n).toBe(0)
  })
})
