import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { seedDemo } from './seed-demo.mjs'
import { aggregateCrowd, WINDOW_MS } from '../server/crowd.mjs'

const directory = mkdtempSync(join(tmpdir(), 'campus-seed-demo-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))
const official = { id: 'm-48f5e86b3b', title: '【科道探索·活动报名】生涯讲座｜打开研究型大学的 “隐藏副本”', start: '2026-06-05T15:00:00+08:00', end: '2026-06-05T17:00:00+08:00', allDay: false, venueRaw: '科道书院（学生公寓8号楼）1楼研讨室', room: '', floor: null, unmapped: '', organizer: '科道书院', category: 'student', source: 'email', place: 'a747029d' }
let run = 0, source, target, sourceDb

beforeEach(() => {
  sourceDb?.close()
  run++
  source = join(directory, `source-${run}.sqlite`)
  target = join(directory, `demo-${run}.db`)
  // Leave the last write in the WAL, like a running server would.
  sourceDb = new DatabaseSync(source)
  sourceDb.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE discovery_catalog (kind TEXT PRIMARY KEY, data TEXT NOT NULL)')
  sourceDb.prepare('INSERT INTO discovery_catalog VALUES (?, ?)').run('events', JSON.stringify([official]))
})
afterAll(() => sourceDb?.close())

function open(path = target) {
  return new DatabaseSync(path, { readOnly: true })
}
function dump(path = target) {
  const db = open(path)
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name)
    return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  } finally { db.close() }
}
const customEvent = (db, id) => JSON.parse(db.prepare('SELECT data FROM custom_events WHERE id=?').get(id).data)
const crowdAt = (db, time) => aggregateCrowd(db.prepare('SELECT outlet_id AS outletId, level, wait_min AS waitMin, source, created_at AS createdAt FROM crowd_reports WHERE created_at >= ?').all(time - WINDOW_MS), time)

