import type { CampusEvent } from './discoveryTypes'
import type { BuildingGroup } from './groups'
import { roomsFrom } from './rooms'
import type { Building } from './types'

/**
 * 教室号全局搜索：「1A-108」「SEM501」「图书馆302」「5-105」直接定位到楼和楼层。
 * 可信度从高到低：房间表（exact）> 楼名加号码或编号规则（rule）> 往期活动里出现过的地点（history）。
 * 只有 5 栋楼有房间表，其余楼按号码首位推测楼层。
 */
export interface RoomHit {
  building: string
  /** 显示用的房间号，例如 1A-108、302 */
  code: string
  floor: number | null
  label?: string
  kind?: string
  confidence: 'exact' | 'rule' | 'history'
  /** history：往期活动里的原始地点写法 */
  venue?: string
}
interface RoomIndex {
  rooms: { building: string; code: string; key: string; label: string; kind: string; floor: number | null }[]
  /** 楼名、简称、别名、楼群名 → 楼 */
  tokens: { key: string; buildings: string[] }[]
  /** 往期活动：房间号 → 各楼出现次数和一个原始地点写法 */
  history: Map<string, Map<string, { n: number; venue: string; code: string }>>
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·.,，、()（）]/g, '')
const CONFIDENCE = { exact: 0, rule: 1, history: 2 }
/** 号码首位就是楼层；没有三位数号码时不推测 */
export function floorFromCode(code: string): number | null {
  const m = /(\d)\d{2}$/.exec(code)
  return m && m[1] !== '0' ? Number(m[1]) : null
}

export function buildRoomIndex(buildings: Building[], groups: BuildingGroup[], events: CampusEvent[]): RoomIndex {
  const rooms = buildings.flatMap((b) => roomsFrom(b.rooms).map((r) => ({ building: b.id, code: r.code, key: norm(r.code), label: r.label, kind: r.kind, floor: r.floor })))
  const tokens = new Map<string, Set<string>>()
  const add = (s: string | undefined, ids: string[]) => {
    const key = s && norm(s)
    // 太短或纯数字的别名（例如 309）会把房间号误当楼名
    if (!key || key.length < 2 || /^\d+$/.test(key) || /^\d[a-e]$/.test(key)) return
    if (!tokens.has(key)) tokens.set(key, new Set())
    ids.forEach((id) => tokens.get(key)!.add(id))
  }
  for (const b of buildings) for (const s of [b.name.zh, b.name.en, b.short.zh, b.short.en, ...b.aliases]) add(s, [b.id])
  for (const g of groups) for (const s of [g.name.zh, g.name.en]) add(s, g.members)
  const history: RoomIndex['history'] = new Map()
  for (const e of events) {
    if (!e.room || !e.place || !/\d/.test(e.room)) continue
    const key = norm(e.room)
    if (!history.has(key)) history.set(key, new Map())
    const counts = history.get(key)!
    const c = counts.get(e.place) ?? { n: 0, venue: e.venueRaw, code: e.room }
    c.n++
    counts.set(e.place, c)
  }
  return {
    rooms,
    tokens: [...tokens].map(([key, ids]) => ({ key, buildings: [...ids] })).sort((a, b) => b.key.length - a.key.length),
    history,
  }
}

const exists = (index: RoomIndex, id: string) => index.rooms.some((r) => r.building === id) || index.tokens.some((t) => t.buildings.includes(id))
const tokenOf = (index: RoomIndex, key: string) => index.tokens.find((t) => t.key === key && t.buildings.length === 1)?.buildings[0]

export function findRooms(query: string, index: RoomIndex, limit = 5): RoomHit[] {
  const q = norm(query)
  if (!/\d/.test(q) || q.length < 2) return []
  // 拆成「楼名前缀 + 房间号」：图书馆302、SEM501、物质学院5-105；楼群名会把范围限定在组内各栋
  const longest = index.tokens.find((t) => q.startsWith(t.key) && /\d/.test(q.slice(t.key.length)))?.key.length ?? 0
  const scope = longest ? new Set(index.tokens.filter((t) => t.key.length === longest && q.startsWith(t.key)).flatMap((t) => t.buildings)) : null
  const code = q.slice(longest)
  const inScope = (id: string) => !scope || scope.has(id)
  const hits = new Map<string, RoomHit>()
  const push = (hit: RoomHit) => {
    if (!inScope(hit.building) || !exists(index, hit.building)) return
    const key = `${hit.building}:${norm(hit.code)}`
    const old = hits.get(key)
    if (!old || CONFIDENCE[hit.confidence] < CONFIDENCE[old.confidence]) hits.set(key, { ...hit, venue: hit.venue ?? old?.venue })
    else if (!old.venue && hit.venue) old.venue = hit.venue
  }

  // 1. 房间表：完整编号；有楼名时号码可以只写后半段；没有楼名时支持边输入边匹配编号开头
  for (const r of index.rooms) {
    if (r.key === code || code.length >= 3 && (r.key.startsWith(code) || scope && r.key.endsWith(code)))
      push({ building: r.building, code: r.code, floor: r.floor, label: r.label, kind: r.kind, confidence: 'exact' })
  }
  const exactCode = index.rooms.some((r) => r.key === code && inScope(r.building))

  // 2. 编号规则（房间表里已经有这个编号时不再猜别的楼）
  if (!exactCode) {
    const sist = /^1([a-e])(b?\d{3})$/.exec(code)
    const sist1 = tokenOf(index, 'sist1')
    if (sist && sist1) push({ building: sist1, code: `1${sist[1].toUpperCase()}-${sist[2].toUpperCase()}`, floor: sist[2].startsWith('b') ? -1 : floorFromCode(sist[2]), confidence: 'rule' })
    // 2-xxx、3-xxx 在信息学院和物质学院都有，两个都给出来；楼群前缀下不写横线也算
    const dashed = /(\d)\s*-\s*(\d{3})\s*$/.exec(query) ?? (scope && scope.size > 1 ? /^(\d)(\d{3})$/.exec(code) : null)
    if (dashed) for (const school of ['sist', 'spst']) {
      const id = tokenOf(index, school + dashed[1])
      if (id) push({ building: id, code: `${dashed[1]}-${dashed[2]}`, floor: floorFromCode(dashed[2]), confidence: 'rule' })
    }
    // 单独一栋楼加号码：按号码首位推测楼层
    if (scope?.size === 1 && !dashed && /^[a-z]{0,2}\d{3,4}$/.test(code))
      push({ building: [...scope][0], code: code.toUpperCase(), floor: floorFromCode(code), confidence: 'rule' })
  }

  // 3. 往期活动：只看编号判断不了楼时（S301、M501、302），按出现次数推测
  for (const [place, c] of index.history.get(code) ?? [])
    push({ building: place, code: c.code, floor: floorFromCode(c.code), confidence: 'history', venue: c.venue })

  const count = (h: RoomHit) => index.history.get(norm(h.code))?.get(h.building)?.n ?? 0
  // 只输入数字时楼名不确定，往期活动最常用的地点排前面
  const byCount = !scope && /^\d+$/.test(code)
  return [...hits.values()]
    .sort((a, b) => (byCount ? count(b) - count(a) : 0) || CONFIDENCE[a.confidence] - CONFIDENCE[b.confidence] || count(b) - count(a) || a.code.localeCompare(b.code, 'zh', { numeric: true }))
    .slice(0, limit)
}
