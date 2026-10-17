import { PLACE_COLORS } from './catalog'
import type { IconName } from './icons'
import type { Building, Poi } from './types'

export const MAP_LABEL_CATEGORIES = [
  { id: 'academic', name: '教学科研', icon: 'academic', color: PLACE_COLORS.academic },
  { id: 'housing', name: '住宿', icon: 'housing', color: PLACE_COLORS.housing },
  { id: 'dining', name: '餐饮', icon: 'dining', color: PLACE_COLORS.dining },
  { id: 'sports', name: '运动', icon: 'sports', color: PLACE_COLORS.sports },
  { id: 'service', name: '生活服务', icon: 'service', color: PLACE_COLORS.service },
  { id: 'gate', name: '校门', icon: 'gate', color: PLACE_COLORS.gate },
  { id: 'transport', name: '交通停车', icon: 'parking', color: '#6e7b94' },
  { id: 'events', name: '活动', icon: 'calendar', color: '#a86581' },
] as const satisfies ReadonlyArray<{ id: string; name: string; icon: IconName; color: string }>

export type MapLabelCategory = typeof MAP_LABEL_CATEGORIES[number]['id']
export type MapLabelVisibility = Record<MapLabelCategory, boolean>

export function allMapLabels(visible: boolean): MapLabelVisibility {
  return Object.fromEntries(MAP_LABEL_CATEGORIES.map((c) => [c.id, visible])) as MapLabelVisibility
}

/** 交通点位按需打开，其余分类默认开启，名称仍会按空间避让。 */
export function defaultMapLabels(): MapLabelVisibility {
  return { ...allMapLabels(true), transport: false }
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
