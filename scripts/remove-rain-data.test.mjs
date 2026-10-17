import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { removeRainFields, runMigration } from './remove-rain-data.mjs'

describe('移除遮雨数据', () => {
  it('仅移除废弃属性，保留长廊几何、介绍及地下拓扑', () => {
    const input = { id: 'corridor', name: { en: 'Covered Walkway' }, poly: [[1, 2], [3, 4]], parts: [], walkway: true, covered: false, sheltered: true, coveredMeters: 30, routingCost: 50, nodes: [{ id: 'n', pos: [1, 2] }], edges: [], weather: { temperature: 20 }, info: '长廊' }
    const { walkway, covered, sheltered, coveredMeters, routingCost, ...expected } = input
    expect(removeRainFields(input)).toEqual(expected)
    expect(removeRainFields(removeRainFields(input))).toEqual(expected)
  })

  it('在线备份包含 WAL 已提交数据，幂等迁移不改变其他行/时间', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'remove-rain-'))
    const path = join(directory, 'static.db'), saved = join(directory, 'backup.db')
    const db = new DatabaseSync(path)
    try {
      db.exec('PRAGMA journal_mode = WAL')
      for (const table of ['buildings', 'pois', 'underground_maps']) db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)`)
      db.exec('CREATE TABLE meta(key TEXT, value TEXT)')
      db.prepare('INSERT INTO meta VALUES (?, ?)').run('map.settings', '{"selected":1}')
      const original = { id: 'w', walkway: true, poly: [[1, 2]], note: 'user edit' }
      db.prepare('INSERT INTO buildings VALUES (?, ?, ?)').run('w', JSON.stringify(original), 123)
      const topology = '{"version":2,"nodes":[{"id":"n","pos":[1,2]}],"edges":[],"connectors":[]}'
      db.prepare('INSERT INTO underground_maps VALUES (?, ?, ?)').run('default', topology, 456)
      expect(await runMigration(['--db', path])).toBe(1)
      expect(existsSync(saved)).toBe(false)
      expect(await runMigration(['--db', path, '--write', '--backup', saved])).toBe(1)
      const backup = new DatabaseSync(saved, { readOnly: true })
      try {
        expect(JSON.parse(backup.prepare('SELECT data FROM buildings').get().data)).toEqual(original)
        expect(backup.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
      } finally { backup.close() }
      expect(db.prepare('SELECT data, updated_at FROM buildings').get()).toEqual({ data: JSON.stringify({ id: 'w', poly: [[1, 2]], note: 'user edit' }), updated_at: 123 })
      expect(db.prepare('SELECT data, updated_at FROM underground_maps').get()).toEqual({ data: topology, updated_at: 456 })
      expect(db.prepare('SELECT value FROM meta').get().value).toBe('{"selected":1}')
      expect(await runMigration(['--db', path])).toBe(0)
      await expect(runMigration(['--db', path, '--write', '--backup', saved])).rejects.toThrow('全新')
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
