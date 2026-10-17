# 地下路网系统设计（README）

本文是地下路网数据、后台标注、街景点和雨天地下导航的系统设计说明。

- 适用数据版本：`UndergroundMap.version = 2`
- 数据文件：`public/data/underground.json`
- 后台入口：`/admin/#underground`
- 街景图片目录：`data/streetview/`
- 主要代码：
  - `src/lib/types.ts`：持久化数据结构
  - `src/lib/underground.ts`：数据校验
  - `src/lib/undergroundGraph.ts`：图编辑、街景点、折线插值
  - `src/lib/undergroundRoute.ts`：地下显式图寻路
  - `src/lib/integratedRoute.ts`：地面与地下联合选路
  - `src/admin/UndergroundWorkspace.vue`：后台标注工作台
  - `src/admin/store.ts`：编辑状态、持久化、街景图片上传
  - `server/index.mjs`：地下图 API、街景图片上传与读取

---

## 1. 目标与边界

地下路网用于表达 B1 车库、地下通道及它们与地面的连接关系，主要服务于：

1. 后台人工标注地下道路、出入口和街景点。
2. 雨天导航时比较「地面路线」与「地面 → 地下 → 地面」路线。
3. 为每个街景点绑定一张图片，图片按 GUID 存放在独立目录。
4. 沿已连接的道路折线批量生成街景点。

当前边界：

- 只处理一个地下楼层，`floor = -1`。
- 不保存道路的通行方向、道路等级、限速等属性；每条边都是双向可走。
- 不会根据几何位置自动把相邻或交叉但未显式连接的孤立路网接通。
- 街景点不是路网节点，不参与寻路，只记录道路位置和图片。
- 街景点图片不写入数据库，只写文件系统。

---

## 2. 总体架构

```text
                         ┌─────────────────────────────┐
                         │ public/data/underground.json│
                         │ 首次启动种子数据            │
                         └──────────────┬──────────────┘
                                        │ seed
                                        ▼
┌──────────────┐   GET /api/underground  ┌──────────────────┐
│ 前台地图/导航 │ ◀────────────────────── │ SQLite           │
│ MapView/Route │                         │ underground_maps │
└──────┬───────┘                         └────────▲─────────┘
       │                                          │ PUT /api/underground
       │ findIntegratedRoute                      │
       ▼                                          │
┌──────────────────────┐                  ┌───────┴─────────────────┐
│ 地面 route.ts        │                  │ 后台 UndergroundWorkspace│
│ 地下 undergroundRoute│ ◀── 地下显式边 ── │ admin/store.ts          │
└──────────────────────┘                  └───────┬─────────────────┘
                                                  │ POST 图片
                                                  ▼
                                        ┌──────────────────┐
                                        │ data/streetview/ │
                                        │ <GUID>.jpg|png…  │
                                        └──────────────────┘
```

职责划分：

- **持久化数据**只描述节点、边、连接点和街景点，不描述路线。
- **后台**操作内存中的 `UndergroundGraph`，保存时转回 `UndergroundMap`。
- **前台**只读加载，经过校验后用于显示和导航。
- **图片**通过 GUID 与街景点解耦，图片本体不进入地下 JSON。

---

## 3. 坐标与楼层

- 坐标类型：`LngLat = [lng, lat]`
- 坐标系：BD-09，与校园地图、楼宇数据一致。
- 地下楼层：`floor: -1`
- 校园范围：`bounds: [西南角, 东北角]`，同时用于校验节点、连接点和图纸锚点是否越界。
- 前端地图默认最大缩放 20 级，瓦片原生到 19 级。
- 后台地图通过 `createCampusMap(..., { maxZoom: Infinity })` 取消缩放上限；超过 19 级后由 Leaflet 拉伸 19 级瓦片，因此继续放大只会更模糊。

---

## 4. 数据模型

### 4.1 顶层结构

```json
{
  "version": 2,
  "floor": -1,
  "bounds": [[121.5955, 31.1808], [121.6062, 31.1865]],
  "sources": [],
  "nodes": [],
  "edges": [],
  "connectors": [],
  "points": []
}
```

当前种子文件规模：

- 节点：75
- 双向边：88
- 上下连接点：26
- 参考图纸：6
- 街景点：种子文件为 0，运行时以后台数据库为准

`points` 是可选字段，旧数据没有时可以省略。

### 4.2 参考图纸 `sources`

