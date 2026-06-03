/**
 * The desk composer's text model: an immutable multi-line buffer with a cursor.
 * Every operation returns a NEW EditBuffer (pure) so it is trivially testable
 * and the React reducer/dispatch in app.tsx never mutates state in place.
 *
 * Named EditBuffer (not Buffer) to avoid shadowing Node's global Buffer.
 */
export interface EditBuffer {
  /** One entry per logical line; always at least one (possibly empty) line. */
  lines: string[]
  /** Cursor line index (0-based). */
  row: number
  /** Cursor column within `lines[row]` (0..line.length). */
  col: number
}

/** Result of a vertical move: the (possibly unchanged) buffer + whether we were already at the edge. */
export interface VerticalMove {
  buffer: EditBuffer
  /** true when the cursor was already on the top (moveUp) / bottom (moveDown) line. */
  atEdge: boolean
}

const WORD_BOUNDARY = /\s/

export const empty = (): EditBuffer => ({ lines: [''], row: 0, col: 0 })

export const toText = (b: EditBuffer): string => b.lines.join('\n')

export const fromText = (s: string): EditBuffer => {
  const lines = s.split('\n')
  const row = lines.length - 1
  return { lines, row, col: lines[row]!.length }
}

export const isBlank = (b: EditBuffer): boolean => b.lines.length === 1 && b.lines[0] === ''

/** Insert arbitrary text at the cursor; embedded "\n" creates new lines (paste path). */
export function insertText(b: EditBuffer, text: string): EditBuffer {
  if (text === '') return b
  const parts = text.split('\n')
  const cur = b.lines[b.row]!
  const before = cur.slice(0, b.col)
  const after = cur.slice(b.col)
  if (parts.length === 1) {
    const line = before + parts[0] + after
    const lines = b.lines.slice()
    lines[b.row] = line
    return { lines, row: b.row, col: b.col + parts[0]!.length }
  }
  const first = before + parts[0]
  const last = parts[parts.length - 1]! + after
  const middle = parts.slice(1, -1)
  const inserted = [first, ...middle, last]
  const lines = [...b.lines.slice(0, b.row), ...inserted, ...b.lines.slice(b.row + 1)]
  const row = b.row + parts.length - 1
  return { lines, row, col: parts[parts.length - 1]!.length }
}

/** Split the current line at the cursor into two lines. */
export function insertNewline(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  const before = cur.slice(0, b.col)
  const after = cur.slice(b.col)
  const lines = [...b.lines.slice(0, b.row), before, after, ...b.lines.slice(b.row + 1)]
  return { lines, row: b.row + 1, col: 0 }
}

export function deleteBackward(b: EditBuffer): EditBuffer {
  if (b.col > 0) {
    const cur = b.lines[b.row]!
    const line = cur.slice(0, b.col - 1) + cur.slice(b.col)
    const lines = b.lines.slice()
    lines[b.row] = line
    return { lines, row: b.row, col: b.col - 1 }
  }
  if (b.row === 0) return b // start of buffer — nothing to delete
  const prev = b.lines[b.row - 1]!
  const cur = b.lines[b.row]!
  const lines = [...b.lines.slice(0, b.row - 1), prev + cur, ...b.lines.slice(b.row + 1)]
  return { lines, row: b.row - 1, col: prev.length }
}

export function deleteWordBackward(b: EditBuffer): EditBuffer {
  if (b.col === 0) return deleteBackward(b)
  const cur = b.lines[b.row]!
  let i = b.col
  while (i > 0 && WORD_BOUNDARY.test(cur[i - 1]!)) i-- // skip trailing spaces
  while (i > 0 && !WORD_BOUNDARY.test(cur[i - 1]!)) i-- // skip the word
  const line = cur.slice(0, i) + cur.slice(b.col)
  const lines = b.lines.slice()
  lines[b.row] = line
  return { lines, row: b.row, col: i }
}

export function moveLeft(b: EditBuffer): EditBuffer {
  if (b.col > 0) return { ...b, col: b.col - 1 }
  if (b.row === 0) return b
  return { ...b, row: b.row - 1, col: b.lines[b.row - 1]!.length }
}

export function moveRight(b: EditBuffer): EditBuffer {
  if (b.col < b.lines[b.row]!.length) return { ...b, col: b.col + 1 }
  if (b.row === b.lines.length - 1) return b
  return { ...b, row: b.row + 1, col: 0 }
}

/** Word move within the current line. Line-scoped: at col 0 this stays put (no wrap to the previous line). */
export function moveWordLeft(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  let i = b.col
  while (i > 0 && WORD_BOUNDARY.test(cur[i - 1]!)) i--
  while (i > 0 && !WORD_BOUNDARY.test(cur[i - 1]!)) i--
  return { ...b, col: i }
}

/** Word move within the current line. Line-scoped: at end-of-line this stays put (no wrap to the next line). */
export function moveWordRight(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  let i = b.col
  while (i < cur.length && WORD_BOUNDARY.test(cur[i]!)) i++
  while (i < cur.length && !WORD_BOUNDARY.test(cur[i]!)) i++
  return { ...b, col: i }
}

export const moveLineStart = (b: EditBuffer): EditBuffer => ({ ...b, col: 0 })
export const moveLineEnd = (b: EditBuffer): EditBuffer => ({ ...b, col: b.lines[b.row]!.length })

export function moveUp(b: EditBuffer): VerticalMove {
  if (b.row === 0) return { buffer: b, atEdge: true }
  const row = b.row - 1
  const col = Math.min(b.col, b.lines[row]!.length)
  return { buffer: { ...b, row, col }, atEdge: false }
}

export function moveDown(b: EditBuffer): VerticalMove {
  if (b.row === b.lines.length - 1) return { buffer: b, atEdge: true }
  const row = b.row + 1
  const col = Math.min(b.col, b.lines[row]!.length)
  return { buffer: { ...b, row, col }, atEdge: false }
}
