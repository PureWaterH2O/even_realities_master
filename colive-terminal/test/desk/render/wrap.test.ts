import { describe, it, expect } from 'vitest'
import { wrapAnsi } from '../../../src/desk/render/wrap'
import { green, stripAnsi } from '../../../src/desk/render/ansi'

describe('wrapAnsi', () => {
  it('splits a long plain line into rows no wider than width', () => {
    const rows = wrapAnsi('aaaa bbbb cccc dddd', 9)
    expect(rows.every((r) => stripAnsi(r).length <= 9)).toBe(true)
    expect(rows.join(' ')).toContain('dddd')
  })
  it('measures width ignoring ANSI codes', () => {
    const rows = wrapAnsi(green('aaaaa') + ' ' + green('bbbbb'), 6)
    expect(rows.length).toBe(2)
    expect(stripAnsi(rows[0])).toBe('aaaaa')
  })
  it('hard-breaks a single token longer than width', () => {
    const rows = wrapAnsi('abcdefghij', 4)
    expect(rows.map(stripAnsi)).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('preserves an empty line as a single empty row', () => {
    expect(wrapAnsi('', 10)).toEqual([''])
  })
})
