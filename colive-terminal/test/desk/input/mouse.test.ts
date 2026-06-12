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
  it('is false for [M…-prefixed text that is NOT a bare X10 header', () => {
    // The real legacy X10 header is ALWAYS exactly `[M` (the 3 coordinate bytes arrive as a
    // SEPARATE event), so the header predicate must match `[M` EXACTLY — not as a prefix. Text
    // delivered as a single useInput event that merely starts with `[M` must NOT be dropped.
    expect(isMouseReport('[Mood]')).toBe(false)
    expect(isMouseReport('[Markdown](x)')).toBe(false)
    expect(isMouseReport('[My note')).toBe(false)
    expect(isMouseReport('\x1b[Mood]')).toBe(false)
  })
})

describe('parseSgrClick (click-to-position, UAT 2026-06-12)', () => {
  it('parses a left-button PRESS into 1-based {col, row}', async () => {
    const { parseSgrClick } = await import('../../../src/desk/input/mouse')
    expect(parseSgrClick('[<0;13;42M')).toEqual({ col: 13, row: 42 })
  })
  it('tolerates a leading ESC (the internal-channel form)', async () => {
    const { parseSgrClick } = await import('../../../src/desk/input/mouse')
    expect(parseSgrClick('\x1b[<0;5;6M')).toEqual({ col: 5, row: 6 })
  })
  it('returns null for release, wheel, drag, and plain text', async () => {
    const { parseSgrClick } = await import('../../../src/desk/input/mouse')
    expect(parseSgrClick('[<0;5;6m')).toBeNull() // release
    expect(parseSgrClick('[<64;5;6M')).toBeNull() // wheel
    expect(parseSgrClick('[<32;5;6M')).toBeNull() // drag/motion
    expect(parseSgrClick('hello')).toBeNull()
  })
})
