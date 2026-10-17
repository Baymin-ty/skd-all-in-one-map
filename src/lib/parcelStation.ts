import { reactive } from 'vue'
import type { Poi } from './types'

// 快递服务中心（菜鸟驿站）货架平面图：按站里张贴的平面图精简重绘，坐标沿用原图的像素位置。
// 取件码一般是「货架-层-编号」，例如 15-3-2045 = 15 号货架第 3 层。

export type ParcelKind = 'shelf' | 'locker' | 'desk' | 'room' | 'door'
/** [x, y, 宽, 高]，原图像素，y 向下 */
export type Rect = [number, number, number, number]
export type Pt = [number, number]

export interface ParcelItem {
  id: string
  /** 图上写的字，\n 换行 */
  label: string
  /** 卡片标题；为空表示只是背景（墙、柜台），不能点也搜不到 */
  name: string
  kind: ParcelKind
  rect: Rect
  /** 不是矩形时的外形，rect 是它的外接框里放文字的那块 */
  poly?: Pt[]
  /** 框太小放不下字：字写在这里，再画一条引线 */
  labelAt?: Pt
  hint?: string
  aliases?: string[]
  /** 一个编号分成几段时共用，例如 1-1、1-2 都是 1 号货架 */
  group?: string
}

const shelf = (label: string, rect: Rect, hint: string, extra: Partial<ParcelItem> = {}): ParcelItem =>
  ({ id: `s${label}`, label, name: `${label} 号货架`, kind: 'shelf', rect, hint, ...extra })
const locker = (n: number, rect: Rect, hint: string): ParcelItem =>
  ({ id: `l${n}`, label: `${n}号智能柜`, name: `${n} 号智能柜`, kind: 'locker', rect, hint })

const RACK = '站内后墙的竖排货架'
const RACKS: [string, number, number][] = [['1-2', 862, 1], ['1-1', 880, 1], ['2', 910, 2], ['3', 928, 2], ['4', 958, 3], ['5', 976, 3], ['6', 1006, 4], ['7', 1024, 4], ['8', 1054, 5], ['9', 1072, 5], ['10', 1102, 6]]

