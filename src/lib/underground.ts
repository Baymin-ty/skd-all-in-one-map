import type { Campus, LngLat, UndergroundMap } from './types'
import { isGuid } from './streetview'

export type { UndergroundConnector, UndergroundMap, UndergroundEdge, UndergroundNode, UndergroundStreetViewPoint, UndergroundSource } from './types'

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
  if (map.version !== 2 || !Array.isArray(map.nodes) || !Array.isArray(map.edges) || 'roads' in map) return ['地下地图必须为 version 2 节点与边格式']
  const ids = [...map.nodes.map((n) => n.id), ...map.edges.map((e) => e.id), ...map.connectors.map((c) => c.id), ...(map.points ?? []).map((p) => p.id)]
  for (const id of duplicateIds(ids)) errors.push(`重复 id: ${id}`)
  const nodeIds = new Set<string>()
  for (const networkNode of map.nodes ?? []) {
    if (!networkNode.id) errors.push('路网节点缺少 id')
    nodeIds.add(networkNode.id)
    if (!inBounds(networkNode.pos, bounds)) errors.push(`路网节点超出校园范围: ${networkNode.id}`)
  }
  for (const source of map.sources) {
    if (!source.id || !source.image) errors.push(`来源缺少 id 或 image: ${source.id || '(空)'}`)
    if (source.anchors.length < 2) errors.push(`来源锚点不足: ${source.id}`)
    source.anchors.forEach((anchor, i) => {
      if (anchor.image.some((v) => v < 0 || v > 1)) errors.push(`来源锚点图片坐标越界: ${source.id}#${i}`)
      if (!inBounds(anchor.pos, bounds)) errors.push(`来源锚点超出校园范围: ${source.id}#${i}`)
    })
  }
  const pairs = new Set<string>()
  for (const edge of map.edges) {
    if (!edge.id || Object.keys(edge).some((key) => !['id', 'a', 'b'].includes(key))) errors.push(`路段字段无效: ${edge.id}`)
    if (!nodeIds.has(edge.a) || !nodeIds.has(edge.b) || edge.a === edge.b) errors.push(`路段端点无效: ${edge.id}`)
    const pair = JSON.stringify([edge.a, edge.b].sort())
    if (pairs.has(pair)) errors.push(`重复路段: ${edge.id}`)
    pairs.add(pair)
  }
  for (const connector of map.connectors) {
    if (connector.node !== undefined && !nodeIds.has(connector.node)) errors.push(`连接点绑定无效: ${connector.id}`)
    if (!VALID_KINDS.has(connector.kind)) errors.push(`连接点 kind 无效: ${connector.id}`)
    if (!inBounds(connector.pos, bounds)) errors.push(`连接点超出校园范围: ${connector.id}`)
    if (connector.floorFrom === connector.floorTo) errors.push(`连接点楼层不能相同: ${connector.id}`)
  }
  for (const point of map.points ?? []) {
    if (!point.imageId?.trim()) errors.push(`街景点缺少图片 ID: ${point.id}`)
    else if (!isGuid(point.imageId)) errors.push(`街景点图片 ID 必须是 GUID: ${point.id}`)
    if (!nodeIds.has(point.endpointId1) || !nodeIds.has(point.endpointId2) || point.endpointId1 === point.endpointId2) errors.push(`街景点端点无效: ${point.id}`)
    const weightsValid = [point.endpointWeight1, point.endpointWeight2].every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)
    if (!weightsValid || Math.abs(point.endpointWeight1 + point.endpointWeight2 - 1) > 1e-6) errors.push(`街景点权重无效: ${point.id}`)
  }
  return errors
}
