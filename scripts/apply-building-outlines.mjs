// 默认只预览。加 --write 才更新已有数据库，保留其他后台数据，并先备份。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { planOutlinePatches } from './outline-patches.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const write = process.argv.includes('--write')
const path = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? join(root, 'server/map.db'))
if (!existsSync(path)) throw new Error(`数据库不存在：${path}`)
const { patches } = JSON.parse(readFileSync(join(root, 'data/building-outline-refinements.json'), 'utf8'))
const db = new DatabaseSync(path, { readOnly: !write })
db.exec('pragma busy_timeout = 5000')
if (write) db.exec('begin immediate')
try {
  const rows = db.prepare('select id, data, updated_at from buildings').all()
  const current = rows.map(({ id, data }) => ({ id, ...JSON.parse(data) }))
  const plan = planOutlinePatches(current, patches)
  if (plan.conflicts.length) throw new Error(`轮廓已有其他修改，整批未写入：${plan.conflicts.join(', ')}`)
  console.log(`${write ? '写入' : '预览'}：${plan.changed.length} 个地点需要更新`)
  if (write && plan.changed.length) {
    const folder = join(dirname(path), 'backups')
    mkdirSync(folder, { recursive: true })
    const backup = join(folder, `building-outlines-${Date.now()}.json`)
    writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), rows }, null, 2), { flag: 'wx' })
    const changed = new Set(plan.changed)
    const update = db.prepare('update buildings set data = ?, updated_at = ? where id = ?')
    for (const { id, ...data } of plan.buildings) if (changed.has(id)) update.run(JSON.stringify(data), Date.now(), id)
    console.log(`原始数据备份：${backup}`)
  }
  if (write) db.exec('commit')
} catch (error) {
  if (write) db.exec('rollback')
  throw error
} finally { db.close() }
