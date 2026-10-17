import { describe, expect, it } from 'vitest'
import {
  EXPLORER_BUILDING_ID,
  EXPLORER_FLOORS,
  roomsForFloor,
  searchExplorerRooms,
} from './buildingExplorer'

describe('building explorer demo data', () => {
  it('keeps the physics building demo focused on floor five', () => {
    expect(EXPLORER_BUILDING_ID).toBe('ded84a6d')
    expect(EXPLORER_FLOORS[0]).toEqual({ number: -1, available: true })
    expect(EXPLORER_FLOORS.at(-1)?.number).toBe(5)
    expect(EXPLORER_FLOORS.slice(1, 5).every((floor) => !floor.available)).toBe(true)
  })

  it('returns the five demo rooms on floor five in plan order', () => {
    expect(roomsForFloor(5).map((room) => room.code)).toEqual(['509', '507', '505', '503', '501'])
  })

  it('searches room code and keeps floors without source data empty', () => {
    expect(roomsForFloor(-1)).toEqual([])
    expect(roomsForFloor(4)).toEqual([])
    expect(searchExplorerRooms(5, '503')[0]?.code).toBe('503')
    expect(searchExplorerRooms(5, '实验室')).toEqual([])
  })
})
