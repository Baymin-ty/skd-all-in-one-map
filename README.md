# 上科大一图通

校园地图网页（第一版只有地图）：旧版 2.5D 手绘底图 + 楼宇 + 点位动态管理 + 步行路网导航，含两段**风雨长廊**和「雨天模式」导航。

## 功能

- **地图**：map.shanghaitech.edu.cn 的手绘瓦片（z14–19，已补画 11–13 号楼），百度墨卡托自定义 CRS 直接显示
- **楼宇**：61 栋（含 5 个校门、2 段风雨长廊），点击看名称、别名、单位、开放时间、出入口；缩小时只显示校门、食堂、长廊的名字
- **风雨长廊**：地图上常亮（青色），点击有介绍
- **点位**：33 个校内点位（生活服务、餐饮、运动、停车），存在后端 SQLite；输入管理口令后可以
  新增（点地图放置）、编辑、拖动改位置、删除
- **步行导航**：在数据包的步行栅格上跑 Dijkstra。起点 / 终点可以是楼、点位或地图上任意一点；
  有出入口的楼导到入口。打开「雨天模式」后露天路段按 2 倍代价算，路线会多走长廊下面（青色线段），并显示有多少米在长廊下
- **路网图层**：红 = 手绘图上的路，蓝 = OpenStreetMap 补的路，青 = 风雨长廊下
- **搜索**：楼名、简称、别名（一食堂、SIST…）、点位名

后端挂了也能看地图和导航，点位退回打包的静态数据（只读）。

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

测试：`npm test`（导航：路段首尾相接、雨天模式多走长廊且绕路不超过 50%、导到楼的入口）。

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
src/lib/geo.ts             百度墨卡托投影、Leaflet CRS、瓦片
src/lib/route.ts           步行栅格 Dijkstra + 雨天模式（不依赖 Vue / Leaflet，有单测）
src/lib/store.ts           全局状态、数据加载、搜索、导航、点位接口
src/components/            MapView 地图 · PlaceCard 详情 · RouteCard 导航 · PoiForm 点位表单 · SearchBox 搜索
```

## 第三方与出处

- 底图瓦片、楼宇轮廓、点位：上海科技大学校园地图 map.shanghaitech.edu.cn
- 部分道路：© OpenStreetMap contributors（ODbL）
- 百度墨卡托系数：公开常数
- [Vue 3](https://vuejs.org)（MIT）、[Leaflet 1.9](https://leafletjs.com)（BSD-2）、[Express 5](https://expressjs.com)（MIT）、[Vite](https://vite.dev)（MIT）、[Vitest](https://vitest.dev)（MIT）
- 实现参考了自己的原型项目 skdmap（地图 CRS、步行栅格寻路的思路）
