import { describe, it, expect } from 'vitest'
import { highlight } from '../../../src/desk/render/highlight'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('highlight', () => {
  it('returns the same visible text it was given', () => {
    const out = highlight('const x = 1', 'typescript')
    expect(stripAnsi(out)).toBe('const x = 1')
  })
  it('adds ANSI color for a known language', () => {
    const out = highlight('const x = 1', 'typescript')
    expect(out).not.toBe(stripAnsi(out)) // some escapes were added
  })
  it('falls back to plain text for an unknown language (no throw)', () => {
    const out = highlight('weird ::: code', 'no-such-lang-xyz')
    expect(stripAnsi(out)).toBe('weird ::: code')
  })
})
