import type { CampusEvent, Canteen, Dish } from '../lib/discoveryTypes'
import { request } from './store'

/** 后台看到的活动：比前台多了隐藏、置顶和人工修改记录 */
export interface AdminEvent extends CampusEvent {
  hidden?: boolean
  pin?: number
  manualOverrides?: Record<string, unknown>
  editedAt?: number
  reviewedAt?: number
  owner?: string
}
export type EventPatch = Partial<Pick<AdminEvent, 'title' | 'title_en' | 'desc_en' | 'start' | 'end' | 'allDay' | 'venueRaw' | 'place' | 'room' | 'organizer' | 'speaker' | 'category' | 'url' | 'status' | 'hidden'>>

export const fetchEvents = () => request<{ events: AdminEvent[]; discussions: Record<string, number> }>('/api/admin/events')
export const updateEvent = (id: string, patch: EventPatch) => request<AdminEvent>(`/api/admin/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) })
export const savePins = (ids: string[]) => request<{ pins: string[] }>('/api/admin/event-pins', { method: 'PUT', body: JSON.stringify({ ids }) })
/** 主办方活动（后台新建的也算）走 organizer 接口，可以真正删除 */
export const createEvent = (body: Record<string, unknown>) => request<AdminEvent>('/api/organizer/events', { method: 'POST', body: JSON.stringify(body) })
export const deleteEvent = (id: string) => request<void>(`/api/organizer/events/${encodeURIComponent(id)}`, { method: 'DELETE' })

export interface AdminPost {
  id: string; title: string; content: string; tag: string; createdAt: number
  author: { id: string; name: string }
  topic: { id: string; name: string; type: string }
  images: string[]; likes: number; comments: number
}
export interface AdminComment { id: string; content: string; createdAt: number; parentId: string | null; author: { id: string; name: string } }
export interface CommunityPage {
  posts: AdminPost[]; total: number; hasMore: boolean
  stats: { posts?: number; comments?: number; today?: number; byType?: Record<string, number> }
}
export function fetchPosts(query: { type?: string; topic?: string; q?: string; offset?: number }) {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
  return request<CommunityPage>(`/api/admin/community?${params}`)
}
export const fetchComments = (postId: string) => request<AdminComment[]>(`/api/admin/community/posts/${encodeURIComponent(postId)}/comments`)
export const deletePost = (id: string) => request<void>(`/api/admin/community/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const deleteComment = (id: string) => request<void>(`/api/admin/community/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const fetchCanteens = () => request<{ canteens: Canteen[]; hoursSource?: string }>('/api/canteens')
const dishUrl = (canteen: string, outlet: string, dish = '') => `/api/admin/canteens/${encodeURIComponent(canteen)}/outlets/${encodeURIComponent(outlet)}/dishes${dish ? `/${encodeURIComponent(dish)}` : ''}`
export const createDish = (canteen: string, outlet: string, dish: Partial<Dish>) => request<Dish>(dishUrl(canteen, outlet), { method: 'POST', body: JSON.stringify(dish) })
export const updateDish = (canteen: string, outlet: string, id: string, dish: Partial<Dish>) => request<Dish>(dishUrl(canteen, outlet, id), { method: 'PUT', body: JSON.stringify(dish) })
export const removeDish = (canteen: string, outlet: string, id: string) => request<void>(dishUrl(canteen, outlet, id), { method: 'DELETE' })

export interface SystemInfo {
  generatedAt: number
  server: { startedAt: number; node: string; platform: string; memory: number; port: number }
  config: { mapSettings: Record<string, number> | null; passwordSource: string; aiSummary: boolean; aiModel: string; mail: boolean; mailLogin: boolean; scheduleVision: boolean; eventSchedule: boolean | null; demoMode: boolean }
  databases: { label: string; name: string; size: number; wal: number }[]
  map: { buildings: number; pois: number; entrances: number; updatedAt: number | null; underground: { nodes: number; edges: number; connectors: number; points: number; updatedAt: number | null } | null }
  events: { total: number; upcoming: number; hidden: number; pinned: number; cancelled: number; edited: number; bySource: Record<string, number>; review: { pending: number; approved: number; rejected: number } | null; lastSuccess: number | null; sources: { id: string; label: string; configured: boolean; lastRun: { status: string; startedAt: number } | null }[] }
  dining: { canteens: number; outlets: number; stalls: number; dishes: number; soldOut: number; photos: number; latestMenu: string | null }
  users: { accounts: number; organizers: number; sessions: number; posts: number; comments: number; checkins: number; crowd24h: number }
  backups: { name: string; size: number; modifiedAt: number }[]
}
export const fetchSystem = () => request<SystemInfo>('/api/admin/system')

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const today = () => new Date().toISOString().slice(0, 10)
export function bytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`
}
