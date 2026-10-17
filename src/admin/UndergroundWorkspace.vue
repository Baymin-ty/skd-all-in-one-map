<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { createCampusMap } from '../lib/campusMap'
import { fromLatLng, toLatLng } from '../lib/geo'
import type { IconName } from '../lib/icons'
import { meters } from '../lib/measure'
import type { LngLat, UndergroundConnectorKind } from '../lib/types'
import { degree, edgeMeters, graphIssues, projectOnEdge, streetViewPointPosition, type UgEdge, type UgEntrance, type UgStreetViewPoint } from '../lib/undergroundGraph'
import {
  admin, addUndergroundEntrance, addUndergroundStreetViewPoint, bindUndergroundEntrances, deleteUnderground, deleteUndergroundSelection, drawUndergroundAt,
  drawUndergroundOnEdge, drawUndergroundToEntrance, drawUndergroundToNode, finishUndergroundRoad, insertUndergroundNode,
  interpolateUndergroundStreetViewPathWithImages, moveUndergroundEntrance, moveUndergroundNode, redoUnderground, saveUnderground, selectUnderground, setUndergroundTool,
  undergroundCanRedo, undergroundCanUndo, undergroundDirty, undoUnderground, updateUndergroundEntrance, uploadUndergroundStreetViewImage,
  type UndergroundSnap, type UndergroundTool, notify,
} from './store'
import { STREETVIEW_DIR, streetViewUrl } from '../lib/streetview'

const PURPLE = '#9b4fd1', PURPLE_DARK = '#5b21b6', RED = '#e5262d'
/** 拖动时离节点、路段或出入口这么近（屏幕像素）就吸附过去，松手即接上 / 绑定 */
const SNAP_PX = 14
/** 「一键绑定」只处理这么近的出入口，再远多半是故意放在路外 */
const AUTO_BIND_METERS = 10
const BIND_ONE_METERS = 30

const tools: { id: UndergroundTool; label: string; icon: IconName; key: string }[] = [
  { id: 'select', label: '选择', icon: 'pointer', key: 'V' },
  { id: 'road', label: '道路', icon: 'road', key: 'R' },
  { id: 'entrance', label: '出入口', icon: 'entrance', key: 'E' },
  { id: 'point', label: '街景点', icon: 'image', key: 'P' },
  { id: 'interpolate', label: '插值', icon: 'sparkles', key: 'I' },
  { id: 'erase', label: '删除', icon: 'trash', key: 'X' },
]
const kindLabel: Record<UndergroundConnectorKind, string> = { ramp: '车辆出入口', stairs: '楼梯口', elevator: '电梯口', unknown: '其他出入口' }
/** 车辆出入口是醒目的红圈；楼梯口、电梯口只用一个小圆点，按颜色区分 */
const kindColor: Record<UndergroundConnectorKind, string> = { ramp: RED, stairs: '#f08c00', elevator: '#1c7ed6', unknown: '#64748b' }
const markClass = (kind: UndergroundConnectorKind) => kind === 'ramp' ? 'ring' : 'dot'

const el = ref<HTMLDivElement>()
const ready = ref(false)
let map: L.Map | null = null
const renderer = L.canvas({ padding: 0.5, tolerance: 7 })
const edgeLayer = L.layerGroup(), nodeLayer = L.layerGroup(), entranceLayer = L.layerGroup(), pointLayer = L.layerGroup()
const rubber = L.polyline([], { color: PURPLE, weight: 3, opacity: 0.85, dashArray: '6 7', interactive: false })
/** 拖动时标出松手会接到哪里 */
const snapHalo = L.circleMarker([0, 0], { radius: 10, color: PURPLE_DARK, weight: 3, fillColor: '#fff', fillOpacity: 0.55, interactive: false })
let cursor: L.LatLng | null = null
/** 节点 → 与它相连的线（以及它是线的第几个端点），拖动时实时跟着走 */
const tracked = new Map<string, { line: L.Polyline; end: 0 | 1 }[]>()
const nodeMarkers = new Map<string, L.Marker>()
/** 节点 → 绑定在上面的出入口标记，拖节点时一起走 */
const boundMarkers = new Map<string, L.Marker[]>()
const edgeLines = new Map<string, { line: L.Polyline; edge: UgEdge; selected: boolean }>()
let snap: UndergroundSnap | null = null

const graph = computed(() => admin.undergroundGraph)
const tool = computed(() => admin.undergroundTool)
const issues = computed(() => graph.value ? graphIssues(graph.value) : { islands: [], looseEnds: [], unboundEntrances: [] })
const totalKm = computed(() => graph.value ? graph.value.edges.reduce((sum, e) => sum + edgeMeters(graph.value!, e), 0) / 1000 : 0)
const selectedNode = computed(() => {
  const s = admin.undergroundSelected
  return s?.kind === 'node' ? graph.value?.nodes.find((n) => n.id === s.id) ?? null : null
})
const selectedEdge = computed(() => {
  const s = admin.undergroundSelected
  return s?.kind === 'edge' ? graph.value?.edges.find((e) => e.id === s.id) ?? null : null
})
const selectedEntrance = computed(() => {
  const s = admin.undergroundSelected
  return s?.kind === 'entrance' ? graph.value?.entrances.find((e) => e.id === s.id) ?? null : null
})
const selectedPoint = computed(() => {
  const s = admin.undergroundSelected
  return s?.kind === 'point' ? graph.value?.points.find((point) => point.id === s.id) ?? null : null
})
const uploadInput = ref<HTMLInputElement>()
const uploading = ref(false)
const previewVersion = ref(0)
const previewBroken = ref(false)
const previewUrl = computed(() => selectedPoint.value ? `${streetViewUrl(selectedPoint.value.imageId)}?v=${previewVersion.value}` : '')
watch(() => selectedPoint.value?.id, () => { previewBroken.value = false; previewVersion.value++ })
/** 街景点插值：按顺序选择路网节点形成折线，再沿整条折线按里程均匀插入。 */
const interpolateNodes = ref<string[]>([])
const interpolateCount = ref(1)
const interpolateFiles = ref<File[]>([])
const interpolateFileInput = ref<HTMLInputElement>()
const interpolateFolderInput = ref<HTMLInputElement>()
const interpolating = ref(false)
const interpolateProgress = ref(0)
const STREETVIEW_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const interpolatePath = computed(() => {
  const ids = interpolateNodes.value
  if (ids.length < 2) return { error: '', meters: 0 }
  if (new Set(ids).size !== ids.length) return { error: '节点不能重复', meters: 0 }
  const g = graph.value
  if (!g) return { error: '地下路网尚未加载', meters: 0 }
  let total = 0
  for (let i = 1; i < ids.length; i++) {
    const edge = g.edges.find((item) => (item.a === ids[i - 1] && item.b === ids[i]) || (item.a === ids[i] && item.b === ids[i - 1]))
    if (!edge) return { error: `第 ${i} 个和第 ${i + 1} 个节点之间没有路段，请按道路顺序选择`, meters: 0 }
    total += edgeMeters(g, edge)
  }
  return { error: '', meters: total }
})
const interpolateError = computed(() => interpolatePath.value.error)
const interpolateFilesReady = computed(() => {
  const count = Number(interpolateCount.value)
  return Number.isInteger(count) && count >= 1 && count <= 50 && interpolateFiles.value.length === count
    && interpolateFiles.value.every((file) => STREETVIEW_TYPES.includes(file.type) && file.size <= 20 * 1024 * 1024)
})
const interpolateReady = computed(() => interpolateNodes.value.length >= 2 && !interpolateError.value
  && interpolateFilesReady.value && !interpolating.value)
