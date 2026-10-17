import type { LatLngTuple } from 'leaflet'
import type { LngLat } from './types'

export interface OutlineGeometry { poly: LngLat[]; parts?: LngLat[][] }
export const outlineRings = (shape: OutlineGeometry) => [shape.poly, ...(shape.parts ?? [])]
export const outlinePoints = (shape: OutlineGeometry) => outlineRings(shape).flat()
// Leaflet 的第三层数组表示独立多边形，避免把看台误当成主轮廓中的洞。
export const outlineLatLngs = (shape: OutlineGeometry) => outlineRings(shape).map((ring) => [ring.map(([lng, lat]): LatLngTuple => [lat, lng])])
