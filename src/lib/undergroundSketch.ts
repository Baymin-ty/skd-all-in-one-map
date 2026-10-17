import type { LngLat, UndergroundMap, UndergroundRoad } from './types'

/** 把前台手绘的完成线段转换为后台可编辑的 B1 车行道路。 */
export function sketchRoads(paths: LngLat[][]): UndergroundRoad[] {
  return paths
    .filter((path) => path.length >= 2)
    .map((path, index) => ({
      id: `ug-sketch-${index + 1}`,
      floor: -1,
      mode: 'car' as const,
      direction: 'both' as const,
      status: 'candidate' as const,
      path: path.map(([lng, lat]) => [+lng, +lat] as LngLat),
      source: 'front-sketch',
      note: '从前台手绘迁移，待管理员确认。',
    }))
}

/** 只在地图里还没有前台手绘道路时导入，避免刷新后台重复添加。 */
export function mergeUndergroundSketch(map: UndergroundMap, paths: LngLat[][]): UndergroundMap {
  const imported = sketchRoads(paths)
  if (!imported.length || map.roads.some((road) => road.source === 'front-sketch')) return map
  return { ...map, roads: [...map.roads, ...imported] }
}

