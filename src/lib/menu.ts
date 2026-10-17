// Menu search across every canteen: one row per dish per counter, ranked for Chinese queries
// (substring + synonyms rather than fuzzy edit distance, which matches unrelated dishes that share a character).
import { computed } from 'vue'
import { canteens } from './discoveryData'
import { dateKey, dayName, weekdayText, MEAL_LABELS, outletState, clockText, nowTick } from './campusTime'
import type { Canteen, Dish, Meal, Outlet, Stall } from './discoveryTypes'

export interface MenuItem {
  d: Dish
  o: Outlet
  c: Canteen
  s?: Stall
  lo: number | null
  hi: number | null
  // lower-cased search text
  name: string
  en: string
  /** counter name + aliases (matched whole or as a prefix: 「水饺」 → the 水饺 counter, but 「牛肉」 ≠ 手工牛肉面) */
  stallWords: string[]
  extra: string
  place: string
}

const low = (s?: string | null) => (s || '').toLowerCase()
export const TAG_LABELS: Record<string, string> = { noodles: '面食', rice: '米饭', dumplings: '饺子馄饨', soup: '汤类', mild: '不辣', spicy: '辣味', spicy1: '微辣', spicy2: '较辣', veg: '素食', breakfast: '早餐', snack: '小吃', drink: '饮品', sweet: '甜品' }

/** Every dish on campus with where it is sold. */
export const menuItems = computed<MenuItem[]>(() =>
  canteens.value.flatMap((c) =>
    c.outlets.flatMap((o) =>
      o.dishes.map((d) => {
        const s = o.stalls.find((x) => x.zh === d.stall)
        const ps = (d.specs?.length ? d.specs.map((x) => x.price) : [d.price]).filter((p): p is number => p != null)
        return {
          d, o, c, s,
          lo: ps.length ? Math.min(...ps) : null,
          hi: ps.length ? Math.max(...ps) : null,
          name: low(d.zh),
          en: low(d.en),
          stallWords: [d.stall, s?.en, ...(s?.aliases ?? [])].filter(Boolean).map((w) => low(w)),
          extra: low([d.desc?.zh, d.desc?.en].join(' ')),
          place: low([c.zh, c.en, ...(c.aliases ?? []), o.zh, o.en, ...(o.aliases ?? [])].join(' ')),
        }
      }),
    ),
  ),
)

/** Outlets that are listed but whose menu is still being entered. */
export const pendingOutlets = computed(() => canteens.value.flatMap((c) => c.outlets.filter((o) => o.menuPending && !o.dishes.length).map((o) => ({ c, o }))))

// ---------- prices ----------
export const yuan = (n: number) => `¥${Number.isInteger(n) ? n : String(Math.round(n * 100) / 100)}`
export const unitText = (u?: string) => u || ''
/** Short price for a list row: ¥12 · ¥9–10 · 免费 · 现场价 */
export function priceShort(d: Dish) {
  const ps = (d.specs?.length ? d.specs.map((x) => x.price) : [d.price]).filter((p): p is number => p != null)
  if (!ps.length) return '现场价'
  const lo = Math.min(...ps)
  const hi = Math.max(...ps)
  if (hi === 0) return '免费'
  const amount = lo === hi ? yuan(lo) : `${yuan(lo)}–${Math.round(hi * 100) / 100}`
  return d.referencePrice ? `参考 ${amount}` : amount
}
/** Full price line: 小份 ¥9 · 大份 ¥10 / 12只 */
export function priceLong(d: Dish) {
  const u = unitText(d.unit)
  const sp = d.specs?.filter((x) => x.price != null) ?? []
  const main = sp.length > 1 || (sp.length === 1 && d.specs!.length === 1)
    ? sp.map((x) => `${x.zh} ${yuan(x.price!)}`).join(' · ')
    : d.price == null ? '现场价' : d.price === 0 ? '免费' : yuan(d.price)
  const amount = u && d.price != null ? `${main} / ${u}` : main
  return d.referencePrice && d.price != null ? `参考价 ${amount}` : amount
}

