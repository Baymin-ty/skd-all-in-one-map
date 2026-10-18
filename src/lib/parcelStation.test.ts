import { describe, expect, it } from 'vitest'
import { findParcel, neighbors, openParcelStationMap, PARCEL_ITEMS, PARCEL_POI, parcel, parcelItem, parcelSearchHint, queryFor, resultTitle, shelfNumbers } from './parcelStation'
import { fitLabel, itemAt, itemBox, planSize, planSvg, toBox } from './parcelPlanSvg'

const ids = (q: string) => findParcel(q).items.map((i) => i.id).sort()

describe('快递站找货架', () => {
  it('从固定入口打开快递站地图时不需要先输入取件码', () => {
    parcel.open = false
    parcel.query = '15-3-2045'
    parcel.poi = ''

    openParcelStationMap()

    expect(parcel.open).toBe(true)
    expect(parcel.query).toBe('')
    expect(parcel.poi).toBe(PARCEL_POI)
  })

  it('打开快递站前允许关闭互斥的导航状态', () => {
    parcel.open = false
    let closed = false

    openParcelStationMap(() => { closed = true })

    expect(closed).toBe(true)
    expect(parcel.open).toBe(true)
  })

  it('取件码按「货架-层-编号」理解，全角、空格、点都能当分隔', () => {
    for (const q of ['15-3-2045', '１５－３－２０４５', '15 3 2045', '15.3.2045', '取件码：15-3-2045', '015-03-2045']) {
      const r = findParcel(q)
      expect(r.items.map((i) => i.id), q).toEqual(['s15'])
      expect(r.layer, q).toBe('3')
    }
    expect(findParcel('15-3-2045').serial).toBe('2045')
    expect(findParcel('15-2045')).toMatchObject({ layer: undefined, serial: '2045' })
  })

  it('1 号货架分成 1-1、1-2 两段：写全了就是那一段，只写 1 就两段都标', () => {
    expect(ids('1-2')).toEqual(['s1-2'])
    expect(ids('1-1-3-2045')).toEqual(['s1-1'])
    expect(findParcel('1-1-3-2045').layer).toBe('3')
    // 三段的取件码仍是「货架-层-编号」：1 号货架第 2 层
    expect(ids('1-2-2045')).toEqual(['s1-1', 's1-2'])
    expect(findParcel('1-2-2045').layer).toBe('2')
    expect(ids('1')).toEqual(['s1-1', 's1-2'])
    expect(resultTitle(findParcel('1'))).toBe('1 号货架')
  })

  it('1-1 和 1-2 的地图位置按现场标注排列', () => {
    expect(parcelItem('s1-2')!.rect[0]).toBeLessThan(parcelItem('s1-1')!.rect[0])
  })

  it('同一个数字也可能是智能柜，作为备选给出', () => {
    const r = findParcel('3')
    expect(r.items.map((i) => i.id)).toEqual(['s3'])
    expect(r.also.map((i) => i.id)).toEqual(['l3'])
    expect(findParcel('15-3').also).toEqual([])
  })

  it('智能柜、货架、设施都能用中文搜', () => {
    expect(ids('3号柜')).toEqual(['l3'])
    expect(ids('3 号智能柜')).toEqual(['l3'])
    expect(ids('智能柜5')).toEqual(['l5'])
    expect(ids('智能柜')).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6'])
    expect(ids('15号货架')).toEqual(['s15'])
    expect(ids('货架 20')).toEqual(['s20'])
    expect(ids('前台')).toEqual(['desk'])
    expect(ids('扫码')).toEqual(['scanner'])
    expect(ids('厕所')).toEqual(['wc-f', 'wc-m'])
    expect(ids('入口')).toEqual(['entry'])
  })

  it('图上标了两处的编号一起标出来，没有的编号说清楚', () => {
    expect(ids('36')).toEqual(['s36', 's36b'])
    expect(resultTitle(findParcel('36'))).toBe('36 号货架')
    expect(findParcel('30')).toMatchObject({ items: [], missing: '30 号货架' })
    expect(findParcel('9号柜')).toMatchObject({ items: [], missing: '9 号智能柜' })
    expect(shelfNumbers()).toBe('1–29、31–34、36、45')
  })

  it('点了格子之后填进搜索框的字能搜回它自己', () => {
    for (const item of PARCEL_ITEMS.filter((i) => i.name)) expect(ids(queryFor(item)), item.id).toContain(item.id)
  })

  it('相邻只算共用一段边的格子', () => {
    expect(neighbors(parcelItem('s18')!).map((i) => i.id).sort()).toEqual(['l1', 's19'])
    expect(neighbors(parcelItem('s1-2')!).map((i) => i.id).sort()).toEqual(['mail', 's1-1'])
  })

  it('主搜索框优先识别货架号、取件码和货架关键词', () => {
    expect(parcelSearchHint('15-3-2045')).toEqual({ name: '快递站 · 15 号货架', sub: '第 3 层 · 在货架平面图上高亮' })
    expect(parcelSearchHint('3号智能柜')?.name).toBe('快递站 · 3 号智能柜')
    expect(parcelSearchHint('货架30')?.sub).toContain('图上没有 30 号货架')
    expect(parcelSearchHint('11')).toEqual({ name: '快递站 · 11 号货架', sub: '在货架平面图上高亮' })
    expect(parcelSearchHint('11号')).toEqual({ name: '快递站 · 11 号货架', sub: '在货架平面图上高亮' })
    expect(parcelSearchHint('15')).toEqual({ name: '快递站 · 15 号货架', sub: '在货架平面图上高亮' })
    expect(parcelSearchHint('36')?.name).toBe('快递站 · 36 号货架')
    // 图上没有这个编号时，纯数字不抢占普通搜索；写了「货架」才提示缺号。
    expect(parcelSearchHint('30')).toBeNull()
    expect(parcelSearchHint('1A-108')).toBeNull()
    expect(parcelSearchHint('2-302')).toBeNull()
  })
})

