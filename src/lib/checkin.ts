import { reactive } from 'vue'
import { account, openAccount } from './account'
import { demoClockEnabled, nowTick } from './campusTime'

export const checkin = reactive({ eventId: '', code: '', count: 0, me: false, busy: false, error: '', done: false })
const headers = { 'Content-Type': 'application/json', 'X-Community-Request': '1' }

export async function loadCheckins(eventId: string) {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/checkins`, { credentials: 'same-origin' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '签到信息读取失败')
    checkin.eventId = eventId; checkin.count = body.count || 0; checkin.me = !!body.me
    return body as { count: number; me: boolean }
  } catch { return null }
}

export async function submitCheckin(eventId: string, code: string) {
  if (!account.me) { openAccount(); return false }
  checkin.busy = true; checkin.error = ''
  try {
    const at = demoClockEnabled.value ? `?at=${encodeURIComponent(String(nowTick.value))}` : ''
    const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/checkin${at}`, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ code }) })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || '签到失败')
    checkin.eventId = eventId; checkin.count = body.count || checkin.count; checkin.me = true; checkin.done = true
    return true
  } catch (error) { checkin.error = error instanceof Error ? error.message : '签到失败'; return false }
  finally { checkin.busy = false }
}

export async function handleCheckinLink(eventId: string, code: string) {
  if (!account.me) { checkin.eventId = eventId; checkin.code = code; openAccount(); return false }
  return submitCheckin(eventId, code)
}