// ---------- weekly menus (自选, daily specials) ----------
/** Is the dish on that day's menu? 'unknown' when the stall's weekly menu does not cover the date (last week's menu). */
export function servedOn(d: Dish, date: string, s?: Stall): 'yes' | 'no' | 'unknown' {
  if (!d.days || date in d.days) return 'yes'
  const w = s?.week
  return w && (date < w[0] || date > w[1]) ? 'unknown' : 'no'
}
/** meals it is served at that day ([] = whenever the counter is open) */
export const mealsOn = (d: Dish, date: string): Meal[] => d.days?.[date] ?? d.meals ?? []
/** the first day from `from` on that the dish is on */
export function nextServed(d: Dish, from = dateKey()) {
  const k = Object.keys(d.days ?? {}).filter((x) => x >= from).sort()[0]
  return k ? { date: k, meals: d.days![k] } : null
}
const mealsText = (ms: Meal[]) => ms.map((m) => MEAL_LABELS[m]).join('、')
/** 「每天」 · 「周一、周三、周五」 · 「周一 午餐 · 周二 晚餐」 (meals only when they differ between days) */
export function scheduleText(d: Dish) {
  const e = Object.entries(d.days ?? {}).sort(([a], [b]) => a.localeCompare(b))
  if (!e.length) return ''
  const same = e.every(([, ms]) => ms.join() === e[0][1].join())
  const days = e.length === 7 ? '每天' : e.map(([k]) => weekdayText(k)).join('、')
  if (same) return e[0][1].length ? `${days} ${mealsText(e[0][1])}` : days
  return e.map(([k, ms]) => `${weekdayText(k)} ${mealsText(ms)}`).join(' · ')
}
/** list hint for a weekly-menu dish: 「今天晚餐」 / 「周六有」 / 「本周没有了」 */
export function dayHint(d: Dish, s?: Stall): { text: string; today: boolean } | null {
  if (!d.days) return null
  const today = dateKey()
  const on = servedOn(d, today, s)
  if (on === 'unknown') return { text: '周菜单待更新', today: false }
  if (on === 'yes') {
    const ms = d.days[today]
    return { text: '今天' + (ms.length === 1 ? MEAL_LABELS[ms[0]] : ''), today: true }
  }
  const n = nextServed(d, today)
  return { text: n ? dayName(n.date) + '供应' : '本期菜单已无后续安排', today: false }
}

