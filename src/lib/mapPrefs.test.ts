import { describe, expect, it } from 'vitest'
import { defaultMapPrefs, labelsForMode, normalizeMapPrefs, removeMapPlace, setMapLabel, setMapMode, type MapPrefs } from './mapPrefs'
import { allMapLabels, defaultMapLabels } from './mapLabelCategories'

const base = (): MapPrefs => defaultMapPrefs()

describe('mapPrefs', () => {
  it('keeps independent label visibility for all and mine modes', () => {
    const prefs = base()
    const all = setMapLabel(prefs, 'all', 'transport', true)
    const mine = setMapLabel(all, 'mine', 'transport', true)

    expect(labelsForMode(mine, 'all').transport).toBe(true)
    expect(labelsForMode(mine, 'mine').transport).toBe(true)
    expect(labelsForMode(mine, 'all')).not.toBe(labelsForMode(mine, 'mine'))
    expect(defaultMapLabels().transport).toBe(false)
  })

  it('changes mode without sharing mutable state', () => {
    const prefs = base()
    const next = setMapMode(prefs, 'mine')

    expect(next.mode).toBe('mine')
    expect(prefs.mode).toBe('all')
    expect(next.labels.all).toEqual(prefs.labels.all)
    expect(next.labels.all).not.toBe(prefs.labels.all)
  })

  it('normalizes malformed records and removes places whose ids no longer exist', () => {
    const raw = {
      mode: 'mine', labels: { all: allMapLabels(true), mine: allMapLabels(false) },
      places: [{ id: 'dorm', role: 'dorm', place: 'missing' }, { id: 'lab', role: 'lab', place: 'building-1', room: '101' }, { id: 'bad', role: 'x', place: '' }],
      markers: [{ id: 'm', pos: [121.6, 31.18], name: '树下', icon: 'pin' }, { id: 'bad', pos: [1], name: '', icon: 'nope' }],
    }
    const prefs = normalizeMapPrefs(raw, new Set(['building-1']))

    expect(prefs.mode).toBe('mine')
    expect(prefs.places).toEqual([{ id: 'lab', role: 'lab', place: 'building-1', room: '101' }])
    expect(prefs.markers).toEqual([{ id: 'm', pos: [121.6, 31.18], name: '树下', icon: 'pin' }])
  })

  it('removes a place by its stable record id', () => {
    const prefs = { ...base(), places: [{ id: 'dorm', role: 'dorm' as const, place: 'building-1' }] }
    const next = removeMapPlace(prefs, 'dorm')
    expect(next.places).toEqual([])
    expect(prefs.places).toHaveLength(1)
  })
})
