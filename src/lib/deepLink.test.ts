import { describe, expect, it } from 'vitest'
import { buildLink, parseDeepLink } from './deepLink'

const base = 'https://map.example.edu/'
describe('分享链接', () => {
  it('导航、地点、活动三种链接可以来回转换', () => {
    for (const link of [{ kind: 'to', place: '82807efc', room: '1A-108' }, { kind: 'place', place: 'poi-history' }, { kind: 'event', id: 'abc_123' }] as const)
      expect(parseDeepLink(new URL(buildLink(link, base)).search)).toEqual(link.kind === 'event' ? link : { room: undefined, ...link })
    expect(buildLink({ kind: 'to', place: 'e2473fa9', room: '302' }, base)).toBe('https://map.example.edu/?to=e2473fa9&room=302')
  })
  it('不合法的 id 忽略，非编号的房间名不放进链接', () => {
    expect(parseDeepLink('?to=<script>')).toBeNull()
    expect(parseDeepLink('?place=82807efc&room=%3Cb%3E')).toEqual({ kind: 'place', place: '82807efc', room: undefined })
    expect(buildLink({ kind: 'to', place: '90e46c48', room: 'L楼报告厅' }, base)).toBe('https://map.example.edu/?to=90e46c48')
  })
  it('时光机链接可以指定窗口起点，不合法的起点忽略', () => {
    expect(parseDeepLink('?timemachine')).toEqual({ kind: 'timemachine', start: undefined })
    expect(parseDeepLink('?timemachine=best')).toEqual({ kind: 'timemachine', start: 'best' })
    expect(parseDeepLink(new URL(buildLink({ kind: 'timemachine', start: '2026-05-14T08:00' }, base)).search)).toEqual({ kind: 'timemachine', start: '2026-05-14T08:00' })
    expect(parseDeepLink('?timemachine=<b>')).toEqual({ kind: 'timemachine', start: undefined })
  })
  it('兼容原来的 ?event= 链接，导航参数优先', () => {
    expect(parseDeepLink('?event=e1')).toEqual({ kind: 'event', id: 'e1' })
    expect(parseDeepLink('?event=e1&to=lib')).toMatchObject({ kind: 'to', place: 'lib' })
  })
})
