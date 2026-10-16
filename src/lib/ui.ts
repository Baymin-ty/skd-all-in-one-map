import { reactive } from 'vue'

/** 桌面：左侧固定侧栏；手机：顶部搜索 + 可拖动的底部面板（布局沿用 skdmap） */
const mq = window.matchMedia('(min-width: 900px)')
export const SIDEBAR_W = 400
/** 手机顶部搜索框 + 分类条占的高度 */
export const TOPBAR_H = 112

export const ui = reactive({
  desktop: mq.matches,
  /** 底部面板高度（px）和三个停靠位置：收起 / 半屏 / 展开 */
  sheet: 0,
  anchors: [0, 0, 0] as number[],
  dragging: false,
})
mq.addEventListener('change', (e) => (ui.desktop = e.matches))

export function computeAnchors() {
  const h = window.innerHeight
  const level = ui.anchors.indexOf(ui.sheet)
  ui.anchors = [136, Math.round(h * 0.46), Math.round(h * 0.88)]
  ui.sheet = ui.anchors[level >= 0 ? level : 0]
}

/** 打开到某一档；已经被用户拉得更高时不往回缩 */
export function openSheet(level: 0 | 1 | 2) {
  const target = ui.anchors[level]
  if (level < 2 && ui.sheet >= target) return
  ui.sheet = target
}

/** 地图被界面挡住的边距（px） */
export function covered() {
  if (ui.desktop) return { l: SIDEBAR_W, t: 0, r: 0, b: 0 }
  return { l: 0, t: TOPBAR_H, r: 0, b: Math.min(ui.sheet, ui.anchors[1]) }
}
