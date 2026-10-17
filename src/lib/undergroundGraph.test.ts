import { describe, expect, it } from 'vitest'
import type { LngLat, UndergroundMap } from './types'
import { addNode, connect, graphFromMap, graphToMap, moveNode, bindEntrance, unbindEntrance, splitEdge, removeNode, removeEdge, mergeNodes, createStreetViewPoint, streetViewPointPosition, interpolateStreetViewPoints, importSketch, components, graphIssues, autoBindEntrances, type UndergroundGraph } from './undergroundGraph'

const A: LngLat = [121.6, 31.18], B: LngLat = [121.601, 31.18], C: LngLat = [121.602, 31.18], D: LngLat = [121.601, 31.181]
const base: UndergroundMap = { version: 2, floor: -1, bounds: [A, D], sources: [], nodes: [], edges: [], connectors: [] }
const empty = (): UndergroundGraph => ({ nodes: [], edges: [], entrances: [], points: [] })

describe('地下节点与边编辑器', () => {
  it('直接往返节点、边和 ID，保留二度折点与环路', () => {
    const g = empty(), [a, b, c] = [A, B, D].map((p) => addNode(g, p))
    connect(g, a, b); connect(g, b, c); connect(g, c, a)
    expect(connect(g, b, a)).toBeNull()
    expect(connect(g, a, a)).toBeNull()
    const saved = graphToMap(g, base)
    expect(saved.edges).toHaveLength(3)
    expect(saved).not.toHaveProperty('roads')
    expect(graphFromMap(saved)).toEqual(g)
  })
  it('相同坐标不同 ID 不会在载入时合并，独立连接点不会自动绑定', () => {
    const map: UndergroundMap = { ...base, nodes: [{ id: 'a', pos: A }, { id: 'b', pos: A }], connectors: [{ id: 'c', pos: A, floorFrom: 0, floorTo: -1, kind: 'stairs', note: '保留说明' }] }
    expect(graphToMap(graphFromMap(map), map)).toMatchObject(map)
    expect(graphFromMap(map).entrances[0].node).toBeUndefined()
  })
  it('插点与删除二度节点，删除分叉路口与孤立端点', () => {
    const g = empty(), a = addNode(g, A), c = addNode(g, C)
    const mid = splitEdge(g, connect(g, a, c)!, B)!
    expect(g.edges).toHaveLength(2)
    removeNode(g, mid)
    expect(g.edges).toEqual([expect.objectContaining({ a, b: c })])
    const joint = splitEdge(g, g.edges[0].id, B)!
    connect(g, joint, addNode(g, D))
    removeNode(g, joint)
    expect(g.edges).toEqual([])
    expect(g.nodes).toEqual([])
  })
  it('绑定持久化、跟随拖动；合并后跟随，解绑与删节点后留在原地', () => {
    const g = empty(), a = addNode(g, A), b = addNode(g, B)
    connect(g, a, b)
    g.entrances.push({ id: 'x', floorFrom: 0, floorTo: -1, kind: 'elevator', pos: D, note: '电梯说明' })
    bindEntrance(g, 'x', b); moveNode(g, b, C)
    expect(graphFromMap(graphToMap(g, base)).entrances[0]).toMatchObject({ node: b, pos: C, note: '电梯说明' })
    mergeNodes(g, b, a)
    expect(g.entrances[0]).toMatchObject({ node: a, pos: A })
    unbindEntrance(g, 'x'); moveNode(g, a, D)
    expect(g.entrances[0].pos).toEqual(A)
    bindEntrance(g, 'x', a); removeNode(g, a)
    expect(g.entrances[0].node).toBeUndefined()
    expect(g.entrances[0].pos).toEqual(D)
  })
  it('街景点保留 ID、权重与位置，合并更新引用，删除端点清理引用', () => {
    const g = empty(), [a, b, c] = [A, B, C].map((p) => addNode(g, p))
    const point = createStreetViewPoint(g, connect(g, a, c)!, [121.6015, 31.18])!
    expect(point.imageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(streetViewPointPosition(g, point)).toEqual([121.6015, 31.18])
    expect(graphFromMap(graphToMap(g, base)).points).toEqual([point])
    mergeNodes(g, c, b)
    expect(g.points[0].endpointId2).toBe(b)
    removeNode(g, b)
    expect(g.points).toEqual([])
  })
  it('同一路段上的两个街景点之间按数量均匀插值，跨路段拒绝', () => {
    const g = empty(), [a, b, c] = [A, B, C].map((p) => addNode(g, p))
    const edge = connect(g, a, b)!, another = connect(g, b, c)!
    const first = createStreetViewPoint(g, edge, [121.6002, 31.18])!
    const second = createStreetViewPoint(g, edge, [121.6008, 31.18])!
    const result = interpolateStreetViewPoints(g, first.id, second.id, 3)
    expect(result.error).toBeUndefined()
    expect(result.points.map((point) => point.endpointWeight2)).toEqual([0.35, 0.5, 0.65])
    expect(result.points.every((point) => point.endpointId1 === first.endpointId1 && point.endpointId2 === first.endpointId2)).toBe(true)
    expect(new Set([first, second, ...result.points].map((point) => point.id)).size).toBe(5)
    expect(result.points.every((point) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(point.imageId))).toBe(true)
    const elsewhere = createStreetViewPoint(g, another, [121.6015, 31.18])!
    expect(interpolateStreetViewPoints(g, first.id, elsewhere.id, 2)).toMatchObject({ points: [], error: '两个街景点不在同一条路段上' })
    expect(interpolateStreetViewPoints(g, first.id, second.id, 0)).toMatchObject({ points: [], error: '插值数量必须是 1–50 的整数' })
  })
  it('删除边清理街景点并解除失效绑定', () => {
    const g = empty(), a = addNode(g, A), b = addNode(g, B), edge = connect(g, a, b)!
    createStreetViewPoint(g, edge, B)
    g.entrances.push({ id: 'x', floorFrom: 0, floorTo: -1, kind: 'ramp', pos: A, node: a })
    removeEdge(g, edge)
    expect(g.points).toEqual([])
    expect(g.entrances[0]).not.toHaveProperty('node')
  })
  it('草稿靠近路段时插点形成路口，支持自动绑定与问题检查', () => {
    const g = empty()
    importSketch(g, [[A, C], [[121.601, 31.18002], D]])
    expect(components(g)).toHaveLength(1)
    g.entrances.push({ id: 'near', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.60001, 31.18001] }, { id: 'far', floorFrom: 0, floorTo: -1, kind: 'stairs', pos: [121.61, 31.19] })
    expect(autoBindEntrances(g, 10)).toBe(1)
    expect(graphIssues(g).unboundEntrances).toEqual(['far'])
  })
})
