// 字段含义见赛前数据包 datapack/data/schema.ts，这里只留地图用得到的
export type LngLat = [number, number] // BD-09 [lng, lat]，对齐手绘底图
export type I18nText = { zh: string; en: string }

export type PlaceCat = 'academic' | 'dining' | 'housing' | 'sports' | 'service' | 'gate'
export type PoiCat = 'life' | 'dining' | 'sports' | 'parking' | 'transit'
/** 停车点位的细分：地下车库的车行坡道、步行楼梯、电梯 */
export type PoiKind = 'garage-ramp' | 'garage-stairs' | 'garage-elevator'

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
  /** 分离的附属轮廓，例如体育场看台。每一项都是独立外环。 */
  parts?: LngLat[][]
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
  /** null 表示不细分（保存时用 null 覆盖原记录里的细分） */
  kind?: PoiKind | null
  aliases?: string[]
  pos: LngLat
  desc: I18nText | null
  hours?: I18nText
  source?: string
}

export interface Campus {
  boundary: LngLat[]
  bounds: [LngLat, LngLat]
  grid: { x0: number; y0: number; dx: number; dy: number; rows: string[] }
  construction?: { name: I18nText; poly: LngLat[]; parts?: LngLat[][] }[]
  /** 真实坐标 → 手绘图的校正（175 个路口控制点），见 geoConvert.ts */
  warp?: { A: number[][]; src: LngLat[]; res: LngLat[] }
}

export interface Places {
  categories: Record<PlaceCat, I18nText>
  buildings: Building[]
  pois: Poi[]
}

export type UndergroundConnectorKind = 'ramp' | 'stairs' | 'elevator' | 'unknown'

export interface UndergroundSourceAnchor {
  /** 图片中归一化的 x/y，范围 0..1 */
  image: [number, number]
  pos: LngLat
}

export interface UndergroundSource {
  id: string
  title: string
  image: string
  floor: number
  anchors: UndergroundSourceAnchor[]
  alignment?: 'approximate' | 'reviewed'
  note?: string
}

export interface UndergroundEdge {
  id: string
  a: string
  b: string
}

export interface UndergroundConnector {
  id: string
  floorFrom: number
  floorTo: number
  kind: UndergroundConnectorKind
  pos: LngLat
  node?: string
  source?: string
  linkedPoiId?: string
  note?: string
}

/** 在线段上标注的街景点：位置由两个路网端点和插值权重唯一确定。 */
export interface UndergroundStreetViewPoint {
  id: string
  endpointId1: string
  endpointWeight1: number
  endpointId2: string
  endpointWeight2: number
  imageId: string
}

/** 后台编辑器保存的路网节点 ID，保证街景点在重新载入后仍能找到端点。 */
export interface UndergroundNode {
  id: string
  pos: LngLat
}

export interface UndergroundMap {
  version: 2
  floor: number
  bounds: [LngLat, LngLat]
  sources: UndergroundSource[]
  nodes: UndergroundNode[]
  edges: UndergroundEdge[]
  connectors: UndergroundConnector[]
  points?: UndergroundStreetViewPoint[]
}
