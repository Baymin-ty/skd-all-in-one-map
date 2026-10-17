import { contextOnlyPoi, featuredPoi } from './placeCuration'
import type { Poi } from './types'

export type LabelPresentation = 'hidden' | 'icon' | 'full'

/** 入口只随明确操作出现；次要设施不因普通放大而挤满地图。 */
export function poiPresentation(poi: Poi, options: { zoom: number; detailed: boolean; emphasized: boolean }): LabelPresentation {
  if (options.emphasized) return 'full'
  if (contextOnlyPoi(poi)) return 'hidden'
  if (!featuredPoi(poi.id) && !options.detailed) return 'hidden'
  return labelPresentation({ kind: 'poi', ...options })
}

/** 精简模式随缩放逐步展开；正在查看的地点始终保留名称。 */
export function labelPresentation({ kind, zoom, detailed, emphasized, overview = false }: {
  kind: 'building' | 'group' | 'poi'
  zoom: number
  detailed: boolean
  emphasized: boolean
  overview?: boolean
}): LabelPresentation {
  if (emphasized || kind === 'group') return 'full'
  if (kind === 'poi') return detailed || zoom >= 19 ? 'full' : zoom >= 18 ? 'icon' : 'hidden'
  return detailed || zoom >= 18 || overview ? 'full' : 'hidden'
}

export interface LabelRect { left: number; right: number; top: number; bottom: number }

export function labelsOverlap(a: LabelRect, b: LabelRect, gapX = 10, gapY = 7) {
  return a.left < b.right + gapX && a.right > b.left - gapX
    && a.top < b.bottom + gapY && a.bottom > b.top - gapY
}

export function labelFits(rect: LabelRect, viewport: LabelRect) {
  return rect.left >= viewport.left && rect.right <= viewport.right
    && rect.top >= viewport.top && rect.bottom <= viewport.bottom
}

export const shiftRect = (r: LabelRect, dx: number, dy: number): LabelRect =>
  ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy })

export interface LabelSlot { slot: string; dx: number; dy: number }

/**
 * 标签的候选位置：先放在地点正中，挡住了再上下、左右各挪一小段，标签仍压在地点上。
 * 上一次用过的位置排最前，平移、刷新时标签不会来回跳。
 */
export function labelSlots(width: number, height: number, previous?: string): LabelSlot[] {
  const dy = Math.round(Math.min(height / 2 + 3, 22))
  // 只剩图标时也要挪得开一个图标宽，否则两个挨着的地点谁也让不开
  const dx = Math.round(Math.min(Math.max(width / 3, 26), 36))
  const slots: LabelSlot[] = [
    { slot: 'c', dx: 0, dy: 0 }, { slot: 'n', dx: 0, dy: -dy }, { slot: 's', dx: 0, dy },
    { slot: 'e', dx, dy: 0 }, { slot: 'w', dx: -dx, dy: 0 },
  ]
  const i = slots.findIndex((s) => s.slot === previous)
  if (i > 0) slots.unshift(...slots.splice(i, 1))
  return slots
}

/** 内容由多到少的显示层级：完整 → 一行 → 只留图标，放不下才整体藏起来。 */
export type LabelLevel = 'full' | 'brief' | 'icon'
export function labelLevels(spec: string | undefined): LabelLevel[] {
  const levels = (spec || 'full').split(' ').filter((l): l is LabelLevel => l === 'full' || l === 'brief' || l === 'icon')
  return levels.length ? levels : ['full']
}

/** 按指针到标签边缘的距离计算柔和的聚焦强度，标签内部保持稳定。 */
export function labelProximity(x: number, y: number, rect: LabelRect, radius = 130) {
  const dx = Math.max(rect.left - x, 0, x - rect.right)
  const dy = Math.max(rect.top - y, 0, y - rect.bottom)
  const t = Math.max(0, 1 - Math.hypot(dx, dy) / radius)
  return t * t * (3 - 2 * t)
}

/** 一个楼群同一时刻只显示一个层级；选中、筛选或展开的子项替代父标签。 */
export function collapsedLabelGroups<T extends { id: string; members: readonly string[] }>(
  groups: readonly T[], expanded: ReadonlySet<string>, shownChildren: ReadonlySet<string>,
): T[] {
  return groups.filter((g) => !expanded.has(g.id) && !g.members.some((id) => shownChildren.has(id)))
}
