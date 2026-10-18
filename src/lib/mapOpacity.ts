import type L from 'leaflet'
import { toLatLng } from './geo'
import { outlineRings, type OutlineGeometry } from './outlineGeometry'
import { DEFAULT_MAP_SETTINGS } from './mapSettings'
import { FadedTileLayer, type Bbox, type VeilBuilding, type VeilEffect } from './fadedTileLayer'
import { blendCss, parseColor, type RGB } from './fadedTiles'

/** 盖在底图上的底色 #fbfaf7 */
const VEIL: RGB = [0xfb, 0xfa, 0xf7]
type Shape = OutlineGeometry & { id: string }

const sameRings = (a: readonly Float64Array[], b: readonly Float64Array[]) =>
  a.length === b.length && a.every((ring, i) => ring.length === b[i].length && ring.every((v, k) => v === b[i][k]))

/**
 * 用底色遮罩淡化底图，建筑轮廓处按各自透明度露出原图（边缘羽化 6px）。
 * 效果预先合成进 canvas 瓦片（见 fadedTileLayer.ts），缩放时只缩放位图；
 * 透明度或轮廓变化时只重算受影响的瓦片。
 */
export function createMapOpacity(map: L.Map, buildings: Shape[]) {
  let layer: FadedTileLayer | undefined
  map.eachLayer((l) => { if (l instanceof FadedTileLayer) layer = l })
  // 瓦片范围外只有容器底色：按背景透明度预先混入遮罩色，与瓦片边缘衔接
  const container = map.getContainer()
  const baseColor = parseColor(getComputedStyle(container).backgroundColor)
  const paintContainer = () => {
    if (baseColor && baseColor[3] > 0) container.style.backgroundColor = blendCss([baseColor[0], baseColor[1], baseColor[2]], VEIL, 1 - effect.background)
  }
  const shapes = new Map<string, { source: Shape; shape: VeilBuilding }>()
  let opacityFor: (building: Shape) => number = () => DEFAULT_MAP_SETTINGS.selectable
  const effect: VeilEffect = { color: VEIL, background: DEFAULT_MAP_SETTINGS.background, buildings: [] }

  function project(building: Shape): VeilBuilding {
    const bbox: VeilBuilding['bbox'] = [Infinity, Infinity, -Infinity, -Infinity]
    const rings = outlineRings(building).filter((ring) => ring.length >= 3).map((ring) => {
      const points = new Float64Array(ring.length * 2)
      ring.forEach((p, i) => {
        const { x, y } = map.project(toLatLng(p), 18)
        points[i * 2] = x
        points[i * 2 + 1] = y
        bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y)
        bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y)
      })
      return points
    })
    return { id: building.id, rings, bbox, value: NaN }
  }

  /** 按当前透明度刷新各楼的遮罩值，只重算值有变化的楼附近的瓦片 */
  function apply(dirty: Bbox[], all = false) {
    for (const { source, shape } of shapes.values()) {
      const value = 1 - opacityFor(source)
      if (value === shape.value) continue
      if (!Number.isNaN(shape.value)) dirty.push(shape.bbox)
      shape.value = value
    }
    if (all) layer?.invalidate('all')
    else layer?.invalidate(dirty)
  }

  function setBuildings(next: Shape[], refresh = true) {
    const dirty: Bbox[] = []
    const previous = new Map(shapes)
    shapes.clear()
    for (const source of next) {
      const old = previous.get(source.id)
      previous.delete(source.id)
      // 同一对象视为轮廓未变，免得每次都重新投影
      if (old?.source === source) { shapes.set(source.id, old); continue }
      const shape = project(source)
      if (old && sameRings(old.shape.rings, shape.rings)) shape.value = old.shape.value
      else { if (old) dirty.push(old.shape.bbox); dirty.push(shape.bbox) }
      shapes.set(source.id, { source, shape })
    }
    for (const { shape } of previous.values()) dirty.push(shape.bbox)
    effect.buildings = [...shapes.values()].map(({ shape }) => shape)
    if (refresh) apply(dirty)
  }

  function update(next: (building: Shape) => number, backgroundOpacity = DEFAULT_MAP_SETTINGS.background) {
    opacityFor = next
    const backgroundChanged = backgroundOpacity !== effect.background
    if (backgroundChanged) {
      effect.background = backgroundOpacity
      paintContainer()
    }
    apply([], backgroundChanged)
  }

  setBuildings(buildings, false)
  update(() => DEFAULT_MAP_SETTINGS.selectable)
  paintContainer()
  layer?.setVeil(effect)
  return { update, setBuildings: (next: Shape[]) => setBuildings(next) }
}
