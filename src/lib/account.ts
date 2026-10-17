import { reactive } from 'vue'

export interface AccountUser {
  id: string
  name: string
  email: string
  role: 'student' | 'organizer' | 'admin'
}

export const account = reactive({
  me: null as AccountUser | null,
  open: false,
  step: 'email' as 'email' | 'code',
  email: '',
  code: '',
  busy: false,
  error: '',
  message: '',
})

const headers = { 'Content-Type': 'application/json', 'X-Community-Request': '1' }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `请求失败（${response.status}）`)
  return body as T
}

export async function loadAccount() {
  try { account.me = await request<AccountUser | null>('/api/account/me') }
  catch { account.me = null }
  return account.me
}

export function openAccount() {
  account.open = true
  account.error = ''
  account.message = ''
  account.step = account.me ? 'email' : account.step
  account.email = account.me ? '' : account.email
}

export function closeAccount() {
  if (!account.busy) account.open = false
}

export async function requestLoginCode(email = account.email) {
  account.email = email.trim().toLowerCase()
  account.error = ''
  account.message = ''
  // The server remains the source of truth for allowed domains.  DEMO_MODE
  // seeds accounts with @demo.test addresses so the local walkthrough can
  // exercise the same code path without sending mail; production still
  // rejects those addresses in /api/account/code.
  if (!/^[^\s@]+@(shanghaitech\.edu\.cn|demo\.test)$/i.test(account.email)) {
    account.error = '请输入 @shanghaitech.edu.cn 校内邮箱（演示模式可用 @demo.test）'
    return false
  }
  account.busy = true
  try {
    const result = await request<{ message?: string }>('/api/account/code', { method: 'POST', headers, body: JSON.stringify({ email: account.email }) })
    account.step = 'code'
    account.message = result.message || '验证码已发送，请查收邮箱'
    return true
  } catch (error) {
    account.error = error instanceof Error ? error.message : '验证码发送失败'
    return false
  } finally { account.busy = false }
}

export async function verifyLoginCode(code = account.code) {
  account.code = code.trim()
  account.error = ''
  if (!/^\d{6}$/.test(account.code)) { account.error = '请输入 6 位验证码'; return false }
  account.busy = true
  try {
    account.me = await request<AccountUser>('/api/account/verify', { method: 'POST', headers, body: JSON.stringify({ email: account.email, code: account.code }) })
    const userData = await import('./userData')
    await userData.loadUserData()
    const today = await import('./today')
    today.initPlan()
    const pending = await import('./checkin')
    if (pending.checkin.eventId && pending.checkin.code && !pending.checkin.me) void pending.submitCheckin(pending.checkin.eventId, pending.checkin.code)
    account.open = false
    account.step = 'email'
    account.code = ''
    account.message = ''
    return true
  } catch (error) {
    account.error = error instanceof Error ? error.message : '验证码不正确'
    return false
  } finally { account.busy = false }
}

export async function logoutAccount() {
  account.busy = true
  try {
    await request('/api/account/logout', { method: 'POST', headers })
    account.me = null
    const { clearAccountCache } = await import('./userData')
    clearAccountCache()
    const { initPlan } = await import('./today')
    initPlan()
  }
  finally { account.busy = false }
}
