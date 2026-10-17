import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateUndergroundGraph, runMigration } from './migrate-underground-graph.mjs'

const A = [121.6, 31.184], B = [121.601, 31.184], C = [121.602, 31.184]
function legacy() {
  return {
    version: 1, floor: -1, bounds: [A, C],
    sources: [{ id: 'drawing', image: '/plan.jpg', note: '图纸说明', anchors: [] }],
    nodes: [{ id: 'original-a', pos: A }, { id: 'original-b', pos: B }, { id: 'alias-b', pos: B }],
    roads: [
      { id: 'r1', path: [A, B, C], mode: 'car', direction: 'in', source: 'old', note: '丢弃道路说明' },
      { id: 'r2', path: [C, B, A, A], mode: 'walk', direction: 'out' },
    ],
    points: [{ id: 'photo', endpointId1: 'original-a', endpointWeight1: 0.5, endpointId2: 'alias-b', endpointWeight2: 0.5, imageId: 'img' }],
    connectors: [
      { id: 'on', kind: 'stairs', floorFrom: 0, floorTo: -1, pos: A, note: '连接点说明', source: 'field' },
      { id: 'off', kind: 'elevator', floorFrom: 0, floorTo: -1, pos: [121.601, 31.1842], note: '离路' },
    ],
  }
}

describe('地下图一次性迁移', () => {
  it('拆折点、跨道路共用坐标、去重无向边与自环，保留旧节点 ID 和图片点引用', () => {
    const input = legacy(), before = structuredClone(input), map = migrateUndergroundGraph(input)
    expect(map.version).toBe(2)
    expect(map.nodes).toHaveLength(4)
    expect(map.nodes.slice(0, 3)).toEqual(input.nodes)
    expect(map.edges).toHaveLength(2)
    expect(map.edges[0]).toMatchObject({ a: 'original-a', b: 'original-b' })
    expect(map.edges.every((e) => Object.keys(e).sort().join() === 'a,b,id')).toBe(true)
    expect(map).not.toHaveProperty('roads')
    expect(map.sources).toEqual(input.sources)
    expect(map.points).toEqual(input.points)
    expect(map.connectors[0]).toEqual({ ...input.connectors[0], node: 'original-a' })
    expect(map.connectors[1]).toEqual(input.connectors[1])
    expect(input).toEqual(before)
    expect(migrateUndergroundGraph(map)).toEqual(map)
  })
  it('历史真实样本可以转换且所有边引用存在，仅迁移测试读取旧格式', () => {
    const old = JSON.parse(readFileSync(new URL('../data/underground-sketch-backup-20261017.json', import.meta.url), 'utf8'))
    const map = migrateUndergroundGraph(old), ids = new Set(map.nodes.map((n) => n.id))
    expect(map.edges.length).toBeGreaterThan(0)
    expect(map.edges.every((e) => ids.has(e.a) && ids.has(e.b) && e.a !== e.b)).toBe(true)
    expect(map.sources).toEqual(old.sources)
    expect(map.connectors.map((c) => c.pos)).toEqual(old.connectors.map((c) => c.pos))
  })
  it('显式 JSON 目标默认预览，写入备份并支持重复执行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ug-migration-'))
    try {
      const path = join(dir, 'underground.json'), backup = join(dir, 'original.json'), original = JSON.stringify(legacy())
      writeFileSync(path, original)
      runMigration(['--json', path])
      expect(readFileSync(path, 'utf8')).toBe(original)
      runMigration(['--json', path, '--write', '--backup', backup])
      expect(readFileSync(backup, 'utf8')).toBe(original)
      const saved = readFileSync(path, 'utf8')
      runMigration(['--json', path, '--write'])
      expect(readFileSync(path, 'utf8')).toBe(saved)
      expect(() => runMigration(['--json', path, '--write', '--backup', backup])).toThrow()
      expect(() => runMigration([])).toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('数据库事务只修改 default 行，备份原行且预览无写入，转换失败保持原值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ug-db-migration-'))
    try {
      const path = join(dir, 'static.db'), backup = join(dir, 'original-row.json'), db = new DatabaseSync(path)
      db.exec('create table underground_maps (id text primary key, data text not null, updated_at integer not null); create table other (value text); insert into other values (\'keep\')')
      const original = JSON.stringify(legacy())
      db.prepare('insert into underground_maps values (?,?,?)').run('default', original, 123)
      db.close()
      runMigration(['--db', path])
      let check = new DatabaseSync(path)
      expect(check.prepare('select data from underground_maps').get().data).toBe(original)
      check.close()
      runMigration(['--db', path, '--write', '--backup', backup])
      expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual({ id: 'default', data: original, updated_at: 123 })
      check = new DatabaseSync(path)
      expect(JSON.parse(check.prepare('select data from underground_maps').get().data).version).toBe(2)
      expect(check.prepare('select * from other').get().value).toBe('keep')
      const bad = legacy(); bad.points[0].endpointId1 = 'missing'
      check.prepare('update underground_maps set data = ?').run(JSON.stringify(bad)); check.close()
      const failedBackup = join(dir, 'failed.json')
      expect(() => runMigration(['--db', path, '--write', '--backup', failedBackup])).toThrow('图片点引用无效')
      expect(existsSync(failedBackup)).toBe(false)
      check = new DatabaseSync(path)
      expect(JSON.parse(check.prepare('select data from underground_maps').get().data)).toEqual(bad)
      check.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('拒绝历史 map.db 和 backups 目录', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ug-protect-'))
    try {
      const path = join(dir, 'map.db')
      writeFileSync(path, '')
      expect(() => runMigration(['--db', path, '--write'])).toThrow('拒绝修改历史')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
