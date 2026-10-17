# 距离导航与遮雨数据清理

## 当前行为

- 地面仍使用统一栅格八邻接 Dijkstra；仅按几何距离扩展，生成路径仍经过原有端点吸附及可走区域内拉直。
- `initRouting(campus)` 不接收额外范围；`findRoute(from, to)` 不接收天气参数。
- `findIntegratedRoute(from, to, map, { connectorSnapMeters? })` 沿用原连接点对枚举，按未取整的实际路径长度之和比较地面直达和一次地下通行；不再有天气权重、地下优先、短露天阈值、进出地下附加代价。同距保留地面。
- 不引入新架构，不保证多次进出地下的全局跨层最短。栅格离散化、吸附与路径拉直仍影响结果。
- 原地面导航、地下手绘/后台维护入口语义不变。保留分层路线与进出提示。
- 两段长廊几何及介绍保留，为普通服务区域，不再有遮雨专属分类、图标或优先样式。既有地面路网连线显示保持不变。

## 可复用迁移

先更新应用代码；部署期间避免旧服务再次写入旧字段（应停止旧版本写入或安排部署窗口）。迁移本身支持数据库运行于 WAL 模式，使用 SQLite online backup 和事务，不复制主文件。

```sh
# 默认只预览，必须显式指定目标
node scripts/remove-rain-data.mjs --db server/static.db
# 备份路径必须不存在；备份为完整数据库，不是 JSON 行备份
node scripts/remove-rain-data.mjs --db server/static.db --write --backup server/backups/static-before-remove-rain-DEPLOYMENT.db
node scripts/remove-rain-data.mjs --db server/static.db
# 其他部署的静态快照如有旧字段
node scripts/remove-rain-data.mjs --json public/data/places.json --write --backup server/backups/places-before-remove-rain-DEPLOYMENT.json
```

迁移幂等；无旧字段不改记录；数据库写入前校验源库、online backup、校验完整备份，事务内只更新静态 JSON 字段，不改 `updated_at`。提交前后校验完整性。只允许数据库文件名为 `static.db`，拒绝修改备份目录目标；不修改旧 `map.db` 或 `dynamic.db`。事务后不强制截断 WAL，避免影响运行中的连接。保留历史备份原样用于恢复，不将旧格式支持加回运行时代码。

本机备份：
- `server/backups/static-before-remove-rain-20261017.db`
- `server/backups/places-before-remove-rain-20261017.json`

本机仅 9 条建筑记录删除 `walkway`；备份与现库逐表比较（仅规范化这些记录）完全一致，地下整图原始 JSON、所有时间和其余表不变；`integrity_check = ok`。静态快照只删除两段长廊的属性，不重生成地图数据。

## 验证

- `npm test`：363 项，362 通过、1 既存失败。`server/index.test.mjs:203` 期望建筑原始坐标精度，但原有 `server/index.mjs` 的 `position()` 使用 `toFixed(6)`，得到 6 位坐标。本次未改该逻辑，不修改地图精度或掩盖测试。
- `npm run build`：通过。
- `git diff --check`：通过。
- 新增迁移测试涵盖 WAL 完整备份、幂等、拓扑与时间保留；距离测试涵盖短地下捷径（无换层惩罚）、较长地下不选、不可达回退、结果字段及长廊几何。

## 引用审计

系统检查 `rain/covered/shelter/walkway` 及中文遮雨/避雨/雨天。运行时不再有导航天气字段或专属长廊属性。保留以下无关引用：
- `ui.covered()`：界面遮住地图的像素边距。
- `undergroundGraph.coveredStraightPath()`：检查直线是否已由显式边覆盖，避免重复导入，不是顶棚判断。
- `prepare-data.mjs` 的 `poi-walkway`：删除重复近似点位的历史 ID，不是遮雨范围或运行时兼容接口。
- 长廊实体名称/介绍、活动标题中的 Brain/training、拍摄天气与非导航天气展示。
- 历史数据库、备份和图片不改。

无 commit/push。
