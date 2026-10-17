import { existsSync, realpathSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'

// 精确删除已废弃的遮雨属性；不推断/转换区域、道路、坐标或其他用户字段。
const obsolete = new Set(['walkway', 'covered', 'sheltered', 'coveredMeters', 'routingCost', 'rain', 'rainPenalty', 'shelterPenalty', 'transitionPenaltyMeters', 'shortExposureMeters'])
export function removeRainFields(value) {
  if (Array.isArray(value)) return value.map(removeRainFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !obsolete.has(key)).map(([key, item]) => [key, removeRainFields(item)]))
}
function check(db) {
  const results = db.prepare('PRAGMA integrity_check').all()
  if (results.length !== 1 || Object.values(results[0])[0] !== 'ok') throw new Error(`完整性校验失败: ${JSON.stringify(results)}`)
}
export async function runMigration(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (['--db', '--json', '--backup'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = resolve(argv[++i])
    else throw new Error('用法: node scripts/remove-rain-data.mjs (--db static.db | --json places.json) [--write --backup NEW_PATH]')
  }
  if (!!options.db === !!options.json) throw new Error('必须显式指定一个 --db 或 --json')
  const target = realpathSync(options.db ?? options.json)
  if (options.db && basename(target).toLowerCase() !== 'static.db') throw new Error('只允许 static.db，不修改 map.db/dynamic.db')
  if (/(^|[\\/])backups([\\/]|$)/i.test(target)) throw new Error('不修改历史备份')
  if (options.write && (!options.backup || existsSync(options.backup) || options.backup === target)) throw new Error('写入必须指定全新的独立备份路径')
  if (options.json) {
    const original = readFileSync(target, 'utf8'), input = JSON.parse(original), output = removeRainFields(input)
    const changed = JSON.stringify(input) !== JSON.stringify(output)
    if (options.write && changed) {
      writeFileSync(options.backup, original, { flag: 'wx' })
      const temporary = `${target}.migrating-${process.pid}`
      writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
      renameSync(temporary, target)
    }
    console.log(`JSON: ${changed ? '移除遮雨字段' : '无变化'}`)
    return changed ? 1 : 0
  }
  const db = new DatabaseSync(target, { readOnly: !options.write })
  db.exec('PRAGMA busy_timeout = 10000')
  try {
    check(db)
    if (options.write) {
      // SQLite online backup 包含已提交 WAL 内容，禁止直接复制数据库主文件。
      await backup(db, options.backup)
      const saved = new DatabaseSync(options.backup, { readOnly: true })
      try { check(saved) } finally { saved.close() }
      db.exec('BEGIN IMMEDIATE')
    }
    let changed = 0
    for (const table of ['buildings', 'pois', 'underground_maps']) {
      for (const row of db.prepare(`SELECT id, data FROM ${table}`).all()) {
        const input = JSON.parse(row.data), output = removeRainFields(input)
        if (JSON.stringify(input) === JSON.stringify(output)) continue
        // 不改 updated_at；此次不是用户编辑，不改任何其他表或地下拓扑。
        if (options.write) db.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(output), row.id)
        changed++
      }
    }
    if (options.write) { check(db); db.exec('COMMIT'); check(db) }
    console.log(`${options.write ? '写入' : '预览'}: ${changed} 行移除遮雨字段`)
    return changed
  } catch (error) {
    if (options.write) { try { db.exec('ROLLBACK') } catch {} }
    throw error
  } finally { db.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runMigration(process.argv.slice(2))
