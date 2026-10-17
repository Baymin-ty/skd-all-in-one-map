import type { Campus, LngLat, UndergroundMap } from './types'

export type { UndergroundConnector, UndergroundMap, UndergroundMode, UndergroundRoad, UndergroundSource, UndergroundStatus } from './types'

const VALID_STATUS = new Set(['candidate', 'confirmed', 'rejected'])
const VALID_KINDS = new Set(['ramp', 'stairs', 'elevator', 'unknown'])

function inBounds(p: LngLat, bounds: [LngLat, LngLat]) {
  const minLng = Math.min(bounds[0][0], bounds[1][0])
  const maxLng = Math.max(bounds[0][0], bounds[1][0])
  const minLat = Math.min(bounds[0][1], bounds[1][1])
  const maxLat = Math.max(bounds[0][1], bounds[1][1])
  return p[0] >= minLng && p[0] <= maxLng && p[1] >= minLat && p[1] <= maxLat
}

function duplicateIds(ids: string[]) {
  const seen = new Set<string>()
  return ids.filter((id) => {
    if (seen.has(id)) return true
    seen.add(id)
    return false
  })
}

/** 校验地下图层，错误返回给数据导入/后台，不阻塞地面图层加载。 */
export function validateUndergroundMap(map: UndergroundMap, campus: Campus): string[] {
  const errors: string[] = []
  const bounds = campus.bounds
  const ids = [...map.roads.map((r) => r.id), ...map.connectors.map((c) => c.id)]
  for (const id of duplicateIds(ids)) errors.push(`重复 id: ${id}`)
  for (const source of map.sources) {
    if (!source.id || !source.image) errors.push(`来源缺少 id 或 image: ${source.id || '(空)'}`)
    if (source.anchors.length < 2) errors.push(`来源锚点不足: ${source.id}`)
    source.anchors.forEach((anchor, i) => {
      if (anchor.image.some((v) => v < 0 || v > 1)) errors.push(`来源锚点图片坐标越界: ${source.id}#${i}`)
      if (!inBounds(anchor.pos, bounds)) errors.push(`来源锚点超出校园范围: ${source.id}#${i}`)
    })
  }
  for (const road of map.roads) {
    if (road.path.length < 2) errors.push(`道路至少需要两个点: ${road.id}`)
    if (!VALID_STATUS.has(road.status)) errors.push(`道路 status 无效: ${road.id}`)
    road.path.forEach((p) => { if (!inBounds(p, bounds)) errors.push(`道路超出校园范围: ${road.id}`) })
  }
  for (const connector of map.connectors) {
    if (!VALID_STATUS.has(connector.status)) errors.push(`连接点 status 无效: ${connector.id}`)
    if (!VALID_KINDS.has(connector.kind)) errors.push(`连接点 kind 无效: ${connector.id}`)
    if (!inBounds(connector.pos, bounds)) errors.push(`连接点超出校园范围: ${connector.id}`)
    if (connector.floorFrom === connector.floorTo) errors.push(`连接点楼层不能相同: ${connector.id}`)
  }
  return errors
}
