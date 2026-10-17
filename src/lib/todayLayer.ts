import L from 'leaflet'
import { watch } from 'vue'
import { tm } from './timeMachine'
import { ICONS } from './icons'
import { toLatLng } from './geo'
import { KIND_STYLE, type AgendaStop } from './myMap'
import { endFor, fitToday, mapApi, mineFocus, myAgenda, openEvent, openRoom, placeSelection, select, state } from './store'
import { HOME_ROLES } from './profile'
import { weekdayOf } from './today'
import './todayLayer.css'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']
/** 标注上的标题只留前几个字，完整的在面板里 */
const short = (s: string) => [...s].length > 7 ? [...s].slice(0, 6).join('') + '…' : s

/** 点小旗：活动打开活动详情，课程打开那栋楼并定位到教室 */
function openStop(stop: AgendaStop) {
  const { item } = stop.lead
  if (item.eventId) return openEvent(item.eventId)
  const sel = placeSelection(stop.place)
  if (sel?.kind === 'building' && item.room) openRoom(sel.id, item.room)
  else if (sel) select(sel)
}

/**
 * 我的地图和「我的今天」的地图图层：在每个有安排的地点上方插一面小旗，
 * 颜色和图标区分课程 / 活动 / 吃饭 / 待办，写着时间和标题；同一地点多项合成一面旗（+N）。
 * 某一天的视图再按时间顺序画出各站之间的步行路线：已经过去的灰色，正在进行和下一段高亮。
 * 我的地图还会标出寝室、实验室等常用地点。返回清理函数。
 */
export function mountTodayLayer(map: L.Map) {
  const layer = L.layerGroup().addTo(map)

  function stopHtml(stop: AgendaStop, week: boolean) {
    const { item, date, status } = stop.lead
    const style = KIND_STYLE[item.kind]
    const days = week && item.weekdays?.length ? `周${item.weekdays.map((d) => WEEKDAY[d - 1]).join('')}` : week ? `周${WEEKDAY[weekdayOf(date) - 1]}` : ''
    const more = week ? new Set(stop.entries.map((e) => e.item.id)).size - 1 : stop.entries.length - 1
    const mixed = stop.kinds.length > 1 ? stop.kinds.filter((k) => k !== item.kind).map((k) => `<u style="--k:${KIND_STYLE[k].color}"></u>`).join('') : ''
    const cls = ['agenda-pin', `k-${item.kind}`, week ? 'wk' : `s-${status}`].join(' ')
    // 避让时先去掉标题，再只留图标；正在进行和下一项固定显示
    const prio = !week && (status === 'now' || status === 'upnext') ? 135 : status === 'past' && !week ? 100 : 126
    return `<div class="${cls}" style="--k:${style.color}" data-prio="${prio}" data-levels="full brief icon">`
      + `<i>${ICONS[style.icon]}</i><b>${escapeHtml(days ? `${days} ${item.start}` : item.start)}</b>`
      + `<span>${escapeHtml(short(item.title))}</span>${more > 0 ? `<em>+${more}</em>` : ''}${mixed}</div>`
  }

  function draw() {
    layer.clearLayers()
    // 小旗参与标签避让：旁边的地点名称让开，不压在旗子上
    mapApi.relayout()
    if (!mineFocus.value || tm.open) return
    const { stops, week } = myAgenda.value
    const points = new Map(stops.map((s) => {
      const sel = placeSelection(s.place)
      const end = sel && endFor(sel)
      return [s.place, end?.point] as const
    }))
    // 只标站点，不连路线：要走过去时点「导航」按钮再算真实路线
    for (const stop of stops) {
      const point = points.get(stop.place)
      if (!point) continue
      const titles = stop.entries.map((e) => `${e.item.start} ${KIND_STYLE[e.item.kind].zh} · ${e.item.title}${e.item.room ? ` · ${e.item.room}` : ''}`)
      L.marker(toLatLng(point), {
        icon: L.divIcon({ className: '', html: stopHtml(stop, week), iconSize: [0, 0] }),
        title: [...new Set(titles)].join('\n'), keyboard: false, zIndexOffset: 1700, bubblingMouseEvents: false,
      }).on('click', () => { if (!state.route.picking) openStop(stop) }).addTo(layer)
    }
    // 常用地点：寝室、实验室、办公室和收藏，已经有安排的地点不再重复
    if (state.panel !== 'home') return
    const taken = new Set(stops.map((s) => s.place))
    for (const p of state.mapPrefs.places) {
      const sel = placeSelection(p.place)
      const end = sel && endFor(sel)
      if (!sel || !end || taken.has(sel.id)) continue
      taken.add(sel.id)
      const role = HOME_ROLES.find((r) => r.role === p.role)
      const name = p.label || role?.zh || '收藏'
      L.marker(toLatLng(end.point), {
        icon: L.divIcon({ className: '', html: `<div class="mine-place r-${p.role}" data-prio="112" data-levels="full icon"><i>${ICONS[role?.icon ?? 'heart']}</i><span>${escapeHtml(name)}</span></div>`, iconSize: [0, 0] }),
        title: name, keyboard: false, zIndexOffset: 1650, interactive: false,
      }).addTo(layer)
    }
  }
  // 「我的今天」切换日期时重新缩放到那天的各站；我的地图的切换由 setMyScope 负责缩放
  const stopFit = watch(() => state.panel === 'today' && myAgenda.value.dates.join(), (key, old) => { if (key && old && key !== old) fitToday() })
  const stopDraw = watch(() => [mineFocus.value, myAgenda.value, state.mapPrefs.places, tm.open], draw, { deep: true })
  draw()
  return () => {
    stopFit()
    stopDraw()
    layer.remove()
  }
}
