import express from 'express'
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { communitySession } from './community.mjs'

const SESSION_MAX_AGE = 365 * 86_400_000
const CODE_TTL = 10 * 60_000
const CODE_COOLDOWN = 60_000
const IP_WINDOW = 60 * 60_000
const IP_LIMIT = 10
const CODE_TRIES = 5
const SMTP_TIMEOUT = 10_000
const DATA_LIMIT = 200 * 1024
const DATA_KEYS = new Set(['today', 'map', 'prefs'])
const NAME_WINDOW = 10 * 60_000
const NAME_LIMIT = 10
/** 匿名会话的占位名。只在后台标识会话，不会作为公开昵称显示。 */
const PLACEHOLDER_NAME = /^科大同学 [0-9A-F]{4}$/
const RESERVED_NAME = /管理员|官方|admin|系统|一图通/i

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => { throw new AccountError(status, message) }
const hash = (value) => createHash('sha256').update(String(value)).digest('hex')

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function allowedEmail(value, demoMode = process.env.DEMO_MODE === 'true') {
  const email = normalizeEmail(value)
  if (!/^[^\s@]{1,120}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(email)) return false
  return true
}

export function maskEmail(value) {
  const email = normalizeEmail(value), at = email.lastIndexOf('@')
  if (at <= 0) return ''
  const local = email.slice(0, at), domain = email.slice(at + 1)
  if (local.length <= 2) return `${local[0]}***@${domain}`
  return `${local[0]}${'*'.repeat(Math.max(3, local.length - 2))}${local.at(-1)}@${domain}`
}

/** 校验并规整昵称：2–16 个字，不含控制字符和 @，普通账号不能冒充官方。 */
export function cleanNickname(value, role = 'student') {
  if (typeof value !== 'string') fail(400, '请填写昵称')
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim()
  const length = [...name].length
  if (length < 2 || length > 16) fail(400, '昵称需要 2–16 个字')
  if (/[\p{C}@]/u.test(name)) fail(400, '昵称不能包含 @ 或特殊控制字符')
  if (PLACEHOLDER_NAME.test(name)) fail(400, '换一个属于你自己的昵称吧')
  if (role !== 'admin' && RESERVED_NAME.test(name)) fail(400, '昵称不能包含“管理员”“官方”等字样')
  return name
}

const requestToken = (req) => (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith('campus_session='))?.slice('campus_session='.length) ?? null
const tokenHash = (token) => hash(token)
const secureCookie = (req) => req.secure || process.env.COOKIE_SECURE === 'true'
function setSessionCookie(req, res, token) {
  res.cookie('campus_session', token, { httpOnly: true, sameSite: 'lax', secure: secureCookie(req), maxAge: SESSION_MAX_AGE, path: '/api' })
}

function setupSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY REFERENCES community_users(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','organizer','admin')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_codes_email_time ON login_codes(email, created_at DESC);
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL REFERENCES community_users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      data TEXT NOT NULL,
      rev INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, key)
    );
  `)
  // 昵称归账号所有：nickname_at 为空表示还没起过昵称。旧库里改过名的账号视为已设置。
  if (!db.prepare('PRAGMA table_info(accounts)').all().some((column) => column.name === 'nickname_at')) {
    db.exec('ALTER TABLE accounts ADD COLUMN nickname_at INTEGER')
    for (const row of db.prepare('SELECT a.user_id, a.created_at, u.name FROM accounts a JOIN community_users u ON u.id=a.user_id').all())
      if (!PLACEHOLDER_NAME.test(row.name)) db.prepare('UPDATE accounts SET nickname_at=? WHERE user_id=?').run(row.created_at, row.user_id)
  }
}

function checkSameOrigin(req) {
  if (req.get('X-Community-Request') !== '1') fail(403, '请从校园页面操作')
  const origin = req.get('origin')
  if (!origin) return
  try {
    if (new URL(origin).host !== req.get('host')) fail(403, '不允许跨站操作')
  } catch { fail(403, '不允许跨站操作') }
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

function accountFor(db, userId) {
  return db.prepare('SELECT user_id AS id, email, role, created_at AS createdAt, nickname_at AS nicknameAt FROM accounts WHERE user_id=?').get(userId) ?? null
}

/** 前端「我的」页看到的账号资料；邮箱只返回打码后的形式。 */
function profileJson(db, userId) {
  const account = accountFor(db, userId)
  if (!account) return null
  const user = db.prepare('SELECT name FROM community_users WHERE id=?').get(userId)
  return { id: userId, name: user?.name ?? '', email: maskEmail(account.email), role: account.role, nameSet: account.nicknameAt != null, createdAt: account.createdAt, demo: userId === 'demo-showcase' }
}

function makeName() { return `科大同学 ${randomBytes(2).toString('hex').toUpperCase()}` }

/** Ensure a valid anonymous session exists. The community endpoint normally creates this first. */
function ensureAnonymous(req, res, db, now, writeCookie = true) {
  const token = requestToken(req)
  const current = communitySession(req, db)
  if (current) return { ...current, token }
  const nextToken = randomBytes(32).toString('base64url'), id = randomUUID(), name = makeName()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT INTO community_users (id,name,created_at) VALUES (?,?,?)').run(id, name, now())
    db.prepare('INSERT INTO community_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash(nextToken), id, now() + SESSION_MAX_AGE)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  if (writeCookie) setSessionCookie(req, res, nextToken)
  return { id, name, token: nextToken }
}

function issueSession(req, res, db, userId, now, oldToken = null) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO community_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(tokenHash(token), userId, now() + SESSION_MAX_AGE)
  if (oldToken) db.prepare('DELETE FROM community_sessions WHERE token_hash=?').run(tokenHash(oldToken))
  setSessionCookie(req, res, token)
  return token
}

function migrateReactions(db, fromId, toId) {
  if (!tableExists(db, 'community_reactions')) return
  const rows = db.prepare('SELECT post_id, kind FROM community_reactions WHERE user_id=?').all(fromId)
  for (const row of rows) {
    if (db.prepare('SELECT 1 FROM community_reactions WHERE post_id=? AND user_id=? AND kind=?').get(row.post_id, toId, row.kind))
      db.prepare('DELETE FROM community_reactions WHERE post_id=? AND user_id=? AND kind=?').run(row.post_id, fromId, row.kind)
    else db.prepare('UPDATE community_reactions SET user_id=? WHERE post_id=? AND user_id=? AND kind=?').run(toId, row.post_id, fromId, row.kind)
  }
}

/** Move anonymous content to an already registered account before deleting the old user. */
function mergeUser(db, fromId, toId) {
  if (fromId === toId) return
  migrateReactions(db, fromId, toId)
  for (const table of ['community_posts', 'community_comments', 'community_images']) {
    if (tableExists(db, table)) db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id=?`).run(toId, fromId)
  }
  if (tableExists(db, 'crowd_reports')) db.prepare('UPDATE crowd_reports SET user_id=? WHERE user_id=?').run(toId, fromId)
  if (tableExists(db, 'community_sessions')) db.prepare('DELETE FROM community_sessions WHERE user_id=?').run(fromId)
  // Anonymous users cannot have user_data, but this keeps a manually seeded database merge-safe.
  if (tableExists(db, 'user_data')) {
    const rows = db.prepare('SELECT key,data,rev,updated_at FROM user_data WHERE user_id=?').all(fromId)
    for (const row of rows) {
      const existing = db.prepare('SELECT rev FROM user_data WHERE user_id=? AND key=?').get(toId, row.key)
      if (!existing) db.prepare('UPDATE user_data SET user_id=? WHERE user_id=? AND key=?').run(toId, fromId, row.key)
      else db.prepare('DELETE FROM user_data WHERE user_id=? AND key=?').run(fromId, row.key)
    }
  }
  db.prepare('DELETE FROM community_users WHERE id=?').run(fromId)
}

