import L from 'leaflet'
import { applyLut, blurReach, compositeVeil, gaussianBlur, rasterizeMask, saturate, toneLut, type MaskShape, type RGB } from './fadedTiles'

const TILE = 256
/** 建筑轮廓边缘的羽化宽度（屏幕像素，高斯 σ）。 */
const EDGE_SOFTNESS_PX = 6
// 只小幅提亮最深的色块，调整在 40% 色阶处归零，中间调和亮部沿用原值。
const SHADOW_TONES = [0.14, 0.225, 0.30, 0.375, 0.46, 0.56, 0.66, 0.75, 0.84, 0.92, 1]
// 保留底图原本的饱和度（1 = 不变），避免草地、水面和建筑颜色发灰。
const MAP_SATURATION = 1
const LUT = toneLut(SHADOW_TONES)
/** 每帧最多花在瓦片处理上的时间，超出的留到下一帧。 */
const FRAME_BUDGET_MS = 6

/** z18 像素坐标下的楼：value = 该处底色遮罩的不透明度（1 − 建筑透明度）。 */
export interface VeilBuilding extends MaskShape { id: string; bbox: [number, number, number, number] }
export interface VeilEffect { color: RGB; background: number; buildings: VeilBuilding[] }
export type Bbox = readonly [number, number, number, number]

type TileCanvas = HTMLCanvasElement & { complete?: boolean }
interface TileEntry {
  canvas: TileCanvas
  coords: L.Coords
  img: HTMLImageElement | null
  /** 已调色、未盖遮罩的像素，换透明度时直接从这里重算 */
  toned: Uint8ClampedArray | null
  sigma: number
  done?: L.DoneCallback
}

let scratch: CanvasRenderingContext2D | null = null
let output: ImageData | null = null
function readPixels(source: CanvasImageSource) {
  if (!scratch) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = TILE
    scratch = canvas.getContext('2d', { willReadFrequently: true })!
  }
  scratch.clearRect(0, 0, TILE, TILE)
  scratch.drawImage(source, 0, 0)
  return scratch.getImageData(0, 0, TILE, TILE).data
}

interface Stat { n: number; ms: number; max: number }
// 开发环境下记录每块瓦片的处理耗时，便于在控制台查看
const stats = import.meta.env.DEV && typeof window !== 'undefined' ? { first: { n: 0, ms: 0, max: 0 }, recomposite: { n: 0, ms: 0, max: 0 } } : null
if (stats) (window as unknown as { __fadedTileStats: typeof stats }).__fadedTileStats = stats
const record = (stat: Stat | undefined, t0: number) => {
  if (!stat) return
  const ms = performance.now() - t0
  stat.n++; stat.ms += ms; stat.max = Math.max(stat.max, ms)
}

/**
 * 百度编号的本地瓦片（y 写成 -y-1），以 canvas 输出。设置了遮罩效果后，
 * 每块瓦片加载时套用色阶，再按建筑透明度预先合成底色遮罩；缩放时只是缩放位图。
 */
export class FadedTileLayer extends L.TileLayer {
  private veilEffect: VeilEffect | null = null
  private tileEntries = new Map<string, TileEntry>()
  /** 已解码、等待首次绘制的瓦片 */
  private freshKeys = new Set<string>()
  /** 透明度变化后需要重新合成的瓦片 */
  private dirtyKeys = new Set<string>()
  private rafId = 0
  private zoomBusy = false

  constructor(options: L.TileLayerOptions) {
    super('', options)
    this.on('tileunload tileabort', (event) => {
      const e = event as L.TileEvent
      const key = this._tileCoordsToKey(e.coords)
      const entry = this.tileEntries.get(key)
      if (!entry || entry.canvas !== (e.tile as HTMLElement)) return
      this.tileEntries.delete(key)
      this.freshKeys.delete(key)
      this.dirtyKeys.delete(key)
      if (entry.img) { entry.img.src = ''; entry.img = null }
    })
  }

  getTileUrl(c: L.Coords) {
    return `/tiles/${c.z}/tile${c.x}_${-c.y - 1}.png`
  }

  getEvents() {
    return { ...L.TileLayer.prototype.getEvents!.call(this), zoomstart: this.onZoomStart, zoomend: this.onZoomEnd }
  }

  onRemove(map: L.Map) {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    return super.onRemove(map)
  }

  /** 设置（或取消）遮罩效果，已加载的瓦片全部重新合成。 */
  setVeil(effect: VeilEffect | null) {
    this.veilEffect = effect
    this.invalidate('all')
  }

  /** 标记与这些 z18 范围相交的瓦片待重算；视野内优先，分帧完成，缩放中推迟到 zoomend。 */
  invalidate(regions: 'all' | readonly Bbox[]) {
    if (regions !== 'all' && !regions.length) return
    for (const [key, entry] of this.tileEntries) {
      if (this.freshKeys.has(key) || entry.img) continue
      if (regions === 'all' || regions.some((r) => this.touches(entry, r))) this.dirtyKeys.add(key)
    }
    this.schedule()
  }

  createTile(coords: L.Coords, done: L.DoneCallback) {
    const canvas: TileCanvas = document.createElement('canvas')
    canvas.width = canvas.height = TILE
    // Leaflet 换级时用 complete 判断是否还在加载
    canvas.complete = false
    canvas.setAttribute('role', 'presentation')
    const key = this._tileCoordsToKey(coords)
    const img = new Image()
    const entry: TileEntry = { canvas, coords, img, toned: null, sigma: NaN }
    this.tileEntries.set(key, entry)
    img.decoding = 'async'
    img.src = this.getTileUrl(coords)
    img.decode().then(() => {
      if (this.tileEntries.get(key) !== entry) return
      entry.done = done
      this.freshKeys.add(key)
      this.schedule()
    }, () => {
      if (this.tileEntries.get(key) !== entry) return
      // 缺瓦片时留空，露出（已预混遮罩色的）容器底色，之后也不再参与重算
      this.tileEntries.delete(key)
      entry.img = null
      canvas.complete = true
      done(new Error(`tile ${key} failed`), canvas)
    })
    return canvas
  }

