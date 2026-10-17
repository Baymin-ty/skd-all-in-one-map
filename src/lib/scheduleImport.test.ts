import { describe, expect, it } from 'vitest'
import { scheduleNote } from './scheduleImport'

describe('课表截图导入字段', () => {
  it('保留教师和教学周次，避免识别结果在确认导入时丢失', () => {
    expect(scheduleNote({ teacher: '李老师', weeks: [1, 2, 4] })).toBe('教师：李老师；第 1–2、4 周')
    expect(scheduleNote({ teacher: '', weeks: [] })).toBeUndefined()
  })
})
