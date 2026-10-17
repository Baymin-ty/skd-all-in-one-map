#!/usr/bin/env node

/**
 * Build a deterministic database for the product demo (docs/VIDEO_SCRIPT.md §4).
 *
 * Usage:
 *   DEMO_DATE=2026-11-02 node scripts/seed-demo.mjs [source.db] [target.db] [--reset]
 *
 * DEMO_DATE is the protagonist's Monday; the seminar is two days later. The
 * generated rows all use stable ids and timestamps, so running the command
 * repeatedly is safe. It never writes to a file named map.db.
 */
import { existsSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_SOURCE = resolve(root, 'server/map.db')
const DEFAULT_TARGET = resolve(root, 'server/demo.db')
export const DEFAULT_DEMO_DATE = '2026-11-02'
const CREATED_AT = Date.parse('2026-10-17T00:00:00+08:00')
const MINUTE = 60_000

const classmates = [
  ['demo-student-1', '小林', 'student1@demo.test', 'student'],
  ['demo-student-2', '阿哲', 'student2@demo.test', 'student'],
  ['demo-student-3', '小雨', 'student3@demo.test', 'student'],
  ['demo-student-4', 'Mia', 'student4@demo.test', 'student'],
  ['demo-student-5', '陈同学', 'student5@demo.test', 'student'],
  ['demo-student-6', 'Yuki', 'student6@demo.test', 'student'],
]
// Background audience for the talk: they only exist so 小科 checks in as #28.
const attendees = ['阿杰', '小周', 'Leo', '若溪', '小鹿', '子涵', '阿琪', 'Ken', '思远', '小满', '一诺', 'Echo', '宇航', '晓晴', '阿宁', 'Tom', '欣怡', '浩然', '小橙', 'Iris', '明轩']
  .map((name, i) => { const n = String(i + 1).padStart(2, '0'); return [`demo-attendee-${n}`, name, `attendee${n}@demo.test`, 'student'] })
const users = [
  ['demo-xiaoke', '小科', 'xiaoke@demo.test', 'student'],
  ['demo-kedao', '科道书院', 'kedao@demo.test', 'organizer'],
  ['demo-wang', '王老师', 'wang@demo.test', 'organizer'],
  ...classmates,
  ...attendees,
]
/** Accounts written by earlier versions of this script. */
const STALE_USERS = ['demo-organizer']

function fail(message) {
  throw new Error(message)
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function checkDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || addDays(date, 0) !== date) fail(`DEMO_DATE 应为 YYYY-MM-DD：${date}`)
  return date
}

