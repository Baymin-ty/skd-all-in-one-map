import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ensureEventTopics } from './community.mjs'

export const OFFICIAL_EVENTS_URL = 'https://www.shanghaitech.edu.cn/_wp3services/generalQuery?queryObj=articles'
const PAGE_SIZE = 100
const SYNC_INTERVAL_MS = 2 * 60 * 60_000
const DAY_MS = 86_400_000
const OFFICIAL_CATEGORY = { 14750: 'lecture', 15106: 'conference', 15107: 'culture' }
const EVENT_FIELDS = ['title', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'phColId', 'id', 'url']

const trim = (value) => typeof value === 'string' ? value.trim() : ''
const norm = (value) => trim(value).toLowerCase().replace(/[\s\-_·.,，、()（）【】［］]/g, '')
const stripBuildingNote = (value) => trim(value).replace(/【[^】]*】/g, '').replace(/[?？].*$/, '').replace(/[,，].*$/, '').trim()

/** 解析数据包里的地点别名 CSV，支持带引号的逗号和换行。 */
export function parseVenueAliases(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = [], cell = '', quote = false
  const pushCell = () => { row.push(cell); cell = '' }
  const pushRow = () => { if (row.some(Boolean)) rows.push(row); row = [] }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '"') {
      if (quote && source[i + 1] === '"') { cell += '"'; i++ }
      else quote = !quote
    } else if (ch === ',' && !quote) pushCell()
    else if ((ch === '\n' || ch === '\r') && !quote) { if (ch === '\r' && source[i + 1] === '\n') i++; pushCell(); pushRow() }
    else cell += ch
  }
  pushCell(); pushRow()
  const header = rows.shift()?.map((x) => norm(x)) ?? []
  const col = (names) => names.map((name) => header.indexOf(norm(name))).find((index) => index >= 0) ?? -1
  const rawCol = col(['官网原始地点写法', 'venue'])
  const buildingCol = col(['自动归并到的建筑(请核对)', '建筑', 'building'])
  const roomCol = col(['房间号(自动提取)', '房间号', 'room'])
  if (rawCol < 0) return []
  return rows.map((cells) => ({ raw: trim(cells[rawCol]), building: stripBuildingNote(cells[buildingCol] ?? ''), room: trim(cells[roomCol] ?? '') })).filter((row) => row.raw)
}

function findBuilding(buildings, text) {
  const key = norm(text)
  if (!key || key === '?' || key.includes('待确认')) return null
  const candidates = buildings.flatMap((building) => {
    const values = [building.name?.zh, building.name?.en, building.short?.zh, building.short?.en, ...(building.aliases ?? [])]
    return values.filter(Boolean).map((value) => ({ value: norm(value), id: building.id }))
  }).filter((item) => item.value && (item.value === key || key.includes(item.value) || item.value.includes(key)))
  return candidates.sort((a, b) => b.value.length - a.value.length)[0]?.id ?? null
}

function codeFloor(code) {
  if (!code) return null
  if (/^B\d/i.test(code)) return -1
  const match = /(\d)\d{2}$/.exec(code)
  return match ? Number(match[1]) || null : null
}

function normaliseRoom(value) {
  const text = trim(value).toUpperCase().replace(/[－—]/g, '-').replace(/\s+/g, '')
  if (!text) return ''
  let match = /^(\d[A-E])[-]?((?:B)?\d{3})$/i.exec(text)
  if (match) return `${match[1]}-${match[2]}`
  match = /^(\d)[-](\d{3})$/.exec(text)
  if (match) return `${match[1]}-${match[2]}`
  match = /^(M?\d{3})$/.exec(text)
  if (match) return match[1]
  match = /^([A-Z]?\d{3,4})$/.exec(text)
  return match ? match[1] : text.slice(0, 20)
}

