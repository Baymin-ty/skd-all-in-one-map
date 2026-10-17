import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { findRoute, initRouting, routeWeatherCost, walkableCells } from './route'
import type { Campus, Places } from './types'

const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'))
const places = load<Places>('places.json')
const campus = load<Campus>('campus.json')
const byName = (zh: string) => places.buildings.find((b) => b.name.zh === zh)!
const target = (zh: string) => {
  const b = byName(zh)
  return { point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) }
}

beforeAll(() => initRouting(campus, places.buildings.filter((b) => b.walkway).map((b) => b.poly)))

describe('步行导航', () => {
  it('运行时只暴露一套路网，不区分 OSM 来源', () => {
    const cells = walkableCells()
    expect(cells.length).toBeGreaterThan(100)
    expect(cells.every((cell) => !('osm' in cell))).toBe(true)
  })

  it('两段风雨长廊下面都有可走的格子', () => {
    expect(walkableCells().filter((c) => c.covered).length).toBeGreaterThan(40)
  })

  it('路段首尾相接，总长等于各段之和', () => {
    const r = findRoute(target('西门 · 集慧路249号'), target('东门 · 中科路1号'))!
    expect(r).not.toBeNull()
    for (let i = 1; i < r.segments.length; i++) expect(r.segments[i].path[0]).toEqual(r.segments[i - 1].path.at(-1))
    expect(r.meters).toBeGreaterThan(500)
    expect(r.coveredMeters).toBeLessThanOrEqual(r.meters)
  })

  it('雨天模式会多走长廊，但不会绕太远', () => {
    const from = target('风雨长廊（西）').poly![0]
    const to = target('风雨长廊（东）').poly![4]
    const dry = findRoute({ point: from }, { point: to })!
    const rain = findRoute({ point: from }, { point: to }, true)!
    expect(rain.coveredMeters).toBeGreaterThan(dry.coveredMeters)
    expect(rain.coveredMeters).toBeGreaterThan(200)
    expect(rain.meters).toBeLessThan(dry.meters * 1.5)
  })

  it('到有入口的楼时走到入口为止', () => {
    const r = findRoute(target('图书馆'), target('学生公寓11号楼'))!
    const doors = byName('学生公寓11号楼').entrances!.map((e) => e.pos)
    expect(doors).toContainEqual(r.segments.at(-1)!.path.at(-1))
  })

  it('建筑边缘缓冲只作为轻微遮挡，不等同于风雨长廊', () => {
    const shelter: [number, number][] = [
      [121.6002, 31.1842], [121.6006, 31.1842], [121.6006, 31.1846], [121.6002, 31.1846],
    ]
    initRouting(campus, [], [shelter])
    const nearby = walkableCells().filter((cell) =>
      Math.abs(cell.pos[0] - 121.6004) < 0.0004 && Math.abs(cell.pos[1] - 31.1844) < 0.0004)
    expect(nearby.some((cell) => cell.sheltered && !cell.covered)).toBe(true)
    const path = nearby.slice(0, 2).map((cell) => cell.pos)
    const shelteredCost = routeWeatherCost([{ path, covered: false, sheltered: true, layer: 'surface' }], 0)
    expect(shelteredCost).toBeGreaterThan(
      routeWeatherCost([{ path, covered: true, layer: 'surface' }], 0),
    )
    expect(shelteredCost).toBeLessThan(routeWeatherCost([{ path, covered: false, layer: 'surface' }], 0))
    initRouting(campus, places.buildings.filter((b) => b.walkway).map((b) => b.poly))
  })
})
