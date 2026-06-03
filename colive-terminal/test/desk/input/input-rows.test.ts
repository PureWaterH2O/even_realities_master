import { describe, it, expect } from 'vitest'
import { renderInputRows } from '../../../src/desk/input/input-rows'
import * as B from '../../../src/desk/input/buffer'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('renderInputRows', () => {
  it('renders a single line with the "> " prompt and a trailing cursor cell', () => {
    const rows = renderInputRows(B.insertText(B.empty(), 'hi'), { width: 80 })
    expect(rows).toHaveLength(1)
    expect(stripAnsi(rows[0]!)).toBe('> hi ') // trailing space is the cursor cell at end-of-line
  })

  it('renders one visual row per logical line; continuation lines are indented', () => {
    const rows = renderInputRows(B.fromText('one\ntwo'), { width: 80 })
    expect(rows).toHaveLength(2)
    expect(stripAnsi(rows[0]!)).toBe('> one')
    expect(stripAnsi(rows[1]!)).toBe('  two ') // cursor at end of "two"
    expect(rows[0]).not.toContain('[7m') // non-cursor row must carry no inverse cell
  })

  it('places the cursor (inverse video) on the char under it, not only at the end', () => {
    let b = B.insertText(B.empty(), 'abc')
    b = B.moveLeft(b) // cursor on "c"
    const row = renderInputRows(b, { width: 80 })[0]!
    expect(stripAnsi(row)).toBe('> abc') // no extra trailing cell when cursor is mid-line
    expect(row).toContain('[7m') // inverse SGR present (the cursor cell)
  })
})
