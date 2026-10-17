import type { Building, Entrance, LngLat } from './types'

/** 导航只标出各端实际采用的最近入口；主动查看时才展开该楼全部入口。 */
export function visibleEntrances(buildings: Building[], explicitId: string, routeEnds: { buildingId: string; point: LngLat }[]) {
  const result = new Map<string, { building: Building; entrance: Entrance }>()
  const add = (building: Building, entrance: Entrance) => result.set(`${building.id}:${entrance.pos.join(',')}`, { building, entrance })
  const explicit = buildings.find((b) => b.id === explicitId)
  for (const entrance of explicit?.entrances ?? []) add(explicit!, entrance)
  for (const end of routeEnds) {
    const building = buildings.find((b) => b.id === end.buildingId)
    if (!building?.entrances?.length) continue
    const distance = (e: Entrance) => (e.pos[0] - end.point[0]) ** 2 * Math.cos(end.point[1] * Math.PI / 180) ** 2 + (e.pos[1] - end.point[1]) ** 2
    const entrance = building.entrances.reduce((best, e) => distance(e) < distance(best) ? e : best)
    add(building, entrance)
  }
  return [...result.values()]
}
