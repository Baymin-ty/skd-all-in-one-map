import L from 'leaflet'
import { watch } from 'vue'
import type { CampusEvent } from './discoveryTypes'
import { PAINTED_OUTLINE, toLatLng } from './geo'
import { ICONS, PIN_PATH } from './icons'
import { labelsOverlap } from './mapLabels'
import { buildingById, mapApi, poiById, state } from './store'
import { glowAt, glowColor, glowWhen, nightAt, pause, tm, windowEvents, type Glow } from './timeMachine'
import type { LngLat } from './types'
import './timeMachineLayer.css'

interface Mark {
  root: HTMLDivElement
  node: HTMLButtonElement
  when: HTMLElement
  title: HTMLElement
  more: HTMLElement
  where: HTMLElement
  marker: L.Marker
  events: CampusEvent[]
  point: LngLat
  name: string
  /** 上一次写进 DOM 的内容，没变就不碰 */
  last: { cls: string; p: string; c: string; when: string; title: string; more: string; where: string; z: number }
  p: number
}

/**
 * 时光机打开时的地图：每个地点一枚钉，显示这里此刻最醒目的一场活动。显著度随播放头连续变化，
 * 钉的大小、颜色、光晕和标签都跟着变；刚开始的活动弹出标注卡，镜头跟过去。底图按模拟时间昼夜渐变。
 * 返回清理函数。
 */
