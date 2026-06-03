import { describe, it, expect } from 'vitest'
import { parseSgrMouse } from '../../../src/desk/input/mouse'

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
