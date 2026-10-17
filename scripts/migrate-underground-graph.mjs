import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const positionKey = (pos) => {
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every(Number.isFinite)) throw new Error('无效节点坐标')
  return JSON.stringify(pos)
}

/** 一次性 v1 → v2 转换；已有节点 ID 和图片点引用始终保留。 */
export function migrateUndergroundGraph(input) {
  if (input.version === 2) return structuredClone(input)
  if (input.version !== 1 || !Array.isArray(input.roads)) throw new Error('需要 version 1 roads 数据')
  const used = new Set([...(input.connectors ?? []), ...(input.points ?? [])].map((x) => x.id))
  const byPosition = new Map(), nodes = [], edges = [], pairs = new Set()
  let sequence = 0
  const freshId = (prefix) => {
    let id
    do { id = `${prefix}-${++sequence}` } while (used.has(id))
    used.add(id); return id
  }
  for (const n of input.nodes ?? []) {
    if (!n.id || used.has(n.id)) throw new Error(`重复或空节点 ID: ${n.id}`)
    used.add(n.id)
    nodes.push({ id: n.id, pos: [...n.pos] })
    const key = positionKey(n.pos)
    if (!byPosition.has(key)) byPosition.set(key, n.id)
  }
  const nodeFor = (pos) => {
    const key = positionKey(pos)
    if (!byPosition.has(key)) {
      const id = freshId('ug-node')
      nodes.push({ id, pos: [...pos] }); byPosition.set(key, id)
    }
    return byPosition.get(key)
  }
  for (const road of input.roads) {
    if (!Array.isArray(road.path) || road.path.length < 2) throw new Error(`道路折点不足: ${road.id}`)
    const ids = road.path.map(nodeFor)
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1], b = ids[i], pair = JSON.stringify([a, b].sort())
      if (a === b || pairs.has(pair)) continue
      pairs.add(pair); edges.push({ id: freshId('ug-edge'), a, b })
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id))
  const connectors = (input.connectors ?? []).map((c) => {
    const result = structuredClone(c)
    // 仅恢复旧编辑器的精确重合绑定；离路连接点的位置保持不变。
    const bound = c.node ?? byPosition.get(positionKey(c.pos))
    if (bound) {
      if (!nodeIds.has(bound)) throw new Error(`连接点引用不存在: ${c.id}`)
      result.node = bound
    }
    return result
  })
  for (const p of input.points ?? []) if (!nodeIds.has(p.endpointId1) || !nodeIds.has(p.endpointId2) || p.endpointId1 === p.endpointId2) throw new Error(`图片点引用无效: ${p.id}`)
  return {
    version: 2, floor: input.floor, bounds: structuredClone(input.bounds),
    sources: structuredClone(input.sources ?? []), nodes, edges, connectors,
    points: structuredClone(input.points ?? []),
  }
}

/** 无默认目标，默认只预览；数据库事务内只更新 default 整图行。备份为原始 JSON 行。 */
export function runMigration(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') options.write = true
    else if (['--db', '--json', '--backup'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[arg.slice(2)] = resolve(argv[++i])
    else throw new Error('用法: node scripts/migrate-underground-graph.mjs (--db PATH | --json PATH) [--write] [--backup PATH]')
  }
  if (!!options.db === !!options.json) throw new Error('必须显式指定一个 --db 或 --json')
  const target = options.db ?? options.json
  const real = realpathSync(target)
  if (basename(real).toLowerCase() === 'map.db' || /(^|[\\/])backups([\\/]|$)/i.test(real)) throw new Error('拒绝修改历史 map.db/backups')
  if (options.backup && (resolve(options.backup) === target || existsSync(options.backup))) throw new Error('备份路径必须是新的独立文件')
  let db
  try {
    if (options.db) {
      db = new DatabaseSync(target, { readOnly: !options.write })
      db.exec('pragma busy_timeout = 5000')
      if (options.write) db.exec('begin immediate')
    }
    const row = db?.prepare("select data, updated_at from underground_maps where id = 'default'").get()
    if (db && !row) throw new Error('未找到地下整图 default 行')
    const original = row ? row.data : readFileSync(target, 'utf8')
    const input = JSON.parse(original), output = migrateUndergroundGraph(input)
    const changed = input.version !== 2
    if (options.write && changed) {
      if (options.backup) writeFileSync(options.backup, row ? JSON.stringify({ id: 'default', ...row }, null, 2) : original, { flag: 'wx' })
      if (db) db.prepare("update underground_maps set data = ?, updated_at = ? where id = 'default'").run(JSON.stringify(output), Date.now())
      else {
        const temporary = `${target}.migrating-${process.pid}`
        try { writeFileSync(temporary, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' }); renameSync(temporary, target) }
        finally { if (existsSync(temporary)) unlinkSync(temporary) }
      }
    }
    if (db && options.write) db.exec('commit')
    console.log(`${options.write ? '写入' : '预览'}: ${changed ? 'v1 → v2' : '已为 v2，无变化'}，${output.nodes.length} 节点，${output.edges.length} 双向边`)
    return output
  } catch (error) {
    if (db && options.write) { try { db.exec('rollback') } catch {} }
    throw error
  } finally { db?.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runMigration(process.argv.slice(2))
