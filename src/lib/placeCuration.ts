import curation from '../../data/place-curation.json'
import type { Poi } from './types'

export const featuredPoi = (id: string) => curation.featuredPois.includes(id)
export const majorGate = (id: string) => curation.majorGates.includes(id)
/** 全校视图里优先保留名称的地标：三个食堂、图书馆、学活、体育馆 */
export const landmark = (id: string) => curation.landmarks.includes(id)
export const facilityBuilding = (id: string) => curation.facilities.find((p) => p.id === id)?.building
export const mergedPlace = (id: string) => {
  if (curation.promoted.some((p) => p.id === id)) return { kind: 'building' as const, id }
  const entry = curation.merged.find((p) => p.id === id)
  return entry && { kind: entry.kind as 'building' | 'group' | 'poi', id: entry.target }
}
export const contextOnlyPoi = (p: Poi) => p.cat === 'parking' || /出入口|入口|出口/.test(p.name.zh)
