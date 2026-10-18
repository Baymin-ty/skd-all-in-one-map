// 地图显示的三层透明度是固定配置：改 public/data/map-settings.json 后重新构建即可，前台与后台共用。
import defaults from '../../public/data/map-settings.json'

export type MapSettings = typeof defaults
export const DEFAULT_MAP_SETTINGS: Readonly<MapSettings> = Object.freeze({ ...defaults })
export const matchingOpacity = (settings: MapSettings) => (settings.selectable + settings.selected) / 2
export const batchHighlightOpacity = (settings: MapSettings) => settings.selectable * 0.8

export function validMapSettings(value: unknown): value is MapSettings {
  if (!value || typeof value !== 'object') return false
  return Object.keys(defaults).every((key) => {
    const opacity = (value as Record<string, unknown>)[key]
    return typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1
  })
}
