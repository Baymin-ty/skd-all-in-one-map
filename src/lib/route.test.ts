import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { findRoute, initRouting, walkableCells } from './route'
import { meters } from './measure'
import type { Campus, Places } from './types'

const load = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'))
const places = load<Places>('places.json')
const campus = load<Campus>('campus.json')
const byName = (zh: string) => places.buildings.find((b) => b.name.zh === zh)!
const target = (zh: string) => {
  const b = byName(zh)
  return { point: b.center, poly: b.poly, entrances: b.entrances?.map((e) => e.pos) }
}

beforeAll(() => initRouting(campus))

describe('距离步行导航', () => {
  it('运行时只暴露统一路网坐标', () => {
    const cells = walkableCells()
    expect(cells.length).toBeGreaterThan(100)
    expect(cells.every((cell) => Object.keys(cell).join() === 'pos')).toBe(true)
  })

  it('保留两段长廊实际几何，作为普通服务区域', () => {
    for (const name of ['风雨长廊（西）', '风雨长廊（东）']) {
      const b = byName(name)
      expect(b.poly.length).toBeGreaterThan(10)
      expect(b.cat).toBe('service')
      expect(findRoute(target(name), target('图书馆'))).not.toBeNull()
    }
  })

  it('总长等于路径距离之和，结果仅含距离和分层信息', () => {
    const r = findRoute(target('西门 · 集慧路249号'), target('东门 · 中科路1号'))!
    expect(r).not.toBeNull()
    const length = r.segments.reduce((sum, s) => sum + s.path.slice(1).reduce((n, p, i) => n + meters(s.path[i], p), 0), 0)
    expect(r.meters).toBe(Math.round(length))
    expect(r.meters).toBeGreaterThan(500)
    expect(Object.keys(r).sort()).toEqual(['segments', 'meters', 'minutes', 'undergroundMeters', 'transitions'].sort())
    expect(r.segments).toHaveLength(1)
    expect(Object.keys(r.segments[0]).sort()).toEqual(['layer', 'path'])
  })

  it('到有入口的楼时走到入口为止', () => {
    const r = findRoute(target('图书馆'), target('学生公寓11号楼'))!
    const doors = byName('学生公寓11号楼').entrances!.map((e) => e.pos)
    expect(doors).toContainEqual(r.segments.at(-1)!.path.at(-1))
  })
})