```ts
interface UndergroundSource {
  id: string
  title: string
  image: string
  floor: number
  anchors: {
    image: [number, number]  // 归一化图片坐标 0..1
    pos: LngLat
  }[]
  alignment?: 'approximate' | 'reviewed'
  note?: string
}
```

用途：

- 记录地下图纸原图及其与真实坐标的对应关系。
- 每张图至少两个锚点；锚点用于图纸校正和人工对照。
- 图纸不是导航数据，只是标注参考。

### 4.3 节点 `nodes`

```ts
interface UndergroundNode {
  id: string
  pos: LngLat
}
```

节点是道路折线的端点或路口。后台节点 ID 必须持久化，因为街景点会引用它。

### 4.4 边 `edges`

```ts
interface UndergroundEdge {
  id: string
  a: string
  b: string
}
```

- 一条边只保存两个不同节点 ID。
- 无向边只存一次，寻路时同时生成两个方向。
- 边不允许自环、重复端点、重复无向边。
- 边不保存长度、方向、道路类型；长度实时按坐标计算。

### 4.5 上下连接点 `connectors`

```ts
interface UndergroundConnector {
  id: string
  floorFrom: number
  floorTo: number
  kind: 'ramp' | 'stairs' | 'elevator' | 'unknown'
  pos: LngLat
  node?: string          // 已绑定的路网节点
  source?: string        // 来源图纸或采集来源
  linkedPoiId?: string   // 可关联的地面点位
  note?: string
}
```

约定：

- 地下图的连接点必须跨越地面与 `floor`，即 `floorFrom`/`floorTo` 一个为 `0`，另一个为 `-1`。
- `kind` 决定后台图标和前台文案：
  - `ramp`：车辆出入口，红色圆环
  - `stairs`：楼梯口，橙色圆点
  - `elevator`：电梯口，蓝色圆点
  - `unknown`：其他连接点，灰色
- `node` 存在时表示已绑定到路网；绑定后连接点坐标跟随节点。
- 未绑定的连接点仍可保留在图上，但后台会把它列入「未绑定」检查；导航时可按投影临时接入。

### 4.6 街景点 `points`

```ts
interface UndergroundStreetViewPoint {
  id: string
  endpointId1: string
  endpointWeight1: number
  endpointId2: string
  endpointWeight2: number
  imageId: string   // GUID
}
```

街景点不是节点，而是**一条边上的插值位置**：

```text
position = node(endpointId1).pos × endpointWeight1
         + node(endpointId2).pos × endpointWeight2
```

约束：

- `endpointId1 !== endpointId2`
- `0 <= weight <= 1`
- `endpointWeight1 + endpointWeight2 = 1`
- `imageId` 必须是标准 GUID
- 权重保留 6 位小数

这样节点移动后，街景点会自动跟着边移动，不需要重算坐标。

---

## 5. 数据校验与不变量

前端 `validateUndergroundMap()` 和服务端 `cleanUnderground()` 都会校验。主要不变量：

1. `version === 2`，不允许旧的 `roads` 字段。
2. 所有节点、边、连接点、街景点的 ID 全局不重复。
3. 节点必须在 `bounds` 内。
4. 边的 `a/b` 必须存在、不能相同；无向边不能重复。
5. 边只允许 `id/a/b` 字段，旧字段会被拒绝。
6. 连接点：
   - 绑定节点必须存在
   - `kind` 必须合法
   - 坐标必须在校园范围内
   - `floorFrom !== floorTo`
7. 街景点：
   - 两端节点必须存在且不同
   - 权重必须在 0..1，且和为 1
   - 图片 ID 不能为空，且必须是 GUID
8. 图纸来源：
   - 必须有 `id` 和 `image`
   - 至少两个锚点
   - 锚点图片坐标必须在 0..1
   - 锚点坐标必须在校园范围内

校验失败时：

- 前台：`state.undergroundErrors` 非空，`state.underground = null`，地下图层不参与导航。
- 后台：服务端返回 400，后台显示错误并保留旧数据。

---

## 6. 图编辑规则

后台不直接编辑原始 JSON，而是操作 `UndergroundGraph`：

```ts
interface UndergroundGraph {
  nodes: UgNode[]
  edges: UgEdge[]
  entrances: UgEntrance[]
  points: UgStreetViewPoint[]
}
```

