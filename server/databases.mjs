// 第一阶段拆库：业务模块继续使用 db，地图模块使用 staticDb。
import { DatabaseSync, backup } from 'node:sqlite'
import { existsSync, linkSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const MAP_META_KEYS = ['pois.seeded', 'buildings.seeded', 'underground.map', 'map.settings']
const undergroundMapTable = 'underground_maps'
const metaSchema = 'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'
const mapSchema = `${metaSchema}
  CREATE TABLE IF NOT EXISTS pois (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS buildings (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ${undergroundMapTable} (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);`
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)

export function databasePaths(env = process.env) {
  const dynamicPath = resolve(env.DYNAMIC_DB_PATH ?? env.DB_PATH ?? join(here, 'dynamic.db'))
  return {
    dynamicPath,
    // 自定义业务库默认配套独立地图库，不读取/污染项目真实库（包括旧 DB_PATH 测试）。
    staticPath: resolve(env.STATIC_DB_PATH ?? ((env.DYNAMIC_DB_PATH || env.DB_PATH) ? `${dynamicPath}.static.db` : join(here, 'static.db'))),
    legacyPath: (env.DYNAMIC_DB_PATH || env.DB_PATH) ? null : join(here, 'map.db'),
  }
}

function removeTemporary(path) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true })
}
// 同目录临时文件 + 不覆盖的原子发布。中途退出只会遗留无效命名的临时文件，
// 永远不会让下一次启动将半成品 dynamic.db 当作完整业务库。
function publish(temp, target) {
  try { linkSync(temp, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
}

export async function openDatabases(options = databasePaths()) {
  const dynamicPath = resolve(options.dynamicPath)
  const staticPath = resolve(options.staticPath)
  const legacyPath = options.legacyPath ? resolve(options.legacyPath) : null
  const identity = (path) => existsSync(path) ? realpathSync(path).toLowerCase() : path.toLowerCase()
  if (identity(dynamicPath) === identity(staticPath) || (legacyPath && [dynamicPath, staticPath].some((path) => identity(path) === identity(legacyPath)))) {
    throw new Error('static、dynamic 和旧源数据库必须使用不同路径')
  }
  for (const path of [dynamicPath, staticPath]) mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(dynamicPath)) {
    const temp = `${dynamicPath}.${randomUUID()}.migrating`
    let source, fresh
    try {
      if (legacyPath && existsSync(legacyPath)) {
        source = new DatabaseSync(legacyPath, { readOnly: true })
        // SQLite online backup 包含已提交 WAL，绝不能直接复制运行库的主文件。
        await backup(source, temp)
        source.close(); source = null
      }
      fresh = new DatabaseSync(temp)
      fresh.exec('PRAGMA journal_mode = DELETE;')
      fresh.exec(metaSchema)
      fresh.close(); fresh = null
      publish(temp, dynamicPath)
    } finally {
      source?.close(); fresh?.close()
      removeTemporary(temp)
    }
  }
  let db, staticDb
  try {
    db = new DatabaseSync(dynamicPath)
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(metaSchema)
      const staticExisted = existsSync(staticPath)
      if (!staticExisted) {
        const temp = `${staticPath}.${randomUUID()}.migrating`
        let target
        try {
          target = new DatabaseSync(temp)
          target.exec(mapSchema)
          target.exec('BEGIN IMMEDIATE')
          for (const table of ['pois', 'buildings']) {
            if (!hasTable(db, table)) continue
            const insert = target.prepare(`INSERT INTO ${table} (id, data, updated_at) VALUES (?, ?, ?)`)
            for (const row of db.prepare(`SELECT id, data, updated_at FROM ${table} ORDER BY rowid`).all()) insert.run(row.id, row.data, row.updated_at)
          }
          const insert = target.prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
          for (const key of MAP_META_KEYS) {
            const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key)
            if (row) insert.run(key, row.value)
          }
          target.exec('COMMIT')
          target.close(); target = null
          publish(temp, staticPath)
        } finally {
          target?.close()
          removeTemporary(temp)
        }
      }
      // static 一经发布即为权威，包括刻意清空的地图；重试不得从旧源覆盖。
      staticDb = new DatabaseSync(staticPath)
      staticDb.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
      staticDb.exec(mapSchema)
      // underground.map 是旧版单值 meta。目标表优先：只有目标不存在时才迁移旧值，
      // 且每次删除旧 key 前都已成功写入目标，重启重试不会覆盖用户数据。
      staticDb.exec('BEGIN IMMEDIATE')
      try {
        const target = staticDb.prepare(`SELECT id FROM ${undergroundMapTable} WHERE id=?`).get('default')
        const oldStatic = staticDb.prepare('SELECT value FROM meta WHERE key=?').get('underground.map')
        if (!target && oldStatic) {
          staticDb.prepare(`INSERT INTO ${undergroundMapTable} (id, data, updated_at) VALUES (?, ?, ?)`).run('default', oldStatic.value, Date.now())
        }
        if (oldStatic) staticDb.prepare('DELETE FROM meta WHERE key=?').run('underground.map')
        const migrated = staticDb.prepare(`SELECT id FROM ${undergroundMapTable} WHERE id=?`).get('default')
        const oldDynamic = db.prepare('SELECT value FROM meta WHERE key=?').get('underground.map')
        if (!migrated && !staticExisted && oldDynamic) {
          staticDb.prepare(`INSERT INTO ${undergroundMapTable} (id, data, updated_at) VALUES (?, ?, ?)`).run('default', oldDynamic.value, Date.now())
        }
        staticDb.exec('COMMIT')
      } catch (error) { staticDb.exec('ROLLBACK'); throw error }
      // 打开/验证 static 成功后才能清理 dynamic；失败回滚，重启可继续。
      for (const table of ['pois', 'buildings']) db.exec(`DROP TABLE IF EXISTS ${table}`)
      for (const key of MAP_META_KEYS) db.prepare('DELETE FROM meta WHERE key=?').run(key)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    return {
      db, staticDb,
      close() { try { staticDb.close() } finally { db.close() } },
    }
  } catch (error) { try { staticDb?.close() } finally { db?.close() }; throw error }
}