watch(tool, () => { interpolateNodes.value = []; interpolateFiles.value = []; interpolateProgress.value = 0 })
watch(() => graph.value?.nodes.map((node) => node.id).join('|'), () => {
  const ids = new Set(graph.value?.nodes.map((node) => node.id))
  if (interpolateNodes.value.some((id) => !ids.has(id))) interpolateNodes.value = interpolateNodes.value.filter((id) => ids.has(id))
})
const sortInterpolationFiles = (files: File[]) => [...files]
  .filter((file) => STREETVIEW_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }))
function pickInterpolationFiles(event: Event) {
  const input = event.target as HTMLInputElement
  interpolateFiles.value = sortInterpolationFiles([...(input.files ?? [])])
  input.value = ''
}
function dropInterpolationFiles(event: DragEvent) {
  if (interpolating.value) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length) interpolateFiles.value = sortInterpolationFiles(files)
}
async function applyInterpolation() {
  const nodes = interpolateNodes.value
  const count = Number(interpolateCount.value)
  if (nodes.length < 2) { notify('请按顺序选择至少两个路网节点', 'error'); return }
  if (interpolateError.value) { notify(interpolateError.value, 'error'); return }
  if (!interpolateFilesReady.value) { notify(`需要选择 ${count} 张有效图片（JPG / PNG / WebP，单张不超过 20 MB）`, 'error'); return }
  if (interpolating.value) return
  interpolating.value = true
  interpolateProgress.value = 0
  try {
    const result = await interpolateUndergroundStreetViewPathWithImages(
      nodes, count, interpolateFiles.value, (done) => { interpolateProgress.value = done },
    )
    if (result.error) { notify(result.error, 'error'); return }
    interpolateNodes.value = []
    interpolateFiles.value = []
  } finally {
    interpolating.value = false
    interpolateProgress.value = 0
  }
}
async function uploadStreetView(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const point = selectedPoint.value
  if (!file || !point || uploading.value) return
  uploading.value = true
  try {
    if (await uploadUndergroundStreetViewImage(point.imageId, file)) {
      previewBroken.value = false
      previewVersion.value++
    }
  } finally { uploading.value = false }
}
const hint = computed(() => {
  if (tool.value === 'road') return admin.undergroundActive
    ? '继续点击添加下一个点，点到已有的点、路段或出入口会自动接上 · 双击、Enter 或右键结束这条路'
    : '点击地图开始画路；从已有的点、路段或出入口上开始，就是接出一条岔路'
  if (tool.value === 'entrance') return '先选类型再点击放置；点在道路或节点上会直接绑定到路网'
  if (tool.value === 'point') return '点击路网线段创建街景点，自动生成 GUID 图片 ID；点在线段外不会创建'
  if (tool.value === 'interpolate') {
    if (interpolating.value) return `正在按文件名顺序上传 ${interpolateProgress.value}/${Number(interpolateCount.value)} 张图片…`
    if (interpolateError.value) return interpolateError.value
    if (interpolateNodes.value.length < 2) return `依次点击路网节点，按道路顺序连成折线（已选 ${interpolateNodes.value.length} 个）`
    const count = Number(interpolateCount.value)
    if (!Number.isInteger(count) || count < 1 || count > 50) return '请输入 1–50 的插值数量'
    if (interpolateFiles.value.length !== count) return `折线约 ${Math.round(interpolatePath.value.meters)} 米；需要选择 ${count} 张图片，当前已选 ${interpolateFiles.value.length} 张`
    if (!interpolateFilesReady.value) return '图片必须是 JPG / PNG / WebP，且每张不超过 20 MB'
    return `折线约 ${Math.round(interpolatePath.value.meters)} 米，图片已齐；会沿整条折线按里程均匀插入，并按文件名顺序绑定`
  }
  if (tool.value === 'erase') return '点击要删的点、路段或出入口；删路中间的点，两侧会自动接上'
  return '拖动紫点改线，拖到别的点或路段上自动接成路口 · 出入口拖到路上会绑定 · 街景点保存端点权重和 GUID · 右键删除'
})

function nearestRoadMeters(pos: LngLat) {
  const g = graph.value
  if (!g) return Infinity
  return Math.min(Infinity, ...g.nodes.map((n) => meters(n.pos, pos)), ...g.edges.map((e) => projectOnEdge(g, e.id, pos)?.meters ?? Infinity))
}
function edgeStyle(_e: UgEdge, selected: boolean): L.PolylineOptions {
  return { color: selected ? PURPLE_DARK : PURPLE, weight: selected ? 8 : 5.5, opacity: 0.95 }
}
function track(id: string, line: L.Polyline, end: 0 | 1) {
  const list = tracked.get(id) ?? []; list.push({ line, end }); tracked.set(id, list)
}
const stop = (event: L.LeafletEvent) => L.DomEvent.stop((event as L.LeafletMouseEvent).originalEvent)

