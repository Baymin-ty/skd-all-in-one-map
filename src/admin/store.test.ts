import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Building, Campus, Poi } from '../lib/types'

vi.stubGlobal('location', { hash: '' })
const store = await import('./store')
const { admin, edit, create, discard, draftDirty, draftIssue, setPosition, mapPick, changeGeometry, undoGeometry, redoGeometry, canRedo, deleteVertex, save, login, closeLogin } = store
const building = (): Building => ({
  id: 'building-1', name: { zh: '测试楼', en: 'Test' }, short: { zh: '测试楼', en: '' }, cat: 'academic',
  aliases: [], orgs: [], rooms: [], center: [121.6, 31.18],
  poly: [[121.6, 31.18], [121.601, 31.18], [121.601, 31.181], [121.6, 31.181]],
})

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('window', { setTimeout })
  vi.stubGlobal('sessionStorage', { setItem: vi.fn(), removeItem: vi.fn() })
  vi.stubGlobal('fetch', vi.fn())
  vi.useFakeTimers()
  admin.saving = false
  admin.deleteTarget = null; admin.deleteError = ''; admin.selected = null
  admin.settingsSaving = false; admin.mapSettingsDraft = { ...admin.mapSettings }
  discard(); closeLogin()
  Object.assign(admin, { loggedIn: true, offline: false, token: 'test', view: 'overview', kind: 'building', search: '测试', category: 'building:academic' })
  admin.places.buildings = [building()]; admin.places.pois = []
  admin.campus = { bounds: [[121.59, 31.17], [121.62, 31.20]] } as Campus
  vi.mocked(confirm).mockClear()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('编辑器草稿', () => {
  it('未修改可直接返回；仅实际修改后确认，并保留原记录和筛选', () => {
    edit({ kind: 'building', data: admin.places.buildings[0] })
    expect(draftDirty.value).toBe(false)
    expect(discard()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    edit({ kind: 'building', data: admin.places.buildings[0] })
    admin.draft!.data.name.zh = '修改名称'
    vi.mocked(confirm).mockReturnValue(false)
    expect(discard()).toBe(false)
    expect(admin.draft!.data.name.zh).toBe('修改名称')
    expect(admin.places.buildings[0].name.zh).toBe('测试楼')
    expect([admin.view, admin.search, admin.category]).toEqual(['overview', '测试', 'building:academic'])
  })

  it('登录后继续原先点击的编辑', async () => {
    admin.loggedIn = false
    edit({ kind: 'building', data: building() })
    expect(admin.loginOpen).toBe(true)
    expect(admin.draft).toBeNull()
    vi.mocked(fetch).mockResolvedValue(new Response('{}'))
    await login('test')
    expect(admin.loginOpen).toBe(false)
    expect(admin.draft!.data.id).toBe('building-1')
  })

  it('新增点位必须先选位置，撤销选址会恢复到未放置状态', () => {
    create('poi'); admin.draft!.data.name.zh = '测试点位'
    expect(draftIssue.value).toContain('选择位置')
    mapPick([121.601, 31.183])
    expect(draftIssue.value).toBe('')
    expect(admin.mode).toBe('')
    undoGeometry()
    expect(draftIssue.value).toContain('选择位置')
    redoGeometry()
    expect((admin.draft!.data as Poi).pos).toEqual([121.601, 31.183])
    expect(draftIssue.value).toBe('')
  })

  it('撤销重做轮廓不会丢掉文字修改，新操作会清除重做记录', () => {
    edit({ kind: 'building', data: building() })
    const draft = admin.draft!.data as Building
    changeGeometry(() => draft.poly[0] = [121.6001, 31.1801])
    draft.name.zh = '新名称'
    undoGeometry()
    expect(draft.poly[0]).toEqual([121.6, 31.18])
    expect(draft.name.zh).toBe('新名称')
    redoGeometry()
    expect(draft.poly[0]).toEqual([121.6001, 31.1801])
    undoGeometry()
    setPosition([121.6005, 31.1805])
    expect(canRedo.value).toBe(false)
  })

  it('删除顶点至少保留三个点，撤销可恢复被删顶点', () => {
    edit({ kind: 'building', data: building() })
    const draft = admin.draft!.data as Building
    admin.selectedVertex = 0; deleteVertex()
    expect(draft.poly).toHaveLength(3)
    admin.selectedVertex = 0; deleteVertex()
    expect(draft.poly).toHaveLength(3)
    expect(admin.editError).toContain('至少')
    undoGeometry()
    expect(draft.poly).toEqual(building().poly)
    expect(admin.editError).toBe('')
  })

  it('保存失败保留草稿与错误，重试成功后回到原筛选列表', async () => {
    edit({ kind: 'building', data: building() })
    admin.draft!.data.name.zh = '修改名称'
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: '服务暂不可用' }), { status: 503 }))
    await save()
    expect(admin.draft!.data.name.zh).toBe('修改名称')
    expect(admin.editError).toContain('服务暂不可用')
    expect(admin.saving).toBe(false)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(admin.draft!.data)))
    await save()
    expect(admin.draft).toBeNull()
    expect(admin.places.buildings[0].name.zh).toBe('修改名称')
    expect([admin.view, admin.search, admin.category]).toEqual(['overview', '测试', 'building:academic'])
  })
})


