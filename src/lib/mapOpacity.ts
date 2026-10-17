import L from 'leaflet'
import { PAINTED_OUTLINE, toLatLng } from './geo'
import { outlineRings, type OutlineGeometry } from './outlineGeometry'
import { DEFAULT_MAP_SETTINGS } from './mapSettings'
import './mapOpacity.css'

const EDGE_SOFTNESS_PX = 6
// 只小幅提亮最深的色块，调整在 40% 色阶处归零，中间调和亮部沿用原值。
const SHADOW_TONES = '0.14 0.225 0.30 0.375 0.46 0.56 0.66 0.75 0.84 0.92 1'
const MAP_SATURATION = 1

/** 用底色遮罩淡化原瓦片，建筑轮廓作为补集中的孔，保留手绘细节。 */
export function createMapOpacity(map: L.Map, buildings: (OutlineGeometry & { id: string })[]) {
  const bounds = L.latLngBounds(PAINTED_OUTLINE.map(toLatLng)).pad(1)
  const origin = map.project(bounds.getNorthWest(), 18)
  const size = map.project(bounds.getSouthEast(), 18).subtract(origin)
  const svg = L.SVG.create('svg')
  svg.setAttribute('viewBox', `0 0 ${size.x} ${size.y}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  const defs = L.SVG.create('defs')
  const tones = L.SVG.create('filter')
  const tonesId = `map-shadow-tones-${L.Util.stamp(svg)}`
  tones.id = tonesId
  tones.setAttribute('x', '0')
  tones.setAttribute('y', '0')
  tones.setAttribute('width', '100%')
  tones.setAttribute('height', '100%')
  tones.setAttribute('color-interpolation-filters', 'sRGB')
  // 保留底图原本的饱和度，避免草地、水面和建筑颜色发灰。
  const saturation = L.SVG.create('feColorMatrix')
  saturation.setAttribute('type', 'saturate')
  saturation.setAttribute('values', String(MAP_SATURATION))
  const transfer = L.SVG.create('feComponentTransfer')
  for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'] as const) {
    const curve = L.SVG.create(channel)
    curve.setAttribute('type', 'table')
    curve.setAttribute('tableValues', SHADOW_TONES)
    transfer.append(curve)
  }
  tones.append(saturation, transfer)
  defs.append(tones)
  const feather = L.SVG.create('filter')
  const featherId = `map-feather-${L.Util.stamp(svg)}`
  feather.id = featherId
  feather.setAttribute('x', '-10%')
  feather.setAttribute('y', '-10%')
  feather.setAttribute('width', '120%')
  feather.setAttribute('height', '120%')
  feather.setAttribute('color-interpolation-filters', 'sRGB')
  const blur = L.SVG.create('feGaussianBlur')
  feather.append(blur)
  defs.append(feather)
  const mask = L.SVG.create('mask')
  const maskId = `map-opacity-${L.Util.stamp(svg)}`
  mask.id = maskId
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '0')
  mask.setAttribute('y', '0')
  mask.setAttribute('width', String(size.x))
  mask.setAttribute('height', String(size.y))
  mask.style.maskType = 'luminance'
  mask.style.colorInterpolation = 'sRGB'
  mask.style.isolation = 'isolate'

  const rect = () => {
    const node = L.SVG.create('rect')
    node.setAttribute('width', String(size.x))
    node.setAttribute('height', String(size.y))
    return node
  }
  const background = rect()
  background.setAttribute('fill', '#fff')
  mask.append(background)
  // 只羽化遮罩，原始手绘瓦片保持清晰；先合并轮廓再模糊，交叠处不会出现硬接缝。
  const cutouts = L.SVG.create('g')
  cutouts.setAttribute('filter', `url(#${featherId})`)
  cutouts.style.isolation = 'isolate'
  mask.append(cutouts)
  const paths = new Map<string, SVGPathElement>()
  function setBuildings(next: typeof buildings) {
    buildings = next
    const ids = new Set(buildings.map((b) => b.id))
    for (const [id, path] of paths) if (!ids.has(id)) { path.remove(); paths.delete(id) }
    for (const building of buildings) {
      let path = paths.get(building.id)
      if (!path) {
        path = L.SVG.create('path')
        path.setAttribute('class', 'map-opacity-cutout')
        // Overlapping silhouettes use the darker mask, keeping the clearer image.
        path.style.mixBlendMode = 'darken'
        path.dataset.building = building.id
        paths.set(building.id, path)
        cutouts.append(path)
      }
      path.setAttribute('d', outlineRings(building).filter((ring) => ring.length >= 3).map((ring) => {
        const points = ring.map((p) => map.project(toLatLng(p), 18).subtract(origin))
        return `${points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')} Z`
      }).join(' '))
    }
  }
  setBuildings(buildings)
  defs.append(mask)
  const veil = rect()
  veil.setAttribute('fill', '#fbfaf7')
  veil.setAttribute('mask', `url(#${maskId})`)
  svg.append(defs, veil)

  const pane = map.createPane('mapOpacity')
  pane.style.zIndex = '250'
  pane.style.pointerEvents = 'none'
  const layer = L.svgOverlay(svg, bounds, { pane: 'mapOpacity', interactive: false })
  // 在透明度遮罩之前校正瓦片；标签、描边和路线保持原来的颜色和对比度。
  const tilePane = map.getPane('tilePane')!
  layer.on('add', () => tilePane.style.setProperty('--map-shadow-filter', `url(#${tonesId})`))
  // viewBox 使用 z18 的坐标，反向补偿缩放，让各级地图都有约 24px 的柔和过渡带。
  const resizeFeather = () => blur.setAttribute('stdDeviation', String(EDGE_SOFTNESS_PX / map.getZoomScale(map.getZoom(), 18)))
  layer.on('add', resizeFeather)
  map.on('zoomend', resizeFeather)
  layer.on('remove', () => {
    map.off('zoomend', resizeFeather)
    tilePane.style.removeProperty('--map-shadow-filter')
  })

  function update(opacityFor: (building: OutlineGeometry & { id: string }) => number, backgroundOpacity = DEFAULT_MAP_SETTINGS.background) {
    const values = buildings.map((building) => ({ building, opacity: opacityFor(building) }))
    // 用最小透明度作为底层，三项可独立调整，也能处理全部为 100% 的情况。
    const strength = 1 - Math.min(backgroundOpacity, ...values.map(({ opacity }) => opacity))
    const shadeFor = (opacity: number) => {
      const shade = strength ? (1 - opacity) / strength * 100 : 0
      return `rgb(${shade}%, ${shade}%, ${shade}%)`
    }
    veil.setAttribute('fill-opacity', String(strength))
    background.style.fill = shadeFor(backgroundOpacity)
    for (const { building, opacity } of values) {
      const path = paths.get(building.id)!
      path.style.fill = shadeFor(opacity)
      path.dataset.opacity = String(opacity)
    }
  }
  update(() => DEFAULT_MAP_SETTINGS.selectable)
  layer.addTo(map)
  return { update, setBuildings }
}
