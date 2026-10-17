import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCommunity } from './community.mjs'
import { installAccount } from './account.mjs'

let db, app, server, base, folder, sent, code, time, sendFailure
const headers = { 'Content-Type': 'application/json', 'X-Community-Request': '1' }
async function start() {
  db = new DatabaseSync(join(folder, 'test.db'))
  app = express()
  installCommunity(app, db, process.cwd(), { fetchAI: async () => new Response('{}') })
  installAccount(app, db, { demoMode: false, now: () => time, generateCode: () => code, sendCode: async (email, value) => { if (sendFailure) throw sendFailure; sent = { email, value }; code = value } })
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }))
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
}
async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve))
  db?.close(); rmSync(folder, { recursive: true, force: true })
}
const call = (path, method = 'GET', body, cookie = '', extra = {}) => fetch(base + path, {
  method, headers: { ...(method === 'GET' ? {} : headers), ...(cookie ? { Cookie: cookie } : {}), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
async function createSession() {
  const response = await call('/api/community/session', 'POST', undefined, '', headers)
  return { cookie: response.headers.get('set-cookie').split(';')[0], user: await response.json() }
}
async function requestCode(email, cookie) {
  return call('/api/account/code', 'POST', { email }, cookie)
}
async function verify(email, value, cookie) {
  return call('/api/account/verify', 'POST', { email, code: value }, cookie)
}

beforeEach(async () => { folder = mkdtempSync(join(tmpdir(), 'campus-account-')); time = Date.now(); sent = null; sendFailure = null; code = '123456'; await start() })
afterEach(stop)

describe('account login and user data API', () => {
  test('accepts campus email and rejects other domains', async () => {
    const ok = await requestCode('student@shanghaitech.edu.cn')
    expect(ok.status).toBe(200)
    expect(sent).toEqual({ email: 'student@shanghaitech.edu.cn', value: '123456' })
    expect((await requestCode('student@example.com')).status).toBe(400)
  })

  test('binds an anonymous session to a new account so it can post', async () => {
    const session = await createSession()
    const topic = '/api/community/topics/event/o-1/posts'
    db.prepare('INSERT OR IGNORE INTO community_topics VALUES (?, ?, ?, ?)').run('event:o-1', 'event', '活动', '{}')
    expect((await call(topic, 'POST', { title: '我的笔记', content: '内容' }, session.cookie)).status).toBe(401)
    expect((await requestCode('student@shanghaitech.edu.cn', session.cookie)).status).toBe(200)
    const verified = await verify('student@shanghaitech.edu.cn', code, session.cookie)
    expect(verified.status).toBe(200)
    const cookie = verified.headers.get('set-cookie').split(';')[0]
    const me = await (await call('/api/account/me', 'GET', undefined, cookie)).json()
    expect(me).toMatchObject({ id: session.user.id, email: 's*****t@shanghaitech.edu.cn' })
    expect((await call(topic, 'POST', { title: '我的笔记', content: '内容' }, cookie)).status).toBe(201)
    expect((await (await call(topic, 'GET', undefined, cookie)).json()).total).toBe(1)
  })

  test('rejects the sixth wrong code and does not verify an expired code', async () => {
    const session = await createSession()
    await requestCode('student@shanghaitech.edu.cn', session.cookie)
    for (let i = 0; i < 4; i++) expect((await verify('student@shanghaitech.edu.cn', '000000', session.cookie)).status).toBe(400)
    expect((await verify('student@shanghaitech.edu.cn', '000000', session.cookie)).status).toBe(429)
    db.prepare('UPDATE login_codes SET expires_at=0').run()
    expect((await verify('student@shanghaitech.edu.cn', code, session.cookie)).status).toBe(400)
  })

  test('switches an anonymous session to an existing account and preserves its reactions', async () => {
    const first = await createSession()
    await requestCode('first@shanghaitech.edu.cn', first.cookie)
    const firstLogin = await verify('first@shanghaitech.edu.cn', code, first.cookie)
    const firstCookie = firstLogin.headers.get('set-cookie').split(';')[0]
    const firstId = (await (await call('/api/account/me', 'GET', undefined, firstCookie)).json()).id
    db.prepare('INSERT OR IGNORE INTO community_topics VALUES (?, ?, ?, ?)').run('event:o-2', 'event', '活动', '{}')
    const post = await call('/api/community/topics/event/o-2/posts', 'POST', { title: '保留', content: '内容' }, firstCookie)
    expect(post.status).toBe(201)
    const postId = (await post.json()).id
    await call('/api/account/logout', 'POST', {}, firstCookie)
    const anonymous = await createSession()
    expect((await call(`/api/community/posts/${postId}/reactions/save`, 'PUT', { active: true }, anonymous.cookie)).status).toBe(200)
    time += 61_000
    await requestCode('first@shanghaitech.edu.cn', anonymous.cookie)
    const switched = await verify('first@shanghaitech.edu.cn', code, anonymous.cookie)
    const switchedCookie = switched.headers.get('set-cookie').split(';')[0]
    expect((await switched.json()).id).toBe(firstId)
    expect(await (await call(`/api/community/posts/${postId}`, 'GET', undefined, switchedCookie)).json()).toMatchObject({ mine: true, saved: true })
    expect(db.prepare('SELECT count(*) AS n FROM community_users WHERE id=?').get(anonymous.user.id).n).toBe(0)
  })

  test('reports a mail delivery failure as 503 without consuming the cooldown', async () => {
    sendFailure = new Error('connect ETIMEDOUT')
    const failed = await requestCode('student@shanghaitech.edu.cn')
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: '验证码邮件发送失败，请稍后再试' })
    expect(db.prepare('SELECT count(*) AS n FROM login_codes').get().n).toBe(0)
    sendFailure = null
    expect((await requestCode('student@shanghaitech.edu.cn')).status).toBe(200)
  })

  test('enforces the per-email cooldown before sending another code', async () => {
    expect((await requestCode('student@shanghaitech.edu.cn')).status).toBe(200)
    expect((await requestCode('student@shanghaitech.edu.cn')).status).toBe(429)
    time += 60_001
    expect((await requestCode('student@shanghaitech.edu.cn')).status).toBe(200)
  })

  test('limits code requests from one IP to ten per hour', async () => {
    for (let i = 0; i < 10; i++) expect((await requestCode(`student${i}@shanghaitech.edu.cn`)).status).toBe(200)
    expect((await requestCode('student10@shanghaitech.edu.cn')).status).toBe(429)
  })

  test('stores user data with optimistic revisions and requires an account', async () => {
    const session = await createSession()
    expect((await call('/api/me/data', 'GET', undefined, session.cookie)).status).toBe(401)
    await requestCode('student@shanghaitech.edu.cn', session.cookie)
    const verified = await verify('student@shanghaitech.edu.cn', code, session.cookie)
    const cookie = verified.headers.get('set-cookie').split(';')[0]
    expect(await (await call('/api/me/data', 'GET', undefined, cookie)).json()).toEqual({})
    const saved = await call('/api/me/data/today', 'PUT', { data: { items: [] }, rev: 0 }, cookie)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ data: { items: [] }, rev: 1 })
    expect((await call('/api/me/data/today', 'PUT', { data: { items: ['stale'] }, rev: 0 }, cookie)).status).toBe(409)
    expect((await call('/api/me/data/today', 'PUT', { data: { items: ['new'] }, rev: 1 }, cookie)).status).toBe(200)
    expect((await (await call('/api/me/data', 'GET', undefined, cookie)).json()).today.data.items).toEqual(['new'])
  })
})
