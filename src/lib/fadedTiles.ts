/**
 * 底图淡化效果的纯计算部分：色阶查找表、饱和度、遮罩栅格化、高斯模糊和遮罩合成。
 * 与 Leaflet 无关，便于单元测试；瓦片图层见 fadedTileLayer.ts。
 */

export type RGB = readonly [number, number, number]

/** 按 SVG feFuncX type="table" 的分段线性规则生成 0–255 查找表（sRGB 数值上计算）。 */
export function toneLut(table: readonly number[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  const n = table.length - 1
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    let v: number
    if (n < 1) v = n === 0 ? table[0] : c
    else {
      const k = Math.min(n - 1, Math.floor(c * n))
      v = table[k] + (c - k / n) * n * (table[k + 1] - table[k])
    }
    lut[i] = Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return lut
}

/** feColorMatrix type="saturate"；s = 1 为恒等，直接跳过。 */
export function saturate(data: Uint8ClampedArray, s: number) {
  if (s === 1) return
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ]
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    data[i] = m[0] * r + m[1] * g + m[2] * b
    data[i + 1] = m[3] * r + m[4] * g + m[5] * b
    data[i + 2] = m[6] * r + m[7] * g + m[8] * b
  }
}

/** 对 RGBA 像素的 RGB 通道套用查找表，透明度不变。 */
export function applyLut(data: Uint8ClampedArray, lut: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

/** 遮罩里一栋楼：环为 [x0, y0, x1, y1, …] 的 z18 像素坐标，value 为该处底色遮罩的不透明度。 */
export interface MaskShape { rings: readonly Float64Array[]; value: number }

/**
 * 栅格化遮罩：w×h 像素，像素 (i, j) 对应 z18 坐标 ((i + 0.5 + ox) / scale, …)。
 * 楼之间取最小值（原 SVG 的 darken，交叠处保留更清晰的一栋），楼外填 background。
 */
export function rasterizeMask(w: number, h: number, shapes: readonly MaskShape[], background: number, scale: number, ox: number, oy: number): Float32Array {
  const UNSET = 2
  const mask = new Float32Array(w * h).fill(UNSET)
  const xs: number[] = []
  for (const { rings, value } of shapes) {
    for (const ring of rings) {
      const n = ring.length >> 1
      if (n < 3) continue
      let minY = Infinity, maxY = -Infinity
      for (let k = 1; k < ring.length; k += 2) { const y = ring[k] * scale - oy; if (y < minY) minY = y; if (y > maxY) maxY = y }
      const j0 = Math.max(0, Math.ceil(minY - 0.5)), j1 = Math.min(h - 1, Math.floor(maxY - 0.5))
      for (let j = j0; j <= j1; j++) {
        // 扫描线取像素中心，奇偶规则求交点
        const sy = j + 0.5
        xs.length = 0
        for (let k = 0, p = n - 1; k < n; p = k++) {
          const ay = ring[p * 2 + 1] * scale - oy, by = ring[k * 2 + 1] * scale - oy
          if ((ay > sy) === (by > sy)) continue
          const ax = ring[p * 2] * scale - ox, bx = ring[k * 2] * scale - ox
          xs.push(ax + (sy - ay) / (by - ay) * (bx - ax))
        }
        xs.sort((a, b) => a - b)
        const row = j * w
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(w - 1, Math.ceil(xs[k + 1] - 0.5) - 1)
          for (let i = i0; i <= i1; i++) if (value < mask[row + i]) mask[row + i] = value
        }
      }
    }
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] === UNSET) mask[i] = background
  return mask
}

/**
 * SVG 规范中 feGaussianBlur 的三次盒式近似：d = ⌊σ·3√(2π)/4 + 0.5⌋，
 * 奇数时三次居中的 d；偶数时两次错开半像素的 d 加一次居中的 d+1。返回每次的 [左半径, 右半径]。
 */
export function blurBoxes(sigma: number): [number, number][] {
  const d = Math.floor(sigma * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5)
  if (d <= 1) return []
  if (d % 2) { const r = (d - 1) / 2; return [[r, r], [r, r], [r, r]] }
  const r = d / 2
  return [[r, r - 1], [r - 1, r], [r, r]]
}

/** 模糊能影响到的最远距离（像素），遮罩外扩至少这么多才能保证瓦片内结果精确。 */
export const blurReach = (sigma: number) => blurBoxes(sigma).reduce((sum, [l, r]) => sum + Math.max(l, r), 0)

function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, left: number, right: number, horizontal: boolean) {
  const len = horizontal ? w : h, lines = horizontal ? h : w
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1
  const inv = 1 / (left + right + 1)
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep
    const at = (i: number) => src[base + (i < 0 ? 0 : i >= len ? len - 1 : i) * step]
    // 边缘按最近像素延伸，滑动窗口求和
    let sum = 0
    for (let i = -left; i <= right; i++) sum += at(i)
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = sum * inv
      sum += at(i + right + 1) - at(i - left)
    }
  }
}

/** 可分离的三次盒式模糊，原地修改。 */
export function gaussianBlur(data: Float32Array, w: number, h: number, sigma: number) {
  const boxes = blurBoxes(sigma)
  if (!boxes.length) return data
  // 两个缓冲区来回倒，共 6 次，结果正好回到 data
  let src: Float32Array = data, dst: Float32Array = new Float32Array(data.length)
  for (const horizontal of [true, false]) {
    for (const [l, r] of boxes) {
      boxPass(src, dst, w, h, l, r, horizontal)
      ;[src, dst] = [dst, src]
    }
  }
  return data
}

/**
 * 把底色以遮罩不透明度 a 盖在已调色的瓦片上（源 over 目标，非预乘 RGBA）：
 * 不透明像素即 toned·(1−a) + veil·a；半透明像素再按 over 规则合成透明度。
 * mask 为 null 时整块使用常数 a。maskW/margin 描述遮罩相对瓦片的外扩。
 */
export function compositeVeil(toned: Uint8ClampedArray, out: Uint8ClampedArray, size: number, veil: RGB, mask: Float32Array | null, constant: number, maskW = size, margin = 0) {
  const [vr, vg, vb] = veil
  for (let y = 0; y < size; y++) {
    const mrow = (y + margin) * maskW + margin
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const a = mask ? mask[mrow + x] : constant
      const A = toned[i + 3]
      if (A === 255) {
        out[i] = toned[i] + (vr - toned[i]) * a
        out[i + 1] = toned[i + 1] + (vg - toned[i + 1]) * a
        out[i + 2] = toned[i + 2] + (vb - toned[i + 2]) * a
        out[i + 3] = 255
      } else {
        const ta = A / 255 * (1 - a), oa = a + ta
        if (oa <= 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue }
        out[i] = (vr * a + toned[i] * ta) / oa
        out[i + 1] = (vg * a + toned[i + 1] * ta) / oa
        out[i + 2] = (vb * a + toned[i + 2] * ta) / oa
        out[i + 3] = oa * 255
      }
    }
  }
  return out
}

/** 解析 #rrggbb 或 rgb()/rgba() 颜色；无法识别时返回 null。 */
export function parseColor(css: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim())
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, 1] }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(css.trim())
  if (!fn) return null
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

/** base 上叠一层不透明度为 a 的 top，返回 rgb() 字符串。 */
export const blendCss = (base: RGB, top: RGB, a: number) =>
  `rgb(${base.map((c, i) => Math.round(c + (top[i] - c) * a)).join(', ')})`
