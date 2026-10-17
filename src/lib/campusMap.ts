import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BaiduCRS, baiduTiles } from './geo'
import type { Campus } from './types'
import './mapPresentation.css'

/** Frontend, editor and appearance preview share the same tile and zoom pipeline. */
export function createCampusMap(element: HTMLElement, campus: Campus) {
  const map = L.map(element, {
    crs: BaiduCRS, zoomControl: false, attributionControl: false,
    minZoom: 15, maxZoom: 20,
    // Fractional tile scales expose hairline gaps. Keep resting zooms on full pixels.
    zoomSnap: 1, zoomDelta: 1, wheelPxPerZoomLevel: 120,
  })
  const [[x0, y0], [x1, y1]] = campus.bounds
  baiduTiles({
    minZoom: 14, maxZoom: 20, maxNativeZoom: 19, keepBuffer: 4,
    bounds: L.latLngBounds([y0 - 0.006, x0 - 0.006], [y1 + 0.006, x1 + 0.006]),
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  }).addTo(map)
  return map
}
