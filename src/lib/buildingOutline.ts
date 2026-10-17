import type { PathOptions, PolylineOptions } from 'leaflet'
import type { MapSettings } from './mapSettings'
import { WALKWAY_COLOR } from './catalog'

export function walkwayOutline(strong = false): PathOptions {
  return {
    stroke: true, color: WALKWAY_COLOR, weight: strong ? 3 : 2,
    opacity: strong ? 0.75 : 0.5, dashArray: strong ? undefined : '6 4', fillOpacity: 0,
  }
}

export const constructionOutline: PolylineOptions = {
  smoothFactor: 0, color: '#e0891f', weight: 1.5, dashArray: '5 4', fillColor: '#e0891f', fillOpacity: 0.05,
}

/** 沿用 skdmap 的米白悬停边和校徽红选中边，透明度仍由显示设置控制。 */
export function buildingOutline(selected: boolean, hovered: boolean, settings: MapSettings): PathOptions {
  return {
    stroke: true,
    color: selected ? '#a8242b' : '#fffdf4',
    weight: selected ? 2.5 : 2,
    opacity: selected || hovered ? settings.selected : 0,
    lineCap: 'round', lineJoin: 'round', dashArray: undefined,
    // 原图的显隐和羽化由遮罩处理，描边层仅保留透明的点击区域。
    fill: true, fillOpacity: 0,
  }
}
