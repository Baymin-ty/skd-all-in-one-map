import { describe, expect, it } from 'vitest'
import { applyLut, blendCss, blurBoxes, blurReach, compositeVeil, gaussianBlur, parseColor, rasterizeMask, saturate, toneLut } from './fadedTiles'

const TONES = [0.14, 0.225, 0.30, 0.375, 0.46, 0.56, 0.66, 0.75, 0.84, 0.92, 1]

describe('色阶查找表', () => {
  it('按 feFuncX table 分段线性插值', () => {
    const lut = toneLut(TONES)
    expect(lut[0]).toBe(Math.round(0.14 * 255))
    expect(lut[255]).toBe(255)
    // 节点处取表值，节点之间线性插值
    expect(lut[51]).toBe(Math.round(0.30 * 255))
    const c = 13 / 255
    expect(lut[13]).toBe(Math.round((0.14 + c * 10 * (0.225 - 0.14)) * 255))
    expect(lut[204]).toBe(Math.round(0.84 * 255))
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1])
  })
  it('只改 RGB，不改透明度', () => {
    const data = new Uint8ClampedArray([0, 128, 255, 77])
    applyLut(data, toneLut(TONES))
    expect([...data]).toEqual([36, 143, 255, 77])
  })
  it('饱和度 1 为恒等，0 为灰度', () => {
    const data = new Uint8ClampedArray([200, 100, 50, 255])
    saturate(data, 1)
    expect([...data]).toEqual([200, 100, 50, 255])
    saturate(data, 0)
    expect(data[0]).toBe(data[1])
    expect(data[1]).toBe(data[2])
  })
})

describe('遮罩合成', () => {
  it('不透明像素：toned·(1−a) + veil·a', () => {
    const toned = new Uint8ClampedArray([0, 100, 200, 255])
    const out = new Uint8ClampedArray(4)
    compositeVeil(toned, out, 1, [250, 250, 250], null, 0.5)
    expect([...out]).toEqual([125, 175, 225, 255])
    compositeVeil(toned, out, 1, [250, 250, 250], new Float32Array([0]), 0.5)
    expect([...out]).toEqual([0, 100, 200, 255])
  })
  it('透明像素只剩底色，透明度为 a', () => {
    const out = new Uint8ClampedArray(4)
    compositeVeil(new Uint8ClampedArray(4), out, 1, [250, 240, 230], null, 0.36)
    expect([...out]).toEqual([250, 240, 230, Math.round(0.36 * 255)])
  })
  it('遮罩按外扩取瓦片对应像素', () => {
    const mask = new Float32Array(9).fill(0)
    mask[4] = 1
    const out = new Uint8ClampedArray(4)
    compositeVeil(new Uint8ClampedArray([0, 0, 0, 255]), out, 1, [255, 255, 255], mask, 0, 3, 1)
    expect([...out]).toEqual([255, 255, 255, 255])
  })
})

describe('遮罩栅格化与模糊', () => {
  const square = (x0: number, y0: number, x1: number, y1: number) => new Float64Array([x0, y0, x1, y0, x1, y1, x0, y1])
  it('楼外填背景，交叠处取较小值', () => {
    const mask = rasterizeMask(10, 10, [
      { rings: [square(0, 0, 6, 6)], value: 0.5 },
      { rings: [square(4, 4, 10, 10)], value: 0.1 },
    ], 0.36, 1, 0, 0)
    expect(mask[0]).toBeCloseTo(0.5)
    expect(mask[5 * 10 + 5]).toBeCloseTo(0.1)
    expect(mask[9 * 10 + 9]).toBeCloseTo(0.1)
    expect(mask[9 * 10]).toBeCloseTo(0.36)
  })
  it('楼可以比背景更淡（值大于背景）', () => {
    const mask = rasterizeMask(4, 4, [{ rings: [square(0, 0, 2, 4)], value: 0.8 }], 0.36, 1, 0, 0)
    expect(mask[0]).toBeCloseTo(0.8)
    expect(mask[3]).toBeCloseTo(0.36)
  })
  it('按缩放和偏移换算 z18 坐标', () => {
    // z19：坐标放大 2 倍，再减去原点 (10, 10)
    const mask = rasterizeMask(4, 4, [{ rings: [square(5, 5, 6, 6)], value: 0 }], 1, 2, 10, 10)
    expect(mask[0]).toBe(0)
    expect(mask[1 * 4 + 1]).toBe(0)
    expect(mask[2 * 4 + 2]).toBe(1)
  })
  it('三次盒式模糊：σ=6 为三次 11 宽，σ=3 为两次错位 6 宽加一次 7 宽', () => {
    expect(blurBoxes(6)).toEqual([[5, 5], [5, 5], [5, 5]])
    expect(blurBoxes(3)).toEqual([[3, 2], [2, 3], [3, 3]])
    expect(blurReach(6)).toBe(15)
  })
  it('模糊保持常数、守恒且边缘平滑过渡', () => {
    const w = 64
    const flat = new Float32Array(w * w).fill(0.36)
    gaussianBlur(flat, w, w, 6)
    for (const v of flat) expect(v).toBeCloseTo(0.36, 5)
    // 左半 0、右半 1 的阶跃：中线约 0.5，单调，离边 3σ 外恢复原值
    const step = new Float32Array(w * w)
    for (let y = 0; y < w; y++) for (let x = 32; x < w; x++) step[y * w + x] = 1
    gaussianBlur(step, w, w, 6)
    const row = [...step.subarray(20 * w, 21 * w)]
    expect(row[31] + row[32]).toBeCloseTo(1, 2)
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1] - 1e-6)
    expect(row[10]).toBeCloseTo(0, 5)
    expect(row[54]).toBeCloseTo(1, 5)
    // 与高斯 σ=6 接近：x=38（距边 6.5px ≈ 1σ）约 0.86
    expect(row[38]).toBeGreaterThan(0.8)
    expect(row[38]).toBeLessThan(0.92)
  })
})

describe('颜色', () => {
  it('解析并预混容器底色', () => {
    expect(parseColor('#fbfaf7')).toEqual([251, 250, 247, 1])
    expect(parseColor('rgb(251, 250, 247)')).toEqual([251, 250, 247, 1])
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0])
    expect(blendCss([0, 0, 0], [200, 100, 50], 0.5)).toBe('rgb(100, 50, 25)')
  })
})
