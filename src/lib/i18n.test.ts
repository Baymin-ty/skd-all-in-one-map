import { describe, expect, it } from 'vitest'
import { DICTIONARY, displayText, t } from './i18n'

describe('visitor language dictionary', () => {
  it('has both Chinese and English text for every key', () => {
    for (const value of Object.values(DICTIONARY)) {
      expect(value.zh).toBeTruthy()
      expect(value.en).toBeTruthy()
    }
  })

  it('falls back to Chinese data when an event or place has no translation', () => {
    expect(displayText('中文')).toBe('中文')
    expect(t('event.navigate', 'en')).toBe('Navigate')
  })
})
