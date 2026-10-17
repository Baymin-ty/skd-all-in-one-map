// 将 static.db 中的公开地下地图快照导出到静态 JSON，不导出动态业务数据。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = resolve(process.argv[2] ?? process.env.STATIC_DB_PATH ?? join(root, 'server/static.db'))
const outputPath = resolve(process.argv[3] ?? join(root, 'public/data/underground.json'))
const db = new DatabaseSync(dbPath, { readOnly: true })
try {
  const row = db.prepare("SELECT data FROM underground_maps WHERE id = 'default'").get()
  if (!row) throw new Error('数据库缺少 underground_maps.default')
  const data = JSON.parse(row.data)
  const content = JSON.stringify(data) + '\n'
  let previous = ''
  try { previous = readFileSync(outputPath, 'utf8') } catch {}
  if (previous !== content) writeFileSync(outputPath, content)
  console.log(`已导出地下地图：${dbPath} → ${outputPath}`)
  console.log(`节点 ${data.nodes.length}，边 ${data.edges.length}，连接点 ${data.connectors.length}`)
} finally { db.close() }
