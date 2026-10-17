import { describe, expect, it } from 'vitest'
import { findRoute, initRouting, posOf, walkableCells, walkablePaths } from './route'
import type { Campus, LngLat } from './types'

function init(rows: string[]) {
  const campus: Campus = {
    boundary: [], bounds: [[0, 0], [1, 1]],
    grid: { x0: 121, y0: 31, dx: 0.00005, dy: 0.00005, rows },
  }
  initRouting(campus)
}

// 展开合并段，按格编号比较实际边，不能仅比较线段数。
function edges(rows: string[]) {
  init(rows)
  const width = rows[0].length
  const cell = (p: LngLat) => {
    const j = Math.round((p[0] - 121) / 0.00005 - 0.5)
    const i = Math.round((31 - p[1]) / 0.00005 - 0.5)
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(rows.length)
    expect(j).toBeGreaterThanOrEqual(0)
    expect(j).toBeLessThan(width)
    expect(['0', '2']).toContain(rows[i][j])
    return i * width + j
  }
  const result: string[] = []
  for (const path of walkablePaths()) {
    expect(path.length).toBeGreaterThanOrEqual(2)
    const ids = path.map(cell)
    for (let k = 1; k < ids.length; k++) {
      const a = ids[k - 1], b = ids[k]
      const di = Math.abs(Math.floor(a / width) - Math.floor(b / width))
      const dj = Math.abs(a % width - b % width)
      expect(Math.max(di, dj)).toBe(1)
      result.push([a, b].sort((x, y) => x - y).join('-'))
    }
  }
  expect(new Set(result).size).toBe(result.length)
  return result.sort()
}

describe('统一地面栅格连接线', () => {
  it('2×2 包含水平、垂直及两个斜向的全部六条无向边，各一次', () => {
    expect(edges(['02', '20'])).toEqual(['0-1', '0-2', '0-3', '1-2', '1-3', '2-3'])
    expect(walkableCells()).toHaveLength(4)
  })

  it('同方向连续边合并，但保留每个格中心', () => {
    expect(edges(['0200'])).toEqual(['0-1', '1-2', '2-3'])
    expect(walkablePaths().map((path) => path.length)).toEqual([4])
    expect(edges(['0', '2', '0'])).toEqual(['0-1', '1-2'])
    expect(walkablePaths().map((path) => path.length)).toEqual([3])
    expect(edges(['011', '121', '110'])).toEqual(['0-4', '4-8'])
    expect(walkablePaths().map((path) => path.length)).toEqual([3])
    expect(edges(['110', '121', '011'])).toEqual(['2-4', '4-6'])
    expect(walkablePaths().map((path) => path.length)).toEqual([3])
  })

  it('与寻路一致：斜向两端可走即可连接，不额外禁止切角', () => {
    expect(edges(['01', '10'])).toEqual(['0-3'])
    expect(findRoute({ point: posOf(0) }, { point: posOf(3) })).not.toBeNull()
  })

  it('阻断格分开连续段，不跨缺口、不把行尾连到下一行行首', () => {
    expect(edges(['00100'])).toEqual(['0-1', '3-4'])
    expect(walkablePaths()).toHaveLength(2)
    expect(edges(['110', '011'])).toEqual([])
    expect(edges(['0'])).toEqual([])
    expect(edges(['11', '11'])).toEqual([])
  })

  it('穷举 3×3 小栅格，所有合法八邻接边恰好出现一次', () => {
    for (let mask = 0; mask < 512; mask++) {
      const rows = Array.from({ length: 3 }, (_, i) =>
        Array.from({ length: 3 }, (_, j) => mask & (1 << (i * 3 + j)) ? '0' : '1').join(''))
      const expected: string[] = []
      for (let a = 0; a < 9; a++)
        for (let b = a + 1; b < 9; b++) {
          if (rows[Math.floor(a / 3)][a % 3] !== '0' || rows[Math.floor(b / 3)][b % 3] !== '0') continue
          if (Math.max(Math.abs(Math.floor(a / 3) - Math.floor(b / 3)), Math.abs(a % 3 - b % 3)) === 1)
            expected.push(`${a}-${b}`)
        }
      expect(edges(rows)).toEqual(expected.sort())
    }
  })
})
