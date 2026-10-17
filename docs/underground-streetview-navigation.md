# 地下街景导航

地下区域没有 GPS。用户沿地面导航到地下入口后，改用“按路线顺序翻看街景照片”的方式继续前进，出地下后恢复地面导航。

## 用户流程

1. 地面导航，路线上的地下入口显示橙色 `↓` 标记（出口 `↑`，内部色 `#e89a31`）。
2. 点击入口 → 弹窗「地下区域没有 GPS 信号，是否启动地下街景导航？」。
3. 进入街景模式：
   - 主区域为大幅街景图；右上角为缩小地图，只保留地下路线与街景点（黄色方块），当前点高亮（黄色圆点）并自动居中，缩放 ≥ 19。
   - 标题栏：左侧「✕ 退出」，显示「第 x / N 个街景点」；底部进度条。
   - 画面下方为 Google 街景风格的地面透视箭头：前进（远离观察者）/ 后退（指向观察者，第 1 张隐藏）。键盘 ↑ / ↓，Esc 退出。
4. 最后一张点前进（标签「到达出口，返回地图」）→ 自动退出街景，恢复完整地图并 fit 整条路线，继续地面导航。
5. GPS 仍可显示蓝点，但不会改变导航起点（起点在选择“我的位置”时已快照，见 `src/lib/locate.ts`）。

## 关键实现

| 模块 | 职责 |
|---|---|
| `src/lib/store.ts` | `state.route.streetView`（`active/open/pending/index/points`）；`requestUndergroundStreetView` / `startStreetViewNavigation` / `nextStreetViewPoint` / `previousStreetViewPoint` / `stopStreetViewNavigation` |
| `src/lib/undergroundRoute.ts` | `findUndergroundRoute` 额外返回 `edges`：按行进顺序的有向边 `{a, b, from, to}`，首尾为吸附产生的部分边 |
| `src/lib/route.ts` / `integratedRoute.ts` | `RouteSegment.edges` 透传到地下段 |
| `src/lib/streetViewOrder.ts` | 街景点排序（见下），有单元测试 `streetViewOrder.test.ts` |
| `src/lib/streetViewTransition.ts` | WebGL 转场渲染器与图片缓存 |
| `src/components/StreetViewImage.vue` | 预加载、连点处理、降级 |
| `src/components/UndergroundStreetView.vue` | 确认弹窗、街景布局、地面箭头 |
| `src/components/MapView.vue` | 小地图模式（`.streetview-map`）、隐藏无关图层、`fitStreetView` / `focusStreetView`、退出后恢复 |

### 街景点排序

每个街景点数据已有：所在边的两个端点 + 插值权重 `w`。排序不依赖数组顺序或坐标投影：

```
key = 边在路线序列中的下标 + (同向 ? w : 1 - w)   // 首尾部分边按已走区间归一化
```

- 只保留落在路线已走边（及首尾边的已走区间）上的点，平行通道、入口外/出口外的点被排除。
- 路线本身是有向的，所以反向导航时顺序自然反转。
- 若地下段缺少 `edges`，则没有街景点（无坐标投影兜底）。

### 小地图缩放时机

`.map` 在全屏与小窗之间有 0.25s CSS 过渡。进入/退出时都等 `transitionend`（350ms 兜底）后再 `invalidateSize()`，然后 `setView`（进入）或带面板 padding 的 `fit` 整条路线（退出，maxZoom 19），避免按错误尺寸计算视野。

### 转场特效

移植自参考页的 WebGL 片元着色器（“向前走进去”）：

- 当前图向消失点 `(0.5, 0.56)` 放大 1× → 6×（`pow(e, 1.55)`），下一张 0.22× → 1×（`pow(e, 0.72)`），`e = easeInOutCubic`。
- 14 次采样径向模糊 + 轻微色散 + 中段提亮 `sin(πt)` + 暗角；`smoothstep(0.30, 0.78, e)` 交叉淡化。
- 空闲时 8s 周期呼吸缩放（2.25%）与鼠标视差（1.2%）。
- 后退时反向播放；`prefers-reduced-motion` 下为 400ms 淡入淡出；无 WebGL 退回 `<img>`。

可调参数（`src/lib/streetViewTransition.ts`）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `TRANSITION_MS` | 1700 | 转场时长 |
| `REDUCED_MOTION_MS` | 400 | 减少动态时的淡化时长 |
| `VANISH_POINT` | [0.5, 0.56] | 消失点 |
| 着色器 `6.0` / `0.22` | — | 旧图终点 / 新图起点缩放 |
| 着色器 `N = 14` | — | 模糊采样数，低端机可降到 8 |
| `0.10` / `0.0035` / `0.18` / `0.35` | — | 模糊 / 色散 / 提亮 / 暗角强度 |

## 临时内容（演示用，正式上线前移除）

搜索 `TEMP DEMO(indoor-503)` 及下列符号即可清理：

1. **固定入口/出口**：`fixedUndergroundConnectorsForRoute`（`store.ts`）——起点为教学中心、终点为「物质学院1号楼 503」（建筑 `ded84a6d`，名称以 `503` 结尾）时，强制入口 `ug-entrance-mvc8btwo15`、出口 `ug-entrance-mvc8itpi2p`。
2. **街景调试按钮**：`startStreetViewDebugRoute` + `MapView.vue` 中的「街景调试」按钮，一键开启避雨并设置 教学中心 → 物质1 503。
3. **室内演出** `src/lib/demoIndoor503.ts` + `public/demo/indoor-503/`：仅上述路线，在地下最后一个街景点之后继续：
   - B1 段：右上角小窗换成静态 B1 平面图（`/data/spst-building-1-b1-plan-context.jpg`），顺序播放 7 张照片 `b1-1…7.jpg`；
   - 5F 段：换成 5F 平面图（503 红框高亮），播放 4 张 `5f-1…4.jpg`；
   - 最后一张前进 → 「已到达目的地：物质学院1号楼 503」→ 退出街景并 `closeRoute()` 回到主界面。
   - 平面图小窗通过 `<Teleport to="body">` 渲染（z-index 3002），否则会被小地图（3001）盖住——`.street-view` 自身是 z-index 3000 的层叠上下文。
   - 室内点没有真实坐标，复用地下最后一点的位置。

## 已知限制

- 箭头的透视角度/位置按计算设定；宽图 `object-fit: contain` 时箭头按容器居中，可能落在黑边上。
- 入口点击不校验用户是否真的在入口附近。
- 低端 GPU 在高 DPR 下转场可能掉帧（每像素 42 次采样）。
