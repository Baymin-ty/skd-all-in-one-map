import { computed, reactive } from 'vue'
import type { CampusEvent, Canteen, EventCat } from './discoveryTypes'
import { dayStart, evEnd, evStart, nowTick } from './campusTime'

export const discovery = reactive({
  events: [] as CampusEvent[], canteens: [] as Canteen[], hoursSource: '',
  eventsLoading: false, diningLoading: false, eventsError: '', diningError: '',
})
export const canteens = computed(() => discovery.canteens)
export const EVENT_CATS: Record<EventCat, string> = {
  lecture: '讲座报告', conference: '会议论坛', culture: '文化艺术', student: '学生活动', career: '就业发展',
  library: '图书馆', international: '国际交流', wellbeing: '健康生活', campus: '校园事务', other: '其他',
}
export const EVENT_RANGES = { now: '进行中', today: '今天', week: '近一周', upcoming: '全部待开始', past: '往期' }
export type EventRange = keyof typeof EVENT_RANGES
export function eventsIn(range: EventRange, cat = 'all', place = '', time = nowTick.value) {
  const endOfToday = dayStart(time) + 86_400_000
  return discovery.events.filter((e) => {
    if (e.hidden || e.status === 'cancelled' && range !== 'past') return false
    if (cat !== 'all' && e.category !== cat || place && e.place !== place) return false
    const start = evStart(e), end = evEnd(e)
    if (range === 'past') return end <= time
    if (range === 'now') return start <= time && end > time
    if (range === 'today') return start < endOfToday && end > time
    if (range === 'week') return start < endOfToday + 6 * 86_400_000 && end > time
    return end > time
  }).sort((a, b) => range === 'past' ? evStart(b) - evStart(a) : evStart(a) - evStart(b))
}
/** 全校地图按哪天看活动：今天、明天或本周（今天起 7 天），和我的地图的日期选择同一套说法 */
export type DayScope = 'today' | 'tomorrow' | 'week'
export function eventsForScope(scope: DayScope, time = nowTick.value) {
  if (scope !== 'tomorrow') return eventsIn(scope, 'all', '', time)
  const from = dayStart(time) + 86_400_000
  return eventsIn('upcoming', 'all', '', time).filter((e) => evStart(e) < from + 86_400_000 && evEnd(e) > from)
}
/** 地图常驻角标：进行中以及未来若干小时内开始的活动（滚动窗口，不按自然日截断）。 */
export function eventsAhead(hours = 24, time = nowTick.value) {
  return eventsIn('upcoming', 'all', '', time).filter((e) => evStart(e) < time + hours * 3_600_000)
}
export async function loadDiscovery(kind?: 'events' | 'dining') {
  await Promise.all((kind ? [kind] : ['events', 'dining'] as const).map(async (key) => {
    if (discovery[`${key}Loading`]) return
    discovery[`${key}Loading`] = true
    discovery[`${key}Error`] = ''
    try {
      const resource = key === 'events' ? 'events' : 'canteens'
      let response: Response
      try {
        response = await fetch(`/api/${resource}`, { signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error('API unavailable')
      } catch {
        response = await fetch(`/data/${resource}.json`, { signal: AbortSignal.timeout(8000) })
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (key === 'events') {
        if (!Array.isArray(data)) throw new Error('活动数据格式错误')
        discovery.events = data
      } else {
        if (!Array.isArray(data.canteens)) throw new Error('菜单数据格式错误')
        discovery.canteens = data.canteens
        discovery.hoursSource = data.hoursSource?.zh || ''
      }
    } catch {
      discovery[`${key}Error`] = key === 'events' ? '活动暂时加载失败，请重试。' : '菜单暂时加载失败，请重试。'
    } finally { discovery[`${key}Loading`] = false }
  }))
}
