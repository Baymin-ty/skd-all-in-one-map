// 只替换经过核对的几何字段；后台修改过的轮廓需要人工合并，不能被数据重建覆盖。
export function planOutlinePatches(buildings, patches) {
  const byId = new Map(patches.map((patch) => [patch.id, patch]))
  const conflicts = [], changed = []
  const result = buildings.map((building) => {
    const patch = byId.get(building.id)
    if (!patch) return building
    const fields = Object.keys(patch.after)
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const different = fields.filter((key) => !same(building[key], patch.after[key]))
    if (!different.length) return building
    const baselines = [patch.before, ...(patch.previous ?? [])]
    if (!baselines.some((baseline) => different.every((key) => same(building[key], baseline[key])))) {
      conflicts.push(building.id)
      return building
    }
    changed.push(building.id)
    return { ...building, ...structuredClone(patch.after) }
  })
  return { buildings: result, changed, conflicts }
}

export function applyOutlinePatches(buildings, patches) {
  const plan = planOutlinePatches(buildings, patches)
  if (plan.conflicts.length) throw new Error(`轮廓已有其他修改，未覆盖：${plan.conflicts.join(', ')}`)
  return plan.buildings
}
