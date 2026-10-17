import { reactive } from 'vue'

export type ExplorerRect = [number, number, number, number]

export interface ExplorerFloor {
  number: number
  available: boolean
}

export interface ExplorerRoom {
  code: string
  floor: number
  rect: ExplorerRect
}

export const EXPLORER_BUILDING_ID = 'ded84a6d'

export const EXPLORER_FLOORS: ExplorerFloor[] = [
  { number: -1, available: true },
  { number: 1, available: false },
  { number: 2, available: false },
  { number: 3, available: false },
  { number: 4, available: false },
  { number: 5, available: true },
]

// 5 楼编号来自用户提供的 1 号楼平面图，按图中从左到右的顺序排列。
// rect 是 plan-context.jpg 中的百分比坐标：[left, top, width, height]。
const FLOOR_FIVE_ROOMS: ExplorerRoom[] = [
  { code: '509', floor: 5, rect: [5, 68.5, 6.6, 18.2] },
  { code: '507', floor: 5, rect: [12.6, 67.5, 6.5, 19.3] },
  { code: '505', floor: 5, rect: [19.4, 67.5, 13.4, 19.7] },
  { code: '503', floor: 5, rect: [33.6, 66.5, 13.2, 19.7] },
  { code: '501', floor: 5, rect: [47.5, 66.4, 13.4, 20.4] },
]

export const roomsForFloor = (floor: number): ExplorerRoom[] => floor === 5 ? FLOOR_FIVE_ROOMS : []

export const searchExplorerRooms = (floor: number, query: string): ExplorerRoom[] => {
  const needle = query.trim().toLowerCase()
  return roomsForFloor(floor).filter((room) => !needle || room.code.toLowerCase().includes(needle))
}

export const explorer = reactive({ open: false, floor: 5, room: '' })

export function openBuildingExplorer() {
  explorer.open = true
  explorer.floor = 5
  explorer.room = ''
}

export function closeBuildingExplorer() {
  explorer.open = false
  explorer.room = ''
}
