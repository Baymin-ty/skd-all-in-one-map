import { describe, expect, test } from 'vitest'
import { campusEmailFromPrefix, demoEntryVisible } from './account'

describe('campus email login', () => {
  test('combines a trimmed prefix with the fixed campus domain', () => {
    expect(campusEmailFromPrefix('  zhangsan  ')).toBe('zhangsan@shanghaitech.edu.cn')
  })

  test('rejects a prefix containing an at sign or whitespace', () => {
    expect(campusEmailFromPrefix('zhang san')).toBeNull()
    expect(campusEmailFromPrefix('zhang@san')).toBeNull()
  })

  test('shows the demo entry only before email verification starts', () => {
    expect(demoEntryVisible('email')).toBe(true)
    expect(demoEntryVisible('code')).toBe(true)
    expect(demoEntryVisible('name')).toBe(false)
  })
})