`loadUnderground()` 将 `UndergroundMap` 转为图；`saveUnderground()` 再转回 `UndergroundMap`。

### 6.1 节点与边

| 操作 | 行为 |
|---|---|
| 添加节点 | 生成 `n-...` ID，坐标保留 6 位小数 |
| 连接两个节点 | 若已相连、相同节点或节点不存在则不重复添加 |
| 移动节点 | 更新坐标，并同步所有绑定在该节点上的出入口 |
| 在边上插点 | `splitEdge()` 把一条边拆成两条，新节点位于投影点 |
| 合并节点 | `mergeNodes()` 把 `from` 的路段改接到 `into`，删除自环和重复边，更新街景点引用 |
| 删除中间节点 | 若恰好两条边且邻居不同，删除后自动把两侧邻居连起来 |
| 删除路口节点 | 连同相连的所有边一起删除 |
| 删除边 | 删除该边上的街景点；端点变成孤立点时一并删除 |

### 6.2 出入口

- 新建出入口可独立放置，或点在节点/路段上时立即绑定。
- 已绑定的出入口拖动时，默认连同节点和道路一起移动。
- 按住 `⌥` 拖动可以拆开绑定，只移动出入口本身。
- 未绑定出入口拖到节点或路段上会自动绑定。
- 「一键绑定」只处理指定半径内的出入口，避免把故意放在路外的点强行接上。

### 6.3 吸附与路口

后台拖动时按屏幕像素吸附：

- 默认最近目标半径：14 px
- 节点优先，其次是未绑定出入口，最后是路段投影点
- 道路模式从已有点/路段/出入口开始时，会自动接出岔路
- 路段上落点会先插节点再连接，避免出现几何相交但拓扑不通的情况

### 6.4 前端手绘草稿

前台允许用户在本机手绘地下道路草稿：

- 存储键：`campus.underground.sketch`
- 启动时通过 `mergeUndergroundSketch()` 合并进加载的地下图
- 合并规则：
  - 端点距离在 4 米内合并为同一节点
  - 悬空端点若靠近其他路段，会投影插点并形成路口
  - 无向重复边去重
  - 已经被分割的同一直线不会重复生成捷径
- 后台保存成功后，消费已经保存的草稿线段，避免重复导入

### 6.5 图健康检查

`graphIssues()` 产生三类问题：

1. **孤岛路段**：不在最大连通分量内的节点组
2. **疑似断开的端点**：一度节点离其他路段/节点很近但没有接上（默认 8 米）
3. **未绑定出入口**：`connector.node` 不存在或对应节点已删除

后台右侧的「检查」区域可以逐项定位。

---

## 7. 街景点与图片

### 7.1 创建街景点

1. 选择「街景点（P）」
2. 点击紫色道路线段
3. 允许轻微点偏，后台会投影到最近路段
4. 若点击位置离路段过远，拒绝创建并提示
5. 自动生成：
   - 街景点 ID：`ug-point-...`
   - 图片 ID：标准 GUID
   - 两个端点 ID 和插值权重

### 7.2 图片文件

图片目录：

```text
data/streetview/
```

文件名：

```text
<GUID>.jpg
<GUID>.jpeg
<GUID>.png
<GUID>.webp
<GUID>.avif
```

服务端读取 `GET /streetview/:id` 时，按顺序查找常见后缀。

上传接口：

```text
POST /api/underground/streetview/:id
Authorization: Bearer <admin-token>
Content-Type: image/jpeg | image/png | image/webp
Body: 原始二进制
```

服务端会：

- 要求管理员登录
- 校验 ID 是 GUID
- 限制单张 20 MB
- 校验真实文件头，不能只改后缀
- 自动创建目录
- 删除同 GUID 的其他后缀旧文件
- 写入 `<GUID>.<ext>`
- 返回 `{ id, ext, bytes, url }`

图片读取使用 `Cache-Control: no-cache`，替换后刷新即可看到新图。

单点详情支持：

- 上传/替换图片
- 图片预览
- 打开街景图
- 查看点位 ID、GUID、端点和权重

### 7.3 沿折线批量插值

后台「插值（I）」工具：

1. 按道路顺序点击多个路网节点
2. 相邻节点之间必须有边
3. 输入数量 `N`
4. 选择恰好 `N` 张图片
5. 生成时沿整条折线按总里程均匀插入

计算公式：

```text
L = 折线总长度
target(k) = L × k / (N + 1)    k = 1..N
```

