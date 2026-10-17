import { findRoute } from './route'
import { endFor, placeSelection } from './store'

/** 出楼、进楼、上下楼找教室，每段路额外算 2 分钟（路网只算到楼的轮廓或入口） */
const INDOOR = 2
const walkCache = new Map<string, number | null>()
/** 两个地点之间的步行分钟数，按路网算，按地点对缓存；地点不明或走不通时返回 null */
export function walkMinutes(from?: string, to?: string): number | null {
  if (!from || !to) return null
  if (from === to) return 0
  const key = `${from}>${to}`
  if (!walkCache.has(key)) {
    const a = placeSelection(from)
    const b = placeSelection(to)
    const ea = a && endFor(a)
    const eb = b && endFor(b)
    const route = ea && eb ? findRoute(ea, eb) : null
    walkCache.set(key, route ? route.minutes + INDOOR : null)
  }
  return walkCache.get(key)!
}
