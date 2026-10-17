# 地上地下雨天一体化导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将地面步行栅格、地下候选道路和上下连接点合并为晴天地面、雨天择优的跨层步行导航。

**Architecture:** 保留 `route.ts` 作为地面子图，新增一体化元图寻路模块组合地面路线和地下路线；扩展路线结果携带层级与换层元数据。初始化时把建筑边缘缓冲加入遮挡栅格，前台用分层颜色和连接点标记展示结果，正式地下数据恢复为候选种子。

**Tech Stack:** TypeScript, Vue 3, Leaflet, Vitest, Vite。

**Spec:** `docs/superpowers/specs/2026-10-17-integrated-campus-routing-design.md`

## Global Constraints

- 晴天只使用地面路网；只有雨天才允许地下边参与寻路。
- 所有地下段算不淋雨；地面风雨长廊和建筑边缘缓冲区算有遮挡。
- 连续露天约十米以内不为地下绕行；长露天段应显著偏向地下或风雨长廊。
- 当前地下备份中的 `candidate` 数据参与计算，`rejected` 数据永不参与。
- 保留现有地下后台编辑、数据校验和单向道路语义。

## Review Focus

- 短露天段与长露天段的选择边界：由一体化寻路单测固定十米阈值和换层代价。
- 建筑边缘遮挡：验证建筑缓冲格进入 `covered`，而普通远离建筑的格子仍为露天。
- 连接点不完整：地下连接点吸附失败时不得让整条地面路线失败。
- 候选与拒绝状态：候选可走、拒绝完全排除，空地下图回退地面。
- 地图展示连续性：分层路线段首尾相接，进入/回到地面的标记与步骤方向一致。

### Task 1: 地面路线代价与遮挡模型

**Files:**
- Modify: `src/lib/route.ts`
- Modify: `src/lib/types.ts` only if route metadata types need sharing
- Test: `src/lib/route.test.ts`

**Interfaces:**
- Produces `RouteResult.segments[].layer`, `RouteResult.transitions` (empty for surface-only), `RouteResult.undergroundMeters` (zero for surface-only), and a comparable `routingCost`.
- Extends `initRouting(campus, walkways, shelterPolys?)` so optional building-edge polygons mark covered cells.

- [ ] **Step 1: Write failing tests** for optional shelter polygons, short exposed route cost, and route result metadata.
- [ ] **Step 2: Run `npx vitest run src/lib/route.test.ts` and verify the new assertions fail.**
- [ ] **Step 3: Implement shelter-cell marking and a path cost helper** in `src/lib/route.ts`; keep the existing surface Dijkstra and smoothing behavior, but expose actual distance, covered distance, and weather routing cost.
- [ ] **Step 4: Run the route test file and verify it passes.**
- [ ] **Step 5: Commit** with `git add src/lib/route.ts src/lib/route.test.ts src/lib/types.ts && git commit -m "feat: refine covered surface routing cost"`.

### Task 2: Cross-floor integrated route graph

**Files:**
- Create: `src/lib/integratedRoute.ts`
- Modify: `src/lib/undergroundRoute.ts` to expose reusable underground route filtering/geometry helpers if needed
- Test: `src/lib/integratedRoute.test.ts`

**Interfaces:**
- `findIntegratedRoute(from: Target, to: Target, map: UndergroundMap | null, options?: IntegratedRouteOptions): RouteResult | null`.
- `IntegratedRouteOptions` includes `allowCandidate`, `transitionPenaltyMeters`, `shortExposureMeters`, and underground mode selection.

- [ ] **Step 1: Write failing tests** for dry surface-only behavior, rainy long exposed route selecting underground, short exposed route staying surface, transition metadata, rejected filtering, and underground fallback.
- [ ] **Step 2: Run `npx vitest run src/lib/integratedRoute.test.ts` and verify it fails.**
- [ ] **Step 3: Implement underground subgraph assembly and connector absorption** using existing direction-aware road edges; create a meta graph over start, goal, and valid connectors, add rain-only surface/underground edges, add fixed transition cost, and reconstruct typed segments and transitions.
- [ ] **Step 4: Run the integrated route test file and verify it passes.**
- [ ] **Step 5: Commit** with `git add src/lib/integratedRoute.ts src/lib/integratedRoute.test.ts src/lib/undergroundRoute.ts && git commit -m "feat: add rainy cross-floor routing"`.

### Task 3: Application state and seed data

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/components/RouteCard.vue`
- Modify: `src/components/MapLabelControls.vue`
- Modify: `src/lib/undergroundSketch.ts` only if seed merge needs shared logic
- Modify: `public/data/underground.json`
- Test: `src/lib/store`-related existing tests or add focused assertions in `src/lib/integratedRoute.test.ts`

**Interfaces:**
- `computeRoute()` calls the integrated router only when `state.route.rain` is true and otherwise calls surface `findRoute`.
- `state.route.network` remains available only for underground editing compatibility; normal route UI is unified.

- [ ] **Step 1: Write failing state/UI assertions** for loading the restored seed, rain-only underground participation, and clearing stale underground-only results.
- [ ] **Step 2: Run the focused tests and verify failures.**
- [ ] **Step 3: Restore the backup roads/connectors into `public/data/underground.json`, wire `loadData()` with building shelter polygons, and replace route-network switching in the normal route card with unified status text while keeping the editor entry accessible.
- [ ] **Step 4: Run focused tests and verify they pass.**
- [ ] **Step 5: Commit** with `git add public/data/underground.json src/lib/store.ts src/components/RouteCard.vue src/components/MapLabelControls.vue src/lib/undergroundSketch.ts && git commit -m "feat: wire integrated campus routing"`.

### Task 4: Layered route rendering and transition instructions

**Files:**
- Modify: `src/components/MapView.vue`
- Modify: `src/components/RouteCard.vue`
- Modify: `src/App.vue` if the pick hint mentions underground-only mode
- Test: `src/lib/integratedRoute.test.ts` for segment continuity; manual browser smoke check for colors/markers

**Interfaces:**
- Map draws `surface` exposed in blue, `surface` covered in cyan, `underground` in purple, and transition markers at every `RouteTransition`.
- Route card shows total distance/time, covered distance, underground distance, and ordered transition labels.

- [ ] **Step 1: Add the typed result rendering assertions or snapshots needed by the existing test setup.**
- [ ] **Step 2: Implement layered drawing and transition markers** without changing Leaflet map initialization or unrelated label layers.
- [ ] **Step 3: Update route copy and legend** to describe underground as rain shelter and explain entering/leaving points.
- [ ] **Step 4: Run `npm test` and `npm run build`; manually open the route view with rain mode and verify segment colors and boundary markers.
- [ ] **Step 5: Commit** with `git add src/components/MapView.vue src/components/RouteCard.vue src/App.vue && git commit -m "feat: show integrated route layers"`.

### Task 5: Final verification and review

**Files:**
- Modify: `README.md` and `docs/功能介绍.md` to document the new behavior.

- [ ] **Step 1: Run `npm test` and capture any unrelated server-environment failures separately.**
- [ ] **Step 2: Run `npm run build` and fix TypeScript/Vue diagnostics.**
- [ ] **Step 3: Review the diff for accidental edits to the existing underground editor and parcel work.**
- [ ] **Step 4: Commit documentation and verification fixes** with `git add README.md docs/功能介绍.md && git commit -m "docs: describe cross-floor rainy routing"`.
