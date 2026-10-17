import { reactive } from 'vue'

export interface AccountUser {
  id: string
  /** 公开昵称，发笔记、评论时署名用；和校园账号绑定 */
  name: string
  email: string
  role: 'student' | 'organizer' | 'admin'
  /** 新账号还没起过昵称时为 false */
  nameSet: boolean
  createdAt: number
}

export const ROLE_LABELS: Record<AccountUser['role'], string> = { student: '同学', organizer: '活动主办方', admin: '管理员' }

export const account = reactive({
  me: null as AccountUser | null,
  open: false,
  /** email → code 登录；name 是首次登录（或从其他入口）起昵称 */
  step: 'email' as 'email' | 'code' | 'name',
  email: '',
  code: '',
  name: '',
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

/** 打开登录框；已登录但还没起昵称时直接进入起昵称这一步。 */
export function openAccount() {
  if (account.me && account.me.nameSet) return
  account.open = true
  account.error = ''
  account.message = ''
  if (account.me) { account.step = 'name'; account.name = '' }
  else if (account.step === 'name') account.step = 'email'
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

/** 登录、退出后把课表、寝室等个人数据换成当前身份的那一份。 */
async function reloadPersonalData() {
  const { loadUserData } = await import('./userData')
  await loadUserData()
  const { reloadPersonalData } = await import('./profile')
  reloadPersonalData()
}

export async function verifyLoginCode(code = account.code) {
  account.code = code.trim()
  account.error = ''
  if (!/^\d{6}$/.test(account.code)) { account.error = '请输入 6 位验证码'; return false }
  account.busy = true
  try {
    account.me = await request<AccountUser>('/api/account/verify', { method: 'POST', headers, body: JSON.stringify({ email: account.email, code: account.code }) })
    await reloadPersonalData()
    const pending = await import('./checkin')
    if (pending.checkin.eventId && pending.checkin.code && !pending.checkin.me) void pending.submitCheckin(pending.checkin.eventId, pending.checkin.code)
    account.code = ''
    account.message = ''
    // 新账号先起个昵称；老账号的昵称跟着账号回来，直接关掉
    if (account.me.nameSet) { account.open = false; account.step = 'email' }
    else { account.step = 'name'; account.name = '' }
    return true
  } catch (error) {
    account.error = error instanceof Error ? error.message : '验证码不正确'
    return false
  } finally { account.busy = false }
}

/** 修改昵称：成功后返回最新的账号资料，失败抛出带中文提示的错误。 */
export async function updateNickname(name: string) {
  const me = await request<AccountUser>('/api/account/profile', { method: 'PATCH', headers, body: JSON.stringify({ name }) })
  account.me = me
  return me
}

/** 登录框里「起个昵称」这一步的提交。 */
export async function submitNickname(name = account.name) {
  account.error = ''
  account.busy = true
  try {
    await updateNickname(name)
    account.open = false
    account.step = 'email'
    return true
  } catch (error) {
    account.error = error instanceof Error ? error.message : '昵称保存失败'
    return false
  } finally { account.busy = false }
}

export async function logoutAccount() {
  account.busy = true
  try {
    await request('/api/account/logout', { method: 'POST', headers })
    account.me = null
    account.step = 'email'
    const { clearAccountCache } = await import('./userData')
    clearAccountCache()
    await reloadPersonalData()
  }
  finally { account.busy = false }
}
