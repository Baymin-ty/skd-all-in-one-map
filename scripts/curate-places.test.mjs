import { describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { curatePlaces, planPlaceCuration, planCanteenLocations } from './curate-places.mjs'

const curation = JSON.parse(readFileSync(new URL('../data/place-curation.json', import.meta.url)))
const current = JSON.parse(readFileSync(new URL('../public/data/places.json', import.meta.url)))
function source() {
  const input = structuredClone(current)
  input.buildings = input.buildings.filter((b) => !curation.promoted.some((p) => p.id === b.id))
  for (const entry of curation.buildingNames) Object.assign(input.buildings.find((b) => b.id === entry.id), entry.before)
  const entries = [...curation.merged, ...curation.promoted]
  input.pois = input.pois.filter((p) => !entries.some((e) => e.id === p.id))
  input.pois.push(...entries.map((e) => structuredClone(e.before)))
  return input
}
describe('地点整理与迁移', () => {
  it('合并旧点位、保留资料，将独立楼体升级为建筑；重复运行无变化', () => {
    const input = source(), once = curatePlaces(input)
    for (const entry of curation.merged) expect(once.pois.some((p) => p.id === entry.id)).toBe(false)
    for (const entry of curation.promoted) {
      expect(once.pois.some((p) => p.id === entry.id)).toBe(false)
      expect(once.buildings.find((b) => b.id === entry.id)).toEqual(entry.building)
    }
    expect(once.buildings.find((b) => b.id === 'c678e4ab').hours.zh).toContain('8:30')
    expect(once.buildings.find((p) => p.id === '5149e81e').aliases).toContain('科大咖啡馆')
    expect(curatePlaces(once)).toEqual(once)
    expect(curatePlaces(current)).toEqual(current)
  })
  it('保留管理员资料，不恢复已删地点；来源已变更时报告冲突', () => {
    const input = source()
    input.buildings[0].note = { zh: '管理员的新备注' }
    input.pois = input.pois.filter((p) => p.id !== 'c678e4ab')
    const result = curatePlaces(input)
    expect(result.buildings[0].note).toEqual(input.buildings[0].note)
    expect(result.buildings.some((b) => b.id === 'c678e4ab')).toBe(false)
    const changed = source()
    changed.pois.find((p) => p.id === curation.merged[0].id).desc = { zh: '刚更新的独立资料', en: '' }
    expect(planPlaceCuration(changed).conflicts).toContain(curation.merged[0].id)
    expect(() => curatePlaces(changed)).toThrow('未覆盖')
    const extra = source()
    extra.pois.find((p) => p.id === '5149e81e').note = { zh: '新补充资料' }
    expect(planPlaceCuration(extra).conflicts).toContain('5149e81e')
  })
  it('先前合并后的咖啡馆仍可升级，保留旧名并只对应最左侧小楼', () => {
    const entry = curation.promoted.find((p) => p.id === '5149e81e')
    const input = source()
    input.pois = input.pois.filter((p) => !['5149e81e', '03953523'].includes(p.id))
    input.pois.push(structuredClone(entry.previous[0]))
    const result = curatePlaces(input)
    expect(result.buildings.find((b) => b.id === entry.id)).toEqual(entry.building)
    expect(result.pois.some((p) => ['5149e81e', '03953523'].includes(p.id))).toBe(false)
  })
  it('菜单位置更新保留菜单和新别名，拒绝覆盖管理员移动的位置', () => {
    const patch = curation.diningLocations.find((c) => c.id === 'nestart')
    const input = { canteens: [{ id: patch.id, place: patch.place, ...patch.before, aliases: ['管理员补充的名称'], outlets: [{ dishes: [{ zh: '新菜品', price: 23 }] }] }] }
    const plan = planCanteenLocations(input)
    expect(plan.conflicts).toEqual([])
    expect(plan.catalog.canteens[0].outlets).toEqual(input.canteens[0].outlets)
    expect(plan.catalog.canteens[0].aliases).toContain('管理员补充的名称')
    expect(plan.catalog.canteens[0].pos).toEqual(patch.after.pos)
    expect(planCanteenLocations(plan.catalog).changed).toEqual([])
    input.canteens[0].pos = [121.6, 31.18]
    expect(planCanteenLocations(input).conflicts).toEqual(['nestart'])
  })
  it('数据库预览不写入，迁移前完整备份，已迁移数据库不重复更新', () => {
    const directory = mkdtempSync(join(tmpdir(), 'campus-curation-')), path = join(directory, 'map.db')
    const db = new DatabaseSync(path), input = source()
    try {
      for (const table of ['buildings', 'pois']) {
        db.exec(`create table ${table} (id text primary key, data text not null, updated_at integer not null)`)
        const insert = db.prepare(`insert into ${table} values (?, ?, ?)`)
        for (const { id, ...data } of input[table]) insert.run(id, JSON.stringify(data), 1)
      }
      const catalog = { canteens: curation.diningLocations.map((p) => ({ id: p.id, place: p.place, ...p.before, outlets: [{ dishes: [{ zh: '保留现有菜品', price: 23 }] }] })) }
      db.exec('create table discovery_catalog (kind text primary key, data text not null)')
      db.prepare('insert into discovery_catalog values (?, ?)').run('canteens', JSON.stringify(catalog))
      const readCatalog = () => JSON.parse(db.prepare("select data from discovery_catalog where kind='canteens'").get().data)
      const rows = () => ['buildings', 'pois'].map((table) => db.prepare(`select * from ${table} order by id`).all())
      const before = rows()
      const run = (...args) => execFileSync(process.execPath, [resolve('scripts/apply-place-curation.mjs'), path, ...args])
      run(); expect(rows()).toEqual(before)
      expect(readCatalog()).toEqual(catalog)
      run('--write')
      expect(db.prepare('select count(*) as n from buildings').get().n).toBe(current.buildings.length)
      expect(db.prepare('select count(*) as n from pois').get().n).toBe(current.pois.length)
      const backup = JSON.parse(readFileSync(join(directory, 'backups', readdirSync(join(directory, 'backups'))[0])))
      expect(backup.rows.pois).toHaveLength(input.pois.length)
      expect(JSON.parse(backup.catalog.data)).toEqual(catalog)
      expect(readCatalog()).toEqual(planCanteenLocations(catalog).catalog)
      const after = rows(); run('--write'); expect(rows()).toEqual(after)
      expect(readdirSync(join(directory, 'backups'))).toHaveLength(1)
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