/** All seeded rows for one demo Monday. */
export function buildSeed(date = DEFAULT_DEMO_DATE) {
  checkDate(date)
  const wednesday = addDays(date, 2)
  const at = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+08:00`)
  const events = [
    {
      id: 'demo-share',
      title: '科道探索 · 生涯讲座：打开研究型大学的“隐藏副本”',
      title_en: 'Kedao Explore Career Talk: Unlocking the Hidden Quests of a Research University',
      desc: '「科道探索 · 生涯教育系列讲座」第一期：竞赛摘金 + 大厂实习 + 大学规划全攻略。信息学院 23 级学长分享怎样进课题组做科研、怎样准备学科比赛、怎样拿到并做好大厂实习，以及从大一开始怎样规划大学四年。最后是自由问答，欢迎带着问题来。',
      desc_en: 'Episode 1 of the Kedao Explore career talk series. A senior student from the School of Information Science and Technology shares how to join a research group, prepare for competitions, land and make the most of an internship at a major tech company, and plan your university years from day one. Open Q&A to finish, so bring your questions.',
      start: `${date}T15:00:00+08:00`, end: `${date}T17:00:00+08:00`, allDay: false,
      venueRaw: '科道书院（学生公寓8号楼）1楼研讨室', place: 'a747029d', room: '1 楼研讨室', floor: 1, unmapped: '',
      organizer: '科道书院', speaker: '', category: 'student', source: 'organizer', owner: 'demo-kedao', status: 'active', url: '',
    },
    {
      id: 'demo-report',
      title: '学术报告：AI for Science 的下一步',
      title_en: "Seminar: What's Next for AI for Science",
      desc: '访问学者 Dr. Emma Clarke 介绍 AI for Science 的最新进展：用机器学习加速材料和分子设计、科学大模型能信到什么程度，以及跨学科合作的新方式。报告用英文进行，面向全校师生开放，结束后有现场问答。',
      desc_en: 'Visiting scholar Dr. Emma Clarke discusses recent progress in AI for Science: machine learning for faster materials and molecular design, how far we can trust scientific foundation models, and new ways for disciplines to work together. The talk is in English and open to everyone, followed by Q&A.',
      start: `${wednesday}T14:00:00+08:00`, end: `${wednesday}T15:30:00+08:00`, allDay: false,
      venueRaw: '学校报告厅', place: 'cd9d3699', room: '', floor: null, unmapped: '',
      organizer: '信息学院', speaker: 'Dr. Emma Clarke', category: 'lecture', source: 'organizer', owner: 'demo-wang', status: 'active', url: '',
    },
  ]

  // 小科 posts in event:demo-share live on camera, so that topic is left empty.
  const lunch = at(date, '11:50')
  const posts = [
    ['demo-post-library-1', 'place:e2473fa9', 'demo-student-4', '图书馆今天人多吗', '下午想找个安静的位置写作业。', '提问', lunch - 12 * MINUTE],
    ['demo-post-library-2', 'place:e2473fa9', 'demo-student-5', '四楼靠窗的位置', '采光很好，插座也方便。', '攻略', lunch - 9 * MINUTE],
    ['demo-post-barber-1', 'place:25250bbc', 'demo-student-6', '理发店需要预约吗', '午休时间去剪头发方便吗？', '提问', lunch - 6 * MINUTE],
    ['demo-post-barber-2', 'place:25250bbc', 'demo-xiaoke', '理发店体验分享', '师傅手艺不错，学生价也很友好。', '测评', lunch - 3 * MINUTE],
  ].map(([id, topic_id, user_id, title, content, tag, created_at]) => ({ id, topic_id, user_id, title, content, tag, created_at }))
  const comments = [
    ['demo-comment-library-1', 'demo-post-library-1', 'demo-student-2', '现在还有空位。', lunch - 2 * MINUTE],
    ['demo-comment-barber-1', 'demo-post-barber-1', 'demo-xiaoke', '建议先在交流区问一下。', lunch + 2 * MINUTE],
  ].map(([id, post_id, user_id, content, created_at]) => ({ id, post_id, user_id, parent_id: null, content, created_at }))
  const reactions = [['demo-post-library-1', 'demo-student-6'], ['demo-post-barber-2', 'demo-student-1']]
    .map(([post_id, user_id]) => ({ post_id, user_id, kind: 'like' }))

  // One report every 10 minutes from 11:30 to 12:30, so any demo clock between
  // 11:50 and 12:30 sees at least three reports inside the 30-minute window.
  const reporters = [...classmates, ...attendees].map(([id]) => id)
  const crowd = []
  for (const [outlet, level, waits] of [['c2-2f', 2, [15, 16, 14, 15, 17, 15, 14]], ['c3-1f', 0, [2, 3, 2, 2, 3, 2, 3]]]) {
    waits.forEach((wait_min, i) => {
      const time = at(date, '11:30') + i * 10 * MINUTE
      const hhmm = new Date(time + 8 * 3_600_000).toISOString().slice(11, 16).replace(':', '')
      crowd.push({ id: `demo-crowd-${outlet}-${hhmm}`, outlet_id: outlet, level, wait_min, user_id: reporters[crowd.length % reporters.length], source: 'demo', created_at: time })
    })
  }

  // 27 people already checked in between 14:32 and 14:58; 小科 becomes #28.
  const checkins = [...classmates, ...attendees].map(([user_id], i) => ({ event_id: 'demo-share', user_id, at: at(date, '14:32') + i * MINUTE }))

  return { date, events, posts, comments, reactions, crowd, checkins }
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => arg !== '--reset')
  if (positional.length > 2) fail('用法：node scripts/seed-demo.mjs [源库] [目标库] [--reset]')
  return { source: resolve(positional[0] || DEFAULT_SOURCE), target: resolve(positional[1] || DEFAULT_TARGET), reset: argv.includes('--reset') }
}

function ensureSafeTarget(source, target) {
  if (basename(target).toLowerCase() === 'map.db' || target === source) fail('拒绝把演示数据写入 map.db，请使用 server/demo.db 等目标路径')
  if (existsSync(target) && existsSync(source) && realpathSync(target) === realpathSync(source)) fail('目标路径指向 map.db，拒绝覆盖源库')
}

/** Mirrors the tables the server modules create, so their CREATE IF NOT EXISTS stays a no-op. */
function ensureSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS discovery_catalog (kind TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_topics (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, context TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS community_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES community_users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES community_topics(id), user_id TEXT NOT NULL REFERENCES community_users(id), title TEXT NOT NULL, content TEXT NOT NULL, tag TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_images (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES community_users(id), post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES community_users(id), parent_id TEXT REFERENCES community_comments(id) ON DELETE SET NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_reactions (post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES community_users(id), kind TEXT NOT NULL CHECK(kind IN ('like','save')), PRIMARY KEY(post_id, user_id, kind));
    CREATE TABLE IF NOT EXISTS community_summaries (topic_id TEXT PRIMARY KEY REFERENCES community_topics(id), fingerprint TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS community_ai_usage (bucket INTEGER PRIMARY KEY, calls INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY REFERENCES community_users(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','organizer','admin')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_events (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crowd_reports (
      id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 2), wait_min INTEGER NOT NULL,
      user_id TEXT NOT NULL REFERENCES community_users(id), source TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_checkins (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES community_users(id),
      at INTEGER NOT NULL,
      PRIMARY KEY(event_id, user_id)
    );
  `)
}

