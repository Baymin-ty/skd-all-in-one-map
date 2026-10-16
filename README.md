# 上科大一图通

校园地图网页（第一版只有地图）：旧版 2.5D 手绘底图 + 楼宇 + 点位动态管理 + 步行路网导航，含两段**风雨长廊**和「雨天模式」导航。

## 功能

- **地图**：map.shanghaitech.edu.cn 的手绘瓦片（z14–19，已补画 11–13 号楼），百度墨卡托自定义 CRS 直接显示。
  拖动停在手绘画面的八边形边缘（避开侧栏 / 底部面板后计算），最多缩小到校园差不多铺满可见区域，最大 20 级
- **界面**（沿用 skdmap）：桌面左侧固定侧栏；手机顶部搜索 + 分类条，底部面板可拖动（收起 / 半屏 / 展开）。
  右侧按钮：隐藏地点名称、步行路网、回到全校、缩放
- **楼群**：物质学院 1–8、信息学院 1–3、学生公寓 1–13、教授公寓 1–6 号楼平时各合成一个标签（带栋数），
  点开（或点其中任意一栋）才显示每一栋的名字并用虚线圈出；放大到 19 级自动全部展开
- **标签避让**：优先级高的先占位置（选中 > 点开的楼群 > 分类条选中的类 > 风雨长廊 > 校门 > 食堂 > 楼群 > 其他楼 > 点位），
  被挡住的楼名藏起来、点位先只留图标；楼群标签挡住时会挪到组里最近的一栋上
- **楼宇**：61 栋（含 5 个校门、2 段风雨长廊），点击看分类、出入口、单位、别名、开放时间
- **风雨长廊**：地图上常亮（青色），点击有介绍；分类条里有「风雨长廊」
- **分类条**：餐饮 / 教学科研 / 住宿 / 风雨长廊 / 运动 / 服务 / 校门 / 停车，地图高亮并缩放到这一类
- **步行导航**：在数据包的步行栅格上跑 Dijkstra。起点 / 终点可以是楼、点位、地图上任意一点，选端点时搜索结果也直接当端点；
  有出入口的楼导到入口。「雨天模式」下露天路段按 2 倍代价算，路线会多走长廊下面（青色线段），并显示有多少米在长廊下
- **搜索**：楼群、楼名、简称、别名（一食堂、SIST…）、点位名

后端挂了也能看地图和导航，点位退回打包的静态数据（只读）。

## 管理后台

地址后面加 **`#admin`**（开发时 http://localhost:5180/#admin），首页侧栏最下面也有「管理后台」入口。
输入管理口令后：点位列表（按分类、可筛选）、添加点位（点地图放置）、编辑、删除，地图上的点位可以直接拖动改位置。
普通页面里点位不能拖，也没有编辑按钮。

## 运行

需要 Node ≥ 22.13（后端用内置 `node:sqlite`）。

```bash
npm install
```

开发（两个终端）：

```bash
npm run server
```

```bash
npm run dev
```

打开 http://localhost:5180 。后端在 8790 端口（避开 skdmap 的 8787 / 5173）。
生产：`npm start`（构建后由后端在 8790 端口同时提供网页和接口）。

**管理口令**：第一次启动后端会随机生成，写在 `server/.admin-password`（只有本机可读，已 gitignore）；
也可以启动前设 `ADMIN_PASSWORD=…`。点位数据库是 `server/map.db`，删掉它下次启动会用数据包里的点位重新初始化。

测试：`npm test`（导航：路段首尾相接、雨天模式多走长廊且绕路不超过 50%、导到楼的入口；楼群：分组、排序、长廊和校门不进组）。

## 数据

全部来自赛前数据包 `上科大智慧地图_赛前准备包/datapack`（坐标 BD-09，对齐手绘底图，见其中 `reference/projection.md`）。
`npm run data` 重新生成 `public/data/` 和 `public/tiles/`（默认读 `../上科大智慧地图_赛前准备包/datapack`，也可以把路径作为参数传进去），只做三件事：

1. 两段风雨长廊（后台人工描的轮廓）加上 `walkway: true`，并把原来那个近似位置的「风雨长廊」点位删掉、介绍挪到轮廓上
2. 只保留校园边界内的点位（校外公交站、地铁口、周边商场不要）
3. 复制瓦片

点位初始化之后以 `server/map.db` 为准，重新跑 `npm run data` 不会覆盖已有的点位修改。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pois` | 全部点位 |
| POST | `/api/auth` | 校验口令 |
| POST | `/api/pois` | 新增（`name.zh`、`cat`、`pos` 必填） |
| PUT | `/api/pois/:id` | 只带要改的字段，合并到原点位 |
| DELETE | `/api/pois/:id` | 删除 |

写接口都要 `Authorization: Bearer <管理口令>`。

## 目录

```
scripts/prepare-data.mjs   从数据包生成 public/data、public/tiles
server/index.mjs           后端：点位增删改（Express + node:sqlite），生产环境提供 dist/
src/lib/geo.ts             百度墨卡托投影、Leaflet CRS、瓦片、拖动 / 缩放范围（clampToOutline、limitPan、fillZoom）
src/lib/route.ts           步行栅格 Dijkstra + 雨天模式（不依赖 Vue / Leaflet，有单测）
src/lib/groups.ts          同质化楼群（有单测）
src/lib/store.ts           全局状态、数据加载、搜索、分类、导航、点位接口
src/lib/ui.ts              桌面 / 手机布局、底部面板档位、地图被挡住的边距
src/components/            MapView 地图 · SearchBar 搜索和分类条 · BottomSheet 底部面板 · SidePanel 面板内容
                           HomePanel 首页 · GroupCard 楼群 · CategoryList 分类 · PlaceCard 详情 · RouteCard 导航
                           AdminPanel 管理后台 · PoiForm 点位表单
```

## 第三方与出处

- 底图瓦片、楼宇轮廓、点位：上海科技大学校园地图 map.shanghaitech.edu.cn
- 部分道路：© OpenStreetMap contributors（ODbL）
- 百度墨卡托系数：公开常数
- [Vue 3](https://vuejs.org)（MIT）、[Leaflet 1.9](https://leafletjs.com)（BSD-2）、[Express 5](https://expressjs.com)（MIT）、[Vite](https://vite.dev)（MIT）、[Vitest](https://vitest.dev)（MIT）
- 实现参考了自己的原型项目 skdmap（地图 CRS、步行栅格寻路、拖动范围限制、界面样式和图标）
