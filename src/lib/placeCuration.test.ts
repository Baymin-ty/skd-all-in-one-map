import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Places } from './types'
import { poiPresentation } from './mapLabels'
import { visibleEntrances } from './mapEntrances'
import { outlineLatLngs } from './outlineGeometry'
import { discovery } from './discoveryData'
import { groupBuildings } from './groups'
vi.mock('./ui', () => ({ openSheet: vi.fn(), ui: { desktop: true, sheet: 388, anchors: [136, 388, 740] } }))
import { endFor, placeSelection, search, state } from './store'

const places: Places = JSON.parse(readFileSync(new URL('../../public/data/places.json', import.meta.url), 'utf8'))
beforeEach(() => {
  state.buildings = structuredClone(places.buildings); state.pois = structuredClone(places.pois)
  state.groups = groupBuildings(state.buildings); state.categories = places.categories
  state.route.picking = null
  discovery.canteens = JSON.parse(readFileSync(new URL('../../public/data/canteens.json', import.meta.url), 'utf8')).canteens
  discovery.events = []
})
describe('统一地点身份', () => {
  it.each(['体育场', '运动场', '操场'])('%s 只找到一个操场', (q) => {
    expect(search(q).filter((h) => h.sel.kind === 'building' || h.sel.kind === 'poi').map((h) => h.sel.id)).toEqual(['dbe3b0a1'])
  })
  it('H1/H2 保留别名，医务室与校史馆进入独立建筑，旧点位链接仍能定位', () => {
    expect(search('H1')[0].name).toBe('校园服务中心')
    expect(search('H2')[0].name).toBe('学生科创中心')
    for (const id of ['c678e4ab', 'poi-history', 'e32fb679', '5149e81e']) expect(placeSelection(id)).toEqual({ kind: 'building', id })
    expect(placeSelection('03953523')).toEqual({ kind: 'building', id: '5149e81e' })
    expect(placeSelection('a7e65a53')).toEqual({ kind: 'building', id: 'dbe3b0a1' })
    expect(endFor(placeSelection('c678e4ab')!)?.poly).toHaveLength(12)
  })
  it('食堂与咖啡店搜索不再同时出现重复地点；导航仍保留可选地点', () => {
    for (const q of ['KFC', '丝路', '科大咖啡馆', '耐斯咖啡', '耐思咖啡']) {
      const hits = search(q).filter((h) => ['building', 'poi', 'canteen'].includes(h.sel.kind))
      expect(hits, `${q}: ${JSON.stringify(hits)}`).toHaveLength(1)
    }
    state.route.picking = 'to'
    expect(search('KFC').some((h) => h.sel.kind === 'building')).toBe(true)
  })
  it('菜单位置与所属建筑一致，咖啡馆旧点位可以导航到新轮廓', () => {
    for (const c of discovery.canteens) expect(c.pos).toEqual(places.buildings.find((b) => b.id === c.place)!.center)
    const cafe = places.buildings.find((b) => b.id === '5149e81e')!
    expect(endFor(placeSelection('03953523')!)?.poly).toEqual(cafe.poly)
  })
})
describe('按需要展示点位和入口', () => {
  it('车库口不会因放大或普通详细展示出现；选中、筛选或导航时才显示', () => {
    const garage = places.pois.find((p) => p.cat === 'parking')!
    expect(poiPresentation(garage, { zoom: 20, detailed: true, emphasized: false })).toBe('hidden')
    expect(poiPresentation(garage, { zoom: 17, detailed: false, emphasized: true })).toBe('full')
    const secondary = places.pois.find((p) => p.id === '076e5a66')!
    expect(poiPresentation(secondary, { zoom: 20, detailed: false, emphasized: false })).toBe('hidden')
    expect(poiPresentation(secondary, { zoom: 20, detailed: false, emphasized: true })).toBe('full')
  })
  it('普通选楼不铺入口，主动查看展开全楼，导航只显示实际端点附近的入口', () => {
    const b = places.buildings.find((b) => (b.entrances?.length ?? 0) >= 2)!
    expect(visibleEntrances([b], '', [])).toEqual([])
    expect(visibleEntrances([b], b.id, [])).toHaveLength(b.entrances!.length)
    const result = visibleEntrances([b], '', [{ buildingId: b.id, point: b.entrances![1].pos }])
    expect(result.map((x) => x.entrance)).toEqual([b.entrances![1]])
  })
  it('跑道和看台渲染为两个独立多边形，之间草地不参与选中', () => {
    const stadium = places.buildings.find((b) => b.id === 'dbe3b0a1')!
    const polygons = outlineLatLngs(stadium)
    expect(polygons).toHaveLength(2)
    expect(polygons.every((p) => p.length === 1)).toBe(true)
  })
})
