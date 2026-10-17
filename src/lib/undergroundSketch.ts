import { graphFromMap, graphToMap, importSketch } from './undergroundGraph'
import type { LngLat, UndergroundMap } from './types'

/** 按几何位置复用节点、去重无向边；草稿成功保存后由后台消费本机草稿。 */
export function mergeUndergroundSketch(map: UndergroundMap, paths: LngLat[][]): UndergroundMap {
  const graph = graphFromMap(map)
  importSketch(graph, paths)
  return graphToMap(graph, map)
}
