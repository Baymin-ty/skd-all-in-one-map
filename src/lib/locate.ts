import { reactive, watch } from 'vue'
import { distanceToPath, gpsToMap } from './geoConvert'
import { meters, pointInPoly } from './measure'
import { computeRoute, mapApi, setEnd, state, toast, type RouteEnd } from './store'
import type { LngLat } from './types'

/**
 * 实时定位：蓝点 + 精度圈 + 朝向，地图跟随；「我的位置」只在选择时作为导航起点快照，后续不随 GPS 变化。
 * 浏览器只在 HTTPS（或 localhost）下给定位权限。室内 GPS 不准，演示用 `?mock` 模拟定位：
 * 右键或长按地图把自己放到那里，也可以沿当前路线模拟走一遍。
 */
export type LocateStatus = 'off' | 'locating' | 'on' | 'outside' | 'denied' | 'unavailable'
export const locator = reactive({
  status: 'off' as LocateStatus,
  pos: null as LngLat | null,
  /** 精度（米） */
  accuracy: 0,
  /** 朝向，正北为 0，顺时针（度） */
  heading: null as number | null,
  follow: false,
  mock: false,
  simulating: false,
})

/** 偏离路线超过这么远就重新规划；离终点这么近算到达（米） */
const OFF_ROUTE = 25
const ARRIVE = 20
/** 每走这么远按当前位置重算一次路线（米） */
const REROUTE_STEP = 10

let watchId: number | null = null
let compass = false
let headingAsked = false
let routedAt: LngLat | null = null
let arrivedAt = ''
let walkTimer = 0

const mockParam = () => new URLSearchParams(window.location.search).get('mock')

/** 将当前位置作为一次性的导航起点快照；后续 GPS 更新只更新定位蓝点，不移动导航起点。 */
export function myLocationEnd(): RouteEnd | null {
  return locator.status === 'on' && locator.pos ? { name: '我的位置', point: [...locator.pos] as LngLat, live: false } : null
}

/** 打开页面时静默申请定位：只显示蓝点，不移动地图，也不弹不支持定位的提示 */
export function locateOnLoad() {
  if (locator.status !== 'off' || mockParam() !== null) return
  if (!('geolocation' in navigator) || !window.isSecureContext) return
  locator.status = 'locating'
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 })
}

export function startLocating() {
  locator.follow = true
  // iOS 的方向权限只能在点击时申请，开页自动定位时还没拿到
  if (!headingAsked) requestHeading()
  if (locator.status === 'on' && locator.pos) return mapApi.focus(locator.pos)
  if (locator.status === 'locating') return
  const mock = mockParam()
  if (mock !== null) {
    const [lng, lat] = mock.split(',').map(Number)
    const center = state.buildings.find((b) => b.name.zh === '教学中心')?.center ?? state.campus?.boundary[0]
    locator.mock = true
    toast('模拟定位：右键或长按地图可以换位置')
    return setMockPosition(Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : center!)
  }
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    locator.status = 'unavailable'
    return toast(window.isSecureContext ? '这个浏览器不支持定位' : '定位需要通过 HTTPS 打开本站')
  }
  // 开页时可能已经在后台定位（例如人在校外）：换成用户主动的一次，提示照常给
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  locator.status = 'locating'
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 })
}

export function stopLocating() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  clearInterval(walkTimer)
  window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
  window.removeEventListener('deviceorientation', onOrientation as EventListener)
  Object.assign(locator, { status: 'off', pos: null, accuracy: 0, heading: null, follow: false, mock: false, simulating: false })
  compass = false
  headingAsked = false
}

/** 模拟定位（演示用）：直接把自己放到底图上的某一点 */
export function setMockPosition(pos: LngLat) {
  const prev = locator.pos
  // 模拟时按移动方向当朝向
  if (prev && meters(prev, pos) > 1) {
    const dx = (pos[0] - prev[0]) * Math.cos((pos[1] * Math.PI) / 180)
    locator.heading = (Math.atan2(dx, pos[1] - prev[1]) * 180) / Math.PI
  }
  update(pos, 6)
}

