import { reactive } from 'vue'

/** 桌面：左侧导航栏 + 内容面板；手机：顶部搜索 + 可拖动的底部面板，底部面板自带功能标签栏 */
const mq = window.matchMedia('(min-width: 900px)')
/** 桌面左侧导航栏宽度 */
export const RAIL_W = 72
/** 导航栏 + 内容面板一共挡住地图的默认宽度；用户可以拖动分隔线调整 */
export const SIDEBAR_W = 440
/** 再窄「步行导航」等按钮标题会断行 */
const SIDE_MIN = 380
const SIDE_MAX = 760
/** 拖到最宽时至少给地图留出的宽度 */
const MAP_MIN = 360
const SIDE_KEY = 'stmap.sideW'
/** 手机顶部搜索框 + 分类条占的高度（实际高度由 App 量出来写进 ui.topH，含刘海屏的安全区） */
export const TOPBAR_H = 112
/** 手机底部面板：把手高度，和收起时露出的「接下来」卡片高度 */
const GRIP_H = 22
const PEEK_CONTENT = 92

/** 限制在可用范围内：不窄于最小宽度，也不把地图挤得太小 */
export function clampSide(w: number) {
  const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, window.innerWidth - MAP_MIN))
  return Math.round(Math.min(max, Math.max(SIDE_MIN, w)))
}
function savedSide() {
  try {
    const w = Number(localStorage.getItem(SIDE_KEY))
    return w > 0 ? clampSide(w) : SIDEBAR_W
  } catch { return SIDEBAR_W }
}

export const ui = reactive({
  desktop: mq.matches,
  /** 桌面：导航栏 + 内容面板的总宽度（px） */
  sideW: savedSide(),
  /** 正在拖动侧栏分隔线 */
  resizingSide: false,
  /** 底部面板高度（px）和三个停靠位置：收起 / 半屏 / 展开 */
  sheet: 0,
  anchors: [0, 0, 0] as number[],
  /** 手机顶部栏实际占的高度、底部标签栏（含 Home 指示条安全区）的高度，由组件量出来 */
  topH: TOPBAR_H,
  footH: 64,
  /** 刘海屏顶部安全区 */
  safeTop: 0,
  dragging: false,
  /** 全屏界面（活动时光机）打开时挡住地图的边距，代替侧栏和底部面板 */
  overlay: null as { l: number; t: number; r: number; b: number } | null,
})
mq.addEventListener('change', (e) => (ui.desktop = e.matches))
window.addEventListener('resize', () => { ui.sideW = clampSide(ui.sideW) })

export function setSideWidth(w: number, save = true) {
  ui.sideW = clampSide(w)
  if (save) try { localStorage.setItem(SIDE_KEY, String(ui.sideW)) } catch { /* 只在本次会话生效 */ }
}

export function computeAnchors() {
  const h = window.innerHeight
  const level = ui.anchors.indexOf(ui.sheet)
  // 收起：把手 + 一张卡片 + 标签栏；半屏：地图和列表各占一半；展开：顶部只留出搜索框
  const peek = GRIP_H + PEEK_CONTENT + ui.footH
  const full = Math.max(peek + 120, h - ui.safeTop - 62)
  ui.anchors = [peek, Math.max(peek + 80, Math.round(h * 0.5)), full]
  ui.sheet = ui.anchors[level >= 0 ? level : 0]
}

/** 读取 env(safe-area-inset-*)：viewport-fit=cover 时刘海和 Home 指示条要让出来 */
export function measureSafeArea() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)'
  document.body.append(probe)
  ui.safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
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
  if (ui.desktop) return { l: ui.sideW, t: 0, r: 0, b: 0 }
  return { l: 0, t: ui.topH, r: 0, b: Math.min(ui.sheet, ui.anchors[1]) }
}