function parseData(value) {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) fail(400, '数据必须是有效 JSON')
    if (Buffer.byteLength(encoded, 'utf8') > DATA_LIMIT) fail(413, '单项数据不能超过 200 KB')
    return { encoded, value: JSON.parse(encoded) }
  } catch (error) {
    if (error instanceof AccountError) throw error
    fail(400, '数据必须是有效 JSON')
  }
}

function dataJson(row) {
  return { data: JSON.parse(row.data), rev: row.rev, updatedAt: row.updated_at }
}

function defaultCode() { return String(randomInt(0, 1_000_000)).padStart(6, '0') }

async function defaultSendCode(email, code, demoMode) {
  if (demoMode) {
    console.log(`[DEMO] ${email} 登录验证码：${code}`)
    return
  }
  const smtpUrl = process.env.SMTP_URL, from = process.env.MAIL_FROM
  if (!smtpUrl || !from) fail(503, '发信服务暂未配置')
  let nodemailer
  try { nodemailer = (await import('nodemailer')).default } catch { fail(503, '发信服务暂未安装') }
  // Bound every SMTP phase so a stalled server cannot hold the request for minutes.
  const transport = nodemailer.createTransport({ url: smtpUrl, connectionTimeout: SMTP_TIMEOUT, greetingTimeout: SMTP_TIMEOUT, socketTimeout: SMTP_TIMEOUT })
  await transport.sendMail({ from, to: email, subject: '上科大一图通登录验证码', text: `你的登录验证码是 ${code}，10 分钟内有效。` })
}

function errorMiddleware(error, _req, res, next) {
  if (error instanceof AccountError) return res.status(error.status).json({ error: error.message })
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: '请求数据过大' })
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 格式不正确' })
  next(error)
}

