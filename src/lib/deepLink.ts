import { reactive } from 'vue'

/**
 * 分享链接：
 *   /?to=<地点 id>[&room=1A-108]   打开后直接导航到这里（起点用我的位置）
 *   /?place=<地点 id>[&room=…]     打开地点详情，并定位到房间
 *   /?event=<活动 id>              打开活动详情（已有）
 *   /?timemachine[=now|best|2026-10-16|2026-10-16T08:00]   全屏播放 48 小时的活动（比赛展示用）
 */
export type DeepLink =
  | { kind: 'to' | 'place'; place: string; room?: string; from?: string; lang?: 'zh' | 'en'; now?: string; speed?: number; mock?: string; clean?: boolean }
  | { kind: 'event'; id: string; lang?: 'zh' | 'en'; now?: string; speed?: number; mock?: string; clean?: boolean }
  | { kind: 'checkin'; id: string; code: string; lang?: 'zh' | 'en' }
  | { kind: 'timemachine'; start?: string; lang?: 'zh' | 'en' }

const ID = /^[\w-]{1,64}$/
const ROOM = /^[\w-]{1,24}$/
const TM_START = /^(now|best|\d{4}-\d\d-\d\d(T\d\d:\d\d)?)$/

export function parseDeepLink(search: string): DeepLink | null {
  const q = new URLSearchParams(search)
  const extras = () => {
    const out: { lang?: 'zh' | 'en'; now?: string; speed?: number; mock?: string; clean?: boolean } = {}
    const lang = q.get('lang'); if (lang === 'zh' || lang === 'en') out.lang = lang
    const now = q.get('now'); if (now && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(now)) out.now = now
    const speed = Number(q.get('speed')); if (q.has('speed') && Number.isFinite(speed) && speed > 0 && speed <= 3600) out.speed = speed
    const mock = q.get('mock'); if (mock && /^[-\d., ]{3,100}$/.test(mock)) out.mock = mock
    if (q.has('clean')) out.clean = true
    return out
  }
  const extra = extras()
  if (q.has('timemachine')) {
    const start = q.get('timemachine')!
    return { kind: 'timemachine', start: TM_START.test(start) ? start : undefined, ...(extra.lang ? { lang: extra.lang } : {}) }
  }
  const room = q.get('room') ?? undefined
  const validRoom = room && ROOM.test(room) ? room : undefined
  for (const kind of ['to', 'place'] as const) {
    const place = q.get(kind)
    if (place && ID.test(place)) {
      const from = q.get('from'); const validFrom = from && ID.test(from) ? from : undefined
      return { kind, place, room: validRoom, ...(validFrom ? { from: validFrom } : {}), ...extra }
    }
  }
  const checkin = q.get('checkin'), code = q.get('code')
  if (checkin && code && ID.test(checkin) && /^[a-f0-9]{32,128}$/i.test(code)) return { kind: 'checkin', id: checkin, code, ...(extra.lang ? { lang: extra.lang } : {}) }
  const event = q.get('event')
  return event && ID.test(event) ? { kind: 'event', id: event, ...extra } : null
}

/** 只保留分享参数，去掉页面上其他查询参数和 hash */
export function buildLink(link: DeepLink, base = window.location.origin + window.location.pathname) {
  const url = new URL(base)
  if (link.kind === 'event') url.searchParams.set('event', link.id)
  else if (link.kind === 'checkin') { url.searchParams.set('checkin', link.id); url.searchParams.set('code', link.code) }
  else if (link.kind === 'timemachine') url.searchParams.set('timemachine', link.start && TM_START.test(link.start) ? link.start : 'now')
  else {
    url.searchParams.set(link.kind, link.place)
    // 「L楼报告厅」这类不是编号的房间名不放进链接
    if (link.room && ROOM.test(link.room)) url.searchParams.set('room', link.room)
    if (link.from && ID.test(link.from)) url.searchParams.set('from', link.from)
  }
  if ('lang' in link && link.lang) url.searchParams.set('lang', link.lang)
  if ('now' in link && link.now) url.searchParams.set('now', link.now)
  if ('speed' in link && link.speed) url.searchParams.set('speed', String(link.speed))
  if ('mock' in link && link.mock) url.searchParams.set('mock', link.mock)
  if ('clean' in link && link.clean) url.searchParams.set('clean', '')
  return url.href
}

/** 分享框：主链接，另可给一个备选（例如「打开详情」和「直接导航」） */
export interface ShareTarget {
  title: string
  links: { label: string; url: string; hint: string }[]
}
export const share = reactive({ target: null as ShareTarget | null })
export const openShare = (target: ShareTarget) => { share.target = target }