// ---------- search ----------
export type MenuSort = 'best' | 'asc' | 'desc'
export interface MenuFilter {
  canteen?: string
  outlet?: string
  stall?: string
  tags?: string[]
  max?: number | null
  min?: number | null
  openNow?: boolean
  sort?: MenuSort
}
const SPICY = ['spicy1', 'spicy2']
const isSpicy = (x: MenuItem) => !!x.d.tags?.some((g) => SPICY.includes(g))
const has = (g: string) => (x: MenuItem) => !!x.d.tags?.includes(g)
/** filter chips / query words that select by tag */
export const TAG_FILTERS: Record<string, (x: MenuItem) => boolean> = {
  noodles: has('noodles'), rice: has('rice'), dumplings: has('dumplings'), soup: has('soup'),
  mild: (x) => !isSpicy(x), spicy: isSpicy, veg: has('veg'), breakfast: has('breakfast'), snack: has('snack'), drink: has('drink'), sweet: has('sweet'),
}
/** words in a query that act as filters instead of being searched in dish names */
const QUERY_TAGS: [RegExp, string][] = [
  [/不辣的?|清淡的?|not spicy|mild/gi, 'mild'],
  [/(^|\s)(辣的?|spicy)(?=\s|$)/gi, 'spicy'],
  [/素食|素菜|(^|\s)素的?(?=\s|$)|vegetarian|\bveg\b/gi, 'veg'],
  [/早餐|早点|breakfast/gi, 'breakfast'],
  [/小吃|snacks?/gi, 'snack'],
  [/饮品|饮料|喝的|drinks?/gi, 'drink'],
  [/甜品|甜点|desserts?/gi, 'sweet'],
]
const SYN: string[][] = [
  ['饺子', '水饺', '饺'], ['馄饨', '抄手', '云吞'], ['米线', '米粉', '河粉'], ['面条', '面'], ['番茄', '西红柿'], ['土豆', '马铃薯', '洋芋'],
  ['鸡蛋', '蛋'], ['牛排', '牛扒'], ['鸡排', '鸡扒'], ['咖喱', '咖哩'], ['粥', '稀饭'], ['包子', '包'], ['快餐', '自选', '盖饭', '盖浇饭'],
  ['烧烤', '烤'], ['汉堡', '肉夹馍'], ['dumpling', 'dumplings', 'wonton'], ['noodle', 'noodles'],
]
const TAG_WORDS: Record<string, string[]> = {
  noodles: ['面', '面条', 'noodle', 'noodles'], rice: ['饭', '米饭', 'rice'], dumplings: ['饺子', '饺', 'dumpling', 'dumplings'],
  soup: ['汤', 'soup'], spicy1: ['辣', 'spicy'], spicy2: ['辣', 'spicy'], snack: ['小吃', 'snack'], drink: ['饮品', 'drink'], sweet: ['甜', 'dessert'],
}
const alternatives = (w: string) => {
  const g = SYN.find((x) => x.includes(w))
  return g ? [w, ...g.filter((x) => x !== w)] : [w]
}
/** characters of a appear in b in order (牛面 → 牛肉面) */
const subseq = (a: string, b: string) => {
  let i = 0
  for (const ch of b) if (ch === a[i]) i++
  return i === a.length
}
/** ≥ 50: the dish itself matches; 40: only its counter's name; lower: description / place / loose */
function tokenScore(x: MenuItem, w: string) {
  let best = 0
  for (const [i, a] of alternatives(w).entries()) {
    let s = 0
    const tagHit = !!x.d.tags?.some((g) => TAG_WORDS[g]?.includes(a))
    // one character (面 / 饭 / 汤) is a category: prefer the tag over any name that happens to contain it (面筋)
    if (a.length === 1 && /[一-龥]/.test(a)) s = tagHit ? 70 : x.name.includes(a) ? 35 : 0
    else if (x.name === a) s = 100
    else if (x.name.startsWith(a)) s = 80
    else if (x.name.includes(a)) s = 60 + Math.min(20, (a.length / x.name.length) * 20)
    else if (x.en.includes(a)) s = 55
    else if (x.stallWords.some((w) => w === a || w.startsWith(a))) s = 40
    else if (a.length >= 2 && x.extra.includes(a)) s = 30
    else if (tagHit) s = 30
    else if (x.place.includes(a)) s = 20
    else if (a.length >= 2 && /[一-龥]/.test(a) && subseq(a, x.name)) s = 15
    best = Math.max(best, i ? s * 0.85 : s)
  }
  return best
}

export interface ParsedQuery {
  words: string[]
  tags: string[]
  max: number | null
  min: number | null
  cheap: boolean
}
const N = String.raw`(\d+(?:\.\d+)?)`
/** 「15元以内的牛肉」 → words [牛肉], max 15 · 「白玉兰 不辣 面」 → words [白玉兰, 面], tags [mild] */
export function parseQuery(raw: string, placeWords: string[] = []): ParsedQuery {
  let q = ` ${raw.trim().toLowerCase()} `
  let max: number | null = null
  let min: number | null = null
  const take = (re: RegExp, f: (m: RegExpExecArray) => void) => {
    q = q.replace(re, (...a) => {
      f(a as unknown as RegExpExecArray)
      return ' '
    })
  }
  take(new RegExp(`${N}\\s*(?:元|块|rmb|yuan)?\\s*[-~～到至]\\s*${N}\\s*(?:元|块)?`, 'g'), (m) => ((min = +m[1]), (max = +m[2])))
  take(new RegExp(`${N}\\s*(?:元|块)?\\s*(?:以内|以下|之内|内)的?`, 'g'), (m) => (max = +m[1]))
  take(new RegExp(`(?:<|＜|≤|小于|低于|不超过|不到|under|below)\\s*${N}\\s*(?:元|块)?`, 'g'), (m) => (max = +m[1]))
  take(new RegExp(`${N}\\s*(?:元|块)?\\s*(?:以上|起)的?`, 'g'), (m) => (min = +m[1]))
  take(new RegExp(`(?:>|＞|≥|大于|高于|over|above)\\s*${N}\\s*(?:元|块)?`, 'g'), (m) => (min = +m[1]))
  take(new RegExp(`${N}\\s*(?:元|块)的?`, 'g'), (m) => (max = +m[1]))
  let cheap = false
  take(/便宜的?|实惠的?|省钱|cheap/g, () => (cheap = true))
  const tags: string[] = []
  for (const [re, tag] of QUERY_TAGS) take(re, () => tags.includes(tag) || tags.push(tag))
  const words: string[] = []
  const places = [...placeWords].sort((a, b) => b.length - a.length)
  for (const tok of q.split(/[\s,，、。;；/]+/).map((x) => x.replace(/的$/, '')).filter(Boolean)) {
    // 「白玉兰牛肉」 → 白玉兰 + 牛肉
    const p = places.find((w) => tok.length > w.length && (tok.startsWith(w) || tok.endsWith(w)))
    if (p) words.push(p, tok.startsWith(p) ? tok.slice(p.length) : tok.slice(0, -p.length))
    else words.push(tok)
  }
  return { words: words.filter(Boolean), tags, max, min, cheap }
}

