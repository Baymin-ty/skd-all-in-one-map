// 将运行时数据库中的公开地图数据同步回静态文件，不导出账号、社区和活动运行时数据。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = resolve(process.argv[2] ?? process.env.DB_PATH ?? join(root, 'server/map.db'))
const db = new DatabaseSync(dbPath)

const writeIfChanged = (path, content) => {
  let previous = ''
  try { previous = readFileSync(path, 'utf8') } catch {}
  if (previous !== content) writeFileSync(path, content)
}

const readMeta = (key) => {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  if (!row) throw new Error(`数据库缺少 ${key}`)
  return JSON.parse(row.value)
}

const underground = readMeta('underground.map')
writeIfChanged(join(root, 'public/data/underground.json'), JSON.stringify(underground) + '\n')

console.log(`已导出地图快照：${dbPath}`)
console.log(`地下道路 ${underground.roads.length}，连接点 ${underground.connectors.length}`)
db.close()