export function mountTimeMachineLayer(map: L.Map) {
  const pane = map.createPane('tm-pane')
  pane.style.zIndex = '640'
  pane.style.pointerEvents = 'none'
  // 夜色盖在底图和淡化遮罩上、标签下面，正片叠底保留手绘细节
  const skyPane = map.createPane('tm-sky')
  skyPane.style.zIndex = '380'
  skyPane.style.pointerEvents = 'none'
  skyPane.style.mixBlendMode = 'multiply'
  const layer = L.layerGroup()
  const sky = L.rectangle(L.latLngBounds(PAINTED_OUTLINE.map(toLatLng)).pad(2), {
    pane: 'tm-sky', renderer: L.svg({ pane: 'tm-sky', padding: 1 }), stroke: false, fillColor: '#18224a', fillOpacity: 0, interactive: false,
  })
  const marks = new Map<string, Mark>()
  const container = map.getContainer()
  let frame = 0
  let lastT = NaN
  let lastNight = -1
  let lastClash = 0
  let followKey = ''
  let homeAt = 0
  /** 用户自己拖动或缩放地图后，镜头暂时不跟 */
  let holdFollow = 0

  function createMark(id: string, point: LngLat, name: string): Mark {
    const root = document.createElement('div')
    root.className = 'tm-root'
    root.innerHTML = '<i class="tm-halo"></i><i class="tm-ring"></i>'
      + '<button type="button" class="tm-mark"><span class="tm-tag"><b class="tm-when"></b><span class="tm-title"></span><em class="tm-more"></em><small class="tm-where"></small></span>'
      + `<span class="tm-pin"><svg class="pin-shape" viewBox="0 0 32 42" aria-hidden="true"><path d="${PIN_PATH}"/></svg><span class="tm-ico">${ICONS.calendar}</span></span></button>`
    const node = root.querySelector<HTMLButtonElement>('.tm-mark')!
    const marker = L.marker(toLatLng(point), {
      icon: L.divIcon({ className: '', html: root, iconSize: [0, 0] }), pane: 'tm-pane', keyboard: false, bubblingMouseEvents: false,
    }).addTo(layer)
    const mark: Mark = {
      root, node, marker, point, name, events: [], p: 0,
      when: root.querySelector('.tm-when')!, title: root.querySelector('.tm-title')!, more: root.querySelector('.tm-more')!, where: root.querySelector('.tm-where')!,
      last: { cls: '', p: '', c: '', when: '', title: '', more: '', where: '', z: 0 },
    }
    // 点钉：暂停并展开这一场；同一地点多场时点开当前最醒目的那场
    marker.on('click', () => {
      const lead = leadOf(mark, tm.t)
      if (!lead) return
      pause()
      tm.focus = lead.e.id
      mapApi.focus(point, Math.max(map.getZoom(), 18), 80)
    })
    marks.set(id, mark)
    return mark
  }

  function rebuild() {
    const byPlace = new Map<string, CampusEvent[]>()
    for (const e of windowEvents.value) {
      if (!e.place) continue
      if (!byPlace.has(e.place)) byPlace.set(e.place, [])
      byPlace.get(e.place)!.push(e)
    }
    for (const [id, events] of byPlace) {
      const b = buildingById(id)
      const p = b ? undefined : poiById(id)
      const point = b?.center || p?.pos
      if (!point) continue
      const mark = marks.get(id) || createMark(id, point, b?.name.zh || p!.name.zh)
      mark.events = events
    }
    for (const [id, mark] of marks) if (!byPlace.has(id) || !mark.events.length) { layer.removeLayer(mark.marker); marks.delete(id) }
    lastT = NaN
  }

  /** 这个地点此刻最醒目的一场；同样醒目时刚开始的优先，好弹出标注卡 */
  const score = (g: Glow) => g.p + (g.phase === 'spot' ? 0.01 : 0)
  function leadOf(mark: Mark, t: number) {
    let lead: { e: CampusEvent; g: Glow } | undefined
    for (const e of mark.events) {
      const g = glowAt(e, t)
      if (g && (!lead || score(g) > score(lead.g))) lead = { e, g }
    }
    return lead
  }

  function update() {
    const t = tm.t
    if (t === lastT) return
    lastT = t
    for (const mark of marks.values()) {
      const focused = mark.events.find((e) => e.id === tm.focus)
      let lead = leadOf(mark, t)
      // 点开的活动即使已经结束也保持显示
      if (focused) lead = { e: focused, g: glowAt(focused, t) ?? { phase: 'past', p: 0.5 } }
      const others = lead ? mark.events.filter((e) => e !== lead!.e && (glowAt(e, t)?.p ?? 0) >= 0.3).length : 0
      const g = lead?.g
      const tagged = !!g && (g.phase === 'spot' || g.phase === 'live' || g.phase === 'ongoing' || g.p >= 0.42 || g.phase === 'past' && g.p >= 0.3)
      const next = lead && g ? {
        cls: `tm-root ph-${g.phase}${tagged ? ' tagged' : ''}${g.phase === 'spot' || focused ? ' callout' : ''}${focused ? ' focused' : ''}`,
        p: g.p.toFixed(3), c: glowColor(g), when: glowWhen(lead.e, g, t), title: lead.e.title, more: others ? String(others) : '',
        where: [mark.name, lead.e.room].filter(Boolean).join(' · '), z: focused ? 2000 : Math.round(g.p * 40) * 25,
      } : { ...mark.last, cls: 'tm-root tm-off', z: 0 }
      mark.p = g ? (focused ? 2 : score(g)) : 0
      const { last } = mark
      if (next.cls !== last.cls) mark.root.className = next.cls
      if (next.p !== last.p) mark.root.style.setProperty('--p', next.p)
      if (next.c !== last.c) mark.root.style.setProperty('--c', next.c)
      if (next.when !== last.when) mark.when.textContent = next.when
      if (next.title !== last.title) { mark.title.textContent = next.title; mark.node.title = next.title }
      if (next.more !== last.more) mark.more.textContent = next.more
      if (next.where !== last.where) mark.where.textContent = next.where
      if (next.z !== last.z) mark.marker.setZIndexOffset(next.z)
      if (lead) mark.node.setAttribute('aria-label', `${next.when}：${lead.e.title}，${mark.name}`)
      mark.last = next
    }
    const night = Math.round(nightAt(t) * 50) / 50
    if (night !== lastNight) {
      lastNight = night
      sky.setStyle({ fillOpacity: 0.42 * night })
      container.classList.toggle('tm-night', night > 0.5)
    }
  }

  /** 时光机钉之间避让：越醒目越优先，被挡住的只藏标签和标注卡，钉子和脉冲圈保留 */
  function declutter() {
    const shown = [...marks.values()].filter((m) => m.root.classList.contains('tagged')).sort((a, b) => b.p - a.p)
    for (const m of shown) m.root.classList.remove('tm-clash')
    const placed: DOMRect[] = []
    for (const m of shown) {
      const tag = m.root.querySelector('.tm-tag')!
      const r = tag.getBoundingClientRect()
      if (!r.width) continue
      if (placed.some((q) => labelsOverlap(r, q, 6, 4))) m.root.classList.add('tm-clash')
      else placed.push(r)
    }
  }

  /** 镜头跟随：有活动刚开始时飞过去（多场同时开始就框住它们），之后回到全校 */
  function follow(now: number) {
    if (!tm.follow || !tm.playing || now < holdFollow) return
    const spots = windowEvents.value.filter((e) => e.place && glowAt(e, tm.t)?.phase === 'spot')
    const points = [...new Set(spots.map((e) => e.place!))].flatMap((id) => {
      const point = marks.get(id)?.point
      return point ? [point] : []
    })
    const key = spots.map((e) => e.id).join()
    if (key !== followKey) {
      followKey = key
      homeAt = 0
      if (points.length === 1) mapApi.focus(points[0], 18, 80)
      else if (points.length) mapApi.fit(points, 18)
      else homeAt = now + 900
    }
    if (homeAt && now >= homeAt) {
      homeAt = 0
      mapApi.home()
    }
  }

  function loop(now: number) {
    update()
    follow(now)
    if (now - lastClash > 180) { lastClash = now; declutter() }
    frame = requestAnimationFrame(loop)
  }

  const hold = () => { holdFollow = performance.now() + 6000; homeAt = 0 }
  function setOpen(open: boolean) {
    cancelAnimationFrame(frame)
    container.classList.toggle('tm', open)
    if (!open) {
      layer.remove()
      sky.remove()
      container.classList.remove('tm-night')
      lastNight = -1
      return
    }
    layer.addTo(map)
    sky.addTo(map)
    rebuild()
    followKey = ''
    frame = requestAnimationFrame(loop)
  }

  map.on('dragstart', hold)
  container.addEventListener('wheel', hold, { passive: true })
  map.on('zoomend moveend', declutter)
  const stopOpen = watch(() => tm.open, setOpen)
  const stopData = watch(() => [windowEvents.value, state.buildings, state.pois], () => { if (tm.open) rebuild() })
  const stopFocus = watch(() => tm.focus, () => { lastT = NaN })
  // 重新开始播放时重新判断镜头，免得暂停期间手动移开后不再跟随
  const stopPlay = watch(() => tm.playing, (on) => { if (on) { followKey = ''; holdFollow = 0 } })
  if (tm.open) setOpen(true)
  return () => {
    stopOpen(); stopData(); stopFocus(); stopPlay()
    cancelAnimationFrame(frame)
    map.off('dragstart', hold)
    map.off('zoomend moveend', declutter)
    container.removeEventListener('wheel', hold)
    layer.remove()
    sky.remove()
  }
}