const hasTable = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
}

/** Insert a row using only columns supported by the installed app schema. `key` may list several columns. */
function upsert(db, table, data, key = 'id') {
  const keys = key.split(',')
  const columns = tableColumns(db, table)
  const fields = Object.keys(data).filter((field) => columns.has(field))
  if (!fields.length) return
  const values = fields.map((field) => data[field])
  const placeholders = fields.map(() => '?').join(',')
  const updates = fields.filter((field) => !keys.includes(field)).map((field) => `${field}=excluded.${field}`).join(',')
  const sql = updates
    ? `INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders}) ON CONFLICT(${key}) DO UPDATE SET ${updates}`
    : `INSERT OR IGNORE INTO ${table} (${fields.join(',')}) VALUES (${placeholders})`
  db.prepare(sql).run(...values)
}

function topic(db, id, type, name, context) {
  upsert(db, 'community_topics', { id, type, name, context }, 'id')
}

function seedUsers(db) {
  for (const [id, name, email, role] of users) {
    upsert(db, 'community_users', { id, name, created_at: CREATED_AT })
    upsert(db, 'accounts', { user_id: id, email, role, created_at: CREATED_AT, nickname_at: CREATED_AT }, 'user_id')
  }
}

function seedEvents(db, seed) {
  const catalog = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events')
  let eventsCatalog = []
  if (catalog) {
    try { const parsed = JSON.parse(catalog.data); eventsCatalog = Array.isArray(parsed) ? parsed : [] } catch { eventsCatalog = [] }
  }
  for (const event of seed.events) {
    upsert(db, 'custom_events', { id: event.id, owner: event.owner, data: JSON.stringify(event), created_at: CREATED_AT, updated_at: CREATED_AT })
    topic(db, `event:${event.id}`, 'event', event.title, JSON.stringify(event))
    eventsCatalog = eventsCatalog.filter((item) => item.id !== event.id)
    eventsCatalog.push(event)
  }
  eventsCatalog.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  upsert(db, 'discovery_catalog', { kind: 'events', data: JSON.stringify(eventsCatalog) }, 'kind')
}

function seedCommunity(db, seed) {
  const placeTopics = [
    ['place:e2473fa9', 'building', '图书馆', { kind: 'building', name: { zh: '图书馆', en: 'Library' } }],
    ['place:25250bbc', 'poi', '理发店', { kind: 'poi', name: { zh: '理发店', en: 'Barber shop' } }],
  ]
  for (const [id, type, name, context] of placeTopics) topic(db, id, type, name, JSON.stringify(context))
  for (const post of seed.posts) upsert(db, 'community_posts', post)
  for (const comment of seed.comments) upsert(db, 'community_comments', comment)
  for (const reaction of seed.reactions) upsert(db, 'community_reactions', reaction, 'post_id,user_id,kind')
}

function seedCrowd(db, seed) {
  for (const row of seed.crowd) upsert(db, 'crowd_reports', row)
}

function seedCheckins(db, seed) {
  for (const row of seed.checkins) upsert(db, 'event_checkins', row, 'event_id,user_id')
}

