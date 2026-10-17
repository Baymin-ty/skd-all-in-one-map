/** 构建阶段把手绘路和 OSM 补充路归一为一类可走格，避免运行时出现两套路网。 */
export function normalizeRoadGrid(campus) {
  return {
    ...campus,
    grid: {
      ...campus.grid,
      rows: campus.grid.rows.map((row) => row.replaceAll('2', '0')),
    },
  }
}
