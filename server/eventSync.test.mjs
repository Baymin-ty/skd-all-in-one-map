import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  OFFICIAL_EVENTS_URL,
  convertOfficialEvent,
  convertOfficialResponse,
  createVenueResolver,
  fetchOfficialRecords,
  installEventSync,
  loadVenueResolver,
  parseVenueAliases,
  syncOfficialEvents,
} from './eventSync.mjs'
import { installCommunity } from './community.mjs'

const root = process.cwd()
const places = JSON.parse(readFileSync(join(root, 'public/data/places.json'), 'utf8'))
const aliases = parseVenueAliases('官网原始地点写法,过去一年出现次数,自动归并到的建筑(请核对),房间号\n物质学院5-105报告厅,124,物质学院5号楼,105\n图书馆302,21,图书馆,302\n')
const resolver = createVenueResolver({ places, aliases })
const fixture = [
  { title: '材料讲座', f1: '2026-10-20', f2: '张三', f3: '2026-10-20 10:00', f4: '2026-10-20 11:00', f5: '物质学院5-105报告厅', f6: '物质科学与技术学院', f7: '', phColId: 14750, id: 9001, url: 'http://www.shanghaitech.edu.cn/a' },
  { title: '图书馆展览', f1: '2026-10-21', f2: '', f3: '2026-10-21', f4: '2026-10-22', f5: '图书馆302', f6: '图书信息中心', f7: '', phColId: 15107, id: 9002, url: 'http://www.shanghaitech.edu.cn/b' },
  { title: '线上活动', f1: '2026-10-22', f2: '', f3: '2026-10-22 19:00', f4: '', f5: '线上（腾讯会议）', f6: '学生处', f7: '', phColId: 15106, id: 9003, url: 'http://www.shanghaitech.edu.cn/c' },
]
const savedOfficialResponse = JSON.parse(readFileSync(join(root, 'server/fixtures/official_latest.json'), 'utf8'))