describe('统一地点工作台', () => {
  it('查看地点不要求登录；切换地点时保留尚未保存的修改', () => {
    admin.loggedIn = false
    const a = { kind: 'building' as const, data: building() }
    store.selectAsset(a)
    expect(admin.selected?.data.id).toBe(a.data.id)
    expect(admin.draft).toBeNull()
    expect(admin.loginOpen).toBe(false)
    admin.loggedIn = true; edit(a)
    admin.draft!.data.name.zh = '未保存的名称'
    vi.mocked(confirm).mockReturnValue(false)
    store.selectAsset({ kind: 'building', data: { ...building(), id: 'other' } })
    expect(admin.selected?.data.id).toBe(a.data.id)
    expect(admin.draft!.data.name.zh).toBe('未保存的名称')
  })

  it('类型与分类筛选在同一目录生效，并支持点位别名', () => {
    admin.places.pois = [{ id: 'poi-1', name: { zh: '快递中心', en: '' }, cat: 'life', aliases: ['菜鸟'], pos: [121.6, 31.18], desc: null }]
    store.clearFilters()
    expect(store.filtered.value).toHaveLength(2)
    store.setKind('poi')
    expect(store.filtered.value.map((a) => a.data.id)).toEqual(['poi-1'])
    admin.search = '菜鸟'
    expect(store.filtered.value).toHaveLength(1)
    admin.category = 'poi:parking'
    expect(store.filtered.value).toHaveLength(0)
    store.setKind('building')
    expect(admin.category).toBe('')
    store.clearFilters()
    expect(store.filtered.value).toHaveLength(2)
  })

  it('保存并继续新增保留类型与分类，清空名称和位置，分别保存独立记录', async () => {
    create('poi')
    admin.draft!.data.name.zh = '新增打印机'; admin.draft!.data.cat = 'life'
    mapPick([121.601, 31.183])
    const version = admin.draftVersion
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...admin.draft!.data, id: 'saved-1' })))
    await save(true)
    expect(admin.places.pois).toHaveLength(1)
    expect(admin.places.pois[0].name.zh).toBe('新增打印机')
    expect(admin.draft!.data.id).toBe('')
    expect(admin.draft!.data.name.zh).toBe('')
    expect(admin.draft!.data.cat).toBe('life')
    expect(admin.positionSet).toBe(false)
    expect(admin.mode).toBe('position')
    expect(admin.draftVersion).toBeGreaterThan(version)
    expect(draftDirty.value).toBe(false)
    expect(admin.saving).toBe(false)
  })

  it('删除必须确认，失败保留地点和对话框，重试成功后移除', async () => {
    const a = { kind: 'building' as const, data: building() }
    edit(a); store.remove(a)
    expect(admin.deleteTarget?.data.id).toBe(a.data.id)
    expect(fetch).not.toHaveBeenCalled()
    store.cancelRemove()
    expect(admin.deleteTarget).toBeNull()
    expect(admin.places.buildings).toHaveLength(1)
    store.remove(a)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: '暂不可用' }), { status: 503 }))
    await store.confirmRemove()
    expect(admin.deleteError).toContain('暂不可用')
    expect(admin.deleteTarget).not.toBeNull()
    expect(admin.places.buildings).toHaveLength(1)
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await store.confirmRemove()
    expect(admin.deleteTarget).toBeNull()
    expect(admin.places.buildings).toHaveLength(0)
    expect(admin.selected).toBeNull()
    expect(admin.draft).toBeNull()
  })

  it('附属轮廓支持新增、绘制、删除与撤销，主体保持不变', () => {
    edit({ kind: 'building', data: building() })
    store.addOutlinePart()
    expect(admin.outlinePart).toBe(1)
    expect(draftIssue.value).toContain('至少需要 3 个点')
    mapPick([121.602, 31.18]); mapPick([121.603, 31.18]); mapPick([121.603, 31.181])
    const draft = admin.draft!.data as Building
    expect(draft.parts?.[0]).toHaveLength(3)
    expect(draft.poly).toEqual(building().poly)
    store.removeOutlinePart()
    expect(draft.parts).toHaveLength(0)
    expect(admin.outlinePart).toBe(0)
    undoGeometry()
    expect(draft.parts?.[0]).toHaveLength(3)
    expect(draftIssue.value).toBe('')
  })

  it('离线模式不允许新增、编辑或删除', () => {
    admin.offline = true
    create('poi'); edit({ kind: 'building', data: building() }); store.remove({ kind: 'building', data: building() })
    expect(admin.draft).toBeNull()
    expect(admin.deleteTarget).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
