// 避雨模式（forceUnderground）综合导航基准：npx vitest bench --run test/integratedRoute.bench.ts
import { bench, describe } from 'vitest'
import { findRoute, initRouting, type Target } from '../src/lib/route'
import { findIntegratedRoute, type IntegratedRouteOptions } from '../src/lib/integratedRoute'
import { findRoute as legacyFindRoute, initRouting as legacyInit } from './legacy/route'
import { findIntegratedRoute as legacyFind } from './legacy/integratedRoute'
import { buildingTarget, findBuilding, loadRealRouteData, rampConnectorPositions } from './realRouteData'

const data = loadRealRouteData()
const rainCampus = data.rainGrid ? { ...data.campus, grid: data.rainGrid } : data.campus
const extras = rampConnectorPositions(data.underground)
initRouting(rainCampus, extras)
legacyInit(rainCampus, extras)

const PAIRS: [string, string][] = [
  ['教学中心', '物质学院1号楼'],
  ['图书馆', '学生公寓1号楼'],
  ['信息学院1号楼', '白玉兰食堂'],
  ['体育馆', '行政中心'],
  ['学生公寓11号楼', '生命学院 · L楼'],
]
const cases: { name: string; from: Target; to: Target; options: IntegratedRouteOptions }[] = PAIRS.map(([a, b]) => ({
  name: `${a} → ${b}`,
  from: buildingTarget(findBuilding(data.buildings, a)),
  to: buildingTarget(findBuilding(data.buildings, b)),
  options: { forceUnderground: true },
}))
// 固定出入口（store 中教学中心 → 物质1 503 的路线覆盖）
cases.push({ ...cases[0], name: `${cases[0].name}（固定出入口）`, options: { forceUnderground: true, fixedUndergroundConnectors: { enterId: 'ug-entrance-mvc8btwo15', exitId: 'ug-entrance-mvc8itpi2p' } } })
// 非强制：地面直达与地下候选比较
cases.push({ ...cases[1], name: `${cases[1].name}（非强制比较）`, options: {} })

// 单次 findRoute（Dijkstra 本身的微优化）
describe(`findRoute 单次：${cases[1].name}`, () => {
  bench('legacy', () => { legacyFindRoute(cases[1].from, cases[1].to) }, { time: 1000 })
  bench('current', () => { findRoute(cases[1].from, cases[1].to) }, { time: 1000 })
})

for (const c of cases) {
  describe(c.name, () => {
    bench('legacy', () => { legacyFind(c.from, c.to, data.underground, c.options) }, { time: 1500, warmupIterations: 2 })
    bench('current', () => { findIntegratedRoute(c.from, c.to, data.underground, c.options) }, { time: 1500, warmupIterations: 2 })
  })
}