function draw() {
  const g = graph.value
  if (!map || !g) return
  edgeLayer.clearLayers(); nodeLayer.clearLayers(); entranceLayer.clearLayers(); pointLayer.clearLayers()
  tracked.clear(); nodeMarkers.clear(); boundMarkers.clear(); edgeLines.clear(); setSnap(null)
  const pos = new Map(g.nodes.map((n) => [n.id, n.pos]))
  const sel = admin.undergroundSelected
  for (const e of g.edges) {
    const a = pos.get(e.a), b = pos.get(e.b)
    if (!a || !b) continue
    const selected = sel?.kind === 'edge' && sel.id === e.id
    const line = L.polyline([toLatLng(a), toLatLng(b)], { renderer, lineCap: 'round', bubblingMouseEvents: false, ...edgeStyle(e, selected) })
    line.on('click', (event) => edgeClick(e, event))
    line.on('dblclick', (event) => { stop(event); if (tool.value === 'select') insertUndergroundNode(e.id, fromLatLng(event.latlng)) })
    line.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'edge', id: e.id }) })
    line.on('mouseover', () => { if (tool.value === 'erase') line.setStyle({ color: RED, opacity: 1 }) })
    line.on('mouseout', () => line.setStyle(edgeStyle(e, selected)))
    line.addTo(edgeLayer)
    edgeLines.set(e.id, { line, edge: e, selected })
    track(e.a, line, 0); track(e.b, line, 1)
  }
  for (const n of g.nodes) {
    const selected = sel?.kind === 'node' && sel.id === n.id
    const active = admin.undergroundActive === n.id
    const picked = tool.value === 'interpolate' && interpolateNodes.value.includes(n.id)
    const marker = L.marker(toLatLng(n.pos), {
      draggable: !admin.undergroundSaving, keyboard: false, zIndexOffset: active ? 600 : selected || picked ? 500 : 0,
      icon: L.divIcon({ className: 'ug-node-host', html: `<span class="ug-node${selected ? ' selected' : ''}${active ? ' active' : ''}${picked ? ' picked' : ''}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(nodeLayer)
    nodeMarkers.set(n.id, marker)
    marker.on('click', (event) => nodeClick(n.id, event))
    marker.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'node', id: n.id }) })
    marker.on('drag', () => {
      moveNodeVisual(n.id, marker.getLatLng(), marker)
      setSnap(findSnap(marker.getLatLng(), { except: n.id, edges: true, entrances: true }))
    })
    marker.on('dragend', () => { const target = takeSnap(); moveUndergroundNode(n.id, fromLatLng(marker.getLatLng()), target) })
  }
  for (const c of g.entrances) {
    const selected = sel?.kind === 'entrance' && sel.id === c.id
    const state = selected ? ' selected' : ''
    const icon = c.kind === 'ramp'
      ? L.divIcon({ className: 'ug-entrance-host', html: `<span class="ug-entrance${state}"></span>`, iconSize: [30, 30], iconAnchor: [15, 15] })
      : L.divIcon({ className: 'ug-access-host', html: `<span class="ug-access${state}" style="--c:${kindColor[c.kind]}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] })
    const marker = L.marker(toLatLng(c.pos), {
      draggable: !admin.undergroundSaving, keyboard: false, zIndexOffset: c.kind === 'ramp' ? 1000 : 900, title: `${kindLabel[c.kind]}${c.note ? ` · ${c.note}` : ''}`, icon,
    }).addTo(entranceLayer)
    if (c.node) boundMarkers.set(c.node, [...(boundMarkers.get(c.node) ?? []), marker])
    marker.on('click', (event) => entranceClick(c, event))
    marker.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'entrance', id: c.id }) })
    // 已绑定的出入口：拖它等于拖节点（连同道路）；按住 ⌥ 拖动则拆开单独移动
    let detach = false
    marker.on('mousedown', (event) => { detach = !!c.node && (event as L.LeafletMouseEvent).originalEvent.altKey })
    marker.on('drag', () => {
      const latlng = marker.getLatLng()
      if (c.node && !detach) { moveNodeVisual(c.node, latlng, marker); setSnap(findSnap(latlng, { except: c.node, edges: true })) }
      else setSnap(findSnap(latlng, { edges: true }))
    })
    marker.on('dragend', () => { const target = takeSnap(); moveUndergroundEntrance(c.id, fromLatLng(marker.getLatLng()), target, detach) })
  }
  for (const point of g.points) {
    const pos = streetViewPointPosition(g, point)
    if (!pos) continue
    const selected = sel?.kind === 'point' && sel.id === point.id
    const marker = L.marker(toLatLng(pos), {
      keyboard: false, zIndexOffset: selected ? 1200 : 1100, title: `街景点 · ${point.imageId}`,
      icon: L.divIcon({ className: 'ug-point-host', html: `<span class="ug-point${selected ? ' selected' : ''}"><span class="ug-point-dot"></span></span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).addTo(pointLayer)
    marker.on('click', (event) => pointClick(point, event))
    marker.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'point', id: point.id }) })
  }
  drawRubber()
}

function drawRubber() {
  const g = graph.value, active = admin.undergroundActive
  const from = active && g?.nodes.find((n) => n.id === active)
  if (!map || tool.value !== 'road' || !from || !cursor) { rubber.remove(); return }
  rubber.setLatLngs([toLatLng(from.pos), cursor]).addTo(map)
}

/**
 * 屏幕上 SNAP_PX 以内最近的吸附目标：节点优先，其次没绑定的出入口，最后是路段上的投影点。
 * except 是正在拖的节点，它自己和相连的路段不算。
 */
function findSnap(latlng: L.LatLng, opts: { except?: string; nodes?: boolean; edges?: boolean; entrances?: boolean }): UndergroundSnap | null {
  const g = graph.value, m = map
  if (!m || !g) return null
  const p = m.latLngToContainerPoint(latlng)
  const px = (pos: LngLat) => m.latLngToContainerPoint(toLatLng(pos))
  let best: UndergroundSnap | null = null, bestPx = SNAP_PX
  if (opts.nodes !== false) for (const n of g.nodes) {
    const d = n.id === opts.except ? Infinity : p.distanceTo(px(n.pos))
    if (d <= bestPx) best = { node: n.id }, bestPx = d
  }
  if (!best && opts.entrances) for (const e of g.entrances) {
    const d = e.node ? Infinity : p.distanceTo(px(e.pos))
    if (d <= bestPx) best = { entrance: e.id }, bestPx = d
  }
  if (!best && opts.edges) {
    const pos = new Map(g.nodes.map((n) => [n.id, n.pos]))
    for (const e of g.edges) {
      if (e.a === opts.except || e.b === opts.except) continue
      const a = px(pos.get(e.a)!), b = px(pos.get(e.b)!)
      const d = L.LineUtil.pointToSegmentDistance(p, a, b)
      if (d <= bestPx) bestPx = d, best = { edge: e.id, pos: fromLatLng(m.containerPointToLatLng(L.LineUtil.closestPointOnSegment(p, a, b))) }
    }
  }
  return best
}
function snapPos(target: UndergroundSnap): LngLat | undefined {
  const g = graph.value
  if ('edge' in target) return target.pos
  if ('node' in target) return g?.nodes.find((n) => n.id === target.node)?.pos
  return g?.entrances.find((e) => e.id === target.entrance)?.pos
}
function setSnap(next: UndergroundSnap | null) {
  const prevEdge = snap && 'edge' in snap ? snap.edge : null, nextEdge = next && 'edge' in next ? next.edge : null
  if (prevEdge && prevEdge !== nextEdge) { const hit = edgeLines.get(prevEdge); hit?.line.setStyle(edgeStyle(hit.edge, hit.selected)) }
  if (nextEdge && nextEdge !== prevEdge) edgeLines.get(nextEdge)?.line.setStyle({ color: PURPLE_DARK, weight: 9, opacity: 1 })
  snap = next
  const pos = next && snapPos(next)
  if (map && pos) snapHalo.setLatLng(toLatLng(pos)).addTo(map)
  else snapHalo.remove()
}
function takeSnap() { const target = snap ?? undefined; setSnap(null); return target }
/** 拖动中只挪画面：相连的线、节点和绑定的出入口跟着走，松手后才写入数据 */
function moveNodeVisual(id: string, latlng: L.LatLng, dragging: L.Marker) {
  for (const { line, end } of tracked.get(id) ?? []) {
    const points = line.getLatLngs() as L.LatLng[]
    points[end] = latlng; line.setLatLngs(points)
  }
  for (const marker of [nodeMarkers.get(id), ...(boundMarkers.get(id) ?? [])]) if (marker && marker !== dragging) marker.setLatLng(latlng)
  if (admin.undergroundActive === id && cursor) rubber.setLatLngs([latlng, cursor])
}

function nodeClick(id: string, event: L.LeafletMouseEvent) {
  stop(event)
  const pos = graph.value?.nodes.find((n) => n.id === id)?.pos
  if (tool.value === 'road') event.originalEvent.altKey ? drawUndergroundAt(fromLatLng(event.latlng)) : drawUndergroundToNode(id)
  else if (tool.value === 'entrance') { if (pos) addUndergroundEntrance(pos, { node: id }) }
  else if (tool.value === 'erase') deleteUnderground({ kind: 'node', id })
  else if (tool.value === 'interpolate') {
    const picks = interpolateNodes.value
    interpolateNodes.value = picks.includes(id) ? picks.filter((item) => item !== id) : [...picks, id]
    selectUnderground({ kind: 'node', id })
  }
  else selectUnderground({ kind: 'node', id })
}
function pointClick(point: UgStreetViewPoint, event: L.LeafletMouseEvent) {
  stop(event)
  selectUnderground({ kind: 'point', id: point.id })
}
function addPointOnEdge(edgeId: string, pos: LngLat) {
  addUndergroundStreetViewPoint(edgeId, pos)
}
function edgeClick(e: UgEdge, event: L.LeafletMouseEvent) {
  stop(event)
  const pos = fromLatLng(event.latlng)
  if (tool.value === 'road') event.originalEvent.altKey ? drawUndergroundAt(pos) : drawUndergroundOnEdge(e.id, pos)
  else if (tool.value === 'entrance') addUndergroundEntrance(pos, { edge: e.id, pos })
  else if (tool.value === 'point') addPointOnEdge(e.id, pos)
  else if (tool.value === 'erase') deleteUnderground({ kind: 'edge', id: e.id })
  else selectUnderground({ kind: 'edge', id: e.id })
}
function entranceClick(c: UgEntrance, event: L.LeafletMouseEvent) {
  stop(event)
  if (tool.value === 'erase') return deleteUnderground({ kind: 'entrance', id: c.id })
  // 道路画到出入口上会接到它的节点（没绑定就在出入口处落点并绑上）
  if (tool.value === 'road') return event.originalEvent.altKey ? drawUndergroundAt(fromLatLng(event.latlng)) : drawUndergroundToEntrance(c.id)
  selectUnderground({ kind: 'entrance', id: c.id })
}
function mapClick(event: L.LeafletMouseEvent) {
  const pos = fromLatLng(event.latlng)
  if (tool.value === 'road') drawUndergroundAt(pos)
  else if (tool.value === 'entrance') addUndergroundEntrance(pos)
  else if (tool.value === 'point') {
    // 稍微点偏一点也吸附到最近的路段；点在线段外则明确拒绝，保证街景点始终落在路网上。
    const target = findSnap(event.latlng, { nodes: false, edges: true })
    if (target && 'edge' in target) addPointOnEdge(target.edge, target.pos)
    else notify('街景点必须建在路网上，请点击紫色道路线段', 'error')
  }
  else if (tool.value === 'select') selectUnderground(null)
}
function mapMove(event: L.LeafletMouseEvent) {
  cursor = event.latlng
  if (tool.value === 'road' && admin.undergroundActive) drawRubber()
}
function endRoad() { if (tool.value === 'road' && admin.undergroundActive) finishUndergroundRoad() }

function fitAll() {
  if (!map || !admin.campus) return
  const marked = [
    ...(graph.value?.nodes.map((n) => n.pos) ?? []),
    ...(graph.value?.entrances.map((e) => e.pos) ?? []),
    ...(graph.value?.points.map((point) => streetViewPointPosition(graph.value!, point)).filter((pos): pos is LngLat => !!pos) ?? []),
  ]
  const points = marked.length > 1 ? marked : admin.campus.boundary
  map.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [40, 40], maxZoom: 18 })
}
function focus(points: LngLat[], select?: Parameters<typeof selectUnderground>[0]) {
  if (!map || !points.length) return
  map.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [80, 80], maxZoom: 19 })
  if (select) selectUnderground(select)
}
function focusPoint(point: Parameters<typeof streetViewPointPosition>[1]) {
  const pos = graph.value && streetViewPointPosition(graph.value, point)
  if (pos) focus([pos], { kind: 'point', id: point.id })
}
const cycle = { islands: 0, looseEnds: 0, unboundEntrances: 0 }
function focusIssue(kind: keyof typeof cycle) {
  const g = graph.value, list = issues.value[kind]
  if (!g || !list.length) return
  const item = list[cycle[kind]++ % list.length]
  if (kind === 'islands') focus((item as string[]).map((id) => g.nodes.find((n) => n.id === id)!.pos), { kind: 'node', id: (item as string[])[0] })
  else if (kind === 'looseEnds') { const n = g.nodes.find((x) => x.id === item); if (n) focus([n.pos], { kind: 'node', id: n.id }) }
  else { const c = g.entrances.find((x) => x.id === item); if (c) focus([c.pos], { kind: 'entrance', id: c.id }) }
}
function zoom(delta: number) { map?.setZoom(map.getZoom() + delta) }

function keydown(event: KeyboardEvent) {
  if (interpolating.value) return
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return
  if (document.querySelector('dialog[open]')) return
  const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase()
  if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redoUnderground() : undoUnderground(); return }
  if (mod && key === 'y') { event.preventDefault(); redoUnderground(); return }
  if (mod || event.altKey) return
  const shortcut = tools.find((t) => t.key.toLowerCase() === key)
  if (shortcut) { event.preventDefault(); setUndergroundTool(shortcut.id); return }
  if (key === 'escape') {
    if (admin.undergroundActive) finishUndergroundRoad()
    else if (tool.value !== 'select') setUndergroundTool('select')
    else selectUnderground(null)
  } else if (key === 'enter') endRoad()
  else if (key === 'backspace' || key === 'delete') {
    event.preventDefault()
    // 画路时退格 = 退回上一个点；其他时候删除选中的对象
    if (tool.value === 'road' && admin.undergroundActive) undoUnderground()
    else deleteUndergroundSelection()
  }
}

function setEntrance(key: 'kind' | 'note', value: string) {
  if (selectedEntrance.value) updateUndergroundEntrance(selectedEntrance.value.id, { [key]: key === 'note' ? value.trim() : value } as never)
}
function continueFrom() { setUndergroundTool('road') }

onMounted(() => {
  if (!el.value || !admin.campus) return
  map = createCampusMap(el.value, admin.campus, { maxZoom: Infinity })
  map.doubleClickZoom.disable()
  edgeLayer.addTo(map); nodeLayer.addTo(map); entranceLayer.addTo(map); pointLayer.addTo(map)
  map.on('click', mapClick).on('mousemove', mapMove).on('dblclick', endRoad).on('contextmenu', endRoad)
  map.on('mouseout', () => { cursor = null; drawRubber() })
  fitAll(); ready.value = true; draw()
  window.addEventListener('keydown', keydown)
})
watch(() => [admin.undergroundVersion, admin.undergroundSaving], draw)
watch(() => admin.undergroundGraph === null, (missing) => { if (!missing) fitAll() })
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); map?.remove(); map = null })
</script>

<template>
  <section class="underground-workspace" aria-label="地下标注">
    <div class="ug-map-wrap" :class="`tool-${tool}`">
      <div ref="el" class="ug-map" aria-label="地下道路与出入口标注地图" />
      <div v-if="!ready || admin.undergroundLoading || !graph" class="ug-map-loading">正在加载地下数据…</div>

      <div class="ug-toolbar" role="toolbar" aria-label="标注工具">
        <button
          v-for="t in tools" :key="t.id" type="button" :class="{ active: tool === t.id, erase: t.id === 'erase' }"
          :aria-pressed="tool === t.id" :title="`${t.label}（${t.key}）`" :disabled="admin.undergroundSaving || interpolating" @click="setUndergroundTool(t.id)"
        ><Ico :name="t.icon" /><span>{{ t.label }}</span><kbd>{{ t.key }}</kbd></button>
      </div>

      <div class="ug-hint" :class="`tool-${tool}`" role="status">
        <span>{{ hint }}</span>
        <template v-if="tool === 'entrance'">
          <span class="ug-kinds" role="radiogroup" aria-label="新出入口类型">
            <button v-for="k in (['ramp', 'stairs', 'elevator'] as const)" :key="k" type="button" role="radio" :aria-checked="admin.undergroundEntranceKind === k" :class="{ on: admin.undergroundEntranceKind === k }" :style="{ '--c': kindColor[k] }" @click="admin.undergroundEntranceKind = k"><i class="ug-mark" :class="markClass(k)" />{{ kindLabel[k] }}</button>
          </span>
        </template>
        <template v-if="tool === 'interpolate'">
          <label class="ug-interp-count">数量
            <input v-model.number="interpolateCount" type="number" min="1" max="50" step="1" :disabled="admin.undergroundSaving || interpolating" />
          </label>
          <button
            type="button" class="ug-interp-files" :disabled="admin.undergroundSaving || interpolating"
            :title="interpolateFiles.length ? interpolateFiles.map((file) => file.name).join('、') : '点击选择多张图片，或把图片拖到这里；也支持选择整个文件夹'"
            @click="interpolateFileInput?.click()" @dragover.prevent @drop.prevent="dropInterpolationFiles"
          ><Ico name="image" />{{ interpolateFiles.length }}/{{ Number.isInteger(Number(interpolateCount)) ? interpolateCount : 0 }} 张</button>
          <button
            type="button" class="ug-interp-folder" :disabled="admin.undergroundSaving || interpolating"
            title="选择整个文件夹，按文件名排序" @click="interpolateFolderInput?.click()"
          ><Ico name="grid" /></button>
          <input ref="interpolateFileInput" type="file" multiple accept="image/jpeg,image/png,image/webp" hidden @change="pickInterpolationFiles" />
          <input ref="interpolateFolderInput" type="file" webkitdirectory directory multiple accept="image/jpeg,image/png,image/webp" hidden @change="pickInterpolationFiles" />
          <button type="button" class="ug-hint-action" :disabled="!interpolateReady || admin.undergroundSaving" @click="applyInterpolation">
            {{ interpolating ? `上传中 ${interpolateProgress}/${Number(interpolateCount)}` : '生成并上传' }}
          </button>
        </template>
        <button v-if="tool === 'road' && admin.undergroundActive" type="button" class="ug-hint-action" @click="finishUndergroundRoad">结束这条路</button>
      </div>

      <div class="ug-legend" aria-hidden="true">
        <span><i class="line" />道路</span>
        <span v-for="k in (['ramp', 'stairs', 'elevator'] as const)" :key="k"><i class="ug-mark" :class="markClass(k)" :style="{ '--c': kindColor[k] }" />{{ kindLabel[k] }}</span>
      </div>
      <div class="ug-zoom">
        <button type="button" title="放大" @click="zoom(1)"><Ico name="plus" /></button>
        <button type="button" title="缩小" @click="zoom(-1)"><Ico name="minus" /></button>
        <button type="button" title="显示全部标注" @click="fitAll"><Ico name="target" /></button>
      </div>
    </div>

    <aside class="ug-panel">
      <header class="ug-head">
        <div><span class="ug-eyebrow">B1 地下空间</span><h2>地下标注</h2></div>
        <button class="button primary" :disabled="admin.undergroundSaving || !undergroundDirty" @click="saveUnderground"><Ico name="check" />{{ admin.undergroundSaving ? '保存中…' : '保存' }}</button>
      </header>
      <div v-if="admin.undergroundError" class="ug-alert error" role="alert">{{ admin.undergroundError }}</div>
      <div v-if="admin.undergroundImported" class="ug-alert">已导入前台手绘的 {{ admin.undergroundImported }} 条线段，靠得很近的点已合成路口。保存后写入后台。</div>

      <div class="ug-stats">
        <div><b>{{ totalKm.toFixed(2) }}</b><span>公里道路</span></div>
        <div><b>{{ graph?.nodes.length ?? 0 }}</b><span>个节点</span></div>
        <div><b>{{ graph?.entrances.length ?? 0 }}</b><span>个出入口</span></div>
        <div><b>{{ graph?.points.length ?? 0 }}</b><span>个街景点</span></div>
      </div>

      <div class="ug-scroll">
        <section v-if="selectedNode" class="ug-card">
          <div class="ug-card-head"><span class="ug-dot" />节点<button class="icon-button danger" title="删除节点（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <p class="ug-meta">{{ degree(graph!, selectedNode.id) === 0 ? '孤立的点' : degree(graph!, selectedNode.id) >= 3 ? `路口 · 连着 ${degree(graph!, selectedNode.id)} 条路段` : degree(graph!, selectedNode.id) === 1 ? '道路端点' : '道路中间的点' }}</p>
          <p class="ug-coords">{{ selectedNode.pos[0].toFixed(6) }}, {{ selectedNode.pos[1].toFixed(6) }}</p>
          <button class="button secondary full" @click="continueFrom"><Ico name="road" />从这个点接着画（R）</button>
        </section>

        <section v-else-if="selectedEdge" class="ug-card">
          <div class="ug-card-head"><span class="ug-swatch" />路段<button class="icon-button danger" title="删除路段（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <p class="ug-meta">约 {{ Math.round(edgeMeters(graph!, selectedEdge)) }} 米 · 双向通行</p>
          <p class="ug-help">双击路段可以在上面加点；不需要的路段可直接删除。</p>
        </section>

        <section v-else-if="selectedEntrance" class="ug-card">
          <div class="ug-card-head"><i class="ug-mark" :class="markClass(selectedEntrance.kind)" :style="{ '--c': kindColor[selectedEntrance.kind] }" />{{ kindLabel[selectedEntrance.kind] }}<button class="icon-button danger" title="删除出入口（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <label>类型<select :value="selectedEntrance.kind" @change="setEntrance('kind', ($event.target as HTMLSelectElement).value)"><option v-for="(label, k) in kindLabel" :key="k" :value="k">{{ label }}</option></select></label>
          <label>说明<input :value="selectedEntrance.note ?? ''" placeholder="例如：信息学院北侧坡道" @change="setEntrance('note', ($event.target as HTMLInputElement).value)"></label>
          <div v-if="selectedEntrance.node" class="ug-bind bound"><Ico name="check" /><span><b>已绑定在道路上</b>拖动时连同道路一起移动；按住 <kbd>⌥</kbd> 拖动可以拆开</span></div>
          <div v-else class="ug-bind">
            <span><b>还没绑定到道路</b>{{ Number.isFinite(nearestRoadMeters(selectedEntrance.pos)) ? `离最近的道路 ${Math.round(nearestRoadMeters(selectedEntrance.pos))} 米，` : '' }}拖到道路上松手即可绑定</span>
            <button v-if="nearestRoadMeters(selectedEntrance.pos) <= BIND_ONE_METERS" class="button secondary full" @click="bindUndergroundEntrances(BIND_ONE_METERS, [selectedEntrance.id])"><Ico name="road" />绑定到最近的道路</button>
          </div>
        </section>

        <section v-else-if="selectedPoint" class="ug-card">
          <div class="ug-card-head"><Ico name="image" />街景点<button class="icon-button danger" title="删除街景点（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <div class="ug-point-binding">
            <b>点位 ID</b>
            <span>{{ selectedPoint.id }}</span>
            <b>图片 ID（GUID）</b>
            <span>{{ selectedPoint.imageId }}</span>
            <b>位置绑定</b>
            <span>{{ selectedPoint.endpointId1 }} × {{ selectedPoint.endpointWeight1.toFixed(6) }}</span>
            <span>{{ selectedPoint.endpointId2 }} × {{ selectedPoint.endpointWeight2.toFixed(6) }}</span>
          </div>
          <img v-if="!previewBroken" class="ug-street-preview" :src="previewUrl" alt="街景图预览" loading="lazy" @error="previewBroken = true" />
          <div class="ug-street-actions">
            <button type="button" class="button secondary full" :disabled="uploading" @click="uploadInput?.click()"><Ico name="image" />{{ uploading ? '上传中…' : '上传 / 替换街景图片' }}</button>
            <input ref="uploadInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="uploadStreetView" />
            <a class="button secondary full" :href="streetViewUrl(selectedPoint.imageId)" target="_blank" rel="noreferrer"><Ico name="image" />打开街景图</a>
          </div>
          <p class="ug-help">上传后会自动按 GUID 改名，保存为 .jpg / .png / .webp 并放到 <code>{{ STREETVIEW_DIR }}</code>；移动端点后位置自动更新。</p>
        </section>

        <section v-else class="ug-card ug-guide">
          <h3>怎么标</h3>
          <ul>
            <li><kbd>R</kbd> 画道路：逐点点击，双击或 <kbd>Enter</kbd> 结束；点到已有的点/路段自动接成路口，按住 <kbd>⌥</kbd> 点击不吸附</li>
            <li><kbd>E</kbd> 放出入口：点在道路或节点上会直接绑定，之后跟着道路一起移动</li>
            <li><kbd>P</kbd> 街景点：点击路网线段创建，自动生成随机 GUID；图片放到 data/streetview，文件名用这个 GUID</li>
            <li><kbd>I</kbd> 插值：按道路顺序点击多个路网节点形成折线，输入数量并选择等量图片；沿整条折线按里程均匀插入，图片按文件名顺序绑定</li>
            <li><kbd>V</kbd> 拖动紫点改线，拖到别的点或路段上就接成路口；出入口拖到道路上会绑定，按住 <kbd>⌥</kbd> 拖动可拆开</li>
            <li>右键任何对象直接删除，或选中后按 <kbd>Delete</kbd>；<kbd>⌘Z</kbd> 撤销</li>
          </ul>
        </section>

        <section class="ug-section">
          <h3>检查</h3>
          <button class="ug-check" :class="{ ok: !issues.islands.length }" :disabled="!issues.islands.length" @click="focusIssue('islands')">
            <span>{{ issues.islands.length ? `有 ${issues.islands.length} 段路没接到主路网` : '路网全部连通' }}</span><Ico v-if="issues.islands.length" name="target" /><Ico v-else name="check" />
          </button>
          <button class="ug-check" :class="{ ok: !issues.looseEnds.length }" :disabled="!issues.looseEnds.length" @click="focusIssue('looseEnds')">
            <span>{{ issues.looseEnds.length ? `${issues.looseEnds.length} 个端点紧挨着别的路但没接上` : '没有疑似断开的端点' }}</span><Ico v-if="issues.looseEnds.length" name="target" /><Ico v-else name="check" />
          </button>
          <button class="ug-check" :class="{ ok: !issues.unboundEntrances.length }" :disabled="!issues.unboundEntrances.length" @click="focusIssue('unboundEntrances')">
            <span>{{ issues.unboundEntrances.length ? `${issues.unboundEntrances.length} 个出入口还没绑定到道路` : '出入口都已绑定到道路' }}</span><Ico v-if="issues.unboundEntrances.length" name="target" /><Ico v-else name="check" />
          </button>
          <button v-if="issues.unboundEntrances.length" class="ug-check-action" @click="bindUndergroundEntrances(AUTO_BIND_METERS)">把 {{ AUTO_BIND_METERS }} 米内的出入口自动绑到道路上</button>
        </section>

        <section class="ug-section">
          <h3>出入口 <small>{{ graph?.entrances.length ?? 0 }}</small></h3>
          <p v-if="!graph?.entrances.length" class="ug-help">还没有出入口，按 <kbd>E</kbd> 在地图上点击添加。</p>
          <button
            v-for="c in graph?.entrances" :key="c.id" class="ug-row" :class="{ selected: admin.undergroundSelected?.id === c.id }"
            @click="focus([c.pos], { kind: 'entrance', id: c.id })"
          >
            <span class="ug-row-mark"><i class="ug-mark" :class="markClass(c.kind)" :style="{ '--c': kindColor[c.kind] }" /></span>
            <span class="grow"><b>{{ c.note || kindLabel[c.kind] }}</b><small>{{ kindLabel[c.kind] }}<template v-if="issues.unboundEntrances.includes(c.id)"> · 未绑定</template></small></span>
          </button>
        </section>

        <section class="ug-section">
          <h3>街景点 <small>{{ graph?.points.length ?? 0 }}</small></h3>
          <p v-if="!graph?.points.length" class="ug-help">还没有街景点，按 <kbd>P</kbd> 后点击路网线段添加。</p>
          <button
            v-for="point in graph?.points" :key="point.id" class="ug-row" :class="{ selected: admin.undergroundSelected?.id === point.id }"
            @click="focusPoint(point)"
          >
            <span class="ug-row-mark"><i class="ug-point-list-mark" /></span>
            <span class="grow"><b>{{ point.imageId }}</b><small>{{ point.id }}</small><small>{{ point.endpointId1 }} × {{ point.endpointWeight1.toFixed(4) }} · {{ point.endpointId2 }} × {{ point.endpointWeight2.toFixed(4) }}</small></span>
          </button>
        </section>
      </div>

      <footer class="ug-footer">
        <button :disabled="!undergroundCanUndo" title="撤销（⌘Z）" @click="undoUnderground"><Ico name="undo" />撤销</button>
        <button :disabled="!undergroundCanRedo" title="重做（⇧⌘Z）" @click="redoUnderground"><Ico name="redo" />重做</button>
        <span v-if="undergroundDirty" class="ug-dirty">有未保存的修改</span>
        <span v-else class="ug-clean">已保存</span>
      </footer>
    </aside>
  </section>
</template>

<style scoped>
.underground-workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; overflow: hidden; border: 1px solid #e3dcea; border-radius: 12px; background: #fff; box-shadow: 0 3px 16px #3b1f5a08; }
.ug-map-wrap { position: relative; min-width: 0; min-height: 0; overflow: hidden; isolation: isolate; }
.ug-map { position: absolute; inset: 0; background: #f4f3ef; }
.ug-map-loading { position: absolute; inset: 0; z-index: 900; display: grid; place-items: center; background: #ffffffb0; color: #5d5470; }

.ug-toolbar { position: absolute; z-index: 800; top: 16px; left: 16px; display: flex; flex-direction: column; gap: 2px; padding: 5px; border: 1px solid #e3dcea; border-radius: 12px; background: #fff; box-shadow: 0 6px 22px #3b1f5a1f; }
.ug-toolbar button { display: grid; grid-template-columns: 20px auto; grid-template-rows: auto auto; align-items: center; column-gap: 7px; width: 92px; padding: 7px 9px; border-radius: 8px; background: transparent; color: #4c4260; text-align: left; }
.ug-toolbar button .svgi { grid-row: 1 / 3; font-size: 18px; }
.ug-toolbar button span { font-size: 13px; font-weight: 600; line-height: 1.2; }
.ug-toolbar button kbd { font-size: 10px; color: #9a90a8; line-height: 1.2; }
.ug-toolbar button:hover:not(:disabled) { background: #f4eefa; }
.ug-toolbar button.active { background: #9b4fd1; color: #fff; }
.ug-toolbar button.active kbd { color: #f0e3fb; }
.ug-toolbar button.erase.active { background: #e5262d; }

.ug-hint { position: absolute; z-index: 800; top: 16px; left: 50%; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 10px; max-width: min(720px, calc(100% - 260px)); transform: translateX(-50%); padding: 8px 10px 8px 15px; border: 1px solid #e3dcea; border-radius: 12px; background: #fffffff5; box-shadow: 0 6px 22px #3b1f5a1a; color: #4c4260; font-size: 12.5px; line-height: 1.45; text-align: center; }
.ug-hint.tool-erase { border-color: #f3c4c5; color: #9b2227; }
.ug-hint-action { padding: 5px 10px; border-radius: 7px; background: #9b4fd1; color: #fff; font-size: 12px; font-weight: 600; }
.ug-kinds { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3eef7; }
.ug-kinds button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 6px; background: transparent; color: #6a5d7c; font-size: 12px; }
.ug-kinds button.on { background: #fff; color: #2e2540; font-weight: 600; box-shadow: 0 0 0 1.5px var(--c), 0 1px 3px #2e254026; }
.ug-interp-count { display: inline-flex; align-items: center; gap: 6px; color: #6a5d7c; font-size: 12px; white-space: nowrap; }
.ug-interp-count input { width: 64px; padding: 4px 7px; border: 1px solid #ddd5e6; border-radius: 6px; background: #fff; color: #2e2540; font-size: 12px; }
.ug-interp-files { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 7px; background: #f3eef7; color: #6a5d7c; font-size: 12px; font-weight: 600; white-space: nowrap; }
.ug-interp-files:hover:not(:disabled) { background: #ece2f5; }
.ug-interp-files:disabled { opacity: .5; cursor: not-allowed; }
.ug-interp-folder { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; background: #f3eef7; color: #6a5d7c; font-size: 15px; }
.ug-interp-folder:hover:not(:disabled) { background: #ece2f5; }
.ug-interp-folder:disabled { opacity: .5; cursor: not-allowed; }
.ug-hint-action:disabled { opacity: .45; cursor: not-allowed; }
.ug-point-binding span { overflow-wrap: anywhere; }
.ug-street-preview { width: 100%; max-height: 190px; object-fit: cover; border-radius: 8px; background: #f3eff8; }
.ug-street-actions { display: grid; gap: 6px; }
.ug-card a.button { text-decoration: none; }

.ug-legend { position: absolute; z-index: 800; left: 16px; bottom: 18px; display: flex; flex-wrap: wrap; gap: 6px 14px; max-width: calc(100% - 90px); padding: 7px 12px; border: 1px solid #e3dcea; border-radius: 9px; background: #fffffff2; color: #5d5470; font-size: 12px; }
.ug-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ug-legend .line { width: 22px; height: 5px; border-radius: 3px; background: #9b4fd1; }
.ug-zoom { position: absolute; z-index: 800; right: 16px; bottom: 18px; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e3dcea; border-radius: 9px; background: #fff; box-shadow: 0 2px 10px #3b1f5a14; }
.ug-zoom button { display: grid; place-items: center; width: 36px; height: 36px; background: #fff; color: #5d5470; font-size: 17px; }
.ug-zoom button + button { border-top: 1px solid #efeaf3; }
.ug-zoom button:hover { background: #f6f1fa; }

.ug-panel { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); background: #fff; }
.ug-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 20px 18px 14px; }
.ug-head h2 { margin-top: 2px; font-size: 20px; }
.ug-head .button { min-height: 36px; padding: 7px 14px; }
.ug-eyebrow { color: #8a4cba; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.ug-alert { margin: 0 14px 10px; padding: 9px 11px; border-radius: 9px; background: #f5effa; color: #5d3a7c; font-size: 12px; line-height: 1.5; }
.ug-alert.error { background: #fff1ef; color: #9d3429; }
.ug-stats { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.ug-stats div { display: grid; padding: 11px 0; text-align: center; }
.ug-stats div + div { border-left: 1px solid var(--line); }
.ug-stats b { font-size: 18px; font-variant-numeric: tabular-nums; color: #2e2540; }
.ug-stats span { font-size: 11px; color: #8a8197; }
.ug-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 18px; }

.ug-card { display: grid; gap: 10px; padding: 14px; border: 1px solid #ebe5f0; border-radius: 12px; background: #fcfbfd; }
.ug-card-head { display: flex; align-items: center; gap: 9px; font-weight: 650; }
.ug-card-head .icon-button { margin-left: auto; }
.ug-card label { display: grid; gap: 5px; color: #6c6379; font-size: 12px; }
.ug-card select, .ug-card input { width: 100%; padding: 7px 9px; }
.ug-dot { width: 12px; height: 12px; border: 2.5px solid #9b4fd1; border-radius: 50%; background: #fff; }
.ug-swatch { width: 22px; height: 5px; border-radius: 3px; background: #9b4fd1; }
.ug-mark { flex: none; display: inline-block; border-radius: 50%; }
.ug-mark.ring { width: 14px; height: 14px; border: 3px solid var(--c, #e5262d); }
.ug-mark.dot { width: 10px; height: 10px; margin: 2px; background: var(--c); box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px #0000001f; }
.ug-meta { color: #4c4260; font-size: 13px; }
.ug-coords { color: #9a90a8; font-size: 11px; font-variant-numeric: tabular-nums; }
.ug-help { color: #8a8197; font-size: 12px; line-height: 1.5; }
.ug-help.warn { color: #b0362f; }
.ug-point-binding { display: grid; gap: 4px; padding: 9px 10px; border-radius: 8px; background: #f3eff8; color: #5d5470; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.ug-point-binding b { color: #4c4260; font: 600 12px/1.4 inherit; }
.full { width: 100%; }
.ug-guide h3 { font-size: 13px; }
.ug-guide ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; color: #5d5470; font-size: 12px; line-height: 1.55; }
kbd { display: inline-block; min-width: 18px; padding: 0 5px; border: 1px solid #ddd5e6; border-bottom-width: 2px; border-radius: 5px; background: #fff; color: #4c4260; font: 600 11px/17px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
.ug-toolbar kbd { min-width: 0; padding: 0; border: 0; background: none; font-weight: 500; }

.ug-section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.ug-section h3 { display: flex; align-items: baseline; gap: 6px; color: #8a8197; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.ug-section h3 small { font-weight: 500; }
.ug-check { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border-radius: 9px; background: #fff4e8; color: #8a4b12; font-size: 12.5px; text-align: left; }
.ug-check:hover:not(:disabled) { background: #ffead3; }
.ug-check.ok { background: #f2f7f3; color: #3d6b4c; }
.ug-check-action { justify-self: start; padding: 2px 4px; border-radius: 6px; background: transparent; color: #8a4cba; font-size: 12px; font-weight: 600; }
.ug-check-action:hover { background: #f4eefa; }
.ug-bind { display: grid; gap: 8px; padding: 10px 11px; border-radius: 9px; background: #fff4e8; color: #8a4b12; font-size: 12px; line-height: 1.5; }
.ug-bind > span b { display: block; font-size: 12.5px; }
.ug-bind.bound { grid-template-columns: auto 1fr; align-items: start; background: #f2f7f3; color: #3d6b4c; }
.ug-bind.bound .svgi { margin-top: 2px; font-size: 14px; }
.ug-check:disabled { opacity: 1; cursor: default; }
.ug-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 9px; border-radius: 9px; background: transparent; text-align: left; }
.ug-row:hover, .ug-row.selected { background: #f6f0fa; }
.ug-row b { display: block; overflow: hidden; color: #2e2540; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ug-row small { display: block; overflow: hidden; color: #8a8197; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.ug-row .grow { flex: 1; min-width: 0; }
.ug-row-mark { display: grid; flex: none; place-items: center; width: 26px; height: 26px; }
.ug-point-list-mark { width: 13px; height: 13px; border: 2px solid #8a4cba; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px #e8d9f2; }
.ug-footer { display: flex; align-items: center; gap: 4px; padding: 10px 14px; border-top: 1px solid var(--line); }
.ug-footer button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border-radius: 7px; background: transparent; color: #5d5470; font-size: 12px; }
.ug-footer button:hover:not(:disabled) { background: #f4eefa; }
.ug-dirty { margin-left: auto; color: #9b4fd1; font-size: 12px; font-weight: 600; }
.ug-clean { margin-left: auto; color: #9a90a8; font-size: 12px; }

@media (max-width: 900px) {
  .underground-workspace { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(320px, 60%) minmax(0, 1fr); }
  .ug-map-wrap { grid-row: 1; }
  .ug-panel { border-left: 0; border-top: 1px solid var(--line); }
  .ug-toolbar button { width: auto; grid-template-columns: 20px; }
  .ug-toolbar button span, .ug-toolbar button kbd { display: none; }
  .ug-hint { top: auto; bottom: 64px; max-width: calc(100% - 32px); }
}
</style>

<style>
/* 地图上的标注由 Leaflet 生成，不在模板里，scoped 样式管不到 */
.ug-node-host, .ug-entrance-host, .ug-access-host { background: transparent; border: 0; }
.ug-node-host { cursor: grab; }
.ug-node { display: block; width: 12px; height: 12px; margin: 5px; border: 2.5px solid #9b4fd1; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #2e254055; transition: transform .1s; }
.ug-node-host:hover .ug-node { transform: scale(1.3); }
.ug-node.selected { background: #5b21b6; border-color: #fff; box-shadow: 0 0 0 2.5px #5b21b6, 0 2px 6px #2e254066; transform: scale(1.25); }
.ug-node.active { background: #9b4fd1; border-color: #fff; box-shadow: 0 0 0 3px #9b4fd1, 0 0 0 8px #9b4fd133; }
.ug-node.picked { background: #5b21b6; border-color: #fff; box-shadow: 0 0 0 3px #9b4fd1, 0 0 0 7px #9b4fd133; }
.ug-entrance-host { cursor: grab; }
.ug-entrance { display: block; width: 24px; height: 24px; margin: 3px; border: 3.5px solid #e5262d; border-radius: 50%; background: #ffffff38; box-shadow: 0 0 0 1.5px #fff, 0 1px 5px #0005; transition: transform .1s; }
.ug-entrance-host:hover .ug-entrance { transform: scale(1.12); }
.ug-entrance.selected { background: #e5262d40; box-shadow: 0 0 0 2px #fff, 0 0 0 6px #e5262d55; transform: scale(1.15); }
.ug-access-host { cursor: grab; }
.ug-access { display: block; width: 14px; height: 14px; margin: 4px; border: 2.5px solid #fff; border-radius: 50%; background: var(--c); box-shadow: 0 1px 4px #0006; transition: transform .1s; }
.ug-access-host:hover .ug-access { transform: scale(1.25); }
.ug-access.selected { outline: 2.5px solid var(--c); outline-offset: 2px; transform: scale(1.2); }
.ug-point-host { cursor: pointer; background: transparent; border: 0; }
.ug-point { display: grid; place-items: center; width: 24px; height: 24px; border: 2px solid #8a4cba; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px #0005; transition: transform .1s, background .1s; }
.ug-point-dot { width: 7px; height: 7px; border-radius: 50%; background: #8a4cba; }
.ug-point-host:hover .ug-point { transform: scale(1.2); }
.ug-point.selected { background: #eadcf2; box-shadow: 0 0 0 3px #8a4cba66, 0 1px 5px #0005; }
.tool-road .leaflet-container, .tool-road .leaflet-container.leaflet-interactive, .tool-entrance .leaflet-container, .tool-point .leaflet-container, .tool-point .leaflet-container.leaflet-interactive { cursor: crosshair; }
.tool-road .ug-node-host { cursor: copy; }
.tool-erase .ug-node-host, .tool-erase .ug-entrance-host, .tool-erase .ug-access-host { cursor: pointer; }
.tool-erase .ug-node-host:hover .ug-node { border-color: #e5262d; background: #ffe1e1; }
.tool-erase .ug-entrance-host:hover .ug-entrance { background: #e5262d66; }
.tool-erase .ug-access-host:hover .ug-access { outline: 2.5px solid #e5262d; outline-offset: 2px; }
</style>