export const placeWords = computed(() =>
  [...new Set(canteens.value.flatMap((c) => [c.zh, ...(c.aliases ?? []), ...c.outlets.flatMap((o) => o.aliases ?? [])]).map(low))].filter((w) => w.length >= 2),
)

/** dish can be had right now: outlet open, on today's menu, in the current meal, not sold out */
export function availableNow(x: MenuItem) {
  const st = outletState(x.o)
  if (st.kind !== 'open' || x.d.soldOut || st.lastOrder && clockText(nowTick.value) >= st.lastOrder) return false
  const today = dateKey()
  const on = servedOn(x.d, today, x.s)
  if (on !== 'yes') return false
  const ms = on === 'yes' ? mealsOn(x.d, today) : (x.d.meals ?? [])
  return !ms.length || ms.includes(st.meal) || ms.includes('allday')
}

/** A price interval collected from all matching dishes in a group. */
export interface MenuPriceRange {
  min: number | null
  max: number | null
}

export interface MenuOutletGroup {
  outlet: Outlet
  /** Alias kept for callers that use the short MenuItem field names. */
  o: Outlet
  items: MenuItem[]
  price: MenuPriceRange
  lo: number | null
  hi: number | null
  available: boolean
  availableCount: number
  count: number
  hitCount: number
}

export interface MenuCanteenGroup {
  canteen: Canteen
  /** Alias kept for callers that use the short MenuItem field names. */
  c: Canteen
  outlets: MenuOutletGroup[]
  items: MenuItem[]
  price: MenuPriceRange
  lo: number | null
  hi: number | null
  available: boolean
  availableCount: number
  count: number
  hitCount: number
}

export type MenuAvailability = (item: MenuItem) => boolean

/**
 * Group search hits by canteen and then outlet.
 *
 * The input order is preserved for ties, while groups that have at least one
 * dish available now are moved before groups whose matches are all unavailable.
 * Availability is injectable so callers and tests can provide a snapshot at a
 * specific time; the default follows the menu's current-time rules.
 */
