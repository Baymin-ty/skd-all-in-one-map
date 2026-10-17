export interface Room {
  code: string
  label: string
  floor: number | null
  kind: string
}
/** Read the existing room records without changing the shared backend schema. */
export function roomsFrom(records: unknown[]): Room[] {
  return records.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const r = raw as Record<string, unknown>
    if (typeof r.code !== 'string' || typeof r.label !== 'string') return []
    return [{ code: r.code, label: r.label, floor: typeof r.floor === 'number' && Number.isFinite(r.floor) ? r.floor : null, kind: typeof r.kind === 'string' ? r.kind : 'other' }]
  })
}
export const floorLabel = (floor: number | null) => floor == null ? '楼层未标注' : floor < 0 ? `地下 ${Math.abs(floor)} 层` : floor === 0 ? 'B 层 / 设备层' : `${floor} 楼`
export function roomFloors(rooms: Room[], query: string) {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s-]/g, '')
  const q = normalize(query)
  const floors = new Map<number | null, Room[]>()
  for (const r of rooms) {
    if (q && !normalize(`${r.code} ${r.label}`).includes(q)) continue
    if (!floors.has(r.floor)) floors.set(r.floor, [])
    floors.get(r.floor)!.push(r)
  }
  return [...floors.entries()].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity)).map(([floor, list]) => ({ floor, rooms: list.sort((a, b) => a.code.localeCompare(b.code, 'zh', { numeric: true })) }))
}