/** Drop rows an older version of this script generated but the current story no longer has. */
function removeStale(db, seed) {
  const keep = (rows) => JSON.stringify(rows.map((row) => row.id))
  const notKept = "id NOT IN (SELECT value FROM json_each(?))"
  const stalePosts = db.prepare(`SELECT id, topic_id FROM community_posts WHERE id LIKE 'demo-post-%' AND ${notKept}`).all(keep(seed.posts))
  for (const { id } of stalePosts) {
    db.prepare('DELETE FROM community_reactions WHERE post_id=?').run(id)
    db.prepare('DELETE FROM community_comments WHERE post_id=?').run(id)
    db.prepare('DELETE FROM community_images WHERE post_id=?').run(id)
    db.prepare('DELETE FROM community_posts WHERE id=?').run(id)
  }
  for (const topicId of new Set(stalePosts.map((post) => post.topic_id))) db.prepare('DELETE FROM community_summaries WHERE topic_id=?').run(topicId)
  db.prepare(`DELETE FROM community_comments WHERE id LIKE 'demo-comment-%' AND ${notKept}`).run(keep(seed.comments))
  db.prepare(`DELETE FROM crowd_reports WHERE id LIKE 'demo-crowd-%' AND ${notKept}`).run(keep(seed.crowd))

  const references = ['community_posts', 'community_comments', 'community_reactions', 'community_images', 'crowd_reports', 'event_checkins']
  for (const id of STALE_USERS) {
    db.prepare('DELETE FROM community_sessions WHERE user_id=?').run(id)
    db.prepare('DELETE FROM accounts WHERE user_id=?').run(id)
    // Keep the user row if someone posted with it during a rehearsal.
    if (references.some((table) => hasTable(db, table) && db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? LIMIT 1`).get(id))) continue
    if (hasTable(db, 'user_data')) db.prepare('DELETE FROM user_data WHERE user_id=?').run(id)
    db.prepare('DELETE FROM community_users WHERE id=?').run(id)
  }
}

function removeGenerated(db) {
  // Delete children first to keep this compatible with PRAGMA foreign_keys=ON.
  db.prepare("DELETE FROM community_reactions WHERE post_id LIKE 'demo-post-%'").run()
  db.prepare("DELETE FROM community_comments WHERE id LIKE 'demo-comment-%'").run()
  db.prepare("DELETE FROM community_posts WHERE id LIKE 'demo-post-%'").run()
  db.prepare("DELETE FROM community_summaries WHERE topic_id IN ('event:demo-share','event:demo-report','place:e2473fa9','place:25250bbc')").run()
  db.prepare("DELETE FROM community_topics WHERE id IN ('event:demo-share','event:demo-report','place:e2473fa9','place:25250bbc')").run()
  db.prepare("DELETE FROM custom_events WHERE id LIKE 'demo-%'").run()
  db.prepare("DELETE FROM crowd_reports WHERE id LIKE 'demo-crowd-%'").run()
  db.prepare("DELETE FROM event_checkins WHERE event_id LIKE 'demo-%' OR user_id LIKE 'demo-%'").run()
  if (hasTable(db, 'user_data')) db.prepare("DELETE FROM user_data WHERE user_id LIKE 'demo-%'").run()
  db.prepare("DELETE FROM accounts WHERE email LIKE '%@demo.test'").run()
  db.prepare("DELETE FROM community_sessions WHERE user_id LIKE 'demo-%'").run()
  db.prepare("DELETE FROM community_users WHERE id LIKE 'demo-%'").run()
}

/** Snapshot the source including its WAL; a plain file copy would miss changes not yet checkpointed. */
function copyDatabase(source, target) {
  mkdirSync(dirname(target), { recursive: true })
  const db = new DatabaseSync(source, { readOnly: true })
  try { db.prepare('VACUUM INTO ?').run(target) } finally { db.close() }
}

export function seedDemo(source = DEFAULT_SOURCE, target = DEFAULT_TARGET, { reset = false, date = process.env.DEMO_DATE || DEFAULT_DEMO_DATE } = {}) {
  source = resolve(source); target = resolve(target)
  ensureSafeTarget(source, target)
  const seed = buildSeed(date)
  if (!existsSync(source)) fail(`源库不存在：${source}`)
  if (reset) {
    for (const path of [target, `${target}-wal`, `${target}-shm`]) if (existsSync(path)) unlinkSync(path)
  }
  if (!existsSync(target)) copyDatabase(source, target)
  const db = new DatabaseSync(target)
  try {
    ensureSchema(db)
    db.exec('BEGIN IMMEDIATE')
    try {
      if (reset) removeGenerated(db)
      seedUsers(db)
      seedEvents(db, seed)
      seedCommunity(db, seed)
      seedCrowd(db, seed)
      seedCheckins(db, seed)
      removeStale(db, seed)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally { db.close() }
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { source, target, reset } = parseArgs(process.argv.slice(2))
    const date = checkDate(process.env.DEMO_DATE || DEFAULT_DEMO_DATE)
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) console.warn(`seed-demo: ${date} 不是周一，小科的课表只排在周一`)
    console.log(`生成演示库：${seedDemo(source, target, { reset, date })}（演示日 ${date}，学术报告 ${addDays(date, 2)}）`)
  } catch (error) {
    if (!process.exitCode) process.exitCode = 1
    console.error(`seed-demo: ${error.message}`)
  }
}
