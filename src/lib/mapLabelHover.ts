type Place = { kind: string; id: string }
const samePlace = (a: Place | null, b: Place | null) => a?.kind === b?.kind && a?.id === b?.id

/** 统一建筑、点位和标签的悬停交接；同一地点的连续事件不触发重复更新。 */
export function createLabelHover<T extends Place>(onChange: (place: T | null) => void, canHover: () => boolean) {
  let current: T | null = null
  let leaveTimer: ReturnType<typeof setTimeout> | undefined
  const cancelLeave = () => { clearTimeout(leaveTimer); leaveTimer = undefined }
  function set(place: T | null) {
    if (place && !canHover()) return
    cancelLeave()
    if (samePlace(current, place)) return
    current = place
    onChange(place)
  }
  function leave(place: T) {
    // 旧节点移除时产生的 mouseout 不能清掉后来进入的新地点。
    if (!samePlace(current, place)) return
    cancelLeave()
    leaveTimer = setTimeout(() => set(null), 100)
  }
  return { set, leave, dispose: cancelLeave }
}
