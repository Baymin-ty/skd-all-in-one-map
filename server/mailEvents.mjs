import { createHash } from 'node:crypto'

// 从学校群发通知邮件里抽取活动（标题、时间、地点、主办）。移植自 skdmap/scripts/mail_events.py。
// 只有结构化字段会进入活动目录；正文只截取很短的片段放进本地待审核队列，方便管理员核对。

const MONTHS = Object.fromEntries(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, i + 1]))
const SENDER_CATEGORY = [
  [/career/i, 'career'],
  [/grad\.sist|research@|ih@|smdl@|ai@|hospital@|xueying@|ceisd@|amr@|sem@|citl@/i, 'lecture'],
  [/kedao|dadao|shangdao|life@|clubs@|studentunion@|youth@|insist@|undergra\.sist|student\.sist|studentaffairs@|sca-/i, 'student'],
  [/library@/i, 'library'],
  [/studyabroad@/i, 'international'],
  [/share@/i, 'wellbeing'],
  [/ogs@/i, 'campus'],
]
const LABEL_TIME = /时间|日期|Time|Date|DATE|TIME|⏰|📅|🕐|🕖/
const LABEL_VENUE = /(?:地点|地址|场地|Venue|VENUE|Location|LOCATION|Place)\s*[:：]|📍|⛳/
const RE_YMD = /(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/
const RE_MD = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/
const RE_EN = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?/i
const RE_EN2 = /(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i
const RE_TIME = /(上午|下午|晚上|中午|AM|PM|am|pm)?\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*(AM|PM|am|pm)?(?:\s*[-–—~～至到]\s*(上午|下午|晚上)?\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*(AM|PM|am|pm)?)?/
const CHANGE_WORDS = /取消|延期|推迟|改期|变更|调整|cancel|postpone|reschedul/i
const DAY_MS = 86_400_000

export function categoryFor(sender) {
  return SENDER_CATEGORY.find(([pattern]) => pattern.test(sender))?.[1] ?? 'other'
}

export function cleanSubject(subject) {
  let s = String(subject ?? '').trim()
  if (s.includes('-Re:')) s = s.split('-Re:').slice(1).join('-Re:')
  s = s.replace(/^(Re|RE|回复|答复|Fw|FW|Fwd|转发)\s*[:：]\s*/, '').trim()
  s = s.replace(/^(就在(今天|今晚|明天|明晚|周.)|今晚|明天)[！!,，\s]*/, '')
  s = s.replace(/^【(就在[^】]*|[^】]*提醒|地点变更|时间变更|今晚\d+点[^】]*)】\s*/, '')
  return s.trim().replace(/^[ ：:，,！!]+|[ ：:，,！!]+$/g, '')
}

const hour = (h, ampm) => {
  let value = Number(h)
  const mark = ampm?.toLowerCase()
  if (mark && ['下午', '晚上', 'pm'].includes(mark) && value < 12) value += 12
  if (mark === 'am' && value === 12) value = 0
  return value
}
// 只用 UTC 字段表示上海本地日期，避免受运行机器时区影响。
const ymd = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

function parseDate(line, ref) {
  let match = RE_YMD.exec(line)
  if (match) return ymd(Number(match[1]), Number(match[2]), Number(match[3]))
  let md = null
  if ((match = RE_MD.exec(line))) md = [Number(match[1]), Number(match[2])]
  else if ((match = RE_EN.exec(line))) md = [MONTHS[match[1].toLowerCase().slice(0, 3)], Number(match[2])]
  else if ((match = RE_EN2.exec(line))) md = [MONTHS[match[2].toLowerCase().slice(0, 3)], Number(match[1])]
  if (!md) return null
  let date = ymd(ref.getUTCFullYear(), md[0], md[1])
  if (!date) return null
  if (date < ref.getTime() - 120 * DAY_MS) date = ymd(ref.getUTCFullYear() + 1, md[0], md[1])
  // 没写年份且离发信日期太远，多半是笔误，跳过。
  if (!date || date < ref.getTime() - 45 * DAY_MS || date > ref.getTime() + 150 * DAY_MS) return null
  return date
}

function parseTime(line) {
  const m = RE_TIME.exec(line)
  if (!m) return null
  const sh = hour(m[2], m[1] || m[4])
  if (sh > 23 || Number(m[3]) > 59) return null
  const start = [sh, Number(m[3])]
  let end = null
  if (m[6]) {
    let eh = hour(m[6], m[5] || m[8] || (Number(m[6]) < sh ? m[1] : null))
    if (eh < sh && eh + 12 <= 23) eh += 12
    if (eh <= 23 && Number(m[7]) <= 59) end = [eh, Number(m[7])]
  }
  return { start, end }
}

function headingBefore(lines, index) {
  for (let j = index - 1; j > Math.max(-1, index - 5); j--) {
    const t = lines[j].replace(/^[\s\-•·*#]+|[\s\-•·*#]+$/g, '')
    if (LABEL_TIME.test(t) || LABEL_VENUE.test(t)) continue
    const m = /^(?:[一二三四五六七八九十]+[、.．]|\d+[.、．]\s*|主题\s*[:：]\s*)(.{4,40})$/.exec(t)
    if (m) return m[1].trim()
  }
  return null
}

const pad = (n) => String(n).padStart(2, '0')
const stamp = (date, [h, m]) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(h)}:${pad(m)}:00+08:00`
export const mailEventId = (title, start, place, room) => 'm-' + createHash('sha1').update(`${title}|${start.slice(0, 19)}|${place ?? 'None'}|${room ?? ''}`).digest('hex').slice(0, 10)
const organizerFrom = (sender) => {
  const name = String(sender ?? '').split('<')[0].trim().replace(/^"|"$/g, '')
  return name || String(sender ?? '').replace(/<|>/g, '').replace(/@.*/, '')
}

/**
 * 解析一封邮件，返回候选活动和是否像活动通知。
 * @param {{ text: string, subject: string, from: string, date: Date }} mail
 * @param {{ resolve(raw: string): { place: string|null, room: string, floor: number|null, unmapped: string } }} resolver
 */
export function extractMailEvents(mail, resolver) {
  const sent = new Date(mail.date ?? Date.now())
  // 以上海日期作为参照，与 Python 版本的 sent 日期一致。
  const refKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(sent)
  const ref = new Date(`${refKey}T00:00:00Z`)
  const body = String(mail.text ?? '').replace(/\u00a0/g, ' ').replace(/\u2028/g, '\n')
  const lines = body.split(/\r?\n/).map((line) => line.trim())
  let curDate = null, curTime = null, dateIndex = 0
  const found = []
  let timeLabels = 0, venueLabels = 0
  for (const [i, line] of lines.entries()) {
    if (!line || /^(发件人|发送时间|收件人|抄送|From:|To:|Cc:|Sent:)/.test(line)) continue
    if (LABEL_TIME.test(line) || RE_YMD.test(line) || RE_MD.test(line)) {
      timeLabels++
      const d = parseDate(line, ref)
      if (d) { curDate = d; dateIndex = i; if (!parseTime(line)) curTime = null }
      const t = parseTime(line)
      if (t && (LABEL_TIME.test(line) || d)) curTime = t
    }
    if (/^[—\-_=]{6,}|^(祝好|此致|Best|Regards)/.test(line)) break
    if (LABEL_VENUE.test(line) && !/Tel|电话|E-mail|邮箱|传真|浦东新区|华夏中路\d+号/.test(line)) {
      venueLabels++
      let raw = line.split(/[:：]|📍|⛳/).slice(1).join(':').replace(/^[ ：:]+|[ ：:]+$/g, '')
      raw = raw.split(/\s{2,}|；|;|Tel|电话/)[0].trim()
      if (!raw || !curDate) continue
      found.push({ date: curDate, time: curTime, raw, location: resolver.resolve(raw), heading: headingBefore(lines, dateIndex) })
    }
  }
  // 同一封邮件里的提醒和转发原文会重复出现，按日期、开始时间、地点去重。
  const unique = new Map()
  for (const f of found) {
    const key = `${f.date.getTime()}|${f.time?.start}|${f.location.place}|${f.location.room}`
    if (!unique.has(key)) unique.set(key, f)
  }
  const items = [...unique.values()]
  const title = cleanSubject(mail.subject)
  const category = categoryFor(mail.from)
  const organizer = organizerFrom(mail.from)
  const events = items.map((f) => {
    const start = stamp(f.date, f.time?.start ?? [0, 0])
    const end = f.time?.end ? stamp(f.date, f.time.end) : null
    const eventTitle = items.length > 1 && f.heading && !title.includes(f.heading) ? `${f.heading} · ${title}` : title
    const reasons = []
    if (!f.location.place) reasons.push('地点未能定位到校内建筑')
    if (!f.time) reasons.push('没有具体开始时间')
    if (items.length > 1) reasons.push(`同一封邮件里有 ${items.length} 场活动，请核对标题`)
    if (CHANGE_WORDS.test(mail.subject ?? '')) reasons.push('邮件提到取消或变更，需要人工确认')
    if (Date.parse(start) < ref.getTime() - 2 * DAY_MS) reasons.push('活动日期早于发信日期')
    if (eventTitle.length < 4) reasons.push('标题过短')
    return {
      event: {
        id: mailEventId(eventTitle, start, f.location.place, f.location.room), title: eventTitle, start, end, allDay: !f.time,
        venueRaw: f.raw, place: f.location.place, room: f.location.room, floor: f.location.floor, unmapped: f.location.unmapped,
        organizer, category, source: 'email',
      },
      reasons,
    }
  })
  return { events, looksLikeEvent: timeLabels > 0 && venueLabels > 0, title, organizer, category }
}

/** 截取时间、地点附近的几行正文供审核时核对，不保留签名和联系方式。 */
export function mailExcerpt(text, max = 600) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const cut = lines.findIndex((line) => /^[—\-_=]{6,}|^(祝好|此致|Best|Regards|发件人|From:)/.test(line))
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((line) => !/@|电话|Tel|手机|微信/.test(line))
  return kept.join('\n').slice(0, max)
}
