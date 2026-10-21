import { dateKey } from './campusTime'
import { demoPlanFor, obsoleteDemoEventIds } from './demoData'
import { discovery } from './discoveryData'
import { plan, type PlanItem } from './today'
import { readUserData, setUserData } from './userData'

/** Install the curated timetable after the demo session is issued. */
export function initDemoPlan(date = dateKey()) {
  const saved = readUserData<{ items?: PlanItem[] } | null>('today', null)
  const seed = demoPlanFor(date)
  const previous = saved && Array.isArray(saved.items) ? saved.items : seed
  const items = previous.filter((item) => !(item.kind === 'event' && (obsoleteDemoEventIds.has(item.id) || obsoleteDemoEventIds.has(item.eventId ?? ''))))
  plan.items = items
  plan.date = date
  plan.persisted = true
  if (!saved || items.length !== previous.length) setUserData('today', { items })
  // The old showcase reused a real email event ID; preserve the genuine catalog entry.
  discovery.events = discovery.events.filter((event) => !(obsoleteDemoEventIds.has(event.id) && event.source === 'organizer'))
}
