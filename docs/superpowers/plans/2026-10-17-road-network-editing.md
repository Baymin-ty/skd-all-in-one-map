# 地面与地下路网后台编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 admin 中编辑并保存地面可走栅格和地下道路网络，并让前台导航读取已保存的路网覆盖数据。

**Architecture:** 服务端在现有 SQLite 数据库中保存 `surface` 与 `underground` 两个完整 JSON 覆盖项，公开 GET 接口组合覆盖项和静态回退，管理员 PUT 接口做鉴权、校验和更新时间冲突检查。前台加载 `/api/network` 后覆盖静态 campus/地下数据；admin 新增一个路网工作区，地面使用画布栅格画笔，地下使用 Leaflet 折线和可拖动顶点编辑。

**Tech Stack:** Express 5, `node:sqlite`, Vue 3 Composition API, TypeScript, Leaflet, Vitest, `vue-tsc`。

**Spec:** `docs/superpowers/specs/2026-10-17-road-network-editing-design.md`

## Global Constraints

- 保持现有八邻域地面路由算法和地下 `rejected` 状态过滤逻辑不变。
- 地面网格尺寸、坐标参数和非路网字符不能被编辑器改变；允许的网格字符只有 `0`、`1`、`2`，编辑器只写入 `0` 或 `1`。
- 路网读接口公开，路网写接口必须使用现有 admin Bearer 令牌。
- 保存以完整文档替换；`If-Unmodified-Since` 与数据库最新更新时间不一致时返回 409。
- 数据库覆盖项损坏或缺失时回退到静态 JSON，不直接修改 `public/data`。
- 任何最终提交或 commit 前都要先征得用户同意。

## Review Focus

- 网格行数或列数不匹配时，服务端拒绝写入且保留旧覆盖项；由 Task 1 的 API 校验测试覆盖。
- 地下道路越界、少于两个顶点或重复 ID 时，服务端拒绝写入；由 Task 1 的地下校验测试覆盖。
- 两个管理员基于不同版本保存时，后一个请求返回 409 且不覆盖前一个版本；由 Task 1 的并发测试覆盖。
- `/api/network` 不可用时，前台仍使用静态 campus/地下数据；由 Task 2 的加载测试覆盖。
- 地面拖动跨越同一单元、多次撤销重做和地下顶点拖动不能产生重复或丢失编辑；由 Task 3 的纯编辑状态测试覆盖。

---

### Task 1: 路网服务模块与 API

**Files:**
- Create: `server/network.mjs`
- Create: `server/network.test.mjs`
- Modify: `server/index.mjs`（安装 network 模块，并在 `/api` 路由之前注册）

**Interfaces:**
- Consumes: `campus.grid`, `campus.bounds`, `public/data/underground.json`, `requireAdmin`、SQLite `db`。
- Produces: `installNetwork(app, db, root, { authorize, campus })`; `GET /api/network`; `PUT /api/network/surface`; `PUT /api/network/underground`。
- Response shape: `GET` 返回 `{ surface: Campus['grid'], underground: UndergroundMap, updatedAt: number }`；surface PUT 返回 `{ surface, updatedAt }`；underground PUT 返回 `{ underground, updatedAt }`。

- [ ] **Step 1: Write failing integration tests**

