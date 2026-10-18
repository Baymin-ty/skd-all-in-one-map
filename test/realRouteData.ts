// 读取真实校园数据（与 store.loadData 的来源优先级一致），供基准与等价性测试使用。
import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mergeUndergroundSketch } from '../src/lib/undergroundSketch'
import type { Target } from '../src/lib/route'
import type { Building, Campus, LngLat, UndergroundMap } from '../src/lib/types'

const root = join(import.meta.dirname, '..')
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), 'utf8')) as T

function openStatic(): DatabaseSync | null {
  const file = join(root, 'server/static.db')
  return existsSync(file) ? new DatabaseSync(file, { readOnly: true }) : null
}

export interface RealRouteData {
  campus: Campus
  /** 避雨路网（static.db surface_networks.rain），没有则为 null */
  rainGrid: Campus['grid'] | null
  underground: UndergroundMap
  buildings: Building[]
}

export function loadRealRouteData(): RealRouteData {
  const campus = readJson<Campus>('public/data/campus.json')
  const db = openStatic()
  // 地下：优先 /api/underground 的数据源（static.db），否则 public/data/underground.json
  const row = db?.prepare('select data from underground_maps where id = ?').get('default') as { data: string } | undefined
  const raw: UndergroundMap = row ? JSON.parse(row.data) : readJson<UndergroundMap>('public/data/underground.json')
  const underground = mergeUndergroundSketch(raw, [])
  const rain = db?.prepare('select data from surface_networks where id = ?').get('rain') as { data: string } | undefined
  const rainGrid = rain ? (JSON.parse(rain.data) as Campus['grid']) : null
  // 楼栋：优先 /api/places 的数据源（static.db），否则 public/data/places.json
  const rows = db?.prepare('select id, data from buildings order by rowid').all() as { id: string; data: string }[] | undefined
  const buildings: Building[] = rows?.length ? rows.map((r) => ({ id: r.id, ...JSON.parse(r.data) })) : readJson<{ buildings: Building[] }>('public/data/places.json').buildings
  db?.close()
  return { campus, rainGrid, underground, buildings }
}

/** 与 store.rampConnectorPositions 一致：避雨模式把车库坡道视为可走 */
export function rampConnectorPositions(underground: UndergroundMap): LngLat[] {
  return underground.connectors
    .filter((c) => c.kind === 'ramp' && ((c.floorFrom === 0 && c.floorTo === underground.floor) || (c.floorTo === 0 && c.floorFrom === underground.floor)))
    .map((c) => c.pos)
}

/** 与 store.endFor 一致的楼栋端点 */
export function buildingTarget(b: Building): Target {
  return { point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) }
}

export function findBuilding(buildings: Building[], name: string): Building {
  const b = buildings.find((x) => x.name.zh === name || x.short?.zh === name || x.aliases?.includes(name))
  if (!b) throw new Error(`找不到楼栋：${name}`)
  return b
}