describe('活动自动更新', () => {
  let db
  let folder

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'stmap-event-sync-'))
    db = new DatabaseSync(join(folder, 'map.db'))
    db.exec('CREATE TABLE discovery_catalog (kind TEXT PRIMARY KEY, data TEXT NOT NULL)')
    db.prepare('INSERT INTO discovery_catalog VALUES (?, ?)').run('events', JSON.stringify([
      { ...convertOfficialEvent(fixture[0], resolver), title: '旧标题' },
      { ...convertOfficialEvent(fixture[1], resolver), title: '已经下线' },
      { id: 'm-mail', title: '邮件活动', source: 'email', start: '2026-10-20T12:00:00+08:00', end: null, allDay: false, venueRaw: '', place: null, room: '', floor: null, organizer: '', category: 'other' },
    ]))
  })

  afterEach(() => { db.close(); rmSync(folder, { recursive: true, force: true }) })

  test('转换日期、分类、地点和官网链接', () => {
    const event = convertOfficialEvent(fixture[0], resolver)
    expect(event).toMatchObject({ id: 'o-9001', sourceId: '9001', source: 'official', start: '2026-10-20T10:00:00+08:00', end: '2026-10-20T11:00:00+08:00', place: '6f964a8f', room: '5-105', floor: 1, category: 'lecture', url: 'https://www.shanghaitech.edu.cn/a', status: 'active' })
    const allDay = convertOfficialEvent(fixture[1], resolver)
    expect(allDay).toMatchObject({ allDay: true, start: '2026-10-21T00:00:00+08:00', end: '2026-10-22T23:59:00+08:00', place: 'e2473fa9', room: '302', floor: 3 })
  })

  test('使用保存的官网快照转换完整响应，不联网', () => {
    const result = convertOfficialResponse({ data: savedOfficialResponse }, loadVenueResolver(root))
    expect(result.events).toHaveLength(119)
    expect(result.warnings).toEqual([])
    expect(result.events.filter((event) => !event.place)).toHaveLength(5)
    expect(result.events[0]).toMatchObject({ id: 'o-1125128', place: '6f964a8f', room: '5-105', category: 'lecture', source: 'official' })
  })

  test('地点别名和未定位地点分别归并', () => {
    expect(resolver.resolve('物质学院5-105报告厅')).toMatchObject({ place: '6f964a8f', room: '5-105', floor: 1 })
    expect(resolver.resolve('线上（腾讯会议）')).toMatchObject({ place: null, room: '', floor: null, unmapped: '线上（腾讯会议）' })
    expect(resolver.resolve('图书馆302')).toMatchObject({ place: 'e2473fa9', room: '302', floor: 3 })
    // 规则归并也只返回稳定楼宇 id，不能把整条楼宇对象写进活动目录。
    expect(resolver.resolve('信息学院1号楼D106实验室')).toMatchObject({ place: '82807efc', room: '1D-106', floor: 1 })
  })

  test('按 source 和原始 id 去重，保留邮件活动并标记官网删除', () => {
    const result = syncOfficialEvents(db, fixture.filter((item) => item.id !== 9002).map((item) => convertOfficialEvent(item, resolver)), { now: 123 })
    const events = JSON.parse(db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events').data)
    expect(result).toMatchObject({ added: 1, updated: 1, cancelled: 1 })
    expect(events.find((e) => e.id === 'o-9001')).toMatchObject({ title: '材料讲座', status: 'active' })
    expect(events.find((e) => e.id === 'o-9002')).toMatchObject({ status: 'cancelled', cancelledAt: 123 })
    expect(events.find((e) => e.id === 'm-mail')).toBeTruthy()
  })

  test('已有活动修正优先于新的自动地点归并', () => {
    db.exec('CREATE TABLE event_overrides (event_id TEXT PRIMARY KEY, place TEXT, room TEXT, start TEXT, end TEXT, hidden INTEGER, note TEXT, updated_by TEXT, updated_at INTEGER)')
    db.prepare('INSERT INTO event_overrides(event_id,place,room,updated_at) VALUES (?,?,?,?)').run('o-9001', 'e2473fa9', '302', 1)
    syncOfficialEvents(db, [convertOfficialEvent(fixture[0], resolver)], { windowStart: '2026-10-01', windowEnd: '2026-12-01' })
    const events = JSON.parse(db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events').data)
    expect(events.find((e) => e.id === 'o-9001')).toMatchObject({ place: 'e2473fa9', room: '302' })
  })

  test('官网响应分页使用固定请求格式，不在测试中联网', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const body = new URLSearchParams(init.body)
      expect(_url).toBe(OFFICIAL_EVENTS_URL)
      expect(body.get('siteId')).toBe('8')
      expect(body.get('columnId')).toBe('15079')
      expect(JSON.parse(body.get('returnInfos')).map((x) => x.field)).toEqual(expect.arrayContaining(['id', 'url', 'title', 'f1', 'f7']))
      const page = Number(body.get('pageIndex'))
      return new Response(JSON.stringify({ data: page === 1 ? fixture.slice(0, 2) : fixture.slice(2), total: 3 }), { status: 200 })
    })
    const records = await fetchOfficialRecords({ fetcher, start: '2026-08-17', end: '2026-12-15' })
    expect(records).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test('转换或上游失败时不清空旧目录', async () => {
    const app = express()
    const auth = (_req, _res, next) => next()
    const sync = installEventSync(app, db, root, { authorize: auth, fetcher: vi.fn(async () => new Response('{bad', { status: 200 })), initialSync: false, schedule: false, resolver })
    await expect(sync.sync()).resolves.toMatchObject({ lastError: expect.any(String) })
    const events = JSON.parse(db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events').data)
    expect(events).toHaveLength(3)
    expect(sync.status().lastSyncAt).toBeNull()
  })
})
