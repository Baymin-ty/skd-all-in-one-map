import type { IconName } from './icons'
import { labelsForMode, normalizeMapPrefs, removeMapPlace, upsertMapPlace, type MapPlace, type MapPrefs } from './mapPrefs'
import { placeName, placeSelection, showPanel, state } from './store'
import { initPlan } from './today'
import { setUserData, readUserData } from './userData'

/**
 * 「我的」个人中心：寝室、实验室、办公室各只有一个，收藏地点可以有多个。
 * 都存在 map 个人数据里，未登录时只在这台设备，登录后跟着校园账号同步。
 */
export type HomeRole = 'dorm' | 'lab' | 'office'
export const HOME_ROLES: { role: HomeRole; zh: string; hint: string; icon: IconName }[] = [
  { role: 'dorm', zh: '寝室', hint: '首页出现「回寝室」，一键导航', icon: 'housing' },
  { role: 'lab', zh: '实验室', hint: '首页出现「去实验室」', icon: 'academic' },
  { role: 'office', zh: '办公室', hint: '常去的办公或自习地点', icon: 'building' },
]

/** 「我的」页内的分区，从别处跳过来时直接滚到对应位置 */
export const profileUi = { focus: '' as '' | 'places' | 'schedule' }

export function applyMapPrefs() {
  state.mapPrefs = normalizeMapPrefs(readUserData('map', null), [...state.buildings, ...state.pois].map((item) => item.id))
  state.labelVisibility = labelsForMode(state.mapPrefs)
}

/** 登录或退出后换成当前身份的课表和地点 */
export function reloadPersonalData() {
  initPlan()
  if (state.buildings.length) applyMapPrefs()
}

function save(prefs: MapPrefs) {
  state.mapPrefs = prefs
  setUserData('map', prefs)
}

export const homePlace = (role: HomeRole) => state.mapPrefs.places.find((place) => place.role === role)
export const favorites = () => state.mapPrefs.places.filter((place) => place.role === 'fav')

/** 楼名 + 房间号；自定义了名字的用自定义名字 */
export function placeLabel(place: Pick<MapPlace, 'place' | 'room' | 'label'>) {
  const sel = placeSelection(place.place)
  return place.label || [sel ? placeName(sel) : '', place.room].filter(Boolean).join(' ')
}

/** 设寝室、实验室、办公室：同一种只留一个，换地方就替换旧的 */
export function setHomePlace(role: HomeRole, place: string, room = '') {
  let prefs = state.mapPrefs
  for (const old of prefs.places) if (old.role === role) prefs = removeMapPlace(prefs, old.id)
  save(upsertMapPlace(prefs, { id: role, role, place, ...(room.trim() ? { room: room.trim() } : {}) }))
}

export function clearHomePlace(role: HomeRole) {
  let prefs = state.mapPrefs
  for (const old of prefs.places) if (old.role === role) prefs = removeMapPlace(prefs, old.id)
  save(prefs)
}

export const isFavorite = (place: string) => state.mapPrefs.places.some((item) => item.role === 'fav' && item.place === place)

/** 收藏或取消收藏一个地点，返回操作后是否已收藏 */
export function toggleFavorite(place: string, room = '') {
  const existing = state.mapPrefs.places.filter((item) => item.role === 'fav' && item.place === place)
  if (existing.length) {
    save(existing.reduce((prefs, item) => removeMapPlace(prefs, item.id), state.mapPrefs))
    return false
  }
  save(upsertMapPlace(state.mapPrefs, { id: `fav-${place}`, role: 'fav', place, ...(room ? { room } : {}) }))
  return true
}

export function removePlace(id: string) {
  save(removeMapPlace(state.mapPrefs, id))
}

/** 打开「我的」，可选滚到某个分区 */
export function openProfile(focus: typeof profileUi.focus = '') {
  profileUi.focus = focus
  showPanel('me')
}
