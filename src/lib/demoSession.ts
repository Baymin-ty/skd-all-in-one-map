import { dateKey } from './campusTime'
import { demoEventsFor, demoPlanFor } from './demoData'
import { discovery } from './discoveryData'
import { plan, type PlanItem } from './today'
import { readUserData, setUserData } from './userData'

/** Install the curated schedule and activities after the demo session is issued. */
export function initDemoPlan(date = dateKey()) {
  const saved = readUserData<{ items?: PlanItem[] } | null>('today', null)
  const seed = demoPlanFor(date)
  const items = saved && Array.isArray(saved.items) ? [...saved.items] : seed
  const legacyIndex = items.findIndex((item) => item.id === 'demo-event-library')
  const currentEvent = seed.find((item) => item.id === 'm-52f81fe654')
  if (legacyIndex >= 0 && currentEvent) items[legacyIndex] = currentEvent
  plan.items = items
  plan.date = date
  plan.persisted = true
  if (!saved || legacyIndex >= 0) setUserData('today', { items })
  const events = demoEventsFor(date)
  const ids = new Set([...events.map((event) => event.id), 'demo-event-library'])
  discovery.events = [...discovery.events.filter((event) => !ids.has(event.id)), ...events]
}
