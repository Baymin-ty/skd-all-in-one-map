你在 `/Users/ty/Desktop/上科大一图通`（上科大一图通，校园地图网页）里工作。请按 `docs/PLAN.md` 实现还没做的五项：③ 课表截图 AI 解析、④ 排队热力、P3 活动自动更新、P2 后台补齐、P1 中英双语。①②⑤⑥⑦⑧⑨ 已经完成，不要重做。

## 先读这些

1. `docs/PLAN.md`：每项的场景、接口、文件、测试和验收标准都在里面，以它为准。
2. `README.md`：现有功能、运行方式、接口和数据说明。
3. 和本项相关的现有代码，动手前先读懂再改。关键位置：
   - 前端状态与搜索、导航：`src/lib/store.ts`；时区和时间：`src/lib/campusTime.ts`
   - 我的今天：`src/lib/today.ts`（存储、`importItems`）、`src/lib/planner.ts`（吃饭和活动建议）、`src/lib/crowd.ts`（排队估算，④ 要替换它的数据来源）、`src/components/TodayPanel.vue`
   - 食堂：`src/components/CanteenDetail.vue`、`src/lib/canteenMenu.ts`；活动：`src/lib/discoveryData.ts`、`EventsPanel.vue`
   - 后端：`server/index.mjs`（楼宇、点位、管理口令）、`server/community.mjs`（匿名会话、交流区、DeepSeek 总结，活动和菜单目录存在 `discovery_catalog` 表）
   - 后台：`admin/index.html`、`src/admin/`（`AdminApp.vue`、`store.ts`、`AssetEditor.vue`）
   - 赛前数据包：`../上科大智慧地图_赛前准备包/datapack`（`README.md`、`reference/`）

## 顺序

按 ③ → ④ → P3 → P2 → P1 做，一项做完、验证通过、向我汇报之后再开始下一项。P2 内部按 PLAN 里写的顺序：账号权限 → 操作日志 → 活动修正 → 食堂与菜品。P1 改动几乎所有组件，放最后。

## 每项的要点（细节见 PLAN）

**③ 课表截图 AI 解析**
- 后端 `server/schedule.mjs`：`POST /api/schedule/parse`，请求 `{ image: dataURL }`（≤ 4 MB），响应 `{ classes: [{ title, weekday, start, end, room, weeks?, teacher? }], warnings }`。
- 现在用的 DeepSeek 模型不接受图片。用 OpenAI 兼容的 chat completions 接口调用视觉模型，配置全部来自环境变量：`SCHEDULE_VISION_BASE_URL`、`SCHEDULE_VISION_API_KEY`、`SCHEDULE_VISION_MODEL`，写进 `.env.example`。没配置时返回 503 和可读的中文提示，前端退回手动添加。用哪家模型先问我。
- 图片只在内存里处理，不落库、不写日志、不回传。按会话或 IP 限速，30 秒超时，模型返回的 JSON 要校验。
- 学校的上课节次时间表还没有。不要编造节次时间：把「节次 → 时间」做成一个配置（默认空），截图里只有节次没有时间时，在预览里让用户补时间。
- 前端 `ScheduleImport.vue`：在「我的今天」里加入口，选图 → 用现有的 `preparePhoto` 压缩 → 上传 → 表格预览，每一行可改可删 → 确认后调用 `importItems`（来源 `ai`，课程每周重复）。教室号用现有的教室搜索（`src/lib/roomSearch.ts` 的 `findRooms`）解析成楼。
- 测试：`server/schedule.test.mjs` 用假的 fetch 测成功、超时、坏 JSON、超大图片、限速。

**④ 排队热力**
- 表 `crowd_reports`；`POST /api/crowd/:outlet`（同一匿名用户同一窗口 10 分钟内只能报一次，身份用社区已有的匿名会话）；`GET /api/crowd` 按时间衰减聚合最近 30 分钟。
- 前端：食堂详情里「不用排 / 排 5 分钟内 / 排很久」反馈按钮；饭点和菜单面板里的地图热力圈；首页「现在人最少的食堂」。
- 把真实数据接进 `src/lib/crowd.ts` 的 `crowdAt`，`source` 填 `live`；反馈不够时退回现在的估算并继续标「估算」。`planner.ts` 和 `TodayPanel.vue` 不应该需要改。
- 测试：聚合和衰减、限频、未知窗口 404、前端兜底。

