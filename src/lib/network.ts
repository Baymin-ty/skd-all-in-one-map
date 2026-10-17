import type { Campus } from './types'
export type SurfaceGrid = Campus['grid']
export function validSurfaceGrid(value: unknown, base: SurfaceGrid): value is SurfaceGrid {
  const g = value as SurfaceGrid
  return !!g && typeof g === 'object' && g.x0 === base.x0 && g.y0 === base.y0 && g.dx === base.dx && g.dy === base.dy && Array.isArray(g.rows) && g.rows.length === base.rows.length && g.rows.every((row) => typeof row === 'string' && row.length === base.rows[0].length && [...row].every((c) => c === '0' || c === '1' || c === '2'))
}
export function copyGrid(grid: SurfaceGrid): SurfaceGrid { return { ...grid, rows: [...grid.rows] } }
export function paintGrid(grid: SurfaceGrid, row: number, col: number, walkable: boolean, brushSize = 1, mask?: SurfaceGrid): SurfaceGrid {
  const out = copyGrid(grid)
  const rows = out.rows.length
  const cols = out.rows[0].length
  const half = Math.floor(Math.max(1, brushSize) / 2)
  const target = walkable ? '0' : '1'
  let changed = false
  for (let r = row - half; r <= row + half; r++) {
    for (let c = col - half; c <= col + half; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue
      if (walkable && mask && mask.rows[r][c] !== '0' && mask.rows[r][c] !== '2') continue
      if (out.rows[r][c] === target) continue
      out.rows[r] = out.rows[r].slice(0, c) + target + out.rows[r].slice(c + 1)
      changed = true
    }
  }
  return changed ? out : grid
}
export async function loadSurfaceVersion(version: 'rain' | 'default') {
  const response = await fetch(`/api/surface-networks/${version}`)
  if (!response.ok) throw new Error(`路网加载失败（${response.status}）`)
  return await response.json() as { grid: SurfaceGrid | null; available: boolean; updatedAt: number }
}
