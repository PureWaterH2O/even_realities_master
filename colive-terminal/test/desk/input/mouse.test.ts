import { describe, it, expect } from 'vitest'
import { parseSgrMouse, isMouseReport } from '../../../src/desk/input/mouse'

describe('parseSgrMouse', () => {
  it('maps wheel-up (button 64) to -1', () => {
    expect(parseSgrMouse('[<64;10;5M')).toBe(-1)
  })
  it('maps wheel-down (button 65) to 1', () => {
    expect(parseSgrMouse('[<65;10;5M')).toBe(1)
  })
  it('accepts the release form (lowercase m)', () => {
    expect(parseSgrMouse('[<64;1;1m')).toBe(-1)
  })
  it('returns null for a non-wheel button (e.g. left click = 0)', () => {
    expect(parseSgrMouse('[<0;3;4M')).toBeNull()
  })
  it('returns null for a non-mouse sequence (arrow up)', () => {
    expect(parseSgrMouse('[A')).toBeNull()
  })
  it('returns null for plain text', () => {
    expect(parseSgrMouse('hello')).toBeNull()
  })
})

describe('isMouseReport', () => {
  // POSITIVE: every faithful mouse-report form must be identified as a mouse report
  // so the dispatcher can drop it before any key handling.
  it('is true for a clean SGR report (the form parseSgrMouse already catches)', () => {
    expect(isMouseReport('[<8;20;5M')).toBe(true)
    expect(isMouseReport('[<64;1;1m')).toBe(true)
  })
  it('is true for an ESC-prefixed SGR report (double-ESC / meta — Option+click leak)', () => {
    expect(isMouseReport('\x1b[<8;20;5M')).toBe(true)
  })
  it('is true for the split tail of an SGR report (missing the [)', () => {
    expect(isMouseReport('<8;20;5M')).toBe(true)
    expect(isMouseReport('\x1b<8;20;5M')).toBe(true)
  })
  it('is true for a legacy X10 header (with or without leading ESC)', () => {
    expect(isMouseReport('[M')).toBe(true)
    expect(isMouseReport('\x1b[M')).toBe(true)
  })

  // NEGATIVE: must NOT over-match ordinary typed text, or normal typing breaks.
  it('is false for ordinary typed text', () => {
    expect(isMouseReport('5M')).toBe(false) // indistinguishable from typed text — must not match
    expect(isMouseReport('M')).toBe(false)
    expect(isMouseReport('hello')).toBe(false)
    expect(isMouseReport('')).toBe(false)
    expect(isMouseReport('[')).toBe(false)
    expect(isMouseReport('<')).toBe(false)
    expect(isMouseReport('[A')).toBe(false) // arrow-up CSI — not a mouse report
  })
})
