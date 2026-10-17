import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertOfficialResponse, fetchOfficialRecords, loadVenueResolver } from '../server/eventSync.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dateArg = (value, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value : fallback
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const shift = (days) => {
  const date = new Date(`${today}T00:00:00+08:00`)
  date.setTime(date.getTime() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}
const start = dateArg(process.argv[2], shift(-60))
const end = dateArg(process.argv[3], shift(60))
const output = resolve(root, process.argv[4] || 'data/official_events.latest.json')

const raw = await fetchOfficialRecords({ start, end })
const { events, warnings } = convertOfficialResponse({ data: raw }, loadVenueResolver(root))
if (!events.length) throw new Error('官网活动转换结果为空，未写入文件')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(events, null, 2) + '\n')
for (const warning of warnings) console.warn(warning)
console.log(`已保存 ${events.length} 场活动（${start} → ${end}）：${output}`)