/** 沿当前路线每 0.4 秒走约 6 米，用来演示跟随和到达提醒 */
export function simulateWalk() {
  const path = state.route.result?.segments.flatMap((s) => s.path)
  if (!locator.mock || !path?.length) return
  const points: LngLat[] = []
  for (let i = 1; i < path.length; i++) {
    const n = Math.max(1, Math.round(meters(path[i - 1], path[i]) / 6))
    for (let k = 0; k < n; k++) points.push([path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k / n, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k / n])
  }
  points.push(path.at(-1)!)
  clearInterval(walkTimer)
  locator.simulating = true
  locator.follow = true
  let i = 0
  walkTimer = window.setInterval(() => {
    if (i >= points.length || !locator.mock) {
      clearInterval(walkTimer)
      locator.simulating = false
      return
    }
    setMockPosition(points[i++])
  }, 400)
}

function onPosition(p: GeolocationPosition) {
  const { longitude, latitude, accuracy, heading, speed } = p.coords
  if (!compass && heading != null && !Number.isNaN(heading) && (speed ?? 0) > 0.6) locator.heading = heading
  update(gpsToMap(longitude, latitude, state.campus?.warp), accuracy)
}
function onError(e: GeolocationPositionError) {
  // 开页自动定位失败不打扰，用户点定位按钮时才提示
  const asked = locator.follow
  if (e.code === e.PERMISSION_DENIED) {
    stopLocating()
    locator.status = 'denied'
    if (asked) toast('没有定位权限，请在浏览器设置里允许本站使用位置')
  } else if (asked && locator.status === 'locating') toast('暂时拿不到定位，到室外开阔处再试')
}

function update(pos: LngLat, accuracy: number) {
  const first = locator.status !== 'on'
  locator.accuracy = accuracy
  if (state.campus && !pointInPoly(pos, state.campus.boundary)) {
    if (locator.status !== 'outside' && locator.follow) toast('你现在不在校园里，地图上不显示你的位置')
    locator.status = 'outside'
    locator.pos = null
    return
  }
  locator.status = 'on'
  locator.pos = pos
  if (locator.follow) mapApi.focus(pos, first ? 19 : undefined)
  followRoute(pos)
}

/** 兼容旧的实时起点；当前「我的位置」使用快照，因此不会进入此分支。 */
function followRoute(pos: LngLat) {
  const r = state.route
  if (!r.open || !r.from?.live || !r.to) return
  const path = r.result?.segments.flatMap((s) => s.path)
  const end = path?.at(-1)
  if (end && meters(pos, end) < ARRIVE) {
    if (arrivedAt !== r.to.name) toast(`已到达${r.to.name}`)
    arrivedAt = r.to.name
    return
  }
  arrivedAt = ''
  const off = !!path && distanceToPath(pos, path) > OFF_ROUTE
  r.from = { ...r.from, point: pos }
  if (off || !routedAt || meters(pos, routedAt) > REROUTE_STEP) {
    routedAt = pos
    computeRoute(false)
    if (off) toast('已偏离路线，按当前位置重新规划')
  }
}

function onOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null)
  if (h == null || Number.isNaN(h)) return
  compass = true
  locator.heading = h
}
/** iOS 要在点击时请求方向权限；拿不到就退回用 GPS 的行进方向 */
async function requestHeading() {
  headingAsked = true
  const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
  try {
    if (D?.requestPermission && (await D.requestPermission()) !== 'granted') return
  } catch {
    return
  }
  window.addEventListener('deviceorientationabsolute', onOrientation as EventListener)
  window.addEventListener('deviceorientation', onOrientation as EventListener)
}

// 打开导航时只选了终点：已经定位的话直接从我的位置出发
watch(() => [state.route.open, state.route.to, state.route.from], () => {
  const me = myLocationEnd()
  if (state.route.open && state.route.to && !state.route.from && me) setEnd('from', me)
})
