import { PARCEL_DECOR, PARCEL_ITEMS, type ParcelItem, type Pt, type Rect } from './parcelStation'
import './parcelPlan.css'

// 把快递站平面图画成一张 SVG：横屏照原图摆，手机竖屏时顺时针转 90°（原图左端到上面、站内在右边），
// 只转位置不转字，文字一直是正的；格子太窄就竖排。

/** 画布范围（原图像素）：四周留白，上方留出 1–10 的括号 */
const [VX, VY, VW, VH] = [10, 30, 1980, 378]

export const planSize = (rotated: boolean): Pt => rotated ? [VH, VW] : [VW, VH]
export function toPlan([x, y]: Pt, rotated: boolean): Pt {
  const u = x - VX, v = y - VY
  return rotated ? [VH - v, u] : [u, v]
}
export function toBox([x, y, w, h]: Rect, rotated: boolean): Rect {
  const u = x - VX, v = y - VY
  return rotated ? [VH - v - h, u, h, w] : [u, v, w, h]
}

// ---------- 文字排版 ----------
const CJK = /[㐀-鿿]/
const LINE_H = 1.2
const OUTSIDE_SIZE = 12
const MAX_SIZE: Record<ParcelItem['kind'], number> = { shelf: 16, locker: 14, desk: 13, room: 17, door: 13 }

/** 粗估文字宽度（单位：字号） */
export function textWidth(s: string) {
  let w = 0
  for (const c of s) w += CJK.test(c) ? 1 : c === '-' || c === '–' ? 0.45 : 0.62
  return w
}

export interface LabelFit { size: number; mode: 'line' | 'stack' | 'turn' }
/** 字号尽量大又不出框；横着放太小、竖排明显更大时才竖排：中文一字一行，纯数字整体转 90° */
export function fitLabel(label: string, w: number, h: number, max: number): LabelFit {
  const pad = 4
  const lines = label.split('\n')
  const line = Math.min(max, (w - pad) / Math.max(...lines.map(textWidth)), (h - pad) / (lines.length * LINE_H))
  const flat = lines.join('')
  const cjk = CJK.test(flat)
  const vertical = cjk
    ? Math.min(max, (h - pad) / ([...flat].length * 1.08), w - pad)
    : Math.min(max, (h - pad) / textWidth(flat), (w - pad) / LINE_H)
  const readable = Math.min(max, 11)
  return line < readable && vertical > line * 1.2 ? { size: vertical, mode: cjk ? 'stack' : 'turn' } : { size: line, mode: 'line' }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 文字以 (cx, cy) 为中心；不用 dominant-baseline（Safari 对 tspan 支持不好），按 0.36 字号下移基线 */
function textSvg(label: string, cx: number, cy: number, fit: LabelFit, cls = '') {
  const f = fit.size
  const base = f * 0.36
  const c = cls ? ` class="${cls}"` : ''
  if (fit.mode === 'turn') return `<text${c} text-anchor="middle" x="${r1(cx)}" y="${r1(cy + base)}" font-size="${r1(f)}" transform="rotate(-90 ${r1(cx)} ${r1(cy)})">${esc(label.replace(/\n/g, ''))}</text>`
  const rows = fit.mode === 'stack' ? [...label.replace(/\n/g, '')] : label.split('\n')
  const step = f * (fit.mode === 'stack' ? 1.08 : LINE_H)
  const top = cy - (step * (rows.length - 1)) / 2 + base
  const spans = rows.map((row, i) => `<tspan x="${r1(cx)}" y="${r1(top + i * step)}">${esc(row)}</tspan>`).join('')
  return `<text${c} text-anchor="middle" font-size="${r1(f)}">${spans}</text>`
}

const bbox = (pts: Pt[]): Rect => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y]
}
/** 引线：从框外的文字指向格子，停在格子边上 */
function leader(from: Pt, box: Rect): [Pt, Pt] {
  const [x, y, w, h] = box
  const c: Pt = [x + w / 2, y + h / 2]
  const dx = from[0] - c[0], dy = from[1] - c[1]
  const t = Math.min(dx ? (dx > 0 ? w / 2 : -w / 2) / dx : Infinity, dy ? (dy > 0 ? h / 2 : -h / 2) / dy : Infinity)
  const edge: Pt = [c[0] + dx * t, c[1] + dy * t]
  const len = Math.hypot(edge[0] - from[0], edge[1] - from[1]) || 1
  const gap = Math.min(12, len / 2)
  return [[from[0] + ((edge[0] - from[0]) * gap) / len, from[1] + ((edge[1] - from[1]) * gap) / len], edge]
}