export const PARCEL_ITEMS: ParcelItem[] = [
  // 房间和墙：先画，垫在最底下
  { id: 'station', label: '', name: '', kind: 'room', rect: [438, 82, 687, 153] },
  { id: 'staff', label: '员工休息处', name: '员工休息处', kind: 'room', rect: [1125, 82, 95, 36], hint: '站内右上角', aliases: ['休息'] },
  { id: 'wc-m', label: '男卫生间', name: '男卫生间', kind: 'room', rect: [1220, 82, 318, 118], hint: '门在室内侧门正对面的过道里', aliases: ['男厕', '厕所', '洗手间', '卫生间'] },
  { id: 'utility', label: '', name: '', kind: 'room', rect: [1538, 82, 45, 50] },
  { id: 'wc-f', label: '女卫生间', name: '女卫生间', kind: 'room', rect: [1583, 82, 305, 118], hint: '门在男、女卫生间之间的过道里', aliases: ['女厕', '厕所', '洗手间', '卫生间'] },

  // 站内
  { id: 'desk', label: '前台', name: '前台', kind: 'desk', rect: [648, 110, 100, 43], hint: '进室内入口正前方', aliases: ['柜台', '人工', '寄件', '寄快递'] },
  { id: 'scanner', label: '扫码机', name: '扫码机', kind: 'desk', rect: [750, 112, 25, 28], labelAt: [742, 62], hint: '前台右手边，取完件在这里扫码出库', aliases: ['扫码', '出库', '自助'] },
  { id: 'counter', label: '', name: '', kind: 'desk', rect: [775, 112, 25, 28] },
  { id: 'mail', label: '信件\n收取处', name: '信件收取处', kind: 'desk', rect: [800, 82, 60, 28], hint: '扫码机右边，靠后墙', aliases: ['信件', '信', '邮件', '挂号信'] },
  ...RACKS.map(([label, x, n]) => shelf(label, [x, 82, 18, 66], `${RACK}，从前台一侧数第 ${n} 排`, label.startsWith('1-') ? { group: '1' } : {})),
  shelf('11', [775, 172, 155, 28], '站内，2 号智能柜背面'),
  shelf('12', [930, 172, 60, 28], '站内，2、3 号智能柜背面'),
  shelf('13', [990, 172, 85, 28], '站内，3 号智能柜背面'),
  shelf('14', [1075, 172, 50, 28], '站内，3 号智能柜背面，靠室内侧门'),
  shelf('15', [553, 170, 73, 30], '站内，前台左边', { poly: [[553, 170], [598, 170], [598, 132], [626, 132], [626, 200], [553, 200]] }),
  shelf('16', [471, 170, 82, 30], '站内，前台左边'),
  shelf('17', [438, 103, 33, 97], '站内最左边，靠墙'),

  // 正面一排：入口两边
  shelf('24', [145, 165, 32, 70], '18–20 号货架左端'),
  shelf('20', [177, 200, 87, 35], '室内入口左边，和 1 号智能柜同一排'),
  shelf('19', [264, 200, 87, 35], '室内入口左边，和 1 号智能柜同一排'),
  shelf('18', [351, 200, 87, 35], '室内入口左边，紧挨 1 号智能柜'),
  locker(1, [438, 200, 186, 35], '室内入口左边'),
  { id: 'entry', label: '室内入口', name: '室内入口', kind: 'door', rect: [624, 200, 150, 35], hint: '从这里进站', aliases: ['入口', '进门', '门口', '大门'] },
  locker(2, [774, 200, 176, 35], '室内入口右边'),
  locker(3, [950, 200, 175, 35], '2 号智能柜右边，靠室内侧门'),
  { id: 'side', label: '室内\n侧门', name: '室内侧门', kind: 'door', rect: [1122, 150, 6, 22], labelAt: [1172, 162], hint: '站内右边，出门就是卫生间', aliases: ['侧门'] },
  locker(4, [1220, 200, 167, 35], '男卫生间外墙'),
  shelf('31', [1387, 200, 73, 35], '男卫生间外墙，4 号智能柜右边'),
  shelf('32', [1460, 200, 78, 35], '男卫生间外墙，31 号右边'),
  { id: 'door-m', label: '男卫门', name: '', kind: 'door', rect: [1217, 158, 6, 36], labelAt: [1262, 176] },
  shelf('45', [1583, 200, 75, 35], '女卫生间外墙，5 号智能柜左边'),
  locker(5, [1658, 200, 154, 35], '女卫生间外墙'),
  locker(6, [1812, 200, 165, 35], '女卫生间外墙，最右端'),
  { id: 'door-f', label: '女卫门', name: '', kind: 'door', rect: [1580, 166, 6, 32], labelAt: [1626, 182] },

  // 对面几排。原图就有两处 36、两处 45，已确认照原图保留，搜这个编号时两处一起标红
  shelf('23', [25, 207, 72, 31], '最左端，23、22、21 围成一组'),
  shelf('22', [25, 238, 27, 75], '最左端，23、22、21 围成一组'),
  shelf('21', [25, 313, 78, 30], '最左端，23、22、21 围成一组'),
  shelf('25', [142, 315, 86, 38], '18–20 号货架对面'),
  shelf('26', [228, 315, 114, 38], '18–20 号货架对面'),
  shelf('27', [342, 315, 99, 38], '18–20 号货架对面'),
  shelf('28', [142, 353, 150, 40], '25–27 号货架后面'),
  shelf('29', [292, 353, 149, 40], '25–27 号货架后面'),
  shelf('36', [1217, 315, 166, 33], '4 号智能柜对面'),
  { ...shelf('36', [1383, 315, 57, 33], '31 号货架对面'), id: 's36b' },
  shelf('34', [1440, 315, 52, 33], '31、32 号货架对面'),
  shelf('33', [1492, 315, 52, 33], '32 号货架对面'),
  { ...shelf('45', [1582, 315, 280, 33], '5、6 号智能柜对面'), id: 's45b' },
]

export const PARCEL_DECOR = {
  /** 1–10 号竖排货架上方的括号 */
  bracket: { from: 862, to: 1120, y: 72, label: '1–10' },
  /** 室内入口前的箭头：从走廊指向站内 */
  arrow: { x: 699, from: 266, to: 240 },
}

