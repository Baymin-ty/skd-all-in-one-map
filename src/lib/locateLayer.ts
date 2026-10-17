import L from 'leaflet'
import { watch } from 'vue'
import { fromLatLng, toLatLng } from './geo'
import { locator, setMockPosition } from './locate'
import './locateLayer.css'

/** 蓝点 + 精度圈 + 朝向扇形。拖动地图后停止跟随；模拟定位时右键或长按地图换位置。返回清理函数。 */
export function mountLocateLayer(map: L.Map) {
  const accuracy = L.circle([0, 0], { radius: 1, stroke: true, color: '#2f6fd6', weight: 1, opacity: .35, fillColor: '#2f6fd6', fillOpacity: .12, interactive: false })
  const dot = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: '<div class="me-dot"><i class="me-cone"></i><b></b></div>', iconSize: [0, 0] }),
    interactive: false, keyboard: false, zIndexOffset: 2000,
  })
  const stop = watch(() => [locator.pos, locator.accuracy, locator.heading], () => {
    if (!locator.pos) {
      accuracy.remove()
      dot.remove()
      return
    }
    const ll = toLatLng(locator.pos)
    accuracy.setLatLng(ll).setRadius(Math.max(locator.accuracy, 4)).addTo(map)
    dot.setLatLng(ll).addTo(map)
    const cone = dot.getElement()?.querySelector<HTMLElement>('.me-cone')
    if (cone) {
      cone.hidden = locator.heading == null
      cone.style.transform = `rotate(${locator.heading ?? 0}deg)`
    }
  })
  const unfollow = () => { locator.follow = false }
  const mock = (e: L.LeafletMouseEvent) => {
    if (!locator.mock) return
    e.originalEvent.preventDefault()
    setMockPosition(fromLatLng(e.latlng))
  }
  map.on('dragstart', unfollow)
  map.on('contextmenu', mock)
  return () => {
    stop()
    map.off('dragstart', unfollow)
    map.off('contextmenu', mock)
    accuracy.remove()
    dot.remove()
  }
}
