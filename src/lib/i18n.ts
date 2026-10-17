import { computed, reactive } from 'vue'

export type Lang = 'zh' | 'en'
export const DICTIONARY = {
  'event.navigate': { zh: '导航', en: 'Navigate' },
  'event.location': { zh: '地点待确认', en: 'Location to be confirmed' },
  'event.cancelled': { zh: '已取消', en: 'Cancelled' },
  'route.title': { zh: '步行导航', en: 'Walking directions' },
  'route.from': { zh: '选择起点', en: 'Choose a starting point' },
  'route.to': { zh: '选择终点', en: 'Choose a destination' },
  'route.myLocation': { zh: '从我的位置出发', en: 'Start from my location' },
  'place.share': { zh: '分享', en: 'Share' },
  'search.placeholder': { zh: '搜楼、点位、教室、活动或菜品', en: 'Search buildings, rooms, events or food' },
  'location.denied': { zh: '定位未开启', en: 'Location access is off' },
  'visitor.at': { zh: '我在：', en: "I'm at:" },
} as const
export type TranslationKey = keyof typeof DICTIONARY

function browserLang(): Lang {
  return typeof navigator !== 'undefined' && !/^zh/i.test(navigator.language) ? 'en' : 'zh'
}
export const locale = reactive({ value: 'zh' as Lang })
export function detectLanguage(search = typeof window === 'undefined' ? '' : window.location.search) {
  const forced = new URLSearchParams(search).get('lang')
  locale.value = forced === 'en' || forced === 'zh' ? forced : browserLang()
  return locale.value
}
export const isEnglish = computed(() => locale.value === 'en')
export function setLanguage(value: Lang) { locale.value = value; try { localStorage.setItem('stmap.lang', value) } catch {} }
export function t(key: TranslationKey, language = locale.value) { return DICTIONARY[key][language] || DICTIONARY[key].zh }
export function displayText(zh: string, en?: string) { return locale.value === 'en' && en ? en : zh }

detectLanguage()
