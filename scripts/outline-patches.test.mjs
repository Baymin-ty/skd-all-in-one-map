import { describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { applyOutlinePatches, planOutlinePatches } from './outline-patches.mjs'

const { patches, probes, reviewedCount, unchanged, added = [] } = JSON.parse(readFileSync(new URL('../data/building-outline-refinements.json', import.meta.url)))
const places = JSON.parse(readFileSync(new URL('../public/data/places.json', import.meta.url)))
const campus = JSON.parse(readFileSync(new URL('../public/data/campus.json', import.meta.url)))
const byId = new Map(places.buildings.map((b) => [b.id, b]))
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const on = (a, b, p) => cross(a, b, p) === 0 && p.every((v, j) => v >= Math.min(a[j], b[j]) && v <= Math.max(a[j], b[j]))
const intersects = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
function contains(poly, [x, y]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

describe('校对后的建筑轮廓', () => {
  it('建筑与新增楼体的修改记录和静态数据一致，非几何字段不变', () => {
    expect(places.buildings).toHaveLength(reviewedCount)
    expect(new Set([...patches, ...unchanged, ...added].map((p) => p.id)).size).toBe(reviewedCount)
    for (const patch of patches) {
      const current = byId.get(patch.id)
      expect(current, patch.name).toMatchObject(patch.after)
      const original = { ...current, ...patch.before }
      expect(applyOutlinePatches([original], patches)).toEqual([current])
    }
  })

  const shapes = [...places.buildings, ...campus.construction].flatMap((b) => [b, ...(b.parts ?? []).map((poly) => ({ name: b.name, poly }))])
  it.each(shapes)('$name.zh：坐标有效，轮廓无重复点、自交或零面积', (b) => {
    expect(b.poly.length).toBeGreaterThanOrEqual(3)
    expect(new Set(b.poly.map((p) => p.join(','))).size).toBe(b.poly.length)
    for (const p of b.poly) p.forEach((v, i) => {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(campus.bounds[0][i])
      expect(v).toBeLessThanOrEqual(campus.bounds[1][i])
    })
    // 与 API 一样使用六位小数；整数运算识别保存后发生的交叉。
    const ring = b.poly.map((p) => p.map((n) => Math.round(n * 1e6)))
    expect(Math.abs(ring.reduce((sum, p, i) => sum + cross(ring[0], p, ring[(i + 1) % ring.length]), 0))).toBeGreaterThan(0)
    for (let a = 0; a < ring.length; a++) for (let c = a + 2; c < ring.length; c++) {
      if (a === 0 && c === ring.length - 1) continue
      expect(intersects(ring[a], ring[(a + 1) % ring.length], ring[c], ring[(c + 1) % ring.length]), `${b.name.zh}: 边 ${a}/${c}`).toBe(false)
    }
  })

  it('标签在对应轮廓内，典型串选区域归属正确', () => {
    for (const patch of patches.filter((p) => p.after.center)) {
      expect(contains(patch.after.poly, patch.after.center), patch.name).toBe(true)
    }
    for (const { id } of added) {
      const building = byId.get(id)
      expect(contains(building.poly, building.center), building.name.zh).toBe(true)
    }
    for (const probe of probes) {
      const inBuilding = (id) => [byId.get(id).poly, ...(byId.get(id).parts ?? [])].some((ring) => contains(ring, probe.pos))
      for (const id of probe.inside) expect(inBuilding(id), `应选中 ${id}`).toBe(true)
      for (const id of probe.outside) expect(inBuilding(id), `不应选中 ${id}`).toBe(false)
    }
  })
})

describe('轮廓迁移', () => {
  it('早期已核对版本可以继续升级，其他手工修改仍保留冲突检查', () => {
    for (const patch of patches) for (const previous of patch.previous ?? []) {
      const original = { ...byId.get(patch.id), ...previous }
      expect(planOutlinePatches([original], [patch]).conflicts).toEqual([])
      expect(applyOutlinePatches([original], [patch])[0]).toMatchObject(patch.after)
    }
  })
  it('可重复运行，不复活已删除记录，不覆盖新增记录和管理员修改', () => {
    const patch = patches[0]
    const original = { ...byId.get(patch.id), ...patch.before, note: { zh: '后台的新备注' } }
    const added = { id: 'custom', poly: [[1, 2], [2, 3], [3, 1]] }
    const once = applyOutlinePatches([original, added], patches)
    expect(once).toHaveLength(2)
    expect(once[0].note).toEqual(original.note)
    expect(once[1]).toEqual(added)
    expect(applyOutlinePatches(once, patches)).toEqual(once)
    const modified = { ...original, poly: original.poly.map(([x, y]) => [x + 0.00001, y]) }
    expect(planOutlinePatches([modified], patches).conflicts).toEqual([modified.id])
    expect(() => applyOutlinePatches([modified], patches)).toThrow('未覆盖')
  })

  it('数据库默认只预览，写入前备份，重复执行不再写入', () => {
    const dir = mkdtempSync(join(tmpdir(), 'campus-outline-test-'))
    const path = join(dir, 'map.db')
    const db = new DatabaseSync(path)
    try {
      db.exec('create table buildings (id text primary key, data text not null, updated_at integer not null)')
      const patch = patches[0]
      const { id, ...original } = { ...byId.get(patch.id), ...patch.before, note: { zh: '保留后台备注' } }
      db.prepare('insert into buildings values (?, ?, ?)').run(id, JSON.stringify(original), 1)
      const run = (...args) => execFileSync(process.execPath, [resolve('scripts/apply-building-outlines.mjs'), path, ...args], { encoding: 'utf8' })
      run()
      expect(JSON.parse(db.prepare('select data from buildings').get().data)).toEqual(original)
      run('--write')
      const saved = db.prepare('select * from buildings').get()
      expect(JSON.parse(saved.data)).toEqual({ ...original, ...patch.after })
      const backup = JSON.parse(readFileSync(join(dir, 'backups', readdirSync(join(dir, 'backups'))[0])))
      expect(JSON.parse(backup.rows[0].data)).toEqual(original)
      run('--write')
      expect(db.prepare('select * from buildings').get()).toEqual(saved)
      expect(readdirSync(join(dir, 'backups'))).toHaveLength(1)
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
