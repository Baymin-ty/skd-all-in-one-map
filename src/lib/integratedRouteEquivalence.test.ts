import { describe, expect, it } from 'vitest'
import { findRoute, findRoutesToMany, initRouting, routeLengthLowerBounds, type RouteResult, type Target } from './route'
import { findIntegratedRoute, type IntegratedRouteOptions } from './integratedRoute'
import { meters } from './measure'
import type { Campus, LngLat, UndergroundMap } from './types'
// 优化前实现的原样副本（逐个连接点调用 findRoute）
import { findRoute as legacyFindRoute, initRouting as legacyInit } from '../../test/legacy/route'
import { findIntegratedRoute as legacyFindIntegrated } from '../../test/legacy/integratedRoute'
import { buildingTarget, loadRealRouteData, rampConnectorPositions } from '../../test/realRouteData'

// 可复现的伪随机数
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 与 integratedRoute.lengthOf 相同的累加顺序
const lengthSum = (r: RouteResult) => r.segments.reduce((s, seg) => s + seg.path.reduce((m, p, i) => (i ? m + meters(seg.path[i - 1], p) : m), 0), 0)

function expectSame(next: RouteResult | null, old: RouteResult | null, label: string) {
  if (!old || !next) return expect(next, label).toBe(old)
  expect(Math.abs(next.meters - old.meters), label).toBeLessThanOrEqual(1e-6)
  expect(next.transitions, label).toEqual(old.transitions)
  expect(next.segments, label).toEqual(old.segments)
  expect(next, label).toEqual(old)
}

function initBoth(campus: Campus, extras: LngLat[] = []) {
  initRouting(campus, extras)
  legacyInit(campus, extras)
}

/** 基础原语：多终点搜索与逐个 findRoute 相同；反向下界不超过精确长度，且 Infinity ⇔ null。 */
function checkPrimitives(from: Target, to: Target, connectors: Target[], label: string) {
  const many = findRoutesToMany(from, [...connectors, to])
  ;[...connectors, to].forEach((t, k) => expectSame(many[k], legacyFindRoute(from, t), `${label} 正向#${k}`))
  const bounds = routeLengthLowerBounds(connectors, to)
  connectors.forEach((c, k) => {
    const exact = legacyFindRoute(c, to)
    expect(findRoute(c, to), `${label} findRoute#${k}`).toEqual(exact)
    if (!exact) return expect(bounds[k], `${label} 下界#${k}`).toBe(Infinity)
    expect(bounds[k], `${label} 下界#${k}`).toBeLessThanOrEqual(lengthSum(exact))
  })
}

describe('综合导航优化等价性（真实数据）', () => {
  const data = loadRealRouteData()
  const ug = data.underground
  const connectors = ug.connectors.filter((c) => (c.floorFrom === 0 && c.floorTo === ug.floor) || (c.floorTo === 0 && c.floorFrom === ug.floor))
  const grids: [string, Campus, LngLat[]][] = [['普通路网', data.campus, []]]
  if (data.rainGrid) grids.unshift(['避雨路网', { ...data.campus, grid: data.rainGrid }, rampConnectorPositions(ug)])
  const b = data.buildings
  const [[x0, y0], [x1, y1]] = data.campus.bounds

  for (const [name, campus, extras] of grids) {
    it(`${name}：随机楼栋/点位对的强制地下、非强制、固定出入口结果与旧实现一致`, () => {
      initBoth(campus, extras)
      const rand = rng(name.length * 7919)
      const pick = () => b[Math.floor(rand() * b.length)]
      // 一部分端点是校园范围内的随机点（含落在不可走格上的点，用于覆盖吸附逻辑）
      const randomTarget = (): Target => (rand() < 0.25 ? { point: [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)] } : buildingTarget(pick()))
      const cases: [Target, Target, IntegratedRouteOptions][] = []
      for (let k = 0; k < 40; k++) cases.push([randomTarget(), randomTarget(), { forceUnderground: true }])
      for (let k = 0; k < 12; k++) cases.push([randomTarget(), randomTarget(), {}])
      for (let k = 0; k < 10; k++) {
        const e = connectors[Math.floor(rand() * connectors.length)].id
        const x = connectors[Math.floor(rand() * connectors.length)].id
        cases.push([randomTarget(), randomTarget(), { forceUnderground: true, fixedUndergroundConnectors: { enterId: e, exitId: x } }])
      }
      let underground = 0
      cases.forEach(([from, to, options], k) => {
        const old = legacyFindIntegrated(from, to, ug, options)
        expectSame(findIntegratedRoute(from, to, ug, options), old, `${name} case#${k}`)
        if (old?.transitions.length) underground++
      })
      expect(underground).toBeGreaterThan(20)
    }, 60_000)

    it(`${name}：多终点搜索与反向下界`, () => {
      initBoth(campus, extras)
      const rand = rng(17 + name.length)
      const targets: Target[] = connectors.map((c) => ({ point: c.pos }))
      for (let k = 0; k < 8; k++) {
        const from = buildingTarget(b[Math.floor(rand() * b.length)])
        const to = buildingTarget(b[Math.floor(rand() * b.length)])
        checkPrimitives(from, to, targets, `${name}#${k}`)
      }
    }, 60_000)
  }

  it('教学中心 → 物质学院1号楼（避雨，含固定出入口）', () => {
    const [, campus, extras] = grids[0]
    initBoth(campus, extras)
    const find = (n: string) => buildingTarget(b.find((x) => x.name.zh === n)!)
    const from = find('教学中心'), to = find('物质学院1号楼')
    for (const options of [{ forceUnderground: true }, {}, { forceUnderground: true, fixedUndergroundConnectors: { enterId: 'ug-entrance-mvc8btwo15', exitId: 'ug-entrance-mvc8itpi2p' } }])
      expectSame(findIntegratedRoute(from, to, ug, options), legacyFindIntegrated(from, to, ug, options), JSON.stringify(options))
  })
})

