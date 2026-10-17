import type { CampusEvent } from './discoveryTypes'
import { clockText, dateKey, dayName, dayStart, eventStatus, evEnd, evStart, nowTick } from './campusTime'

/** 地图上的活动分档，越临近开始越醒目。跨天的展览、会议等长期活动不和普通「进行中」抢颜色。 */
export type EventTier = 'live' | 'soon' | 'next' | 'ongoing' | 'later'
export const TIER_RANK: Record<EventTier, number> = { live: 0, soon: 1, next: 2, ongoing: 3, later: 4 }
/** 有活动的地点标签的排布优先级：临近的活动先占位置，长期展览和更晚的活动不挤掉食堂、图书馆等地标。 */
export const EVENT_PRIO: Record<EventTier, number> = { live: 118, soon: 116, next: 110, later: 94, ongoing: 92 }

export function eventTier(e: CampusEvent, t = nowTick.value): EventTier {
  const status = eventStatus(e, t)
  if (status === 'live') return evEnd(e) - evStart(e) > 12 * 3_600_000 ? 'ongoing' : 'live'
  if (status === 'soon') return 'soon'
  return evStart(e) - t < 24 * 3_600_000 ? 'next' : 'later'
}

const monthDay = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`

/** 标签里的时间：一眼看出是正在进行、马上开始还是哪天几点。 */
export function eventWhen(e: CampusEvent, tier = eventTier(e), t = nowTick.value) {
  if (tier === 'live') return '进行中'
  if (tier === 'ongoing') return e.end ? `至${monthDay(dateKey(evEnd(e) - 1))}` : '进行中'
  if (tier === 'soon') return `${Math.max(1, Math.round((evStart(e) - t) / 60_000))} 分钟后`
  const day = dateKey(evStart(e))
  if (tier === 'next') return (day === dateKey(t) ? '' : dayName(day) + ' ') + (e.allDay ? '全天' : clockText(evStart(e)))
  return (dayStart(evStart(e)) - dayStart(t)) / 86_400_000 > 6 ? monthDay(day) : dayName(day)
}

const GENERIC_HEAD = /^(?:seminar|lecture|talk|workshop|colloquium|webinar|讲座|报告|学术报告|活动|活动报名|活动邀请|活动预告|通知|预告|邀请)$/i
const OPEN = /[《「“(（]/g
const CLOSE = /[》」”)）]/g
const balanced = (s: string) => (s.match(OPEN)?.length ?? 0) === (s.match(CLOSE)?.length ?? 0)

/**
 * 地图上只放得下一句话：去掉【栏目】前缀，主副标题只留主标题。
 * 「【第六届人文季】思想的星海——人文社科新著对谈系列：人的处境」→「思想的星海」。完整标题留给悬停提示和详情。
 */
export function eventShortTitle(title: string) {
  let s = title.replace(/\s+/g, ' ').trim()
  const stripped = s.replace(/^(?:[【[［〔][^】\]］〕]{0,30}[】\]］〕]\s*)+/, '').trim()
  if (stripped) s = stripped
  // 第一个分隔符把标题分成主、副两段；括号没闭合说明分隔符在书名号或引号里面，不能拆
  const sep = /\s*(?:——|—|\s[-–]\s|(?<!\d)[:：](?!\d)|[|｜])\s*/g
  for (let m = sep.exec(s); m; m = sep.exec(s)) {
    const head = s.slice(0, m.index).trim()
    const tail = s.slice(m.index + m[0].length).trim()
    if (!head || !tail || !balanced(head)) continue
    // 「活动报名 | 正文」：去掉笼统的前缀，再看正文有没有副标题
    if (GENERIC_HEAD.test(head)) { s = tail; sep.lastIndex = 0; continue }
    if ([...head].length >= 4) s = head
    break
  }
  return s || title
}

export interface PlaceEvents {
  /** 这里最紧迫的一场：进行中 > 一小时内开始 > 24 小时内 > 长期活动 > 更晚 */
  lead: CampusEvent
  tier: EventTier
  events: CampusEvent[]
}

/** 同一地点的活动合成一组，和地点名称画在同一个标签里。 */
export function eventsByPlace(list: readonly CampusEvent[], t = nowTick.value) {
  const byPlace = new Map<string, CampusEvent[]>()
  for (const e of list) if (e.place) byPlace.set(e.place, [...byPlace.get(e.place) ?? [], e])
  const out = new Map<string, PlaceEvents>()
  for (const [place, events] of byPlace) {
    const ranked = events.map((e) => ({ e, tier: eventTier(e, t) }))
      .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || evStart(a.e) - evStart(b.e))
    out.set(place, { lead: ranked[0].e, tier: ranked[0].tier, events: ranked.map((x) => x.e) })
  }
  return out
}
