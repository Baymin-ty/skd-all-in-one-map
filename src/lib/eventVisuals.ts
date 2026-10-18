import type { CampusEvent } from './discoveryTypes'

export type EventBadge = { label: string; short: string }

export function isTechathon(event: Pick<CampusEvent, 'id' | 'title'>): boolean {
  return event.id === 'm-techathon-2026' || /techathon|黑客松/i.test(event.title)
}

export function techathonBadge(event: Pick<CampusEvent, 'id' | 'title'>): EventBadge | null {
  return isTechathon(event) ? { label: '今日主活动', short: 'TECHATHON' } : null
}