describe('demo seed', () => {
  test('seeds the Kedao Monday story and the Wednesday seminar', () => {
    seedDemo(source, target, { date: '2026-11-02' })
    const db = open()
    try {
      const share = customEvent(db, 'demo-share')
      expect(share).toMatchObject({ start: '2026-11-02T15:00:00+08:00', end: '2026-11-02T17:00:00+08:00', place: 'a747029d', room: '1 楼研讨室', floor: 1, organizer: '科道书院', owner: 'demo-kedao' })
      expect(share.title).toContain('隐藏副本')
      expect(share.title_en && share.desc_en && share.desc).toBeTruthy()
      const report = customEvent(db, 'demo-report')
      expect(report).toMatchObject({ title: '学术报告：AI for Science 的下一步', title_en: "Seminar: What's Next for AI for Science", start: '2026-11-04T14:00:00+08:00', end: '2026-11-04T15:30:00+08:00', place: 'cd9d3699', speaker: 'Dr. Emma Clarke', organizer: '信息学院', owner: 'demo-wang' })
      expect(report.desc_en).toBeTruthy()

      const catalog = JSON.parse(db.prepare("SELECT data FROM discovery_catalog WHERE kind='events'").get().data)
      expect(catalog.map((event) => event.id)).toEqual(['m-48f5e86b3b', 'demo-share', 'demo-report'])
      expect(db.prepare("SELECT name FROM community_topics WHERE id='event:demo-share'").get().name).toBe(share.title)

      const organizers = db.prepare("SELECT user_id, role FROM accounts WHERE role='organizer' ORDER BY user_id").all().map((row) => ({ ...row }))
      expect(organizers).toEqual([{ user_id: 'demo-kedao', role: 'organizer' }, { user_id: 'demo-wang', role: 'organizer' }])
      expect(db.prepare("SELECT count(*) AS n FROM accounts WHERE email NOT LIKE '%@demo.test'").get().n).toBe(0)
      expect(JSON.stringify(dump())).not.toMatch(/上道|科道分享会|活动中心/)

      const checkins = db.prepare("SELECT user_id, at FROM event_checkins WHERE event_id='demo-share'").all()
      expect(checkins).toHaveLength(27)
      expect(checkins.some((row) => ['demo-xiaoke', 'demo-kedao', 'demo-wang'].includes(row.user_id))).toBe(false)
      for (const { at } of checkins) expect(at >= Date.parse(share.start) - 30 * 60_000 && at < Date.parse(share.start)).toBe(true)

      expect(db.prepare("SELECT count(*) AS n FROM community_posts WHERE topic_id='event:demo-share'").get().n).toBe(0)
      expect(db.prepare("SELECT count(*) AS n FROM community_posts WHERE topic_id IN ('place:e2473fa9','place:25250bbc')").get().n).toBe(4)

      for (const clock of ['11:50', '11:56', '12:10', '12:30']) {
        const crowd = crowdAt(db, Date.parse(`2026-11-02T${clock}:00+08:00`))
        expect(crowd['c2-2f']).toMatchObject({ level: 2 })
        expect(crowd['c2-2f'].waitMin).toBeGreaterThanOrEqual(14)
        expect(crowd['c2-2f'].waitMin).toBeLessThanOrEqual(16)
        expect(crowd['c3-1f']).toMatchObject({ level: 0 })
        expect(crowd['c3-1f'].waitMin).toBeLessThanOrEqual(3)
        expect(crowd['c2-2f'].reports).toBeGreaterThanOrEqual(3)
      }
    } finally { db.close() }
  })

  test('running twice gives the same database', () => {
    seedDemo(source, target)
    const first = dump()
    seedDemo(source, target)
    expect(dump()).toEqual(first)
  })

  test('removes rows from the old 科道分享会 seed but keeps live content', () => {
    seedDemo(source, target)
    const db = new DatabaseSync(target)
    try {
      db.exec("PRAGMA foreign_keys = ON")
      db.prepare('INSERT INTO community_users VALUES (?,?,?)').run('demo-organizer', '科道主办方', 1)
      db.prepare('INSERT INTO accounts (user_id,email,role,created_at) VALUES (?,?,?,?)').run('demo-organizer', 'organizer@demo.test', 'organizer', 1)
      db.prepare('INSERT INTO community_posts VALUES (?,?,?,?,?,?,?)').run('demo-post-share-1', 'event:demo-share', 'demo-xiaoke', '第一次参加科道分享会', '有人一起走吗？', '分享', 1)
      db.prepare('INSERT INTO community_comments VALUES (?,?,?,?,?,?)').run('demo-comment-share-2', 'demo-post-share-1', 'demo-student-5', null, '活动中心门口见。', 2)
      db.prepare('INSERT INTO community_reactions VALUES (?,?,?)').run('demo-post-share-1', 'demo-student-1', 'like')
      db.prepare('INSERT INTO community_summaries VALUES (?,?,?,?)').run('event:demo-share', 'old', '{}', 1)
      db.prepare('INSERT INTO crowd_reports VALUES (?,?,?,?,?,?,?)').run('demo-crowd-c2-1120', 'c2-1f', 2, 28, 'demo-student-1', 'demo', 1)
      db.prepare('INSERT INTO community_posts VALUES (?,?,?,?,?,?,?)').run('live-post', 'event:demo-share', 'demo-xiaoke', '原来不是只有我觉得难', '现场发的', '分享', 3)
    } finally { db.close() }

    seedDemo(source, target)
    const after = open()
    try {
      expect(after.prepare("SELECT id FROM community_posts WHERE topic_id='event:demo-share'").all().map((row) => row.id)).toEqual(['live-post'])
      expect(after.prepare("SELECT count(*) AS n FROM community_comments WHERE content LIKE '%活动中心%'").get().n).toBe(0)
      expect(after.prepare("SELECT count(*) AS n FROM community_summaries WHERE topic_id='event:demo-share'").get().n).toBe(0)
      expect(after.prepare("SELECT count(*) AS n FROM crowd_reports WHERE id='demo-crowd-c2-1120'").get().n).toBe(0)
      expect(after.prepare("SELECT count(*) AS n FROM community_users WHERE id='demo-organizer'").get().n).toBe(0)
      expect(after.prepare("SELECT count(*) AS n FROM accounts WHERE email='organizer@demo.test'").get().n).toBe(0)
    } finally { after.close() }
  })

  test('--reset rebuilds from the source so 小科 checks in as #28 again', () => {
    seedDemo(source, target)
    const db = new DatabaseSync(target)
    db.prepare('INSERT INTO event_checkins VALUES (?,?,?)').run('demo-share', 'demo-xiaoke', 5)
    db.close()
    seedDemo(source, target, { reset: true })
    const after = open()
    try {
      expect(after.prepare("SELECT count(*) AS n FROM event_checkins WHERE event_id='demo-share'").get().n).toBe(27)
      expect(after.prepare("SELECT count(*) AS n FROM event_checkins WHERE user_id='demo-xiaoke'").get().n).toBe(0)
    } finally { after.close() }
  })

  test('follows DEMO_DATE and refuses map.db or an invalid date', () => {
    seedDemo(source, target, { date: '2026-11-09' })
    const db = open()
    try { expect(customEvent(db, 'demo-report').start).toBe('2026-11-11T14:00:00+08:00') } finally { db.close() }
    expect(() => seedDemo(source, join(directory, 'map.db'))).toThrow(/map\.db/)
    expect(() => seedDemo(source, source)).toThrow(/map\.db/)
    expect(() => seedDemo(source, join(directory, 'bad.db'), { date: '2026-13-01' })).toThrow(/DEMO_DATE/)
  })
})
