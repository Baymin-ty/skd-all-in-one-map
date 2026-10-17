import { account } from './account'

export type UserDataKey = 'today' | 'map' | 'prefs'
type Envelope = { data: unknown; rev: number; updatedAt: number }

const memory = new Map<string, Envelope>()
const timers = new Map<UserDataKey, number>()
const KEY_RE = /^(today|map|prefs)$/
const storageKey = (key: UserDataKey, loggedIn = !!account.me) => `stmap.${loggedIn ? 'user' : 'anon'}.${key}.v1`

function readStorage(key: UserDataKey, loggedIn = !!account.me): Envelope | null {
  const name = storageKey(key, loggedIn)
  try {
    const value = JSON.parse(localStorage.getItem(name) || 'null')
    if (value && typeof value === 'object' && 'data' in value) return value as Envelope
    // The first version of the planner stored today directly under this key.
    // Treat it as an anonymous envelope so a later account login can migrate it.
    if (!loggedIn && key === 'today' && value && typeof value === 'object') return { data: value, rev: 0, updatedAt: 0 }
    return null
  } catch { return null }
}
function writeStorage(key: UserDataKey, envelope: Envelope, loggedIn = !!account.me) {
  memory.set(storageKey(key, loggedIn), envelope)
  try { localStorage.setItem(storageKey(key, loggedIn), JSON.stringify(envelope)) } catch { /* memory fallback */ }
}

export function readUserData<T>(key: UserDataKey, fallback: T): T {
  const cached = memory.get(storageKey(key)) || readStorage(key)
  return cached ? cached.data as T : fallback
}

export function mergeByUpdatedAt<T extends { id: string; updatedAt?: number; deleted?: boolean }>(local: T[], remote: T[]) {
  const merged = new Map<string, T>()
  for (const item of [...remote, ...local]) {
    const old = merged.get(item.id)
    if (!old || (item.updatedAt ?? 0) >= (old.updatedAt ?? 0)) merged.set(item.id, item)
  }
  return [...merged.values()].filter((item) => !item.deleted)
}

async function put(key: UserDataKey, envelope: Envelope) {
  if (!account.me) return
  const response = await fetch(`/api/me/data/${key}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Community-Request': '1' }, body: JSON.stringify({ data: envelope.data, rev: envelope.rev }) })
  const body = await response.json().catch(() => null)
  if (response.status === 409 && body?.data) {
    const current = body as { data: unknown; rev: number; updatedAt?: number }
    const merged = mergeValue(key, envelope.data, current.data)
    const next = { data: merged, rev: current.rev, updatedAt: Date.now() }
    writeStorage(key, next)
    return put(key, next)
  }
  if (!response.ok) throw new Error(body?.error || '个人数据同步失败')
  const next = body && typeof body.rev === 'number' ? { data: envelope.data, rev: body.rev, updatedAt: body.updatedAt || Date.now() } : envelope
  writeStorage(key, next)
}

function mergeValue(key: UserDataKey, local: unknown, remote: unknown) {
  if (key === 'today') {
    const a = Array.isArray((local as any)?.items) ? (local as any).items : []
    const b = Array.isArray((remote as any)?.items) ? (remote as any).items : []
    return { ...(remote as any), items: mergeByUpdatedAt(a, b) }
  }
  if (key === 'map' || key === 'prefs') return { ...(remote as any), ...(local as any) }
  return local
}

function sameJson(a: unknown, b: unknown) {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

export function setUserData(key: UserDataKey, data: unknown) {
  if (!KEY_RE.test(key)) throw new Error('不支持的个人数据项')
  const old = memory.get(storageKey(key)) || readStorage(key)
  const envelope = { data, rev: old?.rev ?? 0, updatedAt: Date.now() }
  writeStorage(key, envelope)
  if (account.me) {
    const timer = timers.get(key)
    if (timer) window.clearTimeout(timer)
    timers.set(key, window.setTimeout(() => { timers.delete(key); void put(key, envelope).catch(() => {}) }, 1000))
  }
}

export async function loadUserData() {
  if (!account.me) return
  try {
    const response = await fetch('/api/me/data', { credentials: 'same-origin' })
    if (!response.ok) return
    const result = await response.json() as Record<string, { data: unknown; rev: number; updatedAt?: number }>
    for (const key of ['today', 'map', 'prefs'] as UserDataKey[]) {
      const remote = result[key]
      const local = readStorage(key, false)
      if (remote) {
        const data = local ? mergeValue(key, local.data, remote.data) : remote.data
        const changed = !!local && !sameJson(data, remote.data)
        const envelope = { data, rev: remote.rev ?? 0, updatedAt: changed ? Date.now() : (remote.updatedAt || Date.now()) }
        writeStorage(key, envelope)
        if (changed) void put(key, envelope).catch(() => {})
      } else if (local) {
        const envelope = { data: local.data, rev: 0, updatedAt: Date.now() }
        writeStorage(key, envelope)
        void put(key, envelope).catch(() => {})
      }
    }
  } catch { /* offline: continue using the local copy */ }
}

export function clearAccountCache() {
  for (const key of ['today', 'map', 'prefs'] as UserDataKey[]) {
    memory.delete(storageKey(key, true))
    try { localStorage.removeItem(storageKey(key, true)) } catch { /* ignore */ }
  }
}
