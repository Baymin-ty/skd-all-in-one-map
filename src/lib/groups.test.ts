import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { groupBuildings } from './groups'
import type { Places } from './types'

const places: Places = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8'))
const groups = groupBuildings(places.buildings)
const byName = (zh: string) => groups.find((g) => g.name.zh === zh)!

describe('楼群', () => {
  it('物质学院、信息学院、学生公寓、教授公寓各成一组', () => {
    expect(groups.map((g) => [g.name.zh, g.members.length]).sort()).toEqual(
      [['信息学院', 3], ['学生公寓', 13], ['教授公寓', 6], ['物质学院', 8]].sort(),
    )
  })

  it('成员按楼号排序，英文名去掉楼号', () => {
    const spst = byName('物质学院')
    const names = spst.members.map((id) => places.buildings.find((b) => b.id === id)!.name.zh)
    expect(names[0]).toBe('物质学院1号楼')
    expect(names.at(-1)).toBe('物质学院8号楼')
    expect(spst.name.en).toBe('SPST')
    expect(byName('学生公寓').name.en).toBe('Student Apartment')
  })

  it('风雨长廊和单独的楼不进组', () => {
    const grouped = new Set(groups.flatMap((g) => g.members))
    for (const b of places.buildings.filter((b) => b.cat === 'gate')) expect(grouped.has(b.id)).toBe(false)
  })
})