describe('货架平面图排版', () => {
  it('竖屏转 90° 后所有格子仍在画布内，格子之间的相对位置不变', () => {
    for (const rotated of [false, true]) {
      const [w, h] = planSize(rotated)
      for (const item of PARCEL_ITEMS) {
        const [x, y, bw, bh] = itemBox(item, rotated)
        expect(x, item.id).toBeGreaterThanOrEqual(0)
        expect(y, item.id).toBeGreaterThanOrEqual(0)
        expect(x + bw, item.id).toBeLessThanOrEqual(w)
        expect(y + bh, item.id).toBeLessThanOrEqual(h)
      }
    }
    // 顺时针转：原图左边的 20 号到了 19 号上面，站内（原图上方）到了右边
    const [, y20] = toBox(parcelItem('s20')!.rect, true), [, y19] = toBox(parcelItem('s19')!.rect, true)
    expect(y20).toBeLessThan(y19)
    const [xDesk] = toBox(parcelItem('desk')!.rect, true), [xLocker] = toBox(parcelItem('l1')!.rect, true)
    expect(xDesk).toBeGreaterThan(xLocker)
  })

  it('窄格子里的中文竖排，宽格子横排；数字窄格整体转向', () => {
    expect(fitLabel('2号智能柜', 176, 35, 14).mode).toBe('line')
    expect(fitLabel('2号智能柜', 35, 176, 14)).toMatchObject({ mode: 'stack', size: 14 })
    expect(fitLabel('1-1', 18, 66, 16).mode).toBe('turn')
    expect(fitLabel('1-1', 66, 18, 16).mode).toBe('line')
  })

  it('点图上的格子：落在格子里取最小那格，小格子旁边点一下也算', () => {
    const [x, y, w, h] = itemBox(parcelItem('s15')!, false)
    expect(itemAt([x + w / 2, y + h / 2], false, 0)?.id).toBe('s15')
    const [sx, sy, , sh] = itemBox(parcelItem('scanner')!, true)
    expect(itemAt([sx - 6, sy + sh / 2], true, 10)?.id).toBe('scanner')
    expect(itemAt([5, 5], false, 4)).toBeUndefined()
  })

  it('每个能搜的格子在 SVG 里都有 data-id，好按结果标红', () => {
    const svg = planSvg(true)
    for (const item of PARCEL_ITEMS.filter((i) => i.name)) expect(svg).toContain(`data-id="${item.id}"`)
    expect(svg).not.toContain('undefined')
    expect(svg).not.toContain('NaN')
  })
})