按累计距离找到所在边，再计算该边上的比例 `t`：

```text
t = (target - 已累计长度) / 当前边长
weight1 = 1 - t
weight2 = t
```

新点仍然只保存边端点和权重，不保存绝对坐标。

图片分配流程：

1. 按文件名自然排序，例如 `1.jpg < 2.jpg < 10.jpg`
2. 新街景点按折线起点到终点排序
3. 图片与点一一对应
4. 先并线上传全部图片，全部成功后才把街景点提交到路网
5. 如果上传失败，不提交新街景点；已上传成功的图片可能成为无引用文件

> 已知限制：当前文件名排序依赖文件命名规范。命名不规范或存在同名文件时，最终顺序可能不符合预期；本轮暂不调整。

---

## 8. 后台工作台

### 8.1 工具栏

| 工具 | 快捷键 | 作用 |
|---|---|---|
| 选择 | `V` | 选择对象、拖动节点/出入口 |
| 道路 | `R` | 逐点画路，双击/Enter/右键结束 |
| 出入口 | `E` | 放置并绑定上下连接点 |
| 街景点 | `P` | 在路段上创建街景点 |
| 插值 | `I` | 按顺序选节点，沿折线批量生成街景点 |
| 删除 | `X` | 点击删除节点、边、出入口或街景点 |

通用操作：

- `Esc`：结束画路 / 回到选择 / 取消选择
- `Delete` / `Backspace`：删除选中对象
- `Ctrl/Cmd+Z`：撤销
- `Shift+Ctrl/Cmd+Z` 或 `Ctrl+Y`：重做
- 右键对象：直接删除

### 8.2 编辑历史

- 所有图修改都经过 `changeUnderground()`
- 每次修改前保存快照，最多保留 200 步
- 只有 JSON 真正变化才记录历史
- 撤销/重做不会写入服务端，必须点击「保存」
- 顶部显示「有未保存的修改」/「已保存」

### 8.3 保存流程

1. `graphToMap()` 把图转为持久化结构
2. `PUT /api/underground`
3. 服务端执行 `cleanUnderground()` 校验并清洗
4. 写入 `underground_maps` 表
5. 后台用服务端返回值重置本地图
6. 消费已保存的前台手绘草稿

### 8.4 统计与检查

- 总道路长度（公里）
- 节点数
- 出入口数
- 街景点数
- 孤岛路段检查
- 疑似断开端点检查
- 未绑定出入口检查

---

## 9. 前台加载与显示

### 9.1 加载顺序

```text
GET /api/underground
  └─ 失败则 GET /data/underground.json
       └─ 校验 validateUndergroundMap()
            └─ 合并本机手绘草稿 mergeUndergroundSketch()
```

只有校验通过的数据才会进入 `state.underground`，用于：

- 紫色道路图层
- 出入口图标
- 雨天导航
- 地下路线详情

### 9.2 显示约定

- 道路：紫色折线
- 车辆出入口：红色圆环
- 楼梯口：橙色圆点
- 电梯口：蓝色圆点
- 其他连接点：灰色圆点
- 街景点：紫色圆点标记

---

## 10. 雨天地下导航

### 10.1 联合选路

`findIntegratedRoute()`：

1. 先计算纯地面路线 `findRoute()`。
2. 非雨天直接返回地面路线。
3. 雨天时枚举所有满足 `0 ↔ floor` 的连接点对。
4. 对每个入口：
   - 地面路线：起点 → 入口
   - 地下路线：入口 → 出口
   - 地面路线：出口 → 终点
5. 计算候选总代价：
   - 露天段按天气代价计算
   - 地下段按覆盖段计算
   - 每次进入/离开地下增加 20 米比较代价，避免为很短露天段绕路
6. 选择和地面直达相比代价更低的方案。

### 10.2 地下显式图寻路

`findUndergroundRoute()`：

- 只沿显式双向边行走。
- 起点和终点必须是能连接地面与地下楼层的连接点。
- 已绑定连接点直接接到绑定节点。
- 未绑定连接点在 45 米内投影到最近路段；投影点只在本次寻路中临时存在，不修改持久化数据。
- 同一条边上多个投影点会按参数顺序拆成子段。
- 使用 Dijkstra 计算最短距离。
- 不会因为两条路几何相交就自动连通，也不会自动接通相邻孤岛。

### 10.3 结果

地下路线返回：

