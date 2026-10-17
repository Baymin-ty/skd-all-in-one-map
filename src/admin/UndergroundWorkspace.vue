<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { createCampusMap } from '../lib/campusMap'
import { fromLatLng, toLatLng } from '../lib/geo'
import type { IconName } from '../lib/icons'
import { meters } from '../lib/measure'
import type { LngLat, UndergroundConnector, UndergroundConnectorKind, UndergroundStatus } from '../lib/types'
import { ENTRANCE_REACH_METERS, degree, edgeMeters, graphIssues, projectOnEdge, type UgEdge } from '../lib/undergroundGraph'
import {
  admin, addUndergroundEntrance, deleteUnderground, deleteUndergroundSelection, drawUndergroundAt, drawUndergroundOnEdge,
  drawUndergroundToNode, finishUndergroundRoad, insertUndergroundNode, moveUndergroundEntrance, moveUndergroundNode,
  redoUnderground, saveUnderground, selectUnderground, setUndergroundTool, undergroundCanRedo, undergroundCanUndo,
  undergroundDirty, undoUnderground, updateUndergroundEdge, updateUndergroundEntrance, type UndergroundTool,
} from './store'

const PURPLE = '#9b4fd1', PURPLE_DARK = '#5b21b6', RED = '#e5262d'
/** 拖动节点松手时，离另一个节点这么近（屏幕像素）就合并成路口 */
const SNAP_PX = 14

const tools: { id: UndergroundTool; label: string; icon: IconName; key: string }[] = [
  { id: 'select', label: '选择', icon: 'pointer', key: 'V' },
  { id: 'road', label: '道路', icon: 'road', key: 'R' },
  { id: 'entrance', label: '出入口', icon: 'entrance', key: 'E' },
  { id: 'erase', label: '删除', icon: 'trash', key: 'X' },
]
const kindLabel: Record<UndergroundConnectorKind, string> = { ramp: '车辆出入口', stairs: '楼梯口', elevator: '电梯口', unknown: '其他出入口' }
const kindShort: Record<UndergroundConnectorKind, string> = { ramp: '车', stairs: '梯', elevator: '电', unknown: '口' }
const statusLabel: Record<UndergroundStatus, string> = { candidate: '待核验', confirmed: '已确认', rejected: '已排除' }
const sourceLabel: Record<string, string> = { admin: '后台标注', 'front-sketch': '前台手绘', 'admin-sketch': '后台标注' }

const el = ref<HTMLDivElement>()
const ready = ref(false)
let map: L.Map | null = null
const renderer = L.canvas({ padding: 0.5, tolerance: 7 })
const edgeLayer = L.layerGroup(), nodeLayer = L.layerGroup(), entranceLayer = L.layerGroup()
const rubber = L.polyline([], { color: PURPLE, weight: 3, opacity: 0.85, dashArray: '6 7', interactive: false })
let cursor: L.LatLng | null = null
/** 节点 → 与它相连的线（以及它是线的第几个端点），拖动时实时跟着走 */
const tracked = new Map<string, { line: L.Polyline; end: 0 | 1 }[]>()
const nodeMarkers = new Map<string, L.Marker>()
let snapTarget: string | null = null

const graph = computed(() => admin.undergroundGraph)
const tool = computed(() => admin.undergroundTool)
const issues = computed(() => graph.value ? graphIssues(graph.value) : { islands: [], looseEnds: [], farEntrances: [] })
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
const hint = computed(() => {
  if (tool.value === 'road') return admin.undergroundActive
    ? '继续点击添加下一个点，点到已有的点或路段会自动接上 · 双击、Enter 或右键结束这条路'
    : '点击地图开始画路；从已有的点或路段上开始，就是接出一条岔路'
  if (tool.value === 'entrance') return '点击地图放置红色出入口，放好后可以直接拖动'
  if (tool.value === 'erase') return '点击要删的点、路段或出入口；删路中间的点，两侧会自动接上'
  return '拖动紫点调整道路，拖到另一个点上合并成路口 · 双击路段加点 · 任何时候右键都能删除'
})

