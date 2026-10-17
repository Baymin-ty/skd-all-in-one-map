import { ICONS, type IconName } from './icons'
import { allMapLabels, defaultMapLabels, type MapLabelCategory, type MapLabelVisibility } from './mapLabelCategories'

export type MapMode = 'all' | 'mine'
export type MapPlaceRole = 'dorm' | 'lab' | 'office' | 'fav'

export interface MapPlace {
  id: string
  role: MapPlaceRole
  place: string
  room?: string
  label?: string
}

export interface MapMarker {
  id: string
  pos: [number, number]
  name: string
  note?: string
  icon: IconName
}

/** Local (or account-synced) preferences for the personal map. */
export interface MapPrefs {
  mode: MapMode
  /** Each map mode keeps its own visibility choices. */
  labels: Record<MapMode, MapLabelVisibility>
  places: MapPlace[]
  markers: MapMarker[]
}

const ROLES: readonly MapPlaceRole[] = ['dorm', 'lab', 'office', 'fav']
const MODES: readonly MapMode[] = ['all', 'mine']
const CATEGORIES = Object.keys(allMapLabels(true)) as MapLabelCategory[]

const cloneLabels = (labels: MapLabelVisibility): MapLabelVisibility => ({ ...labels })
const clonePrefs = (prefs: MapPrefs): MapPrefs => ({
  mode: prefs.mode,
  labels: { all: cloneLabels(prefs.labels.all), mine: cloneLabels(prefs.labels.mine) },
  places: prefs.places.map((place) => ({ ...place })),
  markers: prefs.markers.map((marker) => ({ ...marker, pos: [marker.pos[0], marker.pos[1]] })),
})

export function defaultMapPrefs(): MapPrefs {
  return {
    mode: 'all',
    labels: { all: defaultMapLabels(), mine: defaultMapLabels() },
    places: [],
    markers: [],
  }
}

export function labelsForMode(prefs: MapPrefs, mode = prefs.mode): MapLabelVisibility {
  return prefs.labels[mode]
}

export function setMapMode(prefs: MapPrefs, mode: MapMode): MapPrefs {
  const next = clonePrefs(prefs)
  next.mode = mode
  return next
}

export function setMapLabel(prefs: MapPrefs, mode: MapMode, category: MapLabelCategory, visible: boolean): MapPrefs {
  const next = clonePrefs(prefs)
  next.labels[mode][category] = visible
  return next
}

export function setMapLabels(prefs: MapPrefs, mode: MapMode, labels: MapLabelVisibility): MapPrefs {
  const next = clonePrefs(prefs)
  next.labels[mode] = normalizeLabels(labels, next.labels[mode])
  return next
}

function normalizeLabels(raw: unknown, fallback: MapLabelVisibility): MapLabelVisibility {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const next = cloneLabels(fallback)
  for (const category of CATEGORIES) if (typeof source[category] === 'boolean') next[category] = source[category] as boolean
  return next
}

function validRole(value: unknown): value is MapPlaceRole {
  return typeof value === 'string' && ROLES.includes(value as MapPlaceRole)
}

function cleanPlace(value: unknown, validPlaceIds?: Set<string>): MapPlace | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const place = typeof source.place === 'string' ? source.place.trim() : ''
  if (!id || !place || !validRole(source.role) || validPlaceIds && !validPlaceIds.has(place)) return null
  const out: MapPlace = { id, role: source.role, place }
  if (typeof source.room === 'string' && source.room.trim()) out.room = source.room.trim()
  if (typeof source.label === 'string' && source.label.trim()) out.label = source.label.trim()
  return out
}

