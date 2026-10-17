import { describe, expect, it } from 'vitest'
import { ACADEMIC_TERMS, formatWeekRanges, parseWeeks, termForDate, teachingWeek } from './academicCalendar'

describe('2026-2027 校历', () => {
  it('包含秋春暑三个学期的起止日期', () => {
    expect(ACADEMIC_TERMS.map((term) => [term.key, term.start, term.end])).toEqual([
      ['2026-autumn', '2026-09-14', '2027-01-17'],
      ['2027-spring', '2027-02-15', '2027-06-20'],
      ['2027-summer', '2027-06-21', '2027-07-18'],
    ])
  })

  it('按校历计算教学周，并能找到日期所属学期', () => {
    expect(termForDate('2026-09-14')?.key).toBe('2026-autumn')
    expect(teachingWeek('2026-09-14', '2026-autumn')).toBe(1)
    expect(teachingWeek('2026-09-20', '2026-autumn')).toBe(1)
    expect(teachingWeek('2026-09-21', '2026-autumn')).toBe(2)
    expect(teachingWeek('2027-02-15', '2027-spring')).toBe(1)
    expect(teachingWeek('2026-09-13', '2026-autumn')).toBeNull()
  })

  it('支持编辑单周、逗号分隔周和连续周范围', () => {
    expect(parseWeeks('1-3, 5，8')).toEqual([1, 2, 3, 5, 8])
  })

  it('展示周次时合并连续区间，避免一长串数字', () => {
    expect(formatWeekRanges([1, 2, 3, 4, 6, 8, 9, 16])).toBe('1–4、6、8–9、16')
    expect(formatWeekRanges([])).toBe('全学期')
  })
})
