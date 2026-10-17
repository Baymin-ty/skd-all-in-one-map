import { formatWeekRanges } from './academicCalendar'

type ScheduleFields = { teacher?: string; weeks?: number[] }

/** 将识别出的附加字段合并成课程备注，避免当前周历模型丢失教学周信息。 */
export function scheduleNote({ teacher, weeks }: ScheduleFields): string | undefined {
  const parts: string[] = []
  if (teacher?.trim()) parts.push(`教师：${teacher.trim()}`)
  const validWeeks = (weeks ?? []).filter((week) => Number.isInteger(week) && week > 0)
  if (validWeeks.length) parts.push(`第 ${formatWeekRanges(validWeeks)} 周`)
  return parts.length ? parts.join('；') : undefined
}