function cleanMarker(value: unknown): MapMarker | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  const pos = source.pos
  const icon = source.icon
  if (!id || !name || !Array.isArray(pos) || pos.length !== 2 || !pos.every((x) => typeof x === 'number' && Number.isFinite(x)) || typeof icon !== 'string' || !Object.prototype.hasOwnProperty.call(ICONS, icon)) return null
  const out: MapMarker = { id, pos: [pos[0], pos[1]], name, icon: icon as IconName }
  if (typeof source.note === 'string' && source.note.trim()) out.note = source.note.trim()
  return out
}

/**
 * Parse persisted data defensively. Unknown fields are ignored and stale place
 * records can be removed by passing the current set of map place ids.
 *
 * Older drafts stored one flat `labels` object; that shape is accepted and
 * copied into both modes so a migration never silently loses visibility choices.
 */
export function normalizeMapPrefs(raw: unknown, validPlaceIds?: Iterable<string>): MapPrefs {
  const defaults = defaultMapPrefs()
  if (!raw || typeof raw !== 'object') return defaults
  const source = raw as Record<string, unknown>
  const mode: MapMode = MODES.includes(source.mode as MapMode) ? source.mode as MapMode : defaults.mode
  const rawLabels = source.labels
  const labelsObject = rawLabels && typeof rawLabels === 'object' ? rawLabels as Record<string, unknown> : null
  const hasSplitLabels = !!labelsObject && ('all' in labelsObject || 'mine' in labelsObject)
  const labels = hasSplitLabels
    ? { all: normalizeLabels(labelsObject?.all, defaults.labels.all), mine: normalizeLabels(labelsObject?.mine, defaults.labels.mine) }
    : { all: normalizeLabels(rawLabels, defaults.labels.all), mine: normalizeLabels(rawLabels, defaults.labels.mine) }
  const ids = validPlaceIds && new Set(validPlaceIds)
  const places: MapPlace[] = []
  if (Array.isArray(source.places)) for (const value of source.places) {
    const place = cleanPlace(value, ids)
    if (place && !places.some((x) => x.id === place.id)) places.push(place)
  }
  const markers: MapMarker[] = []
  if (Array.isArray(source.markers)) for (const value of source.markers) {
    const marker = cleanMarker(value)
    if (marker && !markers.some((x) => x.id === marker.id)) markers.push(marker)
  }
  return { mode, labels, places, markers }
}

/** Remove personal places that point to buildings/POIs deleted from the map. */
export function pruneMapPlaces(prefs: MapPrefs, validPlaceIds: Iterable<string>): MapPrefs {
  const ids = new Set(validPlaceIds)
  const next = clonePrefs(prefs)
  next.places = next.places.filter((place) => ids.has(place.place))
  return next
}

export function upsertMapPlace(prefs: MapPrefs, place: MapPlace): MapPrefs {
  const next = clonePrefs(prefs)
  const i = next.places.findIndex((item) => item.id === place.id)
  if (i < 0) next.places.push({ ...place })
  else next.places[i] = { ...place }
  return next
}

export function removeMapPlace(prefs: MapPrefs, id: string): MapPrefs {
  const next = clonePrefs(prefs)
  next.places = next.places.filter((place) => place.id !== id)
  return next
}

export function upsertMapMarker(prefs: MapPrefs, marker: MapMarker): MapPrefs {
  const next = clonePrefs(prefs)
  const i = next.markers.findIndex((item) => item.id === marker.id)
  if (i < 0) next.markers.push({ ...marker, pos: [marker.pos[0], marker.pos[1]] })
  else next.markers[i] = { ...marker, pos: [marker.pos[0], marker.pos[1]] }
  return next
}

export function removeMapMarker(prefs: MapPrefs, id: string): MapPrefs {
  const next = clonePrefs(prefs)
  next.markers = next.markers.filter((marker) => marker.id !== id)
  return next
}

/** Useful when a caller wants to reset one mode without affecting the other. */
export function resetMapLabels(prefs: MapPrefs, mode: MapMode, visible = true): MapPrefs {
  const next = clonePrefs(prefs)
  next.labels[mode] = allMapLabels(visible)
  return next
}