function extractRoom(text, buildingName = '') {
  const source = trim(text).replace(/20(?:2[4-9]|3\d)/g, '')
  const infoBuilding = /(?:信息学院|信息科学与技术学院|信院|SIST)\s*([1-3])(?:\s*号楼)?/i.exec(source)
  const materialBuilding = /(?:物质学院|物质院|SPST)\s*([1-8])(?:\s*号楼)?/i.exec(source)
  if (/L楼报告厅/i.test(source)) return 'L楼报告厅'
  const sist = /\b(\d[A-Ea-e])\s*[-－]?\s*(B?\d{3})\b/.exec(source)
  if (sist) return normaliseRoom(`${sist[1]}-${sist[2]}`)
  const dashed = /(?:^|[^\d])(\d)\s*[-－]\s*(\d{3})(?:\D|$)/.exec(source)
  if (dashed) return normaliseRoom(`${dashed[1]}-${dashed[2]}`)
  const sem = /(?:SEM|创管|创业与管理学院)[^\dA-Za-z]{0,8}(M?\d{3})/i.exec(source)
  if (sem) return /SEM/i.test(source) && /^\d{3}$/.test(sem[1]) ? `M${sem[1]}` : normaliseRoom(sem[1])
  const letter = /(?:^|[^A-Za-z])([A-Z]\d{3})(?:\D|$)/.exec(source)
  if (letter) return normaliseRoom(infoBuilding ? `${infoBuilding[1]}${letter[1]}` : letter[1])
  const plain = /(?:^|[^\d])(\d{3,4})(?:\D|$)/.exec(source)
  if (plain && !/^20\d{2}$/.test(plain[1])) return normaliseRoom(materialBuilding ? `${materialBuilding[1]}-${plain[1]}` : infoBuilding ? `${infoBuilding[1]}-${plain[1]}` : plain[1])
  // 某些地点只写了楼名，别名 CSV 仍能给出房间号；不从建筑名本身猜楼层。
  return buildingName ? '' : ''
}

function buildingByPattern(buildings, source) {
  // 统一返回稳定楼宇 id；解析结果会写入活动目录，不能把整条楼宇对象塞进 place。
  const matchBuilding = (pattern) => buildings.find((building) => pattern.test(`${building.name?.zh ?? ''} ${building.short?.zh ?? ''} ${(building.aliases ?? []).join(' ')}`))?.id ?? null
  let match = /(?:物质学院|物质院|SPST)\s*([1-8])\s*(?:号楼)?/i.exec(source)
  if (match) return matchBuilding(new RegExp(`物质学院${match[1]}号楼`))
  match = /(?:信息学院|信息科学与技术学院|信院|SIST)\s*([1-3])(?:\s*号楼)?/i.exec(source)
  if (match) return matchBuilding(new RegExp(`信息学院${match[1]}号楼`))
  // “信息学院报告厅1C-101”省略了楼号，但房间号的首段仍能确定信息学院 1 号楼。
  if (/(?:信息学院|信息科学与技术学院|信院|SIST)/i.test(source)) {
    const room = /\b([1-3])[A-Ea-e]\s*[-－]?\s*\d{3}\b/.exec(source)
    if (room) return matchBuilding(new RegExp(`信息学院${room[1]}号楼`))
  }
  if (/(?:SEM|创管|创业与管理学院|School of Entrepreneurship)/i.test(source)) return matchBuilding(/创业与管理学院/)
  const patterns = [
    [/图书馆|Library/i, /图书馆/],
    [/会议中心|Conference Center/i, /会议中心/],
    [/L楼|生命学院|生命科学/i, /生命学院/],
    [/生物医学工程|生医工|Biomedical/i, /生医工学院/],
    [/创艺|创意|School of Creativity/i, /创意与艺术学院/],
    [/教学中心|Teaching Center/i, /教学中心/],
    [/人字楼|iHuman|Y楼/i, /人字楼/],
    [/学生活动中心|学生中心/i, /学生活动中心/],
    [/学生科创中心|H2|孵化器/i, /学生科创中心/],
    [/行政中心/i, /行政中心/],
    [/学校报告厅|^报告厅|University Auditorium|Lecture Hall/i, /学校报告厅/],
    [/体育馆/i, /体育馆/],
    [/游泳/i, /游泳馆/],
    [/操场|体育场|田径场/i, /操场/],
    [/网球场/i, /网球场/],
  ]
  for (const [pattern, building] of patterns) if (pattern.test(source)) return matchBuilding(building)
  return null
}

