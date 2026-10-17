import { afterEach, beforeEach, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { databasePaths, MAP_META_KEYS, openDatabases } from './databases.mjs'

let directory, paths, connections
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'split-databases-'))
  paths = { legacyPath: join(directory, 'map.db'), dynamicPath: join(directory, 'dynamic.db'), staticPath: join(directory, 'static.db') }
  connections = []
})
afterEach(() => {
  for (const connection of connections.reverse()) connection.close()
  rmSync(directory, { recursive: true, force: true })
})
async function open() {
  const result = await openDatabases(paths)
  connections.push(result)
  return result
}
function fixture(path, label = 'old') {
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE buildings (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE pois (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE business (id INTEGER PRIMARY KEY, secret BLOB);
    INSERT INTO business VALUES (7, X'0001FF');`)
  db.prepare('INSERT INTO buildings VALUES (?, ?, ?)').run('b', JSON.stringify({ name: label }), 123)
  for (const key of MAP_META_KEYS) db.prepare('INSERT INTO meta VALUES (?, ?)').run(key, key.endsWith('seeded') ? '1' : label)
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('business.seeded', 'keep')
  return db
}
const hasTable = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)

test('online backup includes committed WAL, preserves business and source; retry is idempotent', async () => {
  const source = fixture(paths.legacyPath)
  connections.push(source)
  source.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;')
  source.prepare('INSERT INTO pois VALUES (?, ?, ?)').run('wal-only', '{}', 456)
  const before = readFileSync(paths.legacyPath)
  const walBefore = readFileSync(paths.legacyPath + '-wal')
  const { db, staticDb } = await open()
  expect(staticDb.prepare('SELECT id FROM pois').get().id).toBe('wal-only')
  expect(staticDb.prepare('SELECT updated_at FROM buildings').get().updated_at).toBe(123)
  expect(db.prepare('SELECT hex(secret) AS secret FROM business').get().secret).toBe('0001FF')
  expect(db.prepare('SELECT * FROM meta').all()).toEqual([{ key: 'business.seeded', value: 'keep' }])
  expect(hasTable(db, 'buildings')).toBe(false)
  expect(hasTable(db, 'pois')).toBe(false)
  expect(hasTable(staticDb, 'business')).toBe(false)
  expect(staticDb.prepare('SELECT count(*) AS n FROM meta').get().n).toBe(3)
  staticDb.exec('DELETE FROM buildings') // deliberate empty map must stay empty
  db.exec('INSERT INTO business VALUES (8, NULL)')
  connections.pop().close()
  const restarted = await open()
  expect(restarted.staticDb.prepare('SELECT * FROM buildings').all()).toEqual([])
  expect(restarted.db.prepare('SELECT count(*) AS n FROM business').get().n).toBe(2)
  expect(readFileSync(paths.legacyPath)).toEqual(before)
  expect(readFileSync(paths.legacyPath + '-wal')).toEqual(walBefore)
  expect(source.prepare('SELECT count(*) AS n FROM buildings').get().n).toBe(1)
})

test('empty installation creates only map tables in static and meta in dynamic', async () => {
  const { db, staticDb } = await open()
  expect(hasTable(db, 'buildings')).toBe(false)
  expect(staticDb.prepare('SELECT * FROM underground_maps').all()).toEqual([])
  expect(staticDb.prepare('SELECT * FROM meta').all()).toEqual([])
  expect(existsSync(paths.legacyPath)).toBe(false)
})

test('old underground meta migrates to the table and existing target wins', async () => {
  fixture(paths.legacyPath, 'legacy').close()
  const existing = fixture(paths.staticPath, 'new')
  existing.exec('CREATE TABLE underground_maps (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  existing.prepare('INSERT INTO underground_maps VALUES (?, ?, ?)').run('default', JSON.stringify({ target: true }), 1)
  existing.close()
  const { staticDb } = await open()
  expect(JSON.parse(staticDb.prepare("SELECT data FROM underground_maps WHERE id='default'").get().data)).toEqual({ target: true })
  expect(staticDb.prepare("SELECT 1 FROM meta WHERE key='underground.map'").get()).toBeUndefined()
})
test('empty legacy SQLite is migrated without modifying the source', async () => {
  new DatabaseSync(paths.legacyPath).close()
  const before = readFileSync(paths.legacyPath)
  const { db, staticDb } = await open()
  expect(db.prepare('SELECT * FROM meta').all()).toEqual([])
  expect(staticDb.prepare('SELECT * FROM buildings').all()).toEqual([])
  expect(readFileSync(paths.legacyPath)).toEqual(before)
})

test('existing static wins entirely over old source, including empty tables and settings', async () => {
  fixture(paths.legacyPath).close()
  const existing = fixture(paths.staticPath, 'new')
  existing.exec('DELETE FROM buildings; DROP TABLE business')
  existing.close()
  const { db, staticDb } = await open()
  expect(staticDb.prepare('SELECT * FROM buildings').all()).toEqual([])
  expect(staticDb.prepare("SELECT value FROM meta WHERE key='map.settings'").get().value).toBe('new')
  expect(db.prepare('SELECT id FROM business').get().id).toBe(7)
})

test('existing dynamic is authoritative and never reimported from legacy', async () => {
  fixture(paths.legacyPath, 'legacy').close()
  const dynamic = fixture(paths.dynamicPath, 'dynamic')
  dynamic.exec('INSERT INTO business VALUES (9, NULL)')
  dynamic.close()
  const { db, staticDb } = await open()
  expect(JSON.parse(staticDb.prepare('SELECT data FROM buildings').get().data).name).toBe('dynamic')
  expect(db.prepare('SELECT count(*) AS n FROM business').get().n).toBe(2)
})

test('invalid static rolls back cleanup; fixing it allows retry without losing business', async () => {
  fixture(paths.legacyPath).close()
  writeFileSync(paths.staticPath, 'not sqlite')
  await expect(openDatabases(paths)).rejects.toThrow()
  const dynamic = new DatabaseSync(paths.dynamicPath)
  expect(hasTable(dynamic, 'buildings')).toBe(true)
  expect(dynamic.prepare('SELECT id FROM business').get().id).toBe(7)
  dynamic.close()
  rmSync(paths.staticPath)
  const { staticDb } = await open()
  expect(staticDb.prepare('SELECT id FROM buildings').get().id).toBe('b')
})

test('failed source backup does not publish a partial dynamic and is retryable', async () => {
  writeFileSync(paths.legacyPath, 'not sqlite')
  await expect(openDatabases(paths)).rejects.toThrow()
  expect(existsSync(paths.dynamicPath)).toBe(false)
  rmSync(paths.legacyPath)
  fixture(paths.legacyPath).close()
  expect((await open()).db.prepare('SELECT id FROM business').get().id).toBe(7)
})

test('DB_PATH is an isolated dynamic alias; explicit paths win and collisions fail', async () => {
  const compatible = databasePaths({ DB_PATH: paths.dynamicPath })
  expect(compatible.dynamicPath).toBe(paths.dynamicPath)
  expect(compatible.staticPath).toBe(paths.dynamicPath + '.static.db')
  expect(compatible.legacyPath).toBeNull()
  expect(databasePaths({ DB_PATH: 'ignored', DYNAMIC_DB_PATH: paths.dynamicPath, STATIC_DB_PATH: paths.staticPath })).toEqual({ ...paths, legacyPath: null })
  await expect(openDatabases({ ...paths, staticPath: paths.dynamicPath })).rejects.toThrow('不同路径')
})