const byId = new Map(PARCEL_ITEMS.map((item) => [item.id, item]))
export const parcelItem = (id: string) => byId.get(id)
const findable = PARCEL_ITEMS.filter((item) => item.name)
const shelves = findable.filter((item) => item.kind === 'shelf')
const lockers = findable.filter((item) => item.kind === 'locker')

/** 地图上这个点位有货架平面图 */
export const PARCEL_POI = '80ebccc2'
export const isParcelStation = (p: Pick<Poi, 'id' | 'name'>) => p.id === PARCEL_POI || /快递服务中心|菜鸟驿站/.test(p.name.zh)

// ---------- 找货架 ----------
export interface ParcelResult {
  /** 要高亮的格子 */
  items: ParcelItem[]
  /** 取件码里的层号 */
  layer?: string
  /** 取件码最后的编号 */
  serial?: string
  /** 同一个数字的另一种理解，例如 3 也可能是 3 号智能柜 */
  also: ParcelItem[]
  /** 按编号查但图上没有，例如「30 号货架」 */
  missing?: string
}

/** 全角转半角，去掉「取件码」「快递站」这类前缀；各种横线、点、空格都当作取件码的分隔 */
function normalize(q: string) {
  return q.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/取件码?|快递站?|菜鸟|驿站|[:：]/g, ' ').replace(/　/g, ' ').trim().toLowerCase()
}
const strip0 = (n: string) => n.replace(/^0+(?=\d)/, '')
const shelvesNumbered = (n: string) => shelves.filter((s) => s.label === n || s.group === n)

function byNumber(segments: string[]): ParcelResult {
  const a = strip0(segments[0]), b = segments[1] && strip0(segments[1])
  // 1-1、1-2 本身就是货架名：只有这两段，或者后面还跟着层号和编号（共四段）时按它理解
  const split = !!b && shelves.some((s) => s.label === `${a}-${b}`) && segments.length !== 3
  const label = split ? `${a}-${b}` : a
  const tail = segments.slice(split ? 2 : 1)
  const items = split ? shelves.filter((s) => s.label === label) : shelvesNumbered(label)
  const layer = tail[0] && tail[0].length <= 2 ? strip0(tail[0]) : undefined
  const serial = tail.slice(layer ? 1 : 0).join('-') || undefined
  const sameLocker = segments.length === 1 ? lockers.filter((l) => l.id === `l${label}`) : []
  if (items.length) return { items, layer, serial, also: sameLocker }
  // 只输入一个数字，没有这个货架但有这个号的智能柜
  return sameLocker.length ? { items: sameLocker, also: [] } : { items: [], also: [], missing: `${label} 号货架` }
}

export function findParcel(query: string): ParcelResult {
  const s = normalize(query)
  if (!s) return { items: [], also: [] }
  // 只有数字和分隔符：货架号或取件码
  if (/^[\d\s.\-—–_/·~]+$/.test(s)) {
    const segments = s.split(/[^\d]+/).filter(Boolean)
    if (segments.length) return byNumber(segments)
  }
  const t = s.replace(/\s+/g, '')
  const lockerNo = t.match(/^(?:智能|快递)?柜(\d{1,2})号?$/) ?? t.match(/^(\d{1,2})号?(?:智能|快递)?柜$/)
  if (lockerNo) {
    const items = lockers.filter((l) => l.id === `l${strip0(lockerNo[1])}`)
    return { items, also: [], missing: items.length ? undefined : `${strip0(lockerNo[1])} 号智能柜` }
  }
  if (/^(?:智能柜|快递柜|柜子?)$/.test(t)) return { items: lockers, also: [] }
  const shelfNo = t.match(/^(?:货架)?(\d{1,2}(?:-\d{1,2})?)号?(?:货架|架)?$/)
  if (shelfNo) return byNumber(shelfNo[1].split('-'))
  if (t === '货架' || t === '架子') return { items: shelves, also: [] }
  const has = (x?: string) => !!x && x.replace(/\s|\n/g, '').toLowerCase().includes(t)
  return { items: findable.filter((item) => has(item.name) || has(item.label) || item.aliases?.some(has)), also: [] }
}

