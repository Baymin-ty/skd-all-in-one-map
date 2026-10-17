import type { Building, I18nText, LngLat, PlaceCat } from './types'
import { outlinePoints } from './outlineGeometry'

/**
 * 同质化的楼（物质学院 1–8 号楼、信息学院 1–3 号楼、学生公寓、教授公寓）在地图上先合成一个标签，
 * 点开以后再显示各栋。按名字「X n号楼」归组；这四组在图上本来就挨在一起（相邻两栋都在 120 m 内）。
 */
export interface BuildingGroup {
  id: string
  name: I18nText
  cat: PlaceCat
  /** 按楼号排好的楼 id */
  members: string[]
  /** 合并标签的位置：各栋中心的平均 */
  center: LngLat
  /** 所有成员轮廓的顶点，用来算缩放范围 */
  points: LngLat[]
}

const NUMBERED = /^(.+?)(\d+)号楼/

export function groupBuildings(buildings: Building[]): BuildingGroup[] {
  const byPrefix = new Map<string, { n: number; b: Building }[]>()
  for (const b of buildings) {
    const m = NUMBERED.exec(b.name.zh)
    if (!m || b.walkway) continue
    byPrefix.set(m[1], [...(byPrefix.get(m[1]) ?? []), { n: Number(m[2]), b }])
  }
  const groups: BuildingGroup[] = []
  for (const [prefix, list] of byPrefix) {
    if (list.length < 2) continue
    list.sort((x, y) => x.n - y.n)
    const bs = list.map((x) => x.b)
    const avg = (k: 0 | 1) => +(bs.reduce((s, b) => s + b.center[k], 0) / bs.length).toFixed(6)
    groups.push({
      id: `g-${prefix}`,
      name: { zh: prefix, en: bs[0].name.en.replace(/\s*(Building\s*)?\d+.*$/, '') },
      cat: bs[0].cat,
      members: bs.map((b) => b.id),
      center: [avg(0), avg(1)],
      points: bs.flatMap(outlinePoints),
    })
  }
  return groups
}
