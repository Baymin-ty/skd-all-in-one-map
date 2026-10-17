import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { planPlaceCuration, planCanteenLocations } from './curate-places.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const write = process.argv.includes('--write')
const path = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? join(root, 'server/static.db'))
if (!existsSync(path)) throw new Error(`数据库不存在：${path}`)
const db = new DatabaseSync(path, { readOnly: !write })
db.exec('pragma busy_timeout = 5000')
if (write) db.exec('begin immediate')
try {
  const rows = Object.fromEntries(['buildings', 'pois'].map((table) => [table, db.prepare(`select id, data, updated_at from ${table}`).all()]))
  const places = Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values.map(({ id, data }) => ({ id, ...JSON.parse(data) }))]))
  const plan = planPlaceCuration(places)
  const hasCatalog = db.prepare("select 1 from sqlite_master where type='table' and name='discovery_catalog'").get()
  const catalogRow = hasCatalog && db.prepare("select kind, data from discovery_catalog where kind='canteens'").get()
  const dining = catalogRow ? planCanteenLocations(JSON.parse(catalogRow.data)) : { changed: [], conflicts: [] }
  const conflicts = [...plan.conflicts, ...dining.conflicts]
  if (conflicts.length) throw new Error(`地点或餐厅已有其他修改，整批未写入：${conflicts.join(', ')}`)
  console.log(`${write ? '写入' : '预览'}：整理 ${plan.removed.length} 个点位，其中 ${plan.added.length} 个升级为建筑；补充 ${plan.changed.length} 个地点的名称或介绍，校正 ${dining.changed.length} 个菜单位置`)
  if (write && (plan.removed.length || plan.changed.length || dining.changed.length)) {
    const folder = join(dirname(path), 'backups')
    mkdirSync(folder, { recursive: true })
    const backup = join(folder, `place-curation-${Date.now()}.json`)
    writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), rows, catalog: catalogRow || undefined }, null, 2), { flag: 'wx' })
    const update = db.prepare('update buildings set data = ?, updated_at = ? where id = ?')
    for (const { id, ...data } of plan.places.buildings) if (plan.changed.includes(id)) update.run(JSON.stringify(data), Date.now(), id)
    const updatePoi = db.prepare('update pois set data = ?, updated_at = ? where id = ?')
    for (const { id, ...data } of plan.places.pois) if (plan.changed.includes(id)) updatePoi.run(JSON.stringify(data), Date.now(), id)
    const insert = db.prepare('insert into buildings (id, data, updated_at) values (?, ?, ?)')
    for (const { id, ...data } of plan.places.buildings) if (plan.added.includes(id)) insert.run(id, JSON.stringify(data), Date.now())
    const remove = db.prepare('delete from pois where id = ?')
    for (const id of plan.removed) remove.run(id)
    if (dining.changed.length) db.prepare("update discovery_catalog set data = ? where kind = 'canteens'").run(JSON.stringify(dining.catalog))
    console.log(`原始数据备份：${backup}`)
  }
  if (write) db.exec('commit')
} catch (error) {
  if (write) db.exec('rollback')
  throw error
} finally { db.close() }