/** 点了图上某一格之后放进搜索框的字，搜出来就是它 */
export const queryFor = (item: ParcelItem) => item.kind === 'shelf' ? item.label : item.name.replace(/\s/g, '')

/** 结果卡片的标题 */
export function resultTitle(r: ParcelResult) {
  const [first] = r.items
  if (!first) return ''
  if (r.items.length === 1) return first.name
  const groups = new Set(r.items.map((i) => i.group ?? i.label))
  if (groups.size === 1 && first.kind === 'shelf') return `${first.group ?? first.label} 号货架`
  if (r.items.every((i) => i.kind === 'locker')) return r.items.length === lockers.length ? '智能柜' : r.items.map((i) => i.name).join('、')
  if (r.items.every((i) => i.kind === 'shelf') && r.items.length === shelves.length) return '全部货架'
  return r.items.length <= 3 ? r.items.map((i) => i.name).join('、') : `找到 ${r.items.length} 处`
}

/** 图上所有货架编号，连续的写成一段：1–29、31–34、36、45 */
export function shelfNumbers() {
  const nums = [...new Set(shelves.map((s) => Number(s.group ?? s.label)))].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (nums[j + 1] === nums[j] + 1) j++
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]))
    i = j
  }
  return out.join('、')
}

/** 挨着的格子（货架、智能柜、柜台、门），帮着在现场对位置 */
export function neighbors(item: ParcelItem, gap = 3) {
  const [x, y, w, h] = item.rect
  return findable.filter((o) => {
    if (o === item || o.kind === 'room') return false
    const [ox, oy, ow, oh] = o.rect
    const dx = Math.min(x + w, ox + ow) - Math.max(x, ox)
    const dy = Math.min(y + h, oy + oh) - Math.max(y, oy)
    // 共用一段边才算挨着，只碰到一个角的不算
    return (dx > 4 && dy > -gap) || (dy > 4 && dx > -gap)
  })
}

/** 主搜索框：输入像取件码，或者写了「货架 / 取件 / 智能柜」时，给一条直达货架图的结果 */
export function parcelSearchHint(query: string): { name: string; sub: string } | null {
  const codeLike = /^\d{1,2}(?:\s*[-—–.]\s*\d{1,2})(?:\s*[-—–.]\s*\d{1,6}){0,2}$/.test(normalize(query))
  const worded = /货架|取件|智能柜|快递柜|驿站/.test(query)
  if (!codeLike && !worded) return null
  const r = findParcel(query)
  if (!r.items.length) return worded ? { name: '快递站货架平面图', sub: r.missing ? `图上没有 ${r.missing}，打开平面图看看` : '输入取件码，高亮对应货架' } : null
  return { name: `快递站 · ${resultTitle(r)}`, sub: r.layer ? `第 ${r.layer} 层 · 在货架平面图上高亮` : '在货架平面图上高亮' }
}

// ---------- 打开 / 关闭 ----------
export const parcel = reactive({ open: false, query: '', poi: PARCEL_POI })
/** 打开平面图的那个按钮：打开后整个应用变成 inert，焦点要先记下来，关掉时还回去 */
let opener: HTMLElement | null = null
export function openParcelPlan(query = '', poi = PARCEL_POI) {
  const active = typeof document === 'undefined' ? null : document.activeElement
  // 输入框不还焦点，免得手机上关掉平面图又弹出键盘
  opener = typeof HTMLElement !== 'undefined' && active instanceof HTMLElement && !(active instanceof HTMLInputElement) ? active : null
  Object.assign(parcel, { open: true, query: query.trim(), poi })
}
/** 首页等固定入口直接打开默认快递站地图，不要求用户先知道取件码或地点名称。 */
export function openParcelStationMap() {
  openParcelPlan('', PARCEL_POI)
}
export function closeParcelPlan() {
  if (!parcel.open) return
  parcel.open = false
  const el = opener
  opener = null
  // inert 要等这次渲染完才去掉
  if (el) setTimeout(() => el.focus(), 0)
}
