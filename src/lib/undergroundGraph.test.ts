import { describe, expect, it } from 'vitest'
import type { LngLat, UndergroundMap } from './types'
import {
  addNode, components, connect, degree, graphFromMap, graphIssues, graphToMap, graphToRoads, importSketch,
  mergeNodes, removeEdge, removeNode, splitEdge, type UndergroundGraph, type UgEdgeProps,
} from './undergroundGraph'

const props: UgEdgeProps = { status: 'confirmed', mode: 'car' }
const base: UndergroundMap = { version: 1, floor: -1, bounds: [[121.59, 31.17], [121.62, 31.2]], sources: [], roads: [], connectors: [] }
const empty = (): UndergroundGraph => ({ nodes: [], edges: [], entrances: [] })
const road = (id: string, path: LngLat[], extra = {}) => ({ id, floor: -1, mode: 'car' as const, direction: 'both' as const, status: 'confirmed' as const, path, ...extra })
const A: LngLat = [121.6, 31.18], B: LngLat = [121.601, 31.18], C: LngLat = [121.602, 31.18], D: LngLat = [121.601, 31.181]

describe('地下路网', () => {
  it('首尾坐标相同的道路还原成同一个路口，保存后仍是三条道路', () => {
    const g = graphFromMap({ ...base, roads: [road('r1', [A, B]), road('r2', [B, C]), road('r3', [B, D])] })
    expect(g.nodes).toHaveLength(4)
    const junction = g.nodes.find((n) => n.pos[0] === B[0] && n.pos[1] === B[1])!
    expect(degree(g, junction.id)).toBe(3)
    const roads = graphToRoads(g, -1)
    expect(roads).toHaveLength(3)
    expect(graphFromMap({ ...base, roads }).nodes).toHaveLength(4)
  })

  it('一进一出的同一条线合并成一条双向道路，路中间的点合并成一条折线', () => {
    const g = graphFromMap({ ...base, roads: [road('in', [A, B, C], { direction: 'in' }), road('out', [C, B, A], { direction: 'out' })] })
    expect(g.edges).toHaveLength(2)
    expect(graphToRoads(g, -1)).toEqual([expect.objectContaining({ direction: 'both', path: [A, B, C] })])
  })

  it('属性不同的路段在交界处断开，纯环路也能保存', () => {
    const g = empty()
    const [a, b, c] = [A, B, D].map((p) => addNode(g, p))
    connect(g, a, b, props); connect(g, b, c, { ...props, status: 'candidate' }); connect(g, c, a, props)
    // 环上只有一处属性变化：确认段 c→a→b 连成一条，待核验段 b→c 单独一条
    expect(graphToRoads(g, -1).map((r) => r.path.length).sort()).toEqual([2, 3])
    const ring = empty()
    const ids = [A, B, D].map((p) => addNode(ring, p))
    connect(ring, ids[0], ids[1], props); connect(ring, ids[1], ids[2], props); connect(ring, ids[2], ids[0], props)
    const [loop] = graphToRoads(ring, -1)
    expect(loop.path).toHaveLength(4)
    expect(loop.path[0]).toEqual(loop.path[3])
    expect(graphFromMap({ ...base, roads: [loop] }).edges).toHaveLength(3)
  })

  it('在路段上插点、删中间点自动接回，删路口连同路段一起删', () => {
    const g = empty()
    const a = addNode(g, A), c = addNode(g, C)
    const e = connect(g, a, c, props)!
    const mid = splitEdge(g, e, [121.601, 31.1801])!
    expect(g.nodes.find((n) => n.id === mid)!.pos).toEqual([121.601, 31.18])
    expect(g.edges).toHaveLength(2)
    const d = addNode(g, D); connect(g, mid, d, props)
    removeNode(g, d)
    expect(g.edges).toHaveLength(2)
    removeNode(g, mid)
    expect(g.edges).toEqual([expect.objectContaining({ a, b: c })])
    const m2 = splitEdge(g, g.edges[0].id, B)!
    connect(g, m2, addNode(g, D), props)
    removeNode(g, m2)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes).toHaveLength(0)
  })

  it('删路段时清掉孤立端点，合并节点时去掉重复路段', () => {
    const g = empty()
    const [a, b, c, d] = [A, B, C, D].map((p) => addNode(g, p))
    const ab = connect(g, a, b, props)!; connect(g, b, c, props); connect(g, d, c, props); connect(g, d, a, props)
    // d–c、d–a 并到 b 后与已有的 b–c、a–b 重复，只留一份
    mergeNodes(g, d, b)
    expect(g.edges).toHaveLength(2)
    expect(g.nodes.map((n) => n.id)).toEqual([a, b, c])
    removeEdge(g, ab)
    expect(g.nodes.map((n) => n.id)).toEqual([b, c])
  })

  it('导入手绘：几米内的点合成路口，悬空端点接到旁边的路段上', () => {
    const g = empty()
    const count = importSketch(g, [
      [A, C],
      [[121.601, 31.18002], D], // 起点离 A–C 路段约 2 米
      [[121.60200001, 31.18], [121.602, 31.181]], // 起点几乎就是 C
    ], props)
    expect(count).toBe(3)
    expect(components(g)).toHaveLength(1)
    expect(g.nodes).toHaveLength(5)
    expect(graphIssues(g).looseEnds).toEqual([])
  })

  it('检查孤立片段、没接上的端点和够不到路网的出入口', () => {
    const g = empty()
    const [a, b] = [A, C].map((p) => addNode(g, p)); connect(g, a, b, props)
    const loose = addNode(g, [121.601, 31.18005]), far = addNode(g, [121.601, 31.1805]); connect(g, loose, far, props)
    g.entrances.push({ id: 'x', floorFrom: 0, floorTo: -1, kind: 'ramp', status: 'confirmed', pos: [121.61, 31.19] })
    const issues = graphIssues(g)
    expect(issues.islands).toHaveLength(1)
    expect(issues.looseEnds).toEqual([loose])
    expect(issues.farEntrances).toEqual(['x'])
  })

  it('保存时保留地图其他字段，出入口原样写回', () => {
    const g = empty()
    connect(g, addNode(g, A), addNode(g, B), props)
    g.entrances.push({ id: 'e1', floorFrom: 0, floorTo: -1, kind: 'stairs', status: 'confirmed', pos: B, note: '北侧' })
    const map = graphToMap(g, { ...base, version: 3 })
    expect(map).toMatchObject({ version: 3, floor: -1, connectors: [expect.objectContaining({ id: 'e1', note: '北侧' })] })
    expect(map.roads).toHaveLength(1)
  })
})
