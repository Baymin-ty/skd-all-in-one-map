import L from 'leaflet'
import { watch } from 'vue'
import { nowTick } from './campusTime'
import { toLatLng } from './geo'
import { findRoute } from './route'
import { endFor, fitToday, mapApi, placeSelection, state } from './store'
import { endMin, itemsOn, nowMinute, plan, startMin } from './today'
import type { LngLat } from './types'
import './todayLayer.css'

/**
 * 「我的今天」面板打开时，在地图上按顺序给当天各站编号，并画出两站之间的步行路线：
 * 已经过去的灰色，正在进行和下一段高亮。返回清理函数。
 */
export function mountTodayLayer(map: L.Map) {
  const layer = L.layerGroup().addTo(map)
  function draw() {
    layer.clearLayers()
    // 编号钉参与标签避让，旁边的地点名称让开，不压在编号上
    mapApi.relayout()
    if (state.panel !== 'today' || state.route.open) return
    const now = nowMinute(plan.date, nowTick.value)
    const stops = itemsOn(plan.items, plan.date).flatMap((item) => {
      const sel = placeSelection(item.place)
      const end = sel && endFor(sel)
      return end ? [{ item, end, status: endMin(item) <= now ? 'past' : startMin(item) <= now ? 'now' : 'next' }] : []
    })
    const nextIndex = stops.findIndex((s) => s.status !== 'past')
    if (stops[nextIndex]?.status === 'next') stops[nextIndex].status = 'upnext'
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]
      const b = stops[i]
      if (a.end.place?.id === b.end.place?.id) continue
      const r = findRoute(a.end, b.end)
      if (!r) continue
      const active = i === nextIndex || b.status === 'now'
      const path = r.segments.flatMap((s) => s.path).map(toLatLng)
      L.polyline(path, { color: '#fff', weight: 8, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer)
      L.polyline(path, { color: b.status === 'past' ? '#a9a9b1' : active ? '#a8242b' : '#d07a80', weight: 4.5, dashArray: active ? undefined : '6 7', lineCap: 'round', interactive: false }).addTo(layer)
    }
    // 同一地点的几项合成一个编号钉，例如同一栋楼连上两节课
    const byPlace = new Map<string, { point: LngLat; numbers: number[]; status: string; title: string }>()
    stops.forEach((s, i) => {
      const key = s.end.place ? `${s.end.place.kind}:${s.end.place.id}` : String(i)
      const old = byPlace.get(key)
      if (old) {
        old.numbers.push(i + 1)
        if (s.status !== 'past' && old.status !== 'now' && old.status !== 'upnext') old.status = s.status
        old.title += `\n${s.item.start} ${s.item.title}`
      } else byPlace.set(key, { point: s.end.point, numbers: [i + 1], status: s.status, title: `${s.item.start} ${s.item.title}` })
    })
    for (const { point, numbers, status, title } of byPlace.values())
      L.marker(toLatLng(point), {
        icon: L.divIcon({ className: '', html: `<div class="today-stop ${status}" data-prio="135">${numbers.join('·')}</div>`, iconSize: [0, 0] }),
        title, keyboard: false, zIndexOffset: 1700, interactive: false,
      }).addTo(layer)
  }
  // 打开面板时由 showPanel 负责缩放；切换日期时重新缩放到那天的各站
  const stopFit = watch(() => plan.date, () => { draw(); fitToday() })
  const stopDraw = watch(() => [state.panel, plan.items, nowTick.value, state.route.open], draw, { deep: true })
  draw()
  return () => {
    stopFit()
    stopDraw()
    layer.remove()
  }
}