在 `server/network.test.mjs` 复用 `server/index.test.mjs` 的临时 SQLite、随机端口和 `call()` 模式，覆盖：公开 GET 返回静态回退；未登录 PUT 返回 401；合法 surface 保存后 GET 返回覆盖项；surface 行数、列数、坐标参数或字符非法时返回 400 且旧值不变；合法 underground 保存后跨重启读取；地下越界、短道路、重复 ID、无效 status/kind 返回 400；带旧 `If-Unmodified-Since` 的保存返回 409 且不改变新版本。

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run server/network.test.mjs`
Expected: FAIL because the network routes and installer do not exist.

- [ ] **Step 3: Implement `installNetwork` in `server/network.mjs`**

创建 `network_overrides(kind TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`。加载静态地下 JSON；为 surface 检查 `x0/y0/dx/dy` 与静态网格一致、`rows` 行数和列数一致且字符属于 `0|1|2`；为 underground 检查文档字段、ID 唯一性、实体 bounds、道路至少两个点、status/kind/mode/direction、连接点楼层差异，并将数字坐标规范化到 6 位。GET 分别读取覆盖项并回退静态数据，`updatedAt` 取覆盖项时间最大值。PUT 在事务内先校验 `If-Unmodified-Since`，再写对应 kind 和 `Date.now()`；将校验错误传递为现有 `BadRequest` 语义，冲突直接返回 409。

- [ ] **Step 4: Register the installer and run focused tests**

在 `server/index.mjs` 导入并调用 `installNetwork`，传入已有 `requireAdmin` 和 `campus`，确保关闭服务器时不需要额外资源。运行 `npx vitest run server/network.test.mjs`，预期全部通过。

- [ ] **Step 5: Run existing server tests**

Run: `npx vitest run server/index.test.mjs server/network.test.mjs`
Expected: PASS，现有地点和地图显示 API 行为不变。

---

### Task 2: 前台路网数据加载与纯编辑工具

**Files:**
- Create: `src/lib/network.ts`
- Create: `src/lib/network.test.ts`
- Modify: `src/lib/types.ts`（补充 `SurfaceGrid`、`NetworkResponse` 类型别名）
- Modify: `src/lib/store.ts`（请求 `/api/network`，覆盖 campus.grid 和 underground）

**Interfaces:**
- `validateSurfaceGrid(grid: SurfaceGrid, base: SurfaceGrid): string[]`
- `cellAt(grid: SurfaceGrid, pos: LngLat): { row: number; col: number } | null`
- `paintSurfaceCell(grid: SurfaceGrid, row: number, col: number, walkable: boolean): SurfaceGrid`
- `applyNetworkResponse(campus: Campus, underground: UndergroundMap | null, response: unknown): { campus: Campus; underground: UndergroundMap | null }`
- `type NetworkResponse = { surface: SurfaceGrid; underground: UndergroundMap; updatedAt: number }

- [ ] **Step 1: Write failing pure tests**

在 `src/lib/network.test.ts` 测试合法网格通过、尺寸/字符/坐标参数错误被拒绝；`cellAt` 对 bounds 内外和边界返回正确结果；`paintSurfaceCell` 只修改指定字符并返回深拷贝；重复绘制同一单元保持幂等。

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/lib/network.test.ts`
Expected: FAIL because the network helper module does not exist.

- [ ] **Step 3: Implement the network helpers**

在 `src/lib/network.ts` 中集中定义 surface grid 类型和复制、校验、坐标转行列、单元绘制函数。`paintSurfaceCell` 只把可走写为 `'0'`、不可走写为 `'1'`，越界返回原副本；保留 `2` 作为读取兼容字符。所有返回值都不能共享输入的 `rows` 数组引用。

- [ ] **Step 4: Modify `loadData()` and test fallback behavior**

先加载静态 places/campus/underground，再请求 `/api/network`；通过 `applyNetworkResponse` 处理响应：surface 存在且校验通过时用 `{ ...campus, grid: response.surface }`，underground 存在且 `validateUndergroundMap` 无错误时替换；请求失败或字段无效时保留静态值。调用 `initRouting` 时使用最终 campus。测试 network 请求失败和字段无效都不会清空静态数据。

- [ ] **Step 5: Run focused tests and type-check**

Run: `npx vitest run src/lib/network.test.ts src/lib/route.test.ts src/lib/underground.test.ts && npm run build`
Expected: PASS，前台现有路径和地下数据测试不受影响。

---

### Task 3: Admin 路网状态与编辑操作

**Files:**
- Create: `src/admin/networkStore.ts`
- Create: `src/admin/networkStore.test.ts`
- Modify: `src/admin/store.ts`（`View` 增加 `network`，提供 network dirty 状态参与离开保护）

**Interfaces:**
- `network` reactive state：`surface`, `underground`, `baseUpdatedAt`, `activeTab`, `selectedRoadId`, `selectedConnectorId`, `loading`, `saving`, `error`, `dirty`, `surfacePast`, `surfaceFuture`。
- `loadNetwork(): Promise<void>`
- `paintCell(row: number, col: number, walkable: boolean): void`
- `undoSurface(): void`, `redoSurface(): void`
- `updateRoad(id: string, patch: Partial<UndergroundRoad>): void`
- `updateConnector(id: string, patch: Partial<UndergroundConnector>): void`
- `addRoad(path: LngLat[]): string`, `addConnector(pos: LngLat): string`, `rejectEntity(kind, id): void`
- `saveSurface(): Promise<void>`, `saveUnderground(): Promise<void>`
- `networkDirty: ComputedRef<boolean>`

- [ ] **Step 1: Write failing state tests**

用最小 campus/grid 和地下地图测试：地面画笔生成可撤销快照，撤销/重做恢复准确行内容；地下更新只改变目标实体；新增实体 ID 唯一；`rejectEntity` 只改 status；dirty 在加载基线相等时为 false，编辑后为 true；保存冲突错误保留 dirty 草稿。

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run src/admin/networkStore.test.ts`
Expected: FAIL because the store and operations do not exist.

- [ ] **Step 3: Implement `networkStore.ts`**

使用现有 admin `request()`、`admin.campus` 和深拷贝模式。地面每次连续 pointer stroke 只创建一个历史快照，重复 cell 不重复入栈；地下编辑保持完整 `UndergroundMap` 副本。保存通过 `If-Unmodified-Since: String(baseUpdatedAt)` 发送完整文档，成功后更新基线和时间，409 显示“数据已被其他管理员更新，请重新加载”。

- [ ] **Step 4: Integrate dirty protection and run focused tests**

在 `src/admin/store.ts` 导出 network dirty 依赖所需的状态/钩子，更新 `AdminApp.vue` 后续使用的导航类型。运行 `npx vitest run src/admin/networkStore.test.ts src/admin/store.test.ts`，预期通过。

---

### Task 4: Admin 路网地图与工作区 UI

**Files:**
- Create: `src/admin/RoadNetworkMap.vue`
- Create: `src/admin/RoadNetworkWorkspace.vue`
- Modify: `src/admin/AdminApp.vue`（导航、页面挂载、刷新和离开保护）
- Modify: `src/admin/admin.css` 或对应 admin 样式入口（工作区布局、图例、状态和响应式样式）

**Interfaces:**
- `RoadNetworkMap` props：`tab: 'surface' | 'underground'`、当前草稿和 `saving`。
- `RoadNetworkMap` emits：`paint(row, col, walkable)`、`selectRoad(id)`、`selectConnector(id)`、`moveRoadVertex(id, index, pos)`、`moveConnector(id, pos)`、`finishNewRoad(path)`、`finishNewConnector(pos)`。

- [ ] **Step 1: Add the admin navigation and empty workspace shell**

在 `AdminApp.vue` 的 `View` 导航加入“路网编辑”，注册 hash `#network`，挂载 `RoadNetworkWorkspace`。先渲染标签、保存栏、加载/错误状态和两个空面板，确保已有页面导航与刷新逻辑仍可用。

- [ ] **Step 2: Implement the Leaflet map layer**

复用 `createCampusMap`, `toLatLng`, `fromLatLng`。地面使用一个 canvas Leaflet layer 按当前视口绘制网格，不创建数万独立 marker；pointer down/move/up 通过 `cellAt` 发出 paint 事件。地下使用 polyline、connector marker 和可拖动顶点，新增道路采用地图点击收集顶点，新增连接点采用单击定位。地图销毁时移除所有图层和事件监听。

- [ ] **Step 3: Implement surface controls**

工作区显示画笔/擦除、可走/不可走图例、撤销/重做和“保存地面路网”按钮；拖动绘制期间只更新同一历史操作。保存中禁用工具，错误显示在工作区内并保留草稿。

- [ ] **Step 4: Implement underground list and inspector**

侧栏按道路/连接点列出 ID、楼层和状态；选择后显示表单，编辑字段调用 `updateRoad`/`updateConnector`。道路顶点可拖动并支持新增/删除顶点；连接点可编辑类型、起止楼层、状态、关联 POI 和备注。删除按钮执行 `rejected` 状态并提供恢复操作。新增道路和连接点完成后写入草稿，保存按钮提交完整地图。

- [ ] **Step 5: Wire navigation, loading and before-unload behavior**

在 `onMounted` 或进入 network view 时调用 `loadNetwork()`；页面刷新按钮重新加载前先检查 `networkDirty`；`beforeUnload` 同时拦截地点、显示设置和路网未保存修改。运行 `npm run build`，预期 Vue 类型检查和 Vite 构建通过。

---

### Task 5: 集成验证与浏览器验收

**Files:**
- Modify: `server/network.test.mjs` 或 `src/lib/network.test.ts`（只在验证发现缺口时补测试）
- Create: `docs/superpowers/evidence/2026-10-17-road-network-admin.png`（浏览器验收截图）

**Interfaces:**
- Consumes: Task 1–4 的 API、runtime loader 和 admin workspace。
- Produces: 可复现的完整测试结果和一张显示路网编辑工作区、保存状态的截图。

- [ ] **Step 1: Run the full verification suite**

Run: `npx vitest run` with the repository’s required network permission, then `npm run build`.
Expected: all existing and new tests pass; build exits 0.

- [ ] **Step 2: Exercise the browser flow**

用现有 admin 开发服务器登录，打开 `#network`；在地面标签画一个可走单元并保存；切换地下标签，拖动一条道路顶点并保存；刷新后确认两个修改仍显示。检查错误提示、未保存拦截和 409 文案。

- [ ] **Step 3: Capture evidence and report limitations**

保存工作区截图到指定证据路径，记录 API 保存后的更新时间和测试命令输出。停止在提交/commit 前，向用户请求最终提交许可。

