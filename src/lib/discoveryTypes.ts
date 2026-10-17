import type { I18nText, LngLat } from './types'

export type EventCat =
  | 'lecture' | 'conference' | 'culture' | 'student' | 'career'
  | 'library' | 'international' | 'wellbeing' | 'campus' | 'other'

export interface CampusEvent {
  id: string
  title: string
  title_en?: string
  desc_en?: string
  start: string
  end: string | null
  allDay: boolean
  venueRaw: string
  place: string | null
  room: string
  floor: number | null
  unmapped?: string
  organizer: string
  speaker?: string
  category: EventCat
  source: 'official' | 'email' | 'organizer'
  sourceId?: string
  status?: 'active' | 'cancelled'
  cancelledAt?: number
  url?: string
}

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'allday' | 'night'
/** a size / style with its own price: 小份 / 大份, 汤 / 干拌, 200g / 300g … */
export interface DishSpec {
  zh: string
  en?: string
  price: number | null
}
export interface Dish {
  id: string
  stall?: string
  zh: string
  en?: string
  /** lowest price when there are specs; null = not on the menu board */
  price?: number | null
  /** Third-party menu snapshot, shown explicitly as a reference price. */
  referencePrice?: boolean
  specs?: DishSpec[]
  /** what the price buys: 12只, 50g, 碗 … */
  unit?: string
  tags?: string[]
  meals?: Meal[]
  /** weekly menu (自选, daily specials): the dates it is served → at which meals ([] = whenever the counter is open).
   *  Dishes without it are on the menu every day. */
  days?: Record<string, Meal[]>
  /** sub-heading inside the counter's menu: 大荤 / 小荤 / 素菜, 6 元档, 包子馒头, 披萨 … */
  group?: I18nText
  photo?: string
  /** when the photo was taken (YYYY-MM-DD) */
  photoDate?: string
  desc?: I18nText
  /** placeholder menu until the canteen provides the real one */
  sample?: boolean
  soldOut?: boolean
  source?: string
  /** transcription doubt (admin only) */
  verify?: string
}
/** a counter inside an outlet (档口) */
export interface Stall {
  id: string
  zh: string
  en?: string
  aliases?: string[]
  note?: I18nText
  /** photos of the menu board */
  photos?: string[]
  /** the menu changes every day (自选) */
  daily?: boolean
  /** the weekly menu's first and last day (YYYY-MM-DD), when the stall's dishes carry `days` */
  week?: [string, string]
}
export interface Outlet {
  id: string
  zh: string
  en: string
  floor: string
  hours: [string, string, Meal][] | null
  lastOrder?: Partial<Record<Meal, string>>
  closures: [string, string][]
  stalls: Stall[]
  dishes: Dish[]
  note?: I18nText
  aliases?: string[]
  /** menu not entered yet (the outlet is listed so it can be found) */
  menuPending?: boolean
  /** when the menu photos were taken */
  menuDate?: string
}
export interface Canteen {
  id: string
  zh: string
  en: string
  aliases?: string[]
  place: string
  pos: LngLat
  outlets: Outlet[]
}