describe('综合导航优化等价性（随机障碍小网格）', () => {
  it('随机网格、随机连接点（含网格外/不可达）与随机地下边', () => {
    const rand = rng(20261014)
    let compared = 0, withUnderground = 0
    for (let round = 0; round < 60; round++) {
      const size = 12 + Math.floor(rand() * 24)
      const wall = rand() * 0.45
      const rows = Array.from({ length: size }, () => Array.from({ length: size }, () => (rand() < wall ? '1' : '0')).join(''))
      const d = 0.0001
      const campus: Campus = {
        boundary: [[0, 0], [size * d, 0], [size * d, size * d], [0, size * d]],
        bounds: [[0, 0], [size * d, size * d]],
        grid: { x0: 0, y0: 30 + size * d, dx: d, dy: d * 0.9, rows },
      }
      const span = (k = 1.2) => (rand() * k - (k - 1) / 2) * size * d
      const pt = (): LngLat => [span(), 30 + span()]
      initBoth(campus)
      const nc = 2 + Math.floor(rand() * 7)
      const nodes = Array.from({ length: nc + 3 }, (_, i) => ({ id: `n${i}`, pos: pt() }))
      const edges = Array.from({ length: nc + 2 }, (_, i) => ({ id: `e${i}`, a: nodes[Math.floor(rand() * nodes.length)].id, b: nodes[Math.floor(rand() * nodes.length)].id }))
      const kinds = ['ramp', 'stairs', 'elevator'] as const
      const map: UndergroundMap = {
        version: 2, floor: -1, bounds: campus.bounds, sources: [], nodes, edges,
        connectors: Array.from({ length: nc }, (_, i) => ({ id: `c${i}`, floorFrom: 0, floorTo: -1, kind: kinds[i % 3], pos: rand() < 0.5 ? nodes[i].pos : pt() })),
      }
      const box = (): LngLat[] => { const [a, b] = [pt(), pt()]; return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] }
      const target = (): Target => {
        const r = rand()
        if (r < 0.5) return { point: pt() }
        if (r < 0.8) return { point: pt(), poly: box() }
        return { point: pt(), poly: box(), entrances: [pt(), pt()] }
      }
      for (let k = 0; k < 6; k++) {
        const from = target(), to = target()
        const options: IntegratedRouteOptions[] = [{ forceUnderground: true }, {}, { connectorSnapMeters: 200 }, { forceUnderground: true, fixedUndergroundConnectors: { enterId: `c${k % nc}`, exitId: `c${(k + 1) % nc}` } }]
        for (const o of options) {
          const old = legacyFindIntegrated(from, to, map, o)
          expectSame(findIntegratedRoute(from, to, map, o), old, `round ${round} #${k} ${JSON.stringify(o)}`)
          compared++
          if (old?.transitions.length) withUnderground++
        }
        checkPrimitives(from, to, map.connectors.map((c) => ({ point: c.pos })), `round ${round} #${k}`)
      }
    }
    expect(compared).toBe(60 * 6 * 4)
    expect(withUnderground).toBeGreaterThan(50)
  }, 60_000)
})