/** Install campus email login and authenticated per-user data APIs. */
export function installAccount(app, db, options = {}) {
  setupSchema(db)
  const now = options.now ?? (() => Date.now())
  const demoMode = options.demoMode ?? process.env.DEMO_MODE === 'true'
  const sendCode = options.sendCode ?? ((email, code) => defaultSendCode(email, code, demoMode))
  const generateCode = options.generateCode ?? defaultCode
  const ipWindows = new Map()
  const nameWindows = new Map()
  const accountRouter = express.Router()
  const dataRouter = express.Router()
  for (const router of [accountRouter, dataRouter]) {
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
    router.use((req, _res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        try { checkSameOrigin(req); next() } catch (error) { next(error) }
      } else next()
    })
    router.use(express.json({ limit: '256kb' }))
  }
  const rateIp = (req) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown', current = now()
    const old = ipWindows.get(key)
    if (!old || old.until <= current) { ipWindows.set(key, { count: 1, until: current + IP_WINDOW }); return }
    if (old.count >= IP_LIMIT) fail(429, '请求有点频繁，请稍后再试')
    old.count++
  }

  accountRouter.post('/demo', (req, res, next) => {
    try {
      const demoId = 'demo-showcase', current = now(), token = requestToken(req)
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT OR IGNORE INTO community_users (id,name,created_at) VALUES (?,?,?)').run(demoId, '一图通演示账号', current)
        db.prepare('INSERT OR IGNORE INTO accounts (user_id,email,role,created_at,nickname_at) VALUES (?,?,?,?,?)').run(demoId, 'demo@demo.local', 'student', current, current)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      issueSession(req, res, db, demoId, now, token)
      res.json(profileJson(db, demoId))
    } catch (error) { next(error) }
  })

  accountRouter.post('/code', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email)
      if (!allowedEmail(email, demoMode)) fail(400, '请输入有效的邮箱地址')
      rateIp(req)
      const current = now(), previous = db.prepare('SELECT created_at FROM login_codes WHERE email=? ORDER BY created_at DESC,id DESC LIMIT 1').get(email)
      if (previous && current - previous.created_at < CODE_COOLDOWN) fail(429, '验证码发送得太频繁，请稍后再试')
      const code = String(generateCode()).padStart(6, '0')
      if (!/^\d{6}$/.test(code)) fail(500, '验证码生成失败')
      try { await sendCode(email, code) } catch (error) {
        if (error instanceof AccountError) throw error
        console.error('[account] 验证码邮件发送失败', error)
        fail(503, '验证码邮件发送失败，请稍后再试')
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('DELETE FROM login_codes WHERE email=?').run(email)
        db.prepare('INSERT INTO login_codes (email,code_hash,expires_at,tries,created_at) VALUES (?,?,?,?,?)').run(email, hash(code), current + CODE_TTL, 0, current)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      res.json({ ok: true })
    } catch (error) { next(error) }
  })

  accountRouter.post('/verify', (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email), code = typeof req.body?.code === 'string' ? req.body.code.trim() : String(req.body?.code ?? '')
      if (!allowedEmail(email, demoMode) || !/^\d{6}$/.test(code)) fail(400, '验证码不正确')
      const current = now(), row = db.prepare('SELECT * FROM login_codes WHERE email=? ORDER BY created_at DESC,id DESC LIMIT 1').get(email)
      if (!row || row.expires_at <= current) {
        if (row) db.prepare('DELETE FROM login_codes WHERE id=?').run(row.id)
        fail(400, '验证码已过期，请重新获取')
      }
      if (row.tries >= CODE_TRIES) fail(429, '验证码尝试次数过多，请重新获取')
      if (hash(code) !== row.code_hash) {
        const tries = row.tries + 1
        db.prepare('UPDATE login_codes SET tries=? WHERE id=?').run(tries, row.id)
        if (tries >= CODE_TRIES) fail(429, '验证码尝试次数过多，请重新获取')
        fail(400, '验证码不正确')
      }
      // Verification replaces the current token below; avoid emitting a temporary
      // anonymous cookie when a caller did not have a session yet.
      const anonymous = ensureAnonymous(req, res, db, now, false), currentAccount = accountFor(db, anonymous.id)
      let target = db.prepare('SELECT user_id AS id, email, role, created_at AS createdAt FROM accounts WHERE email=?').get(email) ?? null
      // A verified session is permanently bound to its campus account.  Do
      // not fall through to an INSERT with the same user_id when somebody
      // tries a different email: that would surface as a SQLite 500 error.
      if (currentAccount && currentAccount.email !== email) fail(409, '当前会话已绑定其他校园账号')
      db.exec('BEGIN IMMEDIATE')
      try {
        if (target && target.id !== anonymous.id) {
          mergeUser(db, anonymous.id, target.id)
        } else if (!target) {
          db.prepare('INSERT INTO accounts (user_id,email,role,created_at) VALUES (?,?,?,?)').run(anonymous.id, email, 'student', current)
          target = { id: anonymous.id, email, role: 'student', createdAt: current }
        }
        db.prepare('DELETE FROM login_codes WHERE email=?').run(email)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      const token = anonymous.token
      if (token) db.prepare('DELETE FROM community_sessions WHERE token_hash=?').run(tokenHash(token))
      const targetId = target?.id ?? anonymous.id
      issueSession(req, res, db, targetId, now)
      res.json(profileJson(db, targetId))
    } catch (error) { next(error) }
  })

  // TEMP DEMO(temp-account): 演示站不发邮件，一键给当前会话建一个临时账号（邮箱为占位 xxx@demo.local）。
  // 已登录则直接返回；未登录则把匿名会话升级为账号，匿名期间的数据随之保留。
  accountRouter.post('/temp', (req, res, next) => {
    try {
      rateIp(req)
      const anonymous = ensureAnonymous(req, res, db, now, false), existing = accountFor(db, anonymous.id)
      if (!existing) {
        const email = `temp-${randomBytes(4).toString('hex')}@demo.local`
        db.prepare('INSERT INTO accounts (user_id,email,role,created_at) VALUES (?,?,?,?)').run(anonymous.id, email, 'student', now())
      }
      issueSession(req, res, db, anonymous.id, now, anonymous.token)
      res.json(profileJson(db, anonymous.id))
    } catch (error) { next(error) }
  })

  accountRouter.get('/me', (req, res) => {
    const me = communitySession(req, db)
    res.json(me ? profileJson(db, me.id) : null)
  })

  accountRouter.patch('/profile', (req, res, next) => {
    try {
      const me = communitySession(req, db), account = me && accountFor(db, me.id)
      if (!account) fail(401, '请先登录校园账号')
      const name = cleanNickname(req.body?.name, account.role), current = now()
      const window = nameWindows.get(me.id)
      if (window && window.until > current && window.count >= NAME_LIMIT) fail(429, '昵称改得太频繁了，请稍后再试')
      if (!window || window.until <= current) nameWindows.set(me.id, { count: 1, until: current + NAME_WINDOW })
      else window.count++
      const taken = db.prepare('SELECT 1 FROM community_users u JOIN accounts a ON a.user_id=u.id WHERE u.id<>? AND lower(u.name)=lower(?)').get(me.id, name)
      if (taken) fail(409, '这个昵称已经有人用了，换一个吧')
      db.prepare('UPDATE community_users SET name=? WHERE id=?').run(name, me.id)
      db.prepare('UPDATE accounts SET nickname_at=? WHERE user_id=?').run(current, me.id)
      res.json(profileJson(db, me.id))
    } catch (error) { next(error) }
  })

  accountRouter.post('/logout', (req, res, next) => {
    try {
      const token = requestToken(req)
      if (token) db.prepare('DELETE FROM community_sessions WHERE token_hash=?').run(tokenHash(token))
      const anonymous = ensureAnonymous({ ...req, headers: { ...req.headers, cookie: '' } }, res, db, now)
      // ensureAnonymous has already sent a cookie; return the fresh anonymous identity for callers that need it.
      res.json({ ok: true, id: anonymous.id, name: anonymous.name })
    } catch (error) { next(error) }
  })

  dataRouter.get('/', (req, res, next) => {
    try {
      const me = communitySession(req, db), account = me && accountFor(db, me.id)
      if (!account) fail(401, '请先登录校园账号')
      const rows = db.prepare('SELECT key,data,rev,updated_at FROM user_data WHERE user_id=? ORDER BY key').all(me.id)
      res.json(Object.fromEntries(rows.map((row) => [row.key, dataJson(row)])))
    } catch (error) { next(error) }
  })

  dataRouter.put('/:key', (req, res, next) => {
    try {
      const me = communitySession(req, db), account = me && accountFor(db, me.id)
      if (!account) fail(401, '请先登录校园账号')
      const key = String(req.params.key)
      if (!DATA_KEYS.has(key)) fail(400, '不支持的数据类型')
      if (!Number.isInteger(req.body?.rev) || req.body.rev < 0) fail(400, '数据版本不正确')
      const parsed = parseData(req.body?.data), current = db.prepare('SELECT key,data,rev,updated_at FROM user_data WHERE user_id=? AND key=?').get(me.id, key)
      if ((current ? current.rev : 0) !== req.body.rev) {
        if (!current) return res.status(409).json({ error: '数据版本冲突', data: null, rev: 0, updatedAt: 0 })
        return res.status(409).json({ error: '数据版本冲突', ...dataJson(current) })
      }
      const revision = (current?.rev ?? 0) + 1, updatedAt = now()
      db.prepare(`INSERT INTO user_data (user_id,key,data,rev,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,key) DO UPDATE SET data=excluded.data,rev=excluded.rev,updated_at=excluded.updated_at`).run(me.id, key, parsed.encoded, revision, updatedAt)
      res.json({ data: parsed.value, rev: revision, updatedAt })
    } catch (error) { next(error) }
  })

  accountRouter.use(errorMiddleware)
  dataRouter.use(errorMiddleware)
  app.use('/api/account', accountRouter)
  app.use('/api/me/data', dataRouter)
  return { close: () => {} }
}

