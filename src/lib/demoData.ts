import type { AccountUser } from './account'
import type { PlanItem } from './today'
import type { CampusEvent } from './discoveryTypes'

export const DEMO_ACCOUNT_ID = 'demo-showcase'

export function isDemoAccount(user: Pick<AccountUser, 'id'> | null | undefined): boolean {
  return user?.id === DEMO_ACCOUNT_ID
}

export function canWriteDemoData(_user: Pick<AccountUser, 'id'> | null | undefined): boolean {
  return true
}

const course = (id: string, title: string, weekdays: number[], start: string, end: string, place: string, room: string, note?: string): PlanItem => ({
  id, kind: 'class', title, weekdays, start, end, place, room, source: 'manual', note,
})

export function demoEventsFor(date: string): CampusEvent[] {
  return [
    { id: 'm-52f81fe654', title: '科道书院 · 新生分享会', start: `${date}T14:30:00+08:00`, end: `${date}T15:30:00+08:00`, allDay: false, venueRaw: '科道书院一楼公共空间', place: 'a747029d', room: '科道书院一楼', floor: 1, organizer: '上科大一图通', category: 'student', source: 'organizer' },
    { id: 'demo-event-walk', title: '校园夜行地图打卡', start: `${date}T19:55:00+08:00`, end: `${date}T20:35:00+08:00`, allDay: false, venueRaw: '体育馆南门', place: 'df290f76', room: '体育馆南门', floor: 1, organizer: '上科大一图通', category: 'campus', source: 'organizer' },
  ]
}

/** A stable showcase schedule based on the timetable screenshot, with two open-slot activities. */
export function demoPlanFor(date: string): PlanItem[] {
  return [
    course('demo-cs181-mon', '人工智能', [1, 3, 6], '08:15', '09:55', '82807efc', '1D-106'),
    course('demo-si252', '强化学习', [2, 4], '08:15', '09:55', 'edb12f3d', '教学中心103'),
    course('demo-cs110', '计算机系统架构（H）', [1, 3, 6], '10:15', '11:55', '82807efc', '2-215'),
    course('demo-cs182', '机器学习引论', [2, 4], '10:15', '11:55', 'edb12f3d', '教学中心203'),
    course('demo-bio1015', '现代生命科学导论', [5, 7], '10:15', '11:55', 'edb12f3d', '教学中心204'),
    course('demo-gepe', '拳击与塑形 I', [3, 6], '13:00', '14:40', 'df290f76', '体育馆B106'),
    course('demo-ai-practice', '技术的应用与反思：在 AI 时代探寻真实智力的定义', [1], '15:55', '17:35', 'edb12f3d', '教学中心403'),
    course('demo-mt1022', '毛泽东思想和中国特色社会主义理论体系概论', [4], '15:55', '17:35', 'edb12f3d', '教学中心202'),
    course('demo-geha', '宋词导读', [1], '18:00', '19:40', '16b2b62d', '创管学院106'),
    { id: 'm-52f81fe654', kind: 'event', title: '科道书院 · 新生分享会', date, start: '14:30', end: '15:30', place: 'a747029d', room: '科道书院一楼', eventId: 'm-52f81fe654', source: 'event', note: '演示活动 · 科道书院分享会' },
    { id: 'demo-event-walk', kind: 'event', title: '校园夜行地图打卡', date, start: '19:55', end: '20:35', place: 'df290f76', room: '体育馆南门', eventId: 'demo-event-walk', source: 'event', note: '演示活动 · 可导航到场' },
  ]
}
