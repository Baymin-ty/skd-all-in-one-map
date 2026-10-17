import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createVenueResolver, installEventSync, parseVenueAliases } from './eventSync.mjs'
import { findDuplicate, installEventPipeline, mergeCatalogEvents } from './eventPipeline.mjs'
import { cleanSubject, extractMailEvents, mailEventId, mailExcerpt } from './mailEvents.mjs'

const root = process.cwd()
const places = JSON.parse(readFileSync(join(root, 'public/data/places.json'), 'utf8'))
const resolver = createVenueResolver({ places, aliases: parseVenueAliases('官网原始地点写法,自动归并到的建筑(请核对),房间号\n图书馆302,图书馆,302\n') })
const sent = new Date('2026-10-15T09:00:00+08:00')
const lectureMail = {
  subject: '【讲座提醒】图书馆数据素养讲座',
  from: '"图书信息中心" <library@shanghaitech.edu.cn>',
  date: sent,
  text: '各位同学：\n\n时间：10月20日 下午2:00-4:00\n地点：图书馆302\n\n欢迎参加！\n联系电话：12345678\n——————\n祝好',
}

describe('邮件活动解析', () => {
  test('抽取时间、地点、主办和分类，并生成稳定 id', () => {
    const { events, looksLikeEvent } = extractMailEvents(lectureMail, resolver)
    expect(looksLikeEvent).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].reasons).toEqual([])
    expect(events[0].event).toMatchObject({
      title: '图书馆数据素养讲座', start: '2026-10-20T14:00:00+08:00', end: '2026-10-20T16:00:00+08:00', allDay: false,
      place: 'e2473fa9', room: '302', organizer: '图书信息中心', category: 'library', source: 'email',
    })
    expect(events[0].event.id).toBe(mailEventId('图书馆数据素养讲座', '2026-10-20T14:00:00+08:00', 'e2473fa9', '302'))
  })

  test('地点不在校内、没有具体时间或提到改期时给出待审核原因', () => {
    const { events } = extractMailEvents({ ...lectureMail, subject: '活动延期通知：读书会', text: '日期：2026年10月22日\n地点：线上（腾讯会议）' }, resolver)
    expect(events[0].reasons).toEqual(expect.arrayContaining(['地点未能定位到校内建筑', '没有具体开始时间', '邮件提到取消或变更，需要人工确认']))
  })

  test('清理标题前缀，正文片段不带联系方式', () => {
    expect(cleanSubject('Re: 今晚！【地点变更】 学术沙龙')).toBe('学术沙龙')
    expect(mailExcerpt(lectureMail.text)).not.toMatch(/电话|祝好/)
  })
})