function nearestRoadMeters(pos: LngLat) {
  const g = graph.value
  return g?.nodes.length ? Math.min(...g.nodes.map((n) => meters(n.pos, pos))) : Infinity
}
function edgeStyle(e: UgEdge, selected: boolean): L.PolylineOptions {
  if (e.status === 'rejected') return { color: '#a1a1aa', weight: selected ? 7 : 5, opacity: 0.6, dashArray: '2 8' }
  return {
    color: selected ? PURPLE_DARK : PURPLE, weight: selected ? 8 : 5.5, opacity: e.status === 'candidate' ? 0.7 : 0.95,
    dashArray: e.status === 'candidate' ? '10 7' : undefined,
  }
}
function track(id: string, line: L.Polyline, end: 0 | 1) {
  const list = tracked.get(id) ?? []; list.push({ line, end }); tracked.set(id, list)
}
const stop = (event: L.LeafletEvent) => L.DomEvent.stop((event as L.LeafletMouseEvent).originalEvent)

function draw() {
  const g = graph.value
  if (!map || !g) return
  edgeLayer.clearLayers(); nodeLayer.clearLayers(); entranceLayer.clearLayers(); tracked.clear(); nodeMarkers.clear(); snapTarget = null
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
    track(e.a, line, 0); track(e.b, line, 1)
  }
  for (const n of g.nodes) {
    const selected = sel?.kind === 'node' && sel.id === n.id
    const active = admin.undergroundActive === n.id
    const marker = L.marker(toLatLng(n.pos), {
      draggable: !admin.undergroundSaving, keyboard: false, zIndexOffset: active ? 600 : selected ? 500 : 0,
      icon: L.divIcon({ className: 'ug-node-host', html: `<span class="ug-node${selected ? ' selected' : ''}${active ? ' active' : ''}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(nodeLayer)
    nodeMarkers.set(n.id, marker)
    marker.on('click', (event) => nodeClick(n.id, event))
    marker.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'node', id: n.id }) })
    marker.on('drag', () => dragNode(n.id, marker.getLatLng()))
    marker.on('dragend', () => moveUndergroundNode(n.id, fromLatLng(marker.getLatLng()), snapTarget ?? undefined))
  }
  for (const c of g.entrances) {
    const selected = sel?.kind === 'entrance' && sel.id === c.id
    const marker = L.marker(toLatLng(c.pos), {
      draggable: !admin.undergroundSaving, keyboard: false, zIndexOffset: 1000, title: `${kindLabel[c.kind]}${c.note ? ` · ${c.note}` : ''}`,
      icon: L.divIcon({ className: 'ug-entrance-host', html: `<span class="ug-entrance${selected ? ' selected' : ''}${c.status === 'rejected' ? ' rejected' : ''}"></span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(entranceLayer)
    marker.on('click', (event) => entranceClick(c, event))
    marker.on('contextmenu', (event) => { stop(event); deleteUnderground({ kind: 'entrance', id: c.id }) })
    marker.on('dragend', () => moveUndergroundEntrance(c.id, snapToNode(marker.getLatLng())))
  }
  drawRubber()
}

function drawRubber() {
  const g = graph.value, active = admin.undergroundActive
  const from = active && g?.nodes.find((n) => n.id === active)
  if (!map || tool.value !== 'road' || !from || !cursor) { rubber.remove(); return }
  rubber.setLatLngs([toLatLng(from.pos), cursor]).addTo(map)
}

/** 屏幕上离 latlng 最近、且在 SNAP_PX 以内的节点 */
function nearbyNode(latlng: L.LatLng, except?: string) {
  if (!map || !graph.value) return null
  const p = map.latLngToContainerPoint(latlng)
  let best: string | null = null, bestPx = SNAP_PX
  for (const n of graph.value.nodes) {
    if (n.id === except) continue
    const d = p.distanceTo(map.latLngToContainerPoint(toLatLng(n.pos)))
    if (d <= bestPx) best = n.id, bestPx = d
  }
  return best
}
function snapToNode(latlng: L.LatLng): LngLat {
  const id = nearbyNode(latlng)
  return (id && graph.value?.nodes.find((n) => n.id === id)?.pos) || fromLatLng(latlng)
}
function dragNode(id: string, latlng: L.LatLng) {
  for (const { line, end } of tracked.get(id) ?? []) {
    const points = line.getLatLngs() as L.LatLng[]
    points[end] = latlng; line.setLatLngs(points)
  }
  if (admin.undergroundActive === id && cursor) rubber.setLatLngs([latlng, cursor])
  const target = nearbyNode(latlng, id)
  if (target !== snapTarget) {
    if (snapTarget) nodeMarkers.get(snapTarget)?.getElement()?.querySelector('.ug-node')?.classList.remove('snap')
    if (target) nodeMarkers.get(target)?.getElement()?.querySelector('.ug-node')?.classList.add('snap')
    snapTarget = target
  }
}

function nodeClick(id: string, event: L.LeafletMouseEvent) {
  stop(event)
  const pos = graph.value?.nodes.find((n) => n.id === id)?.pos
  if (tool.value === 'road') event.originalEvent.altKey ? drawUndergroundAt(fromLatLng(event.latlng)) : drawUndergroundToNode(id)
  else if (tool.value === 'entrance') { if (pos) addUndergroundEntrance(pos) }
  else if (tool.value === 'erase') deleteUnderground({ kind: 'node', id })
  else selectUnderground({ kind: 'node', id })
}
function edgeClick(e: UgEdge, event: L.LeafletMouseEvent) {
  stop(event)
  const pos = fromLatLng(event.latlng)
  if (tool.value === 'road') event.originalEvent.altKey ? drawUndergroundAt(pos) : drawUndergroundOnEdge(e.id, pos)
  else if (tool.value === 'entrance') addUndergroundEntrance(projectOnEdge(graph.value!, e.id, pos)?.pos ?? pos)
  else if (tool.value === 'erase') deleteUnderground({ kind: 'edge', id: e.id })
  else selectUnderground({ kind: 'edge', id: e.id })
}
function entranceClick(c: UndergroundConnector, event: L.LeafletMouseEvent) {
  stop(event)
  if (tool.value === 'erase') return deleteUnderground({ kind: 'entrance', id: c.id })
  if (tool.value === 'road') {
    // 道路画到出入口上：红圈下面已经有节点就接到那个节点，没有就在红圈处落一个点
    const under = graph.value?.nodes.find((n) => n.pos[0] === c.pos[0] && n.pos[1] === c.pos[1])
    return under ? drawUndergroundToNode(under.id) : drawUndergroundAt(c.pos)
  }
  selectUnderground({ kind: 'entrance', id: c.id })
}
function mapClick(event: L.LeafletMouseEvent) {
  const pos = fromLatLng(event.latlng)
  if (tool.value === 'road') drawUndergroundAt(pos)
  else if (tool.value === 'entrance') addUndergroundEntrance(pos)
  else if (tool.value === 'select') selectUnderground(null)
}
function mapMove(event: L.LeafletMouseEvent) {
  cursor = event.latlng
  if (tool.value === 'road' && admin.undergroundActive) drawRubber()
}
function endRoad() { if (tool.value === 'road' && admin.undergroundActive) finishUndergroundRoad() }

function fitAll() {
  if (!map || !admin.campus) return
  const nodes = graph.value?.nodes ?? []
  const points = nodes.length ? [...nodes.map((n) => n.pos), ...(graph.value?.entrances.map((e) => e.pos) ?? [])] : admin.campus.boundary
  map.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [40, 40], maxZoom: 18 })
}
function focus(points: LngLat[], select?: Parameters<typeof selectUnderground>[0]) {
  if (!map || !points.length) return
  map.fitBounds(L.latLngBounds(points.map(toLatLng)), { padding: [80, 80], maxZoom: 19 })
  if (select) selectUnderground(select)
}
const cycle = { islands: 0, looseEnds: 0, farEntrances: 0 }
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

function setEdgeStatus(status: string) { if (selectedEdge.value) updateUndergroundEdge(selectedEdge.value.id, { status: status as UndergroundStatus }) }
function setEntrance(key: 'kind' | 'status' | 'note', value: string) {
  if (selectedEntrance.value) updateUndergroundEntrance(selectedEntrance.value.id, { [key]: key === 'note' ? value.trim() : value } as never)
}
function continueFrom() { setUndergroundTool('road') }

onMounted(() => {
  if (!el.value || !admin.campus) return
  map = createCampusMap(el.value, admin.campus)
  map.doubleClickZoom.disable()
  edgeLayer.addTo(map); nodeLayer.addTo(map); entranceLayer.addTo(map)
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
          :aria-pressed="tool === t.id" :title="`${t.label}（${t.key}）`" :disabled="admin.undergroundSaving" @click="setUndergroundTool(t.id)"
        ><Ico :name="t.icon" /><span>{{ t.label }}</span><kbd>{{ t.key }}</kbd></button>
      </div>

      <div class="ug-hint" :class="`tool-${tool}`" role="status">
        <span>{{ hint }}</span>
        <template v-if="tool === 'entrance'">
          <span class="ug-kinds" role="radiogroup" aria-label="新出入口类型">
            <button v-for="k in (['ramp', 'stairs', 'elevator'] as const)" :key="k" type="button" role="radio" :aria-checked="admin.undergroundEntranceKind === k" :class="{ on: admin.undergroundEntranceKind === k }" @click="admin.undergroundEntranceKind = k">{{ kindLabel[k] }}</button>
          </span>
        </template>
        <button v-if="tool === 'road' && admin.undergroundActive" type="button" class="ug-hint-action" @click="finishUndergroundRoad">结束这条路</button>
      </div>

      <div class="ug-legend" aria-hidden="true">
        <span><i class="line" />道路</span><span><i class="line dashed" />待核验</span><span><i class="ring" />出入口</span>
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
      </div>

      <div class="ug-scroll">
        <section v-if="selectedNode" class="ug-card">
          <div class="ug-card-head"><span class="ug-dot" />节点<button class="icon-button danger" title="删除节点（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <p class="ug-meta">{{ degree(graph!, selectedNode.id) === 0 ? '孤立的点' : degree(graph!, selectedNode.id) >= 3 ? `路口 · 连着 ${degree(graph!, selectedNode.id)} 条路段` : degree(graph!, selectedNode.id) === 1 ? '道路端点' : '道路中间的点' }}</p>
          <p class="ug-coords">{{ selectedNode.pos[0].toFixed(6) }}, {{ selectedNode.pos[1].toFixed(6) }}</p>
          <button class="button secondary full" @click="continueFrom"><Ico name="road" />从这个点接着画（R）</button>
        </section>

        <section v-else-if="selectedEdge" class="ug-card">
          <div class="ug-card-head"><span class="ug-swatch" :class="selectedEdge.status" />路段<button class="icon-button danger" title="删除路段（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <p class="ug-meta">约 {{ Math.round(edgeMeters(graph!, selectedEdge)) }} 米 · {{ sourceLabel[selectedEdge.source ?? ''] ?? (selectedEdge.source ? '地下图纸' : '未注明来源') }}</p>
          <div class="ug-segmented" role="radiogroup" aria-label="路段状态">
            <button v-for="s in (['confirmed', 'candidate', 'rejected'] as const)" :key="s" type="button" role="radio" :aria-checked="selectedEdge.status === s" :class="{ on: selectedEdge.status === s }" @click="setEdgeStatus(s)">{{ statusLabel[s] }}</button>
          </div>
          <p class="ug-help">已排除的路段不参与地下寻路。双击路段可以在上面加点。</p>
        </section>

        <section v-else-if="selectedEntrance" class="ug-card">
          <div class="ug-card-head"><span class="ug-ring" />出入口<button class="icon-button danger" title="删除出入口（Delete）" @click="deleteUndergroundSelection"><Ico name="trash" /></button></div>
          <label>类型<select :value="selectedEntrance.kind" @change="setEntrance('kind', ($event.target as HTMLSelectElement).value)"><option v-for="(label, k) in kindLabel" :key="k" :value="k">{{ label }}</option></select></label>
          <label>说明<input :value="selectedEntrance.note ?? ''" placeholder="例如：信息学院北侧坡道" @change="setEntrance('note', ($event.target as HTMLInputElement).value)"></label>
          <div class="ug-segmented" role="radiogroup" aria-label="出入口状态">
            <button v-for="s in (['confirmed', 'candidate', 'rejected'] as const)" :key="s" type="button" role="radio" :aria-checked="selectedEntrance.status === s" :class="{ on: selectedEntrance.status === s }" @click="setEntrance('status', s)">{{ statusLabel[s] }}</button>
          </div>
          <p class="ug-help" :class="{ warn: nearestRoadMeters(selectedEntrance.pos) > ENTRANCE_REACH_METERS }">
            离最近的道路节点 {{ Number.isFinite(nearestRoadMeters(selectedEntrance.pos)) ? `${Math.round(nearestRoadMeters(selectedEntrance.pos))} 米` : '—' }}<template v-if="nearestRoadMeters(selectedEntrance.pos) > ENTRANCE_REACH_METERS">，超过 {{ ENTRANCE_REACH_METERS }} 米，地下寻路接不上</template>
          </p>
        </section>

        <section v-else class="ug-card ug-guide">
          <h3>怎么标</h3>
          <ul>
            <li><kbd>R</kbd> 画道路：逐点点击，双击或 <kbd>Enter</kbd> 结束；点到已有的点/路段自动接成路口，按住 <kbd>⌥</kbd> 点击不吸附</li>
            <li><kbd>E</kbd> 放出入口：点哪放哪，红圈可拖动</li>
            <li><kbd>V</kbd> 拖动紫点改线，拖到另一个点上合并；双击路段加点</li>
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
          <button class="ug-check" :class="{ ok: !issues.farEntrances.length }" :disabled="!issues.farEntrances.length" @click="focusIssue('farEntrances')">
            <span>{{ issues.farEntrances.length ? `${issues.farEntrances.length} 个出入口离道路太远` : '出入口都能接到道路' }}</span><Ico v-if="issues.farEntrances.length" name="target" /><Ico v-else name="check" />
          </button>
        </section>

        <section class="ug-section">
          <h3>出入口 <small>{{ graph?.entrances.length ?? 0 }}</small></h3>
          <p v-if="!graph?.entrances.length" class="ug-help">还没有出入口，按 <kbd>E</kbd> 在地图上点击添加。</p>
          <button
            v-for="c in graph?.entrances" :key="c.id" class="ug-row" :class="{ selected: admin.undergroundSelected?.id === c.id, rejected: c.status === 'rejected' }"
            @click="focus([c.pos], { kind: 'entrance', id: c.id })"
          >
            <span class="ug-row-ring">{{ kindShort[c.kind] }}</span>
            <span class="grow"><b>{{ c.note || kindLabel[c.kind] }}</b><small>{{ kindLabel[c.kind] }} · {{ statusLabel[c.status] }}<template v-if="issues.farEntrances.includes(c.id)"> · 离道路太远</template></small></span>
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
.ug-kinds button { padding: 4px 9px; border-radius: 6px; background: transparent; color: #6a5d7c; font-size: 12px; }
.ug-kinds button.on { background: #e5262d; color: #fff; }

.ug-legend { position: absolute; z-index: 800; left: 16px; bottom: 18px; display: flex; gap: 14px; padding: 7px 12px; border: 1px solid #e3dcea; border-radius: 9px; background: #fffffff2; color: #5d5470; font-size: 12px; }
.ug-legend span { display: inline-flex; align-items: center; gap: 6px; }
.ug-legend .line { width: 22px; height: 5px; border-radius: 3px; background: #9b4fd1; }
.ug-legend .line.dashed { background: repeating-linear-gradient(90deg, #9b4fd1b3 0 7px, transparent 7px 11px); }
.ug-legend .ring { width: 13px; height: 13px; border: 3px solid #e5262d; border-radius: 50%; }
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
.ug-stats { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
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
.ug-swatch.candidate { background: repeating-linear-gradient(90deg, #9b4fd1 0 6px, transparent 6px 9px); }
.ug-swatch.rejected { background: #a1a1aa; }
.ug-ring { width: 15px; height: 15px; border: 3px solid #e5262d; border-radius: 50%; }
.ug-meta { color: #4c4260; font-size: 13px; }
.ug-coords { color: #9a90a8; font-size: 11px; font-variant-numeric: tabular-nums; }
.ug-help { color: #8a8197; font-size: 12px; line-height: 1.5; }
.ug-help.warn { color: #b0362f; }
.ug-segmented { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 3px; border-radius: 9px; background: #f1edf5; }
.ug-segmented button { padding: 6px 4px; border-radius: 7px; background: transparent; color: #6a5d7c; font-size: 12px; }
.ug-segmented button.on { background: #fff; color: #2e2540; font-weight: 600; box-shadow: 0 1px 3px #2e254026; }
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
.ug-check:disabled { opacity: 1; cursor: default; }
.ug-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 9px; border-radius: 9px; background: transparent; text-align: left; }
.ug-row:hover, .ug-row.selected { background: #f6f0fa; }
.ug-row.rejected { opacity: .55; }
.ug-row b { display: block; overflow: hidden; color: #2e2540; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ug-row small { color: #8a8197; font-size: 11px; }
.ug-row .grow { flex: 1; min-width: 0; }
.ug-row-ring { display: grid; flex: none; place-items: center; width: 26px; height: 26px; border: 3px solid #e5262d; border-radius: 50%; color: #c21d23; font-size: 11px; font-weight: 800; }
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
.ug-node-host, .ug-entrance-host { background: transparent; border: 0; }
.ug-node-host { cursor: grab; }
.ug-node { display: block; width: 12px; height: 12px; margin: 5px; border: 2.5px solid #9b4fd1; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #2e254055; transition: transform .1s; }
.ug-node-host:hover .ug-node { transform: scale(1.3); }
.ug-node.selected { background: #5b21b6; border-color: #fff; box-shadow: 0 0 0 2.5px #5b21b6, 0 2px 6px #2e254066; transform: scale(1.25); }
.ug-node.active { background: #9b4fd1; border-color: #fff; box-shadow: 0 0 0 3px #9b4fd1, 0 0 0 8px #9b4fd133; }
.ug-node.snap { background: #9b4fd1; box-shadow: 0 0 0 6px #9b4fd155; transform: scale(1.5); }
.ug-entrance-host { cursor: grab; }
.ug-entrance { display: block; width: 24px; height: 24px; margin: 3px; border: 3.5px solid #e5262d; border-radius: 50%; background: #ffffff38; box-shadow: 0 0 0 1.5px #fff, 0 1px 5px #0005; transition: transform .1s; }
.ug-entrance-host:hover .ug-entrance { transform: scale(1.12); }
.ug-entrance.selected { background: #e5262d40; box-shadow: 0 0 0 2px #fff, 0 0 0 6px #e5262d55; transform: scale(1.15); }
.ug-entrance.rejected { border-color: #a1a1aa; border-style: dashed; }
.tool-road .leaflet-container, .tool-road .leaflet-container.leaflet-interactive, .tool-entrance .leaflet-container { cursor: crosshair; }
.tool-road .ug-node-host { cursor: copy; }
.tool-erase .ug-node-host, .tool-erase .ug-entrance-host { cursor: pointer; }
.tool-erase .ug-node-host:hover .ug-node { border-color: #e5262d; background: #ffe1e1; }
.tool-erase .ug-entrance-host:hover .ug-entrance { background: #e5262d66; }
</style>