/** 根据地点别名、当前楼宇名称和房间号规则解析活动场地。 */
export function createVenueResolver({ places, aliases = [] }) {
  const buildings = places?.buildings ?? []
  const exact = new Map()
  for (const alias of aliases) {
    const place = findBuilding(buildings, alias.building)
    exact.set(norm(alias.raw), { place, room: normaliseRoom(alias.room), alias })
  }
  return {
    resolve(rawVenue) {
      const raw = trim(rawVenue)
      if (!raw) return { place: null, room: '', floor: null, unmapped: '' }
      const known = exact.get(norm(raw))
      const source = raw.replace(/上海科技大学|上科大|ShanghaiTech University/gi, '').trim()
      let place = known?.place ?? buildingByPattern(buildings, source)
      if (!place) {
        const tokens = buildings.flatMap((building) => [building.name?.zh, building.name?.en, building.short?.zh, building.short?.en, ...(building.aliases ?? [])]
          .filter(Boolean).map((token) => ({ key: norm(token), id: building.id }))).filter((item) => item.key && norm(source).includes(item.key))
        place = tokens.sort((a, b) => b.key.length - a.key.length)[0]?.id ?? null
      }
      const building = buildings.find((item) => item.id === place)
      // 未定位的校外地点不要把地址里的路号误当教室；别名表明确给出的房间号仍保留。
      const extractedRoom = extractRoom(source, building?.name?.zh)
      const room = place
        ? (known?.room && (/^M\d{3}$/i.test(known.room) || !extractedRoom || extractedRoom === known.room) ? normaliseRoom(known.room) : extractedRoom || normaliseRoom(known?.room || ''))
        : (known?.room || '')
      return { place, room, floor: codeFloor(room), unmapped: place ? '' : raw }
    },
  }
}

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}
function dateOffset(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00+08:00`)
  date.setTime(date.getTime() + days * DAY_MS)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}

function parseOfficialTime(value, fallbackDate) {
  const raw = trim(value)
  if (!raw) return `${fallbackDate}T00:00:00+08:00`
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?$/.exec(raw)
  if (!match) return null
  return `${match[1]}T${match[2] ? `${match[2]}:00` : '00:00:00'}+08:00`
}

export function convertOfficialEvent(raw, resolver) {
  const id = String(raw?.id ?? '').trim()
  const title = trim(raw?.title)
  const date = trim(raw?.f1)
  if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('官网活动缺少 id、标题或日期')
  const start = parseOfficialTime(raw.f3, date)
  if (!start) throw new Error(`活动「${title}」开始时间格式不正确`)
  const endRaw = trim(raw.f4)
  let end = endRaw ? parseOfficialTime(endRaw, date) : null
  if (endRaw && !end) throw new Error(`活动「${title}」结束时间格式不正确`)
  const allDay = !/\d{1,2}:\d{2}/.test(trim(raw.f3))
  if (allDay && end && end.endsWith('T00:00:00+08:00')) end = `${end.slice(0, 10)}T23:59:00+08:00`
  const venueRaw = trim(raw.f5)
  const location = resolver.resolve(venueRaw)
  return {
    id: `o-${id}`, sourceId: id, title, start, end, allDay, venueRaw,
    place: location.place, room: location.room, floor: location.floor, unmapped: location.unmapped,
    organizer: trim(raw.f6), speaker: trim(raw.f2), category: OFFICIAL_CATEGORY[Number(raw.phColId)] ?? 'other',
    source: 'official', url: trim(raw.url || raw.wapUrl).replace(/^http:/i, 'https:'), status: 'active',
  }
}

export function convertOfficialResponse(body, resolver) {
  if (!body || !Array.isArray(body.data)) throw new Error('官网活动响应格式不正确')
  const events = [], warnings = [], sourceIds = [], failed = []
  for (const [index, raw] of body.data.entries()) {
    if (raw?.id != null) sourceIds.push(String(raw.id))
    try { events.push(convertOfficialEvent(raw, resolver)) }
    catch (error) { warnings.push(`第 ${index + 1} 条活动未导入：${error.message}`); failed.push({ raw, error: error.message }) }
  }
  if (!events.length && body.data.length) throw new Error(warnings[0] || '官网活动没有可导入记录')
  return { events, warnings, sourceIds, failed }
}

export function officialRequestBody(page, start, end) {
  return new URLSearchParams({
    siteId: '8', columnId: '15079', pageIndex: String(page), rows: String(PAGE_SIZE),
    orders: JSON.stringify([{ field: 'f1', type: 'asc' }]),
    returnInfos: JSON.stringify(EVENT_FIELDS.map((field) => ({ field, name: field }))),
    conditions: JSON.stringify([{ field: 'scope', value: 1, judge: '=' }, { field: 'f1', value: start, judge: '>=' }, { field: 'f1', value: end, judge: '<=' }]),
  })
}

export async function fetchOfficialRecords({ fetcher = fetch, start = dateOffset(shanghaiDateKey(), -60), end = dateOffset(shanghaiDateKey(), 60), url = OFFICIAL_EVENTS_URL, timeoutMs = 30_000 } = {}) {
  const records = []
  let page = 1
  while (page <= 100) {
    const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: officialRequestBody(page, start, end), signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`官网活动接口返回 HTTP ${response.status}`)
    let body
    try { body = await response.json() } catch { throw new Error('官网活动响应不是 JSON') }
    if (!Array.isArray(body?.data)) throw new Error('官网活动响应格式不正确')
    records.push(...body.data)
    const total = Number(body.total)
    if (!body.data.length || (Number.isFinite(total) && records.length >= total)) break
    page++
  }
  if (!records.length) throw new Error('官网活动接口返回空列表')
  return records
}

function eventKey(event) {
  return `${event.source}:${event.sourceId ?? String(event.id).replace(/^o-/, '')}`
}
function tableExists(db, name) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) }
function overrideFor(db, eventId) {
  if (!tableExists(db, 'event_overrides')) return null
  return db.prepare('SELECT * FROM event_overrides WHERE event_id=?').get(eventId) ?? null
}
function applyOverride(event, override) {
  if (!override) return event
  const output = { ...event }
  for (const field of ['place', 'room', 'start', 'end', 'hidden', 'note']) if (Object.hasOwn(override, field) && override[field] !== undefined) output[field] = override[field]
  if (override.hidden) output.hidden = true
  return output
}
/** 后台人工改过的字段：同步时以人工值为准。 */
export const MANUAL_FIELDS = ['title', 'title_en', 'desc_en', 'place', 'room', 'start', 'end', 'allDay', 'floor', 'venueRaw', 'unmapped', 'organizer', 'speaker', 'category', 'url', 'status']
function applyStoredManual(event) {
  const manual = event.manualOverrides
  if (!manual || typeof manual !== 'object') return event
  return { ...event, ...Object.fromEntries(MANUAL_FIELDS.filter((field) => Object.hasOwn(manual, field)).map((field) => [field, manual[field]])) }
}
function mergeSyncedEvent(old, event, override) {
  const existingManual = old?.manualOverrides && typeof old.manualOverrides === 'object' ? old.manualOverrides : null
  const inferredManual = !existingManual && old && ['place', 'room', 'floor', 'unmapped'].some((field) => old[field] !== event[field])
    ? Object.fromEntries(['place', 'room', 'floor', 'unmapped'].map((field) => [field, old[field]])) : null
  const merged = { ...(old ?? {}), ...event, status: 'active' }
  if (existingManual || inferredManual) merged.manualOverrides = existingManual ?? inferredManual
  return applyOverride(applyStoredManual(merged), override)
}
/** 将一次官网快照原子合并进 discovery_catalog，邮件活动和已删除官网活动都保留。 */
export function syncOfficialEvents(db, incoming, { now = Date.now(), windowStart = '', windowEnd = '', seenSourceIds = null, allowCancellations = true } = {}) {
  const row = db.prepare('SELECT data FROM discovery_catalog WHERE kind=?').get('events')
  if (!row) throw new Error('活动目录尚未初始化')
  const oldEvents = JSON.parse(row.data)
  const oldByKey = new Map(oldEvents.map((event) => [eventKey(event), event]))
  const seen = new Set()
  let added = 0, updated = 0, cancelled = 0
  const next = oldEvents.map((event) => ({ ...event }))
  for (const event of incoming) {
    const key = eventKey(event); seen.add(key)
    const old = oldByKey.get(key)
    const merged = mergeSyncedEvent(old, event, overrideFor(db, event.id))
    if (!old) { next.push(merged); added++ }
    else if (JSON.stringify(old) !== JSON.stringify(merged)) {
      const index = next.findIndex((item) => eventKey(item) === key)
      next[index] = merged; updated++
    }
  }
  if (seenSourceIds) for (const sourceId of seenSourceIds) seen.add(`official:${sourceId}`)
  for (let index = 0; index < next.length; index++) {
    const event = next[index]
    const eventDate = String(event.start ?? '').slice(0, 10)
    const inWindow = (!windowStart || eventDate >= windowStart) && (!windowEnd || eventDate <= windowEnd)
    if (!allowCancellations || event.source !== 'official' || !inWindow || seen.has(eventKey(event)) || event.status === 'cancelled') continue
    next[index] = { ...event, status: 'cancelled', cancelledAt: now }
    cancelled++
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE discovery_catalog SET data=? WHERE kind=?').run(JSON.stringify(next), 'events')
    if (tableExists(db, 'community_topics')) ensureEventTopics(db, next.filter((event) => event.source === 'official').map((event) => applyOverride(event, overrideFor(db, event.id))))
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  return { added, updated, cancelled, total: next.length }
}

function aliasesPath(root) {
  return process.env.EVENT_VENUE_ALIASES || join(resolve(root, '..'), '上科大智慧地图_赛前准备包/datapack/reference/collect/02_活动地点别名表_草稿.csv')
}
export function loadVenueResolver(root) {
  const places = JSON.parse(readFileSync(join(root, 'public/data/places.json'), 'utf8'))
  const path = aliasesPath(root)
  const aliases = existsSync(path) ? parseVenueAliases(readFileSync(path, 'utf8')) : []
  return createVenueResolver({ places, aliases })
}
function defaultStatus() { return { lastSyncAt: null, added: 0, updated: 0, cancelled: 0, total: 0, warnings: [], lastError: '', running: false } }
function readStatus(db) {
  db.exec('CREATE TABLE IF NOT EXISTS event_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const row = db.prepare('SELECT value FROM event_sync_meta WHERE key=?').get('status')
  return row ? { ...defaultStatus(), ...JSON.parse(row.value) } : defaultStatus()
}
function writeStatus(db, status) {
  db.prepare('INSERT INTO event_sync_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('status', JSON.stringify({ ...status, running: false }))
}

/** 安装公开目录同步接口、后台手动同步和每两小时定时任务。 */
export function installEventSync(app, db, root, { authorize = (_req, _res, next) => next(), fetcher = fetch, resolver = loadVenueResolver(root), initialSync = process.env.EVENT_SYNC_ON_START !== 'false', schedule = true } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_overrides (event_id TEXT PRIMARY KEY, place TEXT, room TEXT, start TEXT, end TEXT, hidden INTEGER, note TEXT, updated_by TEXT, updated_at INTEGER)`)
  let status = readStatus(db)
  let running = false
  let failed = [], fetched = 0
  const sync = async () => {
    if (running) return { ...status, running: true, failed: [] }
    failed = []; fetched = 0
    running = true; status = { ...status, running: true, lastError: '' }
    try {
      const windowStart = dateOffset(shanghaiDateKey(), -60)
      const windowEnd = dateOffset(shanghaiDateKey(), 60)
      const raw = await fetchOfficialRecords({ fetcher, start: windowStart, end: windowEnd })
      const converted = convertOfficialResponse({ data: raw }, resolver)
      if (!converted.events.length) throw new Error('官网活动转换结果为空，保留旧数据')
      const result = syncOfficialEvents(db, converted.events, { windowStart, windowEnd, seenSourceIds: converted.sourceIds, allowCancellations: converted.warnings.length === 0 })
      status = { ...status, ...result, warnings: converted.warnings, lastSyncAt: Date.now(), lastError: '', running: false }
      failed = converted.failed; fetched = raw.length
      writeStatus(db, status)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const message = /fetch failed|aborted|timeout|timed out/i.test(detail) ? '官网活动同步失败，请稍后重试（网络或超时）' : detail
      status = { ...status, running: false, lastError: message }
      writeStatus(db, status)
      console.error(`活动自动同步失败：${message}（${detail}）`)
    } finally { running = false }
    // failed 只交给调用方（待审核队列），不写进持久化状态。
    return { ...status, failed, fetched }
  }
  app.get('/api/events/sync/status', authorize, (_req, res) => res.json({ ...status, running }))
  app.post('/api/events/sync', authorize, async (_req, res) => {
    const { failed: _failed, fetched: _fetched, ...result } = await sync()
    if (result.lastError) return res.status(502).json(result)
    res.json(result)
  })
  let timer = null
  if (schedule) {
    timer = setInterval(() => { void sync() }, SYNC_INTERVAL_MS)
    timer.unref?.()
  }
  if (initialSync) setTimeout(() => { void sync() }, 0).unref?.()
  return { sync, status: () => ({ ...status, running }), close: () => { if (timer) clearInterval(timer) } }
}

