// TEMP DEMO(indoor-503): 教学中心 → 物质学院1号楼 503 固定路线的室内“演出”段。整文件可直接删除。
import { ref } from 'vue'
import type { LngLat } from './types'
import { roomsForFloor } from './buildingExplorer'

export type StreetViewMinimap = { kind: 'map' } | { kind: 'plan'; src: string; label: string; highlight?: [number, number, number, number] }
export interface DemoStreetViewPoint { id: string; pos: LngLat; imageUrl: string; minimap?: StreetViewMinimap; stage?: string }

const BASE = '/demo/indoor-503'
const B1_PLAN: StreetViewMinimap = { kind: 'plan', src: '/data/spst-building-1-b1-plan-context.jpg', label: '1号楼 B1 平面总索引' }
const F5_PLAN: StreetViewMinimap = {
  kind: 'plan', src: '/data/spst-building-1-5f-plan-context.jpg', label: '1号楼 5F 平面总索引',
  highlight: roomsForFloor(5).find((r) => r.code === '503')?.rect,
}

/** 在地下最后一个街景点之后追加的室内点（pos 沿用最后一个地下点，小地图不会使用它）。 */
export function demoIndoor503Points(lastPos: LngLat): DemoStreetViewPoint[] {
  const b1 = Array.from({ length: 7 }, (_, i) => ({ id: `demo-503-b1-${i + 1}`, pos: lastPos, imageUrl: `${BASE}/b1-${i + 1}.jpg`, minimap: B1_PLAN, stage: '室内 B1' }))
  const f5 = Array.from({ length: 4 }, (_, i) => ({ id: `demo-503-5f-${i + 1}`, pos: lastPos, imageUrl: `${BASE}/5f-${i + 1}.jpg`, minimap: F5_PLAN, stage: '5F' }))
  return [...b1, ...f5]
}

export const DEMO_INDOOR_503_DESTINATION = '物质学院1号楼 503'
/** 是否正在显示“已到达目的地”浮层。 */
export const demoIndoor503Arrived = ref(false)
