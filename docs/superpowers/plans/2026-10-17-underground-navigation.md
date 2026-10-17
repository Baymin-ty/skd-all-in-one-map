# 地下车库路网与上下连接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入用户提供的地下车库图，建立与地上百度坐标底图对齐的第一版地下道路、候选上下连接点和可删除的地下图层数据。

**Architecture:** 地下图层独立于地面栅格，以 `underground.json` 保存图纸来源、坐标锚点、道路折线和待核验连接点。地下道路先按用户图中三角箭头指示的车行线录入为候选可通行线；楼梯间、电梯厅、车库出入口和地面已有车库 POI 作为 `status: candidate` 的连接点。地图只在地下图层开关打开时叠加绘制，后续确认或删除不需要重做地面数据。

**Tech Stack:** Vue 3、TypeScript、Leaflet、Vitest、Node JSON 数据。

**Spec:** 用户提供的五张地下车库照片与一张全景照片；三角形/箭头线视为道路；上下通行设施先多标记，后续人工确认删除。

## Global Constraints

- 坐标继续使用项目现有的 BD-09 `[lng, lat]`，和 `campus.json` 的手绘底图对齐。
- 候选上下点必须带 `status: candidate`，不能当作已确认设施。
- 地下图层不能改变现有地面寻路结果。
- 原始照片作为数据来源归档，不能覆盖现有瓦片或地面底图。

## Review Focus

- 图纸坐标锚点不足或顺序错误时，地下道路不得静默绘制到校园外；用 bounds 校验覆盖范围。
- 候选楼梯/电梯/坡道必须可区分、可删除，并在详情中显示待核验状态。
- 地下道路断线或孤立时，数据验证应报告节点数、道路数和连接数。
- 地面 POI 与地下连接点重复时，必须保留稳定 id 以便后续确认合并。
- 地下图层未加载时，现有路线和地图渲染测试应保持通过。

### Task 1: 地下图层数据模型和验证器

**Files:**
- Create: `src/lib/underground.ts`
- Test: `src/lib/underground.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- `UndergroundMap`, `UndergroundRoad`, `UndergroundConnector`, `UndergroundSource` types.
- `validateUndergroundMap(map, campus): string[]` validates ids, coordinate bounds, road geometry and connector statuses.

- [ ] Write failing tests for a valid map, an out-of-bounds road, and a connector without candidate status.
- [ ] Run `npm test -- --run src/lib/underground.test.ts` and observe failure.
- [ ] Implement types and validator.
- [ ] Run the focused test and full suite.

### Task 2: 导入照片与地下第一版数据

**Files:**
- Create: `public/data/underground.json`
- Create: `public/data/underground/3aa5da4e8a1d1bde59207641e78e3299.png`
- Create: `public/data/underground/1965b8a04068d1c6d7c606b000f647e6.png`
- Create: `public/data/underground/c23a5b78d0ca395a11330e38a4a0307a.png`
- Create: `public/data/underground/5176ea3f24b2e65456393db6edd213f4.png`
- Create: `public/data/underground/23f650c0cad9dff3f092325feca0d629.png`
- Create: `public/data/underground/codex-clipboard-8eff3162-cc19-4cd5-b4b1-d00fd922a0ef.jpg`

**Interfaces:**
- Data uses a source image with four BD-09 anchor points and normalised image coordinates.
- Roads are polylines in BD-09, `status: candidate` and `mode: car`.
- Candidate connectors use `kind: ramp | stairs | elevator | unknown`, `floorFrom: 0`, `floorTo: -1` and stable ids.

- [ ] Copy user-provided images into the public archive.
- [ ] Create a first-pass underground JSON with source metadata, image anchors, candidate roads and connectors aligned to the current campus map.
- [ ] Run the validator against `public/data/campus.json`.

### Task 3: 加载和绘制地下图层

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/components/MapView.vue`
- Modify: `src/lib/icons.ts`
- Modify: `src/style.css`
- Test: `src/lib/underground.test.ts`

**Interfaces:**
- `state.underground` stores loaded `UndergroundMap | null`.
- `drawUnderground()` renders candidate roads and connectors only when the layer is enabled.

- [ ] Extend the failing test to assert that source data can be loaded without changing the ground route graph.
- [ ] Implement loading and a visible underground toggle/overlay.
- [ ] Render roads with a distinct dashed style and connectors with type-specific icons plus `待核验` label.
- [ ] Run the full suite and `npm run build`.

### Task 4: 数据说明和后续核验入口

**Files:**
- Modify: `README.md`
- Modify: `src/components/MapView.vue`

- [ ] Add a short data note describing the source photos, alignment anchors and candidate status.
- [ ] Ensure the layer can be turned off and no underground candidate participates in ground routing.
- [ ] Run `npm test` and `npm run build`.
