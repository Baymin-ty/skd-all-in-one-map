import { readFileSync } from 'node:fs'
import { isDeepStrictEqual as same } from 'node:util'

const curation = JSON.parse(readFileSync(new URL('../data/place-curation.json', import.meta.url)))
const matchesSource = (poi, entry) => [entry.before, ...(entry.previous ?? [])].some((source) => same(poi, source))

/** 只合并明确对应且没有后续编辑的点位；新建和修改过的数据留给管理员核对。 */
export function planPlaceCuration(places) {
  const result = structuredClone(places), removed = [], changed = [], added = [], conflicts = []
  for (const entry of curation.promoted ?? []) {
    const poi = result.pois.find((p) => p.id === entry.id)
    const building = result.buildings.find((b) => b.id === entry.id)
    if (!poi) continue // 已迁移或已由管理员删除。
    if (!matchesSource(poi, entry) || building) {
      conflicts.push(entry.id); continue
    }
    result.buildings.push(structuredClone(entry.building)); added.push(entry.id)
    result.pois = result.pois.filter((p) => p.id !== entry.id); removed.push(entry.id)
  }
  for (const entry of curation.merged) {
    const poi = result.pois.find((p) => p.id === entry.id)
    if (!poi) continue
    const target = entry.kind === 'building' ? result.buildings.find((b) => b.id === entry.target)
      : entry.kind === 'poi' ? result.pois.find((p) => p.id === entry.target) : null
    const hasGroup = entry.kind === 'group' && result.buildings.some((b) => b.name.zh.startsWith(entry.target.slice(2)))
    if (!target && !hasGroup || !matchesSource(poi, entry)) {
      conflicts.push(entry.id); continue
    }
    // 介绍和营业信息有独立内容时，归入建筑详情；旧记录完整保存在合并清单和数据库备份。
    if (target) {
      const before = JSON.stringify(target)
      const names = new Set([target.name.zh, target.name.en, target.short?.zh, target.short?.en, ...(target.aliases ?? [])])
      target.aliases ??= []
      for (const name of [poi.name.zh, poi.name.en]) if (name && !names.has(name)) { target.aliases.push(name); names.add(name) }
      const description = entry.kind === 'poi' ? 'desc' : 'info'
      if (poi.desc?.zh && !target[description]?.zh) target[description] = poi.desc
      if (poi.hours?.zh && !target.hours?.zh) target.hours = poi.hours
      if (poi.source && !target.source) target.source = poi.source
      if (JSON.stringify(target) !== before) changed.push(target.id)
    }
    result.pois = result.pois.filter((p) => p.id !== entry.id)
    removed.push(entry.id)
  }
  for (const entry of curation.buildingNames ?? []) {
    const building = result.buildings.find((b) => b.id === entry.id)
    if (!building) continue
    const fields = Object.keys(entry.after).filter((key) => !same(building[key], entry.after[key]))
    if (fields.some((key) => !same(building[key], entry.before[key]))) { conflicts.push(entry.id); continue }
    if (!fields.length) continue
    Object.assign(building, structuredClone(entry.after))
    building.aliases = [...new Set([...(building.aliases ?? []), ...entry.aliases])]
      .filter((name) => name && name !== building.name.zh && name !== building.name.en)
    changed.push(entry.id)
  }
  return { places: result, removed, added, changed: [...new Set(changed)], conflicts }
}

export function curatePlaces(places) {
  const plan = planPlaceCuration(places)
  if (plan.conflicts.length) throw new Error(`重复点位已有修改或目标缺失，未覆盖：${plan.conflicts.join(', ')}`)
  return plan.places
}

/** 仅同步已确认地点的坐标，保留数据库中的菜品、价格和后续菜单编辑。 */
export function planCanteenLocations(catalog) {
  const result = structuredClone(catalog), changed = [], conflicts = []
  for (const entry of curation.diningLocations ?? []) {
    const canteen = result.canteens.find((c) => c.id === entry.id)
    if (!canteen) continue
    const fields = Object.keys(entry.after).filter((key) => !same(canteen[key], entry.after[key]))
    if (canteen.place !== entry.place || fields.some((key) => !same(canteen[key], entry.before[key]))) {
      conflicts.push(entry.id); continue
    }
    const aliases = [...new Set([...(canteen.aliases ?? []), ...(entry.aliases ?? [])])]
    if (!fields.length && same(aliases, canteen.aliases ?? [])) continue
    Object.assign(canteen, structuredClone(entry.after))
    if (aliases.length) canteen.aliases = aliases
    changed.push(entry.id)
  }
  return { catalog: result, changed, conflicts }
}
