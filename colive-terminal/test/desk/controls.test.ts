import { describe, it, expect } from 'vitest'
import { MODEL_CHOICES, MODE_CHOICES, actionForCommand, menuForCommand } from '../../src/desk/controls'

describe('controls', () => {
  it('MODEL_CHOICES carry friendly labels + real ids', () => {
    expect(MODEL_CHOICES.map((c) => c.value)).toContain('claude-opus-4-8')
    expect(MODEL_CHOICES.map((c) => c.value)).toContain('claude-sonnet-4-6')
    // UAT 2026-06-12: the curated fallback list was stale — no Fable 5.
    expect(MODEL_CHOICES.map((c) => c.value)).toContain('claude-fable-5')
    expect(MODEL_CHOICES.find((c) => c.value === 'claude-opus-4-8')?.name).toMatch(/opus/i)
  })
  it('MODE_CHOICES are exactly default/acceptEdits/plan', () => {
    expect(MODE_CHOICES.map((c) => c.value)).toEqual(['default', 'acceptEdits', 'plan'])
  })
  it('menuForCommand returns the value list for an exact picker command, else null', () => {
    expect(menuForCommand('/model')).toBe(MODEL_CHOICES)
    expect(menuForCommand('/mode')).toBe(MODE_CHOICES)
    expect(menuForCommand('/mod')).toBeNull()    // incomplete -> slash menu still filters
    expect(menuForCommand('/help')).toBeNull()
    expect(menuForCommand('hello')).toBeNull()
  })
  it('actionForCommand maps picker commands to their control action, else null', () => {
    expect(actionForCommand('/model')).toBe('setModel')
    expect(actionForCommand('/mode')).toBe('setMode')
    expect(actionForCommand('/mod')).toBeNull()
    expect(actionForCommand('hello')).toBeNull()
  })
})
