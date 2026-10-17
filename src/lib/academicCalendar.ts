import { timestamp } from './campusTime'

export type AcademicTermKey = '2026-autumn' | '2027-spring' | '2027-summer'
export interface AcademicTerm { key: AcademicTermKey; label: string; start: string; end: string; weeks: number }

/** 上科大 2026–2027 校历（印刷版）：学期边界按校历日期固定。 */
export const ACADEMIC_TERMS: AcademicTerm[] = [
  { key: '2026-autumn', label: '2026–2027 秋学期', start: '2026-09-14', end: '2027-01-17', weeks: 18 },
  { key: '2027-spring', label: '2026–2027 春学期', start: '2027-02-15', end: '2027-06-20', weeks: 18 },
  { key: '2027-summer', label: '2026–2027 暑学期', start: '2027-06-21', end: '2027-07-18', weeks: 4 },
]

export function termForDate(date: string) {
  return ACADEMIC_TERMS.find((term) => date >= term.start && date <= term.end)
}

export function termByKey(key?: string) {
  return ACADEMIC_TERMS.find((term) => term.key === key)
}

export function teachingWeek(date: string, termKey: string) {
  const term = termByKey(termKey)
  if (!term || date < term.start || date > term.end) return null
  return Math.floor((timestamp(date) - timestamp(term.start)) / 86_400_000 / 7) + 1
}

export function formatWeeks(weeks?: number[]) {
  return (weeks ?? []).filter((week) => Number.isInteger(week) && week > 0).join(',')
}

/** 面向用户展示教学周次：连续周合并成区间，空值代表整学期。 */
export function formatWeekRanges(weeks?: number[]) {
  const values = [...new Set((weeks ?? []).filter((week) => Number.isInteger(week) && week > 0))].sort((a, b) => a - b)
  if (!values.length) return '全学期'
  const ranges: string[] = []
  let start = values[0]
  let end = values[0]
  for (const week of values.slice(1)) {
    if (week === end + 1) end = week
    else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`)
      start = end = week
    }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`)
  return ranges.join('、')
}

export function parseWeeks(value: string) {
  const values = value.split(/[,，、\s]+/).flatMap((part) => {
    const range = part.match(/^(\d+)\s*[-~至]\s*(\d+)$/)
    if (range) {
      const start = Number(range[1]), end = Number(range[2])
      return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)
    }
    const week = Number(part)
    return Number.isInteger(week) ? [week] : []
  })
  return [...new Set(values)].filter((week) => week >= 1 && week <= 52).sort((a, b) => a - b)
}
