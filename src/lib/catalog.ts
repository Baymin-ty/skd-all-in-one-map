import type { IconName } from './icons'
import type { PlaceCat, Poi, PoiCat, PoiKind } from './types'

export const POI_CATS: Record<PoiCat, { zh: string; icon: IconName; color: string }> = {
  life: { zh: '生活服务', icon: 'life', color: '#16a2a8' },
  dining: { zh: '餐饮', icon: 'dining', color: '#e07a1f' },
  sports: { zh: '运动', icon: 'sports', color: '#d64545' },
  parking: { zh: '停车', icon: 'parking', color: '#4a4a4f' },
  transit: { zh: '交通', icon: 'transit', color: '#2f6fd6' },
}
export const POI_KINDS: Record<PoiKind, { zh: string; icon: IconName; hint: string }> = {
  'garage-ramp': { zh: '车库坡道', icon: 'parking', hint: '车辆进出地下车库' },
  'garage-stairs': { zh: '车库楼梯', icon: 'stairs', hint: '步行上下地下车库' },
  'garage-elevator': { zh: '车库电梯', icon: 'elevator', hint: '乘电梯上下地下车库' },
}
/** 点位的显示名称和图标：有细分时用细分 */
export const poiKindLabel = (p: Poi) => p.kind ? POI_KINDS[p.kind].zh : POI_CATS[p.cat]?.zh ?? ''
export const poiIcon = (p: Poi): IconName => p.kind ? POI_KINDS[p.kind].icon : POI_CATS[p.cat]?.icon ?? 'pin'
export const PLACE_COLORS: Record<PlaceCat, string> = {
  academic: '#527da3', dining: '#bd8046', housing: '#64937a', sports: '#b86b67', service: '#528f92', gate: '#8c7ba5',
}
export const WALKWAY_COLOR = '#0e8fa8'

