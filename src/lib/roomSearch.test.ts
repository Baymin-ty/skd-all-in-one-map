import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CampusEvent } from './discoveryTypes'
import { groupBuildings } from './groups'
import { buildRoomIndex, findRooms, resolveRoomPlace } from './roomSearch'
import type { Places } from './types'

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../public/data/${name}.json`, import.meta.url), 'utf8'))
const places = load<Places>('places')
const index = buildRoomIndex(places.buildings, groupBuildings(places.buildings), load<CampusEvent[]>('events'))
const name = (id: string) => places.buildings.find((b) => b.id === id)?.name.zh
const top = (q: string) => {
  const [hit] = findRooms(q, index)
  return hit && { building: name(hit.building), code: hit.code, floor: hit.floor, confidence: hit.confidence }
}

describe('教室号全局搜索', () => {
  it('房间表里的编号忽略大小写、空格和横线', () => {
    expect(top('1A-108')).toMatchObject({ building: '信息学院1号楼', code: '1A-108', floor: 1, confidence: 'exact' })
    expect(top('1d108')).toMatchObject({ building: '信息学院1号楼', code: '1D-108', confidence: 'exact' })
    expect(top('2-101')).toMatchObject({ building: '信息学院2号楼', code: '2-101', confidence: 'exact' })
    // 房间表已经有这个编号时，不再猜物质学院 2 号楼
    expect(findRooms('2-101', index).map((h) => name(h.building))).not.toContain('物质学院2号楼')
  })
  it('楼名或别名加号码，没有房间表的楼按首位推测楼层', () => {
    expect(top('图书馆302')).toMatchObject({ building: '图书馆', code: '302', floor: 3, confidence: 'rule' })
    expect(top('SEM501')).toMatchObject({ building: '创业与管理学院', code: '501', floor: 5 })
    expect(top('信息学院 1A-108')).toMatchObject({ building: '信息学院1号楼', code: '1A-108' })
    expect(top('物质学院5-105')).toMatchObject({ building: '物质学院5号楼', code: '5-105', floor: 1 })
  })
  it('编号规则和往期活动推测楼', () => {
    expect(top('5-105')).toMatchObject({ building: '物质学院5号楼', code: '5-105', floor: 1, confidence: 'rule' })
    expect(top('S301')).toMatchObject({ building: '创意与艺术学院', floor: 3, confidence: 'history' })
    // 只输入数字时按往期活动最常用的地点排序
    expect(top('302')).toMatchObject({ building: '图书馆', floor: 3 })
    // 3-xxx 两个学院都有，往期活动在信息学院 3 号楼
    expect(findRooms('3-301', index).map((h) => name(h.building)).slice(0, 2)).toEqual(['信息学院3号楼', '物质学院3号楼'])
  })
  it('边输入边匹配编号开头，普通文字不当房间号', () => {
    expect(findRooms('1a10', index).every((h) => h.code.startsWith('1A-10'))).toBe(true)
    expect(findRooms('图书馆', index)).toEqual([])
    expect(findRooms('1', index)).toEqual([])
  })

  it('可以把课表里的完整教室写法解析成地图楼栋', () => {
    const hit = resolveRoomPlace('信息学院1D106', index)
    expect(hit && name(hit.building)).toBe('信息学院1号楼')
    expect(hit?.code).toBe('1D-106')
  })
})
