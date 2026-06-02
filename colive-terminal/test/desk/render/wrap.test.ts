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

  it('hard-splits a colored token WITHOUT severing an ANSI escape', () => {
    const ESC = String.fromCharCode(27)
    const rows = wrapAnsi(green('aaaaaaaa'), 4) // 8 visible cols, one colored word
    // no visible content lost or invented
    expect(stripAnsi(rows.join(''))).toBe('aaaaaaaa')
    expect(rows.every((r) => stripAnsi(r).length <= 4)).toBe(true)
    // every ESC in every row begins a COMPLETE SGR ("[…m") — never cut mid-escape
    for (const r of rows) {
      for (const after of r.split(ESC).slice(1)) {
        expect(after).toMatch(/^\[[0-9;]*m/)
      }
    }
  })
})