```ts
{
  floor: -1,
  connectorIds: [fromId, toId],
  path: LngLat[],
  meters: number
}
```

前台路线结果中会体现：

- `layer: 'underground'` 的路段
- 进入/离开地下的 `transitions`
- `undergroundMeters`
- 总步行时间（按 75 米/分钟估算）

---

## 11. API 与持久化

### 11.1 地下图

```text
GET /api/underground
```

- 无需登录
- 返回 `UndergroundMap`
- 没有数据库记录时返回种子数据

```text
PUT /api/underground
Authorization: Bearer <admin-token>
Content-Type: application/json
Body: UndergroundMap
```

- 需要管理员口令
- 服务端执行完整清洗和校验
- 成功返回清洗后的地图
- 失败返回 400 和中文错误信息，不写入数据库

存储表：

```sql
CREATE TABLE underground_maps (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

默认记录 ID：`default`。

### 11.2 街景图片

```text
GET /streetview/:guid
```

- 读取 `data/streetview/<guid>.<ext>`
- 支持 jpg/jpeg/png/webp/avif
- 缓存策略：`no-cache`

```text
POST /api/underground/streetview/:guid
```

- 管理员鉴权
- 原始二进制请求体
- 单张 20 MB
- 校验 MIME + 文件头
- 写入文件系统

开发环境通过 Vite 代理把 `/streetview` 转发到后端 `8790` 端口。

---

## 12. 测试

相关测试：

| 文件 | 覆盖 |
|---|---|
| `src/lib/underground.test.ts` | 数据校验、GUID、端点、权重、越界 |
| `src/lib/undergroundGraph.test.ts` | 节点/边编辑、拆分、删除、合并、街景点、折线插值 |
| `src/lib/undergroundRoute.test.ts` | 双向可达、显式连接、绑定优先、楼层校验 |
| `src/lib/integratedRoute.test.ts` | 雨天地面+地下联合选路、短露天段不绕行 |
| `src/lib/undergroundSketch.test.ts` | 本机草稿合并、图纸和街景点保留 |
| `src/admin/store.test.ts` | 后台编辑、撤销保存、街景点上传顺序 |
| `server/index.test.mjs` | 地下图 API、服务端校验、街景图片上传读取 |

运行：

```bash
npm test
```

或只跑地下相关：

```bash
npx vitest run src/lib/underground*.test.ts src/lib/integratedRoute.test.ts src/admin/store.test.ts
```

---

## 13. 已知限制与后续方向

1. **只有一个地下楼层**：当前固定 `floor = -1`，不支持多层地下图。
2. **没有道路属性**：所有边双向、等权，不支持单行、限高、限重、禁行时段。
3. **不自动补路**：几何相交或相邻但未显式连接的边不会自动连通。
4. **未绑定连接点投影是临时的**：只在寻路时生效，不会回写数据。
5. **街景点图片不在数据库中**：图片与地下 JSON 分离，备份时需要同时备份 `data/streetview/`。
6. **上传失败可能留下孤立图片**：批量插值上传部分成功后失败，新点不会提交，但已上传图片不会被自动清理。
7. **文件名顺序依赖命名规范**：自然排序不能解决所有命名歧义；当前不调整。
8. **后台无限缩放会变糊**：瓦片原生只到 19 级，超过后是拉伸显示。
9. **街景点不参与导航**：街景点只是图片锚点，不是路线节点。
10. **折线插值要求节点按道路顺序选择**：不会自动寻找两节点间最短路径。

---

## 14. 操作速查

### 画一条新路

1. `R`
2. 点击起点和折点
3. 双击 / `Enter` / 右键结束
4. 保存

### 把路接到已有道路

1. `R`
2. 从已有节点、已有路段或出入口开始
3. 继续画到目标位置
4. 结束并保存

### 绑定出入口

1. `E`
2. 点在道路上或节点上
3. 或拖动已有出入口到道路上
4. 保存

### 添加街景点

1. `P`
2. 点击路段
3. 选中街景点
4. 上传图片
5. 保存

### 批量插值

1. `I`
2. 按道路顺序点击多个节点
3. 输入数量
4. 选择等量图片
5. 生成并上传
6. 保存

### 检查与保存

1. 查看右侧「检查」区域
2. 处理孤岛、断开端点、未绑定出入口
3. `Ctrl/Cmd+Z` 可撤销
4. 点击「保存」
