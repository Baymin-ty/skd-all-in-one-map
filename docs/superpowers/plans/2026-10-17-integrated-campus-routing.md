# 距离导航实施与验证（替代原雨天实施计划）

- 删除遮雨衍生数据、天气选项、结果字段、专属地图标记与 UI。
- 保留地面路网连线显示改动与原有地下拓扑/地图编辑。
- 原候选枚举只按路径长度比较，不引入新寻路架构。
- 使用可复用幂等迁移清理静态数据；修改数据库前 online backup 并校验。
- 全量测试、构建、diff 检查；禁止 commit/push。

当前接口、限制和操作步骤见 `../../distance-navigation.md`，设计见 `../specs/2026-10-17-integrated-campus-routing-design.md`。