describe('活动数据管道', () => {
  let db, folder, server, base
  const official = [
    { title: '材料讲座', f1: '2026-10-20', f2: '', f3: '2026-10-20 10:00', f4: '', f5: '图书馆302', f6: '物质学院', phColId: 14750, id: 9001, url: 'http://x/a' },
    { title: '坏记录', f1: '20261021', f3: '', f5: '图书馆', id: 9002 },
  ]
  const officialFetcher = vi.fn(async () => new Response(JSON.stringify({ data: official, total: official.length }), { status: 200 }))

  async function start(options = {}) {
    const app = express()
    const eventSync = installEventSync(app, db, root, { fetcher: officialFetcher, resolver, initialSync: false, schedule: false })
    const pipeline = installEventPipeline(app, db, { eventSync, resolver, schedule: false, initialRun: false, ...options })
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}/api/events`
    return pipeline
  }
  const api = async (path, init) => { const res = await fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...init }); return { status: res.status, body: await res.json() } }
  const catalog = () => JSON.parse(db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events').data)

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'stmap-pipeline-'))
    db = new DatabaseSync(join(folder, 'map.db'))
    db.exec('CREATE TABLE discovery_catalog (kind TEXT PRIMARY KEY, data TEXT NOT NULL)')
    db.prepare('INSERT INTO discovery_catalog VALUES (?, ?)').run('events', JSON.stringify([
      { id: 'o-1', title: '量子计算前沿讲座', start: '2026-10-21T19:00:00+08:00', allDay: false, source: 'official', place: null },
    ]))
  })
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); server = null; db.close(); rmSync(folder, { recursive: true, force: true }) })

  test('官网来源：正常记录上线，转换失败的记录进待审核', async () => {
    const pipeline = await start({ mail: { url: '', mailbox: 'INBOX', senders: 'x', intervalMinutes: 30, sinceDays: 30 } })
    await pipeline.run('manual', 'official')
    const status = pipeline.status()
    expect(status.sources.find((s) => s.id === 'official').lastRun).toMatchObject({ status: 'ok', added: 1, review: 1 })
    expect(status.review.pending).toBe(1)
    expect(catalog().some((e) => e.id === 'o-9001')).toBe(true)
    const { body } = await api('/review')
    expect(body[0]).toMatchObject({ source: 'official', event: { title: '坏记录' } })
  })

  test('邮件来源：可信活动上线，可疑活动待审核，重复活动跳过，游标前进', async () => {
    const fetchMail = vi.fn(async ({ cursor }) => ({
      cursor: { uidValidity: '1', lastUid: (cursor?.lastUid ?? 0) + 3 },
      messages: cursor ? [] : [
        { uid: 1, messageId: 'a', ...lectureMail },
        { uid: 2, messageId: 'b', ...lectureMail, subject: '读书会', text: '时间：10月22日 19:00\n地点：线上会议' },
        { uid: 3, messageId: 'c', ...lectureMail, subject: '【学术报告】量子计算前沿讲座！', text: '时间：10月21日 19:00\n地点：图书馆302' },
        { uid: 4, messageId: 'd', ...lectureMail, from: 'spam@example.com' },
      ],
    }))
    const pipeline = await start({ fetchMail, mail: { url: 'imaps://u:p@imap.example.com', mailbox: 'INBOX', senders: 'shanghaitech\\.edu\\.cn', intervalMinutes: 30, sinceDays: 30 } })
    await pipeline.run('manual', 'email')
    const run = pipeline.status().sources.find((s) => s.id === 'email').lastRun
    expect(run).toMatchObject({ status: 'ok', added: 1, review: 1, skipped: 2, scanned: 4 })
    expect(catalog().filter((e) => e.source === 'email').map((e) => e.title)).toEqual(['图书馆数据素养讲座'])
    await pipeline.run('manual', 'email')
    expect(fetchMail.mock.calls[1][0].cursor).toMatchObject({ uidValidity: '1', lastUid: 3 })
  })

  test('审核通过后带着修改上线，拒绝后不再出现', async () => {
    const fetchMail = async () => ({ cursor: { uidValidity: '1', lastUid: 2 }, messages: [
      { uid: 1, messageId: 'b', ...lectureMail, subject: '读书会', text: '时间：10月22日 19:00\n地点：线上会议' },
      { uid: 2, messageId: 'e', ...lectureMail, subject: '电影之夜', text: '时间：10月23日 19:00\n地点：某咖啡馆' },
    ] })
    const pipeline = await start({ fetchMail, mail: { url: 'imaps://u:p@h', mailbox: 'INBOX', senders: 'shanghaitech', intervalMinutes: 30, sinceDays: 30 } })
    await pipeline.run('manual', 'email')
    const { body: queue } = await api('/review')
    expect(queue).toHaveLength(2)
    const book = queue.find((item) => item.event.title === '读书会')
    expect((await api(`/review/${book.id}/approve`, { method: 'POST', body: JSON.stringify({ event: { title: '' } }) })).status).toBe(400)
    const approved = await api(`/review/${book.id}/approve`, { method: 'POST', body: JSON.stringify({ event: { place: 'e2473fa9', room: '302', start: '2026-10-22T19:30' } }) })
    expect(approved.status).toBe(200)
    expect(catalog().find((e) => e.title === '读书会')).toMatchObject({ place: 'e2473fa9', start: '2026-10-22T19:30:00+08:00', unmapped: '' })
    const movie = queue.find((item) => item.event.title === '电影之夜')
    expect((await api(`/review/${movie.id}/reject`, { method: 'POST' })).status).toBe(200)
    await pipeline.run('manual', 'email')
    expect(pipeline.status().review).toMatchObject({ pending: 0, approved: 1, rejected: 1 })
  })

  test('未配置的数据源不能手动触发，状态里给出配置提示', async () => {
    await start({ mail: { url: '', mailbox: 'INBOX', senders: 'x', intervalMinutes: 30, sinceDays: 30 } })
    const res = await api('/pipeline/run', { method: 'POST', body: JSON.stringify({ source: 'email' }) })
    expect(res.status).toBe(400)
    const { body } = await api('/pipeline')
    expect(body.sources.find((s) => s.id === 'email')).toMatchObject({ configured: false, hint: expect.stringContaining('EVENT_IMAP_URL') })
  })

  test('邮箱登录失败记录为错误，不影响目录', async () => {
    const pipeline = await start({ fetchMail: async () => { throw new Error('Invalid credentials (Failure)') }, mail: { url: 'imaps://u:p@h', mailbox: 'INBOX', senders: 'x', intervalMinutes: 30, sinceDays: 30 } })
    await pipeline.run('manual', 'email')
    expect(pipeline.status().sources.find((s) => s.id === 'email').lastRun).toMatchObject({ status: 'error', error: expect.stringContaining('邮箱登录失败') })
    expect(catalog()).toHaveLength(1)
  })

  test('去重忽略标题标点和前缀，合并保留管理员修改', () => {
    const existing = [{ id: 'x', title: '【讲座】AI 与 教育', start: '2026-10-20T14:00:00+08:00', allDay: false }]
    expect(findDuplicate(existing, { id: 'y', title: 'AI与教育', start: '2026-10-20T14:00:00+08:00', allDay: false })?.id).toBe('x')
    expect(findDuplicate(existing, { id: 'y', title: 'AI与教育', start: '2026-10-20T16:00:00+08:00', allDay: false })).toBeNull()
    db.prepare('UPDATE discovery_catalog SET data=? WHERE kind=?').run(JSON.stringify([{ id: 'm-1', title: 'a', start: '2026-10-20', manualOverrides: { place: 'p1' }, place: 'p1' }]), 'events')
    expect(mergeCatalogEvents(db, [{ id: 'm-1', title: 'b', start: '2026-10-20', place: null }])).toMatchObject({ added: 0, updated: 1 })
    expect(catalog()[0]).toMatchObject({ title: 'b', place: 'p1' })
  })
})
