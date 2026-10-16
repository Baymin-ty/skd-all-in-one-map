// 字段含义见赛前数据包 datapack/data/schema.ts，这里只留地图用得到的
export type LngLat = [number, number] // BD-09 [lng, lat]，对齐手绘底图
export type I18nText = { zh: string; en: string }

export type PlaceCat = 'academic' | 'dining' | 'housing' | 'sports' | 'service' | 'gate'
export type PoiCat = 'life' | 'dining' | 'sports' | 'parking' | 'transit'

export interface Entrance {
  pos: LngLat
  zh?: string
  en?: string
}

export interface Building {
  id: string
  name: I18nText
  short: I18nText
  cat: PlaceCat
  aliases: string[]
  poly: LngLat[]
  center: LngLat
  orgs: I18nText[]
  rooms: unknown[]
  info?: I18nText | null
  hours?: I18nText | null
  note?: I18nText | null
  entrances?: Entrance[]
  isNew?: boolean
  /** 风雨长廊：雨天导航优先走它下面 */
  walkway?: boolean
}

export interface Poi {
  id: string
  name: I18nText
  cat: PoiCat
  pos: LngLat
  desc: I18nText | null
  hours?: I18nText
  source?: string
}

export interface Campus {
  boundary: LngLat[]
  bounds: [LngLat, LngLat]
  grid: { x0: number; y0: number; dx: number; dy: number; rows: string[] }
  construction?: { name: I18nText; poly: LngLat[] }[]
}

export interface Places {
  categories: Record<PlaceCat, I18nText>
  buildings: Building[]
  pois: Poi[]
}
