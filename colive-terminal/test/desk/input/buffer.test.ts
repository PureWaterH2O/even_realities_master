import { describe, it, expect } from 'vitest'
import * as B from '../../../src/desk/input/buffer'

describe('EditBuffer', () => {
  it('empty buffer is one blank line, cursor at 0,0', () => {
    const b = B.empty()
    expect(b.lines).toEqual([''])
    expect(b.row).toBe(0)
    expect(b.col).toBe(0)
    expect(B.isBlank(b)).toBe(true)
  })

  it('insertText appends chars and advances the cursor', () => {
    const b = B.insertText(B.empty(), 'hi')
    expect(B.toText(b)).toBe('hi')
    expect(b.col).toBe(2)
  })

  it('insertText with embedded newlines splits into lines (paste path)', () => {
    const b = B.insertText(B.empty(), 'a\nbb\nc')
    expect(b.lines).toEqual(['a', 'bb', 'c'])
    expect(b.row).toBe(2)
    expect(b.col).toBe(1)
  })

  it('insertNewline splits the current line at the cursor', () => {
    let b = B.insertText(B.empty(), 'abcd')
    b = B.moveLeft(B.moveLeft(b)) // cursor between b and c
    b = B.insertNewline(b)
    expect(b.lines).toEqual(['ab', 'cd'])
    expect(b.row).toBe(1)
    expect(b.col).toBe(0)
  })

  it('deleteBackward removes the char before the cursor', () => {
    const b = B.deleteBackward(B.insertText(B.empty(), 'abc'))
    expect(B.toText(b)).toBe('ab')
    expect(b.col).toBe(2)
  })

  it('deleteBackward at col 0 merges with the previous line', () => {
    const b = B.deleteBackward(B.insertText(B.empty(), 'ab\ncd'))
    // cursor was at end of "cd"; move to start of line 2 first
    const start = B.deleteBackward(B.moveLineStart(B.insertText(B.empty(), 'ab\ncd')))
    expect(start.lines).toEqual(['abcd'])
    expect(start.row).toBe(0)
    expect(start.col).toBe(2)
    expect(B.toText(b)).toBe('ab\nc') // sanity: plain backspace at end deletes 'd'
  })

  it('deleteWordBackward removes the preceding word', () => {
    const b = B.deleteWordBackward(B.insertText(B.empty(), 'foo bar'))
    expect(B.toText(b)).toBe('foo ')
  })

  it('moveLeft/moveRight wrap across line boundaries', () => {
    let b = B.insertText(B.empty(), 'ab\ncd')
    b = B.moveLineStart(b)        // start of "cd" (row 1, col 0)
    b = B.moveLeft(b)             // wrap to end of "ab"
    expect(b.row).toBe(0)
    expect(b.col).toBe(2)
    b = B.moveRight(b)            // wrap back to start of "cd"
    expect(b.row).toBe(1)
    expect(b.col).toBe(0)
  })

  it('moveWordLeft / moveWordRight jump by word within a line', () => {
    let b = B.insertText(B.empty(), 'foo bar baz') // cursor at end
    b = B.moveWordLeft(b)
    expect(b.col).toBe(8) // start of "baz"
    b = B.moveWordRight(b)
    expect(b.col).toBe(11) // end of "baz"
  })

  it('moveLineStart / moveLineEnd', () => {
    let b = B.insertText(B.empty(), 'hello')
    b = B.moveLineStart(b)
    expect(b.col).toBe(0)
    b = B.moveLineEnd(b)
    expect(b.col).toBe(5)
  })

  it('moveUp reports atEdge=true on the top line and leaves the buffer unchanged', () => {
    const b = B.insertText(B.empty(), 'one line')
    const r = B.moveUp(b)
    expect(r.atEdge).toBe(true)
    expect(r.buffer).toEqual(b)
  })

  it('moveDown reports atEdge=true on the bottom line', () => {
    const b = B.insertText(B.empty(), 'one line')
    expect(B.moveDown(b).atEdge).toBe(true)
  })

  it('moveUp inside a multiline buffer moves the cursor and clamps the column', () => {
    const b = B.insertText(B.empty(), 'longline\nx') // cursor row1 col1
    const r = B.moveUp(b)
    expect(r.atEdge).toBe(false)
    expect(r.buffer.row).toBe(0)
    expect(r.buffer.col).toBe(1) // clamped within "longline"
  })

  it('fromText round-trips through toText with the cursor at the end', () => {
    const b = B.fromText('a\nbc')
    expect(B.toText(b)).toBe('a\nbc')
    expect(b.row).toBe(1)
    expect(b.col).toBe(2)
  })
})
