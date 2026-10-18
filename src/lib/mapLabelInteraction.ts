import { labelProximity, type LabelRect } from './mapLabels'

type Target = { node: HTMLElement; rect: LabelRect }

/** 缓存静态排布，鼠标帧只计算距离和更新样式，避免读写布局互相触发。 */
export function createLabelInteraction(container: HTMLElement, onLeave: () => void) {
  const hoverMedia = window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
  let targets: Target[] = []
  let pointer: { x: number; y: number } | null = null
  let frame = 0
  let moving = false

  function paint() {
    frame = 0
    if (!pointer) return
    // 排布已缓存，所有样式更新集中在同一个动画帧。
    for (const { node, rect } of targets) {
      const near = labelProximity(pointer.x, pointer.y, rect)
      node.style.setProperty('--near', near.toFixed(3))
      node.style.setProperty('--shine-x', `${Math.max(0, Math.min(pointer.x - rect.left, rect.right - rect.left))}px`)
      node.style.setProperty('--shine-y', `${Math.max(0, Math.min(pointer.y - rect.top, rect.bottom - rect.top))}px`)
      node.classList.toggle('near-pointer', near > 0.55)
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint)
  }
  function clearPointer(clearHover: boolean) {
    cancelAnimationFrame(frame)
    frame = 0
    pointer = null
    for (const { node } of targets) {
      node.style.setProperty('--near', '0')
      node.classList.remove('near-pointer')
    }
    if (clearHover) onLeave()
  }
  const reset = () => clearPointer(true)
  // 保留悬停产生的临时标签，直到 click 完成；拖动开始时会统一 reset。
  const pointerDown = () => clearPointer(false)
  function move(event: PointerEvent) {
    if (!hoverMedia.matches || event.pointerType === 'touch' || event.buttons || moving) return
    pointer = { x: event.clientX, y: event.clientY }
    schedule()
  }
  function refresh() {
    // 触屏设备没有悬停效果，跳过整批测量
    if (!hoverMedia.matches) { targets = []; return }
    // 排布阶段会清除动效 class，使这里拿到不受浮起 / 缩放影响的位置。
    targets = [...container.querySelectorAll<HTMLElement>('.blabel:not(.clash):not(.hover-suppressed), .pmark:not(.clash):not(.hover-suppressed)')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
    if (pointer) schedule()
  }
  function mediaChanged() { reset(); refresh() }
  container.addEventListener('pointermove', move, { passive: true })
  container.addEventListener('pointerleave', reset)
  container.addEventListener('pointerdown', pointerDown, { passive: true })
  hoverMedia.addEventListener('change', mediaChanged)

  return {
    refresh,
    get canHover() { return hoverMedia.matches && !moving },
    setMoving(value: boolean) { moving = value; if (value) reset() },
    reset,
    destroy() {
      reset()
      container.removeEventListener('pointermove', move)
      container.removeEventListener('pointerleave', reset)
      container.removeEventListener('pointerdown', pointerDown)
      hoverMedia.removeEventListener('change', mediaChanged)
    },
  }
}
