// 从赛前数据包生成网页用的数据：node scripts/prepare-data.mjs [datapack 目录]
// 只做三件事：标出风雨长廊、只留校内点位、复制瓦片。数据包原件不改。
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pack = resolve(process.argv[2] ?? join(root, '../上科大智慧地图_赛前准备包/datapack'))
if (!existsSync(join(pack, 'data/places.json'))) {
  console.error(`找不到数据包：${pack}`)
  process.exit(1)
}
const read = (f) => JSON.parse(readFileSync(join(pack, 'data', f), 'utf8'))
const places = read('places.json')
const campus = read('campus.json')

function pointInPoly([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// 那个近似位置的「风雨长廊」点位和两段长廊轮廓重复，删掉点位，把它的介绍挪到轮廓上
// （「位置为近似」说的是那个点位，轮廓是对着底图描的，去掉这半句）
const walkwayPoi = places.pois.find((p) => p.id === 'poi-walkway')
const walkwayInfo = walkwayPoi?.desc && {
  zh: walkwayPoi.desc.zh.replace('（位置为近似）', ''),
  en: walkwayPoi.desc.en.replace(' (approximate position)', ''),
}
const buildings = places.buildings.map((b) => {
  if (!b.name.zh.includes('风雨长廊')) return b
  return { ...b, walkway: true, info: b.info ?? walkwayInfo ?? null }
})

// 校外的公交站、地铁口、周边商场落在手绘底图外面，这一版不要
const pois = places.pois.filter((p) => p.id !== 'poi-walkway' && pointInPoly(p.pos, campus.boundary))

const out = join(root, 'public/data')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'places.json'), JSON.stringify({ categories: places.categories, buildings, pois }))
writeFileSync(join(out, 'campus.json'), JSON.stringify(campus))
cpSync(join(pack, 'tiles'), join(root, 'public/tiles'), { recursive: true })

console.log(`楼宇 ${buildings.length}（风雨长廊 ${buildings.filter((b) => b.walkway).length}），校内点位 ${pois.length}，瓦片已复制`)