export function groupByCanteen(items: readonly MenuItem[], isAvailable: MenuAvailability = availableNow): MenuCanteenGroup[] {
  const canteenMap = new Map<string, { canteen: Canteen; outlets: Map<string, { outlet: Outlet; items: MenuItem[] }> }>()
  for (const item of items) {
    let canteen = canteenMap.get(item.c.id)
    if (!canteen) {
      canteen = { canteen: item.c, outlets: new Map() }
      canteenMap.set(item.c.id, canteen)
    }
    let outlet = canteen.outlets.get(item.o.id)
    if (!outlet) {
      outlet = { outlet: item.o, items: [] }
      canteen.outlets.set(item.o.id, outlet)
    }
    outlet.items.push(item)
  }

  const range = (xs: MenuItem[]): MenuPriceRange => {
    const prices = xs.flatMap((x) => [x.lo, x.hi]).filter((x): x is number => x != null && Number.isFinite(x))
    return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: null, max: null }
  }
  const makeOutlet = ({ outlet, items: hits }: { outlet: Outlet; items: MenuItem[] }): MenuOutletGroup => {
    const price = range(hits)
    const availableCount = hits.reduce((n, item) => n + (isAvailable(item) ? 1 : 0), 0)
    return {
      outlet, o: outlet, items: [...hits], price, lo: price.min, hi: price.max,
      available: availableCount > 0, availableCount, count: hits.length, hitCount: hits.length,
    }
  }
  const makeCanteen = ({ canteen, outlets }: { canteen: Canteen; outlets: Map<string, { outlet: Outlet; items: MenuItem[] }> }): MenuCanteenGroup => {
    const groupedOutlets = [...outlets.values()].map(makeOutlet)
    const hits = groupedOutlets.flatMap((x) => x.items)
    const price = range(hits)
    const availableCount = groupedOutlets.reduce((n, x) => n + x.availableCount, 0)
    groupedOutlets.sort((a, b) => Number(b.available) - Number(a.available))
    return {
      canteen, c: canteen, outlets: groupedOutlets, items: [...hits], price, lo: price.min, hi: price.max,
      available: availableCount > 0, availableCount, count: hits.length, hitCount: hits.length,
    }
  }
  const groups = [...canteenMap.values()].map(makeCanteen)
  groups.sort((a, b) => Number(b.available) - Number(a.available))
  return groups
}

export function searchMenu(raw: string, f: MenuFilter = {}) {
  const q = parseQuery(raw, placeWords.value)
  const limitsMax = [q.max, f.max].filter((n): n is number => n != null)
  const limitsMin = [q.min, f.min].filter((n): n is number => n != null)
  const max = limitsMax.length ? Math.min(...limitsMax) : null
  const min = limitsMin.length ? Math.max(...limitsMin) : null
  const tags = [...new Set([...(f.tags ?? []), ...q.tags])]
  const today = dateKey()
  const out: { x: MenuItem; score: number; viaStall: boolean[] }[] = []
  for (const x of menuItems.value) {
    if (f.canteen && x.c.id !== f.canteen) continue
    if (f.outlet && x.o.id !== f.outlet) continue
    if (f.stall && x.s?.id !== f.stall) continue
    if (tags.some((g) => !TAG_FILTERS[g]?.(x))) continue
    if (max != null && (x.lo == null || x.lo > max)) continue
    if (min != null && (x.hi == null || x.hi < min)) continue
    // A single size must satisfy both bounds, not two different sizes.
    if ((min != null || max != null) && !(x.d.specs?.length ? x.d.specs.map((s) => s.price) : [x.d.price]).some((p) => p != null && (min == null || p >= min) && (max == null || p <= max))) continue
    if (f.openNow && !availableNow(x)) continue
    let score = 0
    let miss = false
    const viaStall: boolean[] = []
    for (const w of q.words) {
      const s = tokenScore(x, w)
      if (!s) {
        miss = true
        break
      }
      viaStall.push(s === 40)
      score += s
    }
    if (miss) continue
    if (availableNow(x)) score += 4
    // a 自选 dish that is not on today's menu goes below today's
    if (x.d.days && servedOn(x.d, today, x.s) === 'no') score -= 8
    if (x.lo != null) score += 2
    if (x.d.soldOut) score -= 10
    out.push({ x, score, viaStall })
  }
  // 「抄手」 is also an alias of the 重庆小面 counter: when some of its dishes match by name, the rest of the counter is noise
  const named = q.words.map((_, i) => new Set(out.filter((r) => !r.viaStall[i]).map((r) => r.x.o.id + r.x.d.stall)))
  for (let k = out.length - 1; k >= 0; k--) {
    const r = out[k]
    if (r.viaStall.some((v, i) => v && named[i].has(r.x.o.id + r.x.d.stall))) out.splice(k, 1)
  }
  const sort = f.sort && f.sort !== 'best' ? f.sort : q.cheap ? 'asc' : 'best'
  const price = (x: MenuItem) => x.lo ?? Infinity
  out.sort((a, b) =>
    sort === 'asc' ? price(a.x) - price(b.x) || b.score - a.score
    : sort === 'desc' ? (b.x.hi ?? -1) - (a.x.hi ?? -1) || b.score - a.score
    : b.score - a.score || price(a.x) - price(b.x),
  )
  return { items: out.map((r) => r.x), parsed: q, max, min, tags }
}
