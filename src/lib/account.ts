import { reactive } from 'vue'
import { isDemoAccount } from './demoData'

export interface AccountUser {
  id: string
  /** 公开昵称，发笔记、评论时署名用；和校园账号绑定 */
  name: string
  email: string
  role: 'student' | 'organizer' | 'admin'
  /** 新账号还没起过昵称时为 false */
  nameSet: boolean
  createdAt: number
  /** 固定演示账号：预置内容从本机开始，可继续编辑 */
  demo?: boolean
}

export const ROLE_LABELS: Record<AccountUser['role'], string> = { student: '同学', organizer: '活动主办方', admin: '管理员' }

export const CAMPUS_EMAIL_DOMAIN = '@shanghaitech.edu.cn'

export function campusEmailFromPrefix(value: string) {
  const prefix = value.trim().toLowerCase()
  return /^[^\s@]+$/.test(prefix) ? `${prefix}${CAMPUS_EMAIL_DOMAIN}` : null
}

export function demoEntryVisible(step: 'email' | 'code' | 'name') {
  return step !== 'name'
}

export const account = reactive({
  me: null as AccountUser | null,
  open: false,
  /** email → code 登录；name 是首次登录（或从其他入口）起昵称 */
  step: 'email' as 'email' | 'code' | 'name',
  emailPrefix: 'name',
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

export async function requestLoginCode(prefix = account.emailPrefix) {
  const email = campusEmailFromPrefix(prefix)
  account.emailPrefix = prefix.trim().toLowerCase()
  account.error = ''
  account.message = ''
  if (!email) {
    account.error = '请输入有效的邮箱前缀'
    return false
  }
  account.email = email
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

/** Directly open the curated, read-only showcase account. */
export async function loginDemoAccount() {
  account.error = ''
  account.busy = true
  try {
    account.me = await request<AccountUser>('/api/account/demo', { method: 'POST', headers, body: '{}' })
    const { loadUserData } = await import('./userData')
    await loadUserData()
    const { initDemoPlan } = await import('./demoSession')
    initDemoPlan()
    const { showPanel } = await import('./store')
    showPanel('today')
    account.open = false
    account.step = 'email'
    return true
  } catch (error) {
    account.error = error instanceof Error ? error.message : '演示账号登录失败'
    return false
  } finally { account.busy = false }
}

// TEMP DEMO(temp-account): 演示站一键创建临时账号，替代邮箱验证码登录
export async function createTempAccount(name = account.name) {
  account.error = ''
  name = name.trim()
  if (name.length < 2 || name.length > 16) { account.error = '昵称需要 2–16 个字'; return false }
  account.busy = true
  try {
    account.me = await request<AccountUser>('/api/account/temp', { method: 'POST', headers, body: '{}' })
    await reloadPersonalData()
    const pending = await import('./checkin')
    if (pending.checkin.eventId && pending.checkin.code && !pending.checkin.me) void pending.submitCheckin(pending.checkin.eventId, pending.checkin.code)
    account.message = ''
  } catch (error) {
    account.error = error instanceof Error ? error.message : '创建临时账号失败'
    account.busy = false
    return false
  }
  account.busy = false
  // 账号已建好；昵称失败（如重名）时停在昵称步骤，保留错误提示让用户改
  if (await submitNickname(name)) return true
  account.step = 'name'
  return false
}

/** 修改昵称：成功后返回最新的账号资料，失败抛出带中文提示的错误。 */
export async function updateNickname(name: string) {
  if (isDemoAccount(account.me)) {
    const clean = name.trim()
    if (clean.length < 2 || clean.length > 16) throw new Error('昵称需要 2–16 个字')
    const me = account.me
    if (!me) throw new Error('请先登录')
    account.me = { ...me, name: clean, nameSet: true }
    return account.me
  }
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
