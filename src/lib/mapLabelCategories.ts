import { PLACE_COLORS } from './catalog'
import type { IconName } from './icons'
import type { Building, Poi } from './types'

/** 按日常用处排序，默认显示的排在前面。 */
export const MAP_LABEL_CATEGORIES = [
  { id: 'academic', name: '教学科研', icon: 'academic', color: PLACE_COLORS.academic },
  { id: 'dining', name: '餐饮', icon: 'dining', color: PLACE_COLORS.dining },
  { id: 'sports', name: '运动', icon: 'sports', color: PLACE_COLORS.sports },
  { id: 'gate', name: '校门', icon: 'gate', color: PLACE_COLORS.gate },
  { id: 'service', name: '生活服务', icon: 'service', color: PLACE_COLORS.service },
  { id: 'housing', name: '住宿', icon: 'housing', color: PLACE_COLORS.housing },
  { id: 'transport', name: '交通停车', icon: 'parking', color: '#6e7b94' },
] as const satisfies ReadonlyArray<{ id: string; name: string; icon: IconName; color: string }>

export type MapLabelCategory = typeof MAP_LABEL_CATEGORIES[number]['id']
export type MapLabelVisibility = Record<MapLabelCategory, boolean>

/** 停车点不常驻，也不进图层面板：只在悬停、选中、筛选或导航用到时显示 */
const ON_DEMAND = new Set<MapLabelCategory>(['transport'])
/** 图层面板里可以开关的分类 */
export const PICKER_CATEGORIES = MAP_LABEL_CATEGORIES.filter((c) => !ON_DEMAND.has(c.id))
/** 这一类的标签现在是否常驻（旧版本存下来的停车开关一律不算） */
export const labelShown = (visibility: MapLabelVisibility, category: MapLabelCategory) => !ON_DEMAND.has(category) && !!visibility[category]

export function allMapLabels(visible: boolean): MapLabelVisibility {
  return Object.fromEntries(MAP_LABEL_CATEGORIES.map((c) => [c.id, visible])) as MapLabelVisibility
}

/** 默认只开最常用的几类，其余按需打开；名称仍会按空间避让。 */
export function defaultMapLabels(): MapLabelVisibility {
  return { ...allMapLabels(true), housing: false, service: false, transport: false }
}

export function buildingLabelCategory(b: Pick<Building, 'cat'>): MapLabelCategory {
  return b.cat
}

export function poiLabelCategory(p: Pick<Poi, 'cat'>): MapLabelCategory {
  if (p.cat === 'life') return 'service'
  if (p.cat === 'parking' || p.cat === 'transit') return 'transport'
  return p.cat
}

export const mapLabelColor = (category: MapLabelCategory) => MAP_LABEL_CATEGORIES.find((c) => c.id === category)!.color
