import { reactive } from 'vue'

export interface CommunityTarget { type: 'event' | 'stall' | 'place'; id: string; name: string; subtitle?: string }
export interface CommunityUser { id: string; name: string }
export interface CommunityPost {
  id: string; title: string; content: string; tag: string; createdAt: number; author: CommunityUser
  mine: boolean; attended?: boolean; images: string[]; likes: number; comments: number; liked: boolean; saved: boolean
}
export interface CommunityComment {
  id: string; content: string; createdAt: number; parentId: string | null; replyTo: string | null; mine: boolean; author: CommunityUser
}
export interface CommunitySummary {
  overview: string; highlights: string[]; questions: string[]; generatedAt: number; model: string; stale: boolean
  counts: { posts: number; comments: number }; sampled: { posts: number; comments: number }
}
export const community = reactive({ target: null as CommunityTarget | null })
export function openCommunity(target: CommunityTarget) { community.target = target }
export function stallCommunity(canteen: string, outlet: string, stall: string) { return `${canteen}:${outlet}:${stall}` }
export function topicPath(target: CommunityTarget) { return `/topics/${target.type}/${encodeURIComponent(target.id)}` }
export async function communityApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/community${path}`, {
    method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(path.endsWith('/summary') ? 60_000 : 20_000),
  }).catch(() => { throw new Error('暂时连接不上交流区，请检查网络后重试') })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) throw new Error(data?.error || '交流区暂时不可用，请稍后重试')
  return data as T
}
export const communityTime = (time: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)

/** Resize and re-encode on the client: bounded uploads, no embedded EXIF/location metadata. */
export async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片')
  if (file.size > 20 * 1024 * 1024) throw new Error('原图不能超过 20 MB')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取这张图片，请换一张试试') })
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally { bitmap.close() }
}