  private onZoomStart() { this.zoomBusy = true }

  private onZoomEnd() {
    this.zoomBusy = false
    // 超出原生级别时同一批瓦片被放大显示，羽化半径要按屏幕像素重算
    for (const [key, entry] of this.tileEntries) {
      if (entry.toned && this.veilEffect && this.sigmaFor(entry.coords.z) !== entry.sigma) this.dirtyKeys.add(key)
    }
    this.schedule()
  }

  private sigmaFor(z: number) {
    const zoom = Math.round(this._map?.getZoom() ?? z)
    return z === this._tileZoom && zoom > z ? EDGE_SOFTNESS_PX / 2 ** (zoom - z) : EDGE_SOFTNESS_PX
  }

  /** 瓦片（含模糊外扩）是否与 z18 范围相交 */
  private touches(entry: TileEntry, [x0, y0, x1, y1]: Bbox) {
    const { x, y, z } = entry.coords
    const scale = 2 ** (z - 18)
    const margin = blurReach(Number.isNaN(entry.sigma) ? EDGE_SOFTNESS_PX : entry.sigma) + 1
    return (x * TILE - margin) / scale < x1 && ((x + 1) * TILE + margin) / scale > x0
      && (y * TILE - margin) / scale < y1 && ((y + 1) * TILE + margin) / scale > y0
  }

  private schedule() {
    if (!this.rafId && this._map) this.rafId = requestAnimationFrame(() => this.flush())
  }

  private flush() {
    this.rafId = 0
    const map = this._map
    if (!map) return
    const start = performance.now()
    // 当前视野对应的瓦片范围，优先处理
    const z = this._tileZoom ?? Math.round(map.getZoom())
    const px = map.getPixelBounds()
    const s = map.getZoomScale(z, map.getZoom()) / TILE
    const inView = ({ coords: c }: TileEntry) => c.z === z
      && c.x >= Math.floor(px.min!.x * s) && c.x <= Math.floor(px.max!.x * s)
      && c.y >= Math.floor(px.min!.y * s) && c.y <= Math.floor(px.max!.y * s)
    const pick = (keys: Set<string>) => {
      let fallback: string | undefined
      for (const key of keys) {
        const entry = this.tileEntries.get(key)
        if (!entry) { keys.delete(key); continue }
        if (inView(entry)) return key
        fallback ??= key
      }
      return fallback
    }
    while (performance.now() - start < FRAME_BUDGET_MS) {
      let key = pick(this.freshKeys)
      if (key) { this.freshKeys.delete(key); this.firstPaint(this.tileEntries.get(key)!); continue }
      if (this.zoomBusy) break
      key = pick(this.dirtyKeys)
      if (!key) break
      this.dirtyKeys.delete(key)
      const t0 = performance.now()
      this.paint(this.tileEntries.get(key)!)
      record(stats?.recomposite, t0)
    }
    if (this.freshKeys.size || (!this.zoomBusy && this.dirtyKeys.size)) this.schedule()
  }

  private firstPaint(entry: TileEntry) {
    const t0 = performance.now()
    const { canvas, img } = entry
    if (!img) return
    if (this.veilEffect) {
      entry.toned = this.tone(readPixels(img))
      this.paint(entry)
      record(stats?.first, t0)
    } else {
      canvas.getContext('2d')!.drawImage(img, 0, 0)
    }
    entry.img = null
    canvas.complete = true
    entry.done?.(undefined, canvas)
  }

  private tone(data: Uint8ClampedArray) {
    saturate(data, MAP_SATURATION)
    applyLut(data, LUT)
    return data
  }

  /** 从缓存的调色像素重新合成遮罩 */
  private paint(entry: TileEntry) {
    const effect = this.veilEffect
    const ctx = entry.canvas.getContext('2d')!
    // 先前未启用效果时画布里是原图，取一次作为调色前的像素
    entry.toned ??= this.tone(readPixels(entry.canvas))
    output ??= new ImageData(TILE, TILE)
    if (!effect) { output.data.set(entry.toned); ctx.putImageData(output, 0, 0); return }
    const { x, y, z } = entry.coords
    const sigma = this.sigmaFor(z)
    entry.sigma = sigma
    const margin = blurReach(sigma) + 1
    const size = TILE + 2 * margin
    const scale = 2 ** (z - 18)
    const ox = x * TILE - margin, oy = y * TILE - margin
    const bx0 = ox / scale, by0 = oy / scale, bx1 = (ox + size) / scale, by1 = (oy + size) / scale
    const bg = 1 - effect.background
    // 只栅格化与瓦片（含外扩）相交的楼；全部和背景同值时遮罩是常数
    const shapes = effect.buildings.filter(({ bbox: b }) => b[0] < bx1 && b[2] > bx0 && b[1] < by1 && b[3] > by0)
    let mask: Float32Array | null = null
    if (shapes.some(({ value }) => value !== bg)) {
      mask = rasterizeMask(size, size, shapes, bg, scale, ox, oy)
      gaussianBlur(mask, size, size, sigma)
    }
    compositeVeil(entry.toned, output.data, TILE, effect.color, mask, bg, size, margin)
    ctx.putImageData(output, 0, 0)
  }
}
