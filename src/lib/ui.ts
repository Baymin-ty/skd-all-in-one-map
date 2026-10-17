import { reactive } from 'vue'

/** 桌面：左侧导航栏 + 内容面板；手机：顶部搜索 + 可拖动的底部面板，底部面板自带功能标签栏 */
const mq = window.matchMedia('(min-width: 900px)')
/** 桌面左侧导航栏宽度 */
export const RAIL_W = 72
/** 导航栏 + 内容面板一共挡住地图的宽度 */
export const SIDEBAR_W = 440
/** 手机顶部搜索框 + 分类条占的高度 */
export const TOPBAR_H = 112

export const ui = reactive({
  desktop: mq.matches,
  /** 底部面板高度（px）和三个停靠位置：收起 / 半屏 / 展开 */
  sheet: 0,
  anchors: [0, 0, 0] as number[],
  dragging: false,
  /** 全屏界面（活动时光机）打开时挡住地图的边距，代替侧栏和底部面板 */
  overlay: null as { l: number; t: number; r: number; b: number } | null,
})
mq.addEventListener('change', (e) => (ui.desktop = e.matches))

export function computeAnchors() {
  const h = window.innerHeight
  const level = ui.anchors.indexOf(ui.sheet)
  ui.anchors = [164, Math.round(h * 0.46), Math.round(h * 0.88)]
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
  if (ui.overlay) return { ...ui.overlay }
  if (ui.desktop) return { l: SIDEBAR_W, t: 0, r: 0, b: 0 }
  return { l: 0, t: TOPBAR_H, r: 0, b: Math.min(ui.sheet, ui.anchors[1]) }
}