**P3 活动自动更新**
- 数据包 `reference/official_events/official_latest.json` 是从学校官网活动日历接口抓的（字段 `title`、`f1`–`f7`、`phColId`、`id`、`url`），但接口地址没有记录。先找到接口地址，找不到就问我，不要猜着去大量请求官网。
- 转换成现有 `CampusEvent` 格式；地点归并复用数据包 `reference/collect/02_活动地点别名表_草稿.csv` 和 `findRooms`；按 `source + 原始 id` 去重；不覆盖人工修正；官网删掉的标记为已取消而不是删除；同步失败保留旧数据。
- 每 2 小时同步一次，后台显示最近同步时间和新增、更新条数，可以手动「立即同步」。新活动自动建交流话题。
- 测试用保存下来的官网响应做固定输入，不要在测试里联网。

**P2 后台补齐**
- 账号权限：`admin_users`（scrypt 哈希）+ HttpOnly Cookie 会话，角色为管理员、食堂老师（限定食堂）、书院 / 学院（限定主办的活动）。现在的单一口令（`server/.admin-password` 或 `ADMIN_PASSWORD`）作为第一个管理员的初始密码，老部署升级后还能登录。
- 操作日志：`audit_log`，所有写接口统一记录改动前后，后台可按人、对象、时间筛选。
- 活动修正：`event_overrides`，`GET /api/events` 返回时合并；单独列出没定位到楼的活动。
- 食堂与菜品编辑：现在菜单整体存在 `discovery_catalog` 的一条 JSON 里。改结构前先和我确认方案（拆表还是按路径修改）。
- 改数据库结构的迁移要能重复执行、写之前备份所改的表到 `server/backups/`、整批用事务，不能丢现有数据。

**P1 中英双语**
- 自己写轻量的 `src/lib/i18n.ts` 和 `src/locales/zh.ts`、`en.ts`，不引入 vue-i18n。语言存在 localStorage（读写包 try/catch），支持 `?lang=en`，后台保持中文。
- 楼和点位已有 `name.en` / `short.en`，缺英文时退回中文。活动标题不翻译；日期用 `Intl.DateTimeFormat`。英文更长，按钮和标签要能换行或省略，手机宽度下不能溢出。
- 加一个测试保证两份字典的键完全一致。

## 规矩

- 代码风格跟现有代码一致：Vue 3 `<script setup lang="ts">`，注释用简体中文、只写不显然的原因，命名和现有文件一致。纯逻辑放 `src/lib/*.ts` 并写单测。
- 不要在纯逻辑模块里 import `store.ts`：`ui.ts` 加载时会访问 `window`，会让 node 里的测试崩掉（参考 `today.ts` 和 `walkTime.ts` 的拆法）。
- 时间一律用 `campusTime.ts` 里按上海时区的函数（`dateKey`、`clockText`、`timestamp`），不要用设备本地时区。
- 后端 `PUT` 是把请求体合并到原记录上（`{ ...old, ...body }`），要清空一个字段必须显式传 `null`。
- 密钥只放服务器环境变量和 `.env`，不要用 `VITE_` 前缀，不要提交密钥。
- 新依赖要少而小，版本写死（和 `package.json` 现有写法一致），先说明理由。
- 不要改楼宇轮廓和点位整理数据（`public/data/places.json`、`data/*.json`、`server/map.db` 里的 `buildings` 表），这部分在另一条线上维护。
- 不要 `git commit` 或 `git push`，做完由我决定。工作区里有很多不是你改的未提交文件，不要回退或整理它们。
- 遇到需要我拍板的事（视觉模型选哪家、官网接口地址、P2 菜单数据结构、角色权限细节）先停下来问，不要自己猜。

## 每项完成的标准

1. `npm run build && npm test` 全部通过。
2. 后端 `node server/index.mjs` 不会自动重启，改了后端要重启再验证。
3. 在浏览器里验证桌面（宽度 ≥ 900 px）和手机（375 px）两种布局，截图或描述你看到的结果。
4. 更新 `README.md` 对应的功能说明和接口表，把 `docs/PLAN.md` 表格里这一项的「状态」改成已完成，并写明还没验证的部分。
5. 向我汇报：改了哪些文件、怎么验证的、哪些还没做或没验证（例如需要真实密钥、需要上线后才能测）。