/** 格子在当前方向下的外形（点击判定用）：多边形取外接框 */
export const itemBox = (item: ParcelItem, rotated: boolean) => toBox(item.poly ? bbox(item.poly) : item.rect, rotated)
/** 框外文字大致占的范围，小格子点文字也算点到 */
function outsideLabelBox(item: ParcelItem, rotated: boolean): Rect | null {
  if (!item.labelAt) return null
  const [cx, cy] = toPlan(item.labelAt, rotated)
  const lines = item.label.split('\n')
  const w = Math.max(...lines.map(textWidth)) * OUTSIDE_SIZE + 8, h = lines.length * OUTSIDE_SIZE * LINE_H + 6
  return [cx - w / 2, cy - h / 2, w, h]
}

function itemSvg(item: ParcelItem, rotated: boolean) {
  const [x, y, w, h] = toBox(item.rect, rotated)
  const bar = item.kind === 'door' && !!item.labelAt
  const cls = item.id === 'station' ? 'pp-station' : bar ? 'pp-door pp-bar' : item.kind === 'door' ? 'pp-door pp-opening' : `pp-${item.kind}`
  const shape = item.poly
    ? `<polygon class="pp-shape" points="${item.poly.map((p) => toPlan(p, rotated).map(r1).join(',')).join(' ')}"/>`
    : `<rect class="pp-shape" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${item.kind === 'room' ? 2 : 3}"/>`
  const ring = item.name ? shape.replace('pp-shape', 'pp-ring') : ''
  let label = ''
  if (item.label && item.labelAt) {
    const at = toPlan(item.labelAt, rotated)
    const [a, b] = leader(at, itemBox(item, rotated))
    label = `<line class="pp-leader" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}"/>`
      + textSvg(item.label, at[0], at[1], { size: OUTSIDE_SIZE, mode: 'line' }, 'pp-out')
  } else if (item.label) {
    label = textSvg(item.label, x + w / 2, y + h / 2, fitLabel(item.label, w, h, MAX_SIZE[item.kind]))
  }
  const id = item.name ? ` data-id="${item.id}"` : ''
  // 没名字的背景（柜台、卫生间门）也算 pp-item，搜索时跟着变淡；只有站房本身保持原样
  return `<g class="${item.id === 'station' ? '' : 'pp-item '}${cls}"${id}>${shape}${ring}${label}</g>`
}

function decorSvg(rotated: boolean) {
  const { bracket, arrow } = PARCEL_DECOR
  const p = (pt: Pt) => toPlan(pt, rotated).map(r1).join(',')
  const tick = 7
  const brace = `<polyline class="pp-bracket" points="${p([bracket.from, bracket.y + tick])} ${p([bracket.from, bracket.y])} ${p([bracket.to, bracket.y])} ${p([bracket.to, bracket.y + tick])}"/>`
  const [lx, ly] = toPlan([(bracket.from + bracket.to) / 2, bracket.y - 16], rotated)
  const [ax1, ay1] = toPlan([arrow.x, arrow.from], rotated), [ax2, ay2] = toPlan([arrow.x, arrow.to + 6], rotated)
  const head = [[arrow.x, arrow.to - 2], [arrow.x - 7, arrow.to + 9], [arrow.x + 7, arrow.to + 9]] as Pt[]
  return `<g class="pp-decor">${brace}${textSvg(bracket.label, lx, ly, { size: 12, mode: 'line' })}`
    + `<line class="pp-arrow" x1="${r1(ax1)}" y1="${r1(ay1)}" x2="${r1(ax2)}" y2="${r1(ay2)}"/>`
    + `<polygon class="pp-arrow-head" points="${head.map(p).join(' ')}"/></g>`
}

/** 整张平面图的 SVG 字符串；样式写在组件的 CSS 里（.pp-*） */
export function planSvg(rotated: boolean) {
  const [w, h] = planSize(rotated)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" class="pp-art"><rect class="pp-paper" width="${w}" height="${h}" rx="12"/>`
    + PARCEL_ITEMS.map((item) => itemSvg(item, rotated)).join('') + decorSvg(rotated) + '</svg>'
}

/** 点到了哪一格：先看落在谁里面（取最小的那格），都没落中就找 tol 以内最近的 */
export function itemAt(pt: Pt, rotated: boolean, tol: number) {
  let best: ParcelItem | undefined, bestScore = Infinity
  for (const item of PARCEL_ITEMS) {
    if (!item.name) continue
    for (const box of [itemBox(item, rotated), outsideLabelBox(item, rotated)]) {
      if (!box) continue
      const [x, y, w, h] = box
      const dx = Math.max(x - pt[0], 0, pt[0] - x - w), dy = Math.max(y - pt[1], 0, pt[1] - y - h)
      const d = Math.hypot(dx, dy)
      if (d > tol) continue
      // 落在里面的按面积比，没落中的排在后面按距离比
      const score = d === 0 ? w * h : 1e9 + d
      if (score < bestScore) { best = item; bestScore = score }
    }
  }
  return best
}
