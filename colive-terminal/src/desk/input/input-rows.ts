/**
 * Render an EditBuffer to terminal rows with a visible cursor.
 *
 * - The first line is prefixed with "› " (U+203A, native Claude's prompt glyph);
 *   continuation lines with "  " so the text columns align.
 * - The cursor is drawn as an inverse-video cell on the character under it; at
 *   end-of-line it is an inverse space appended after the text.
 * - One visual row per logical line. (Soft-wrapping long single lines is
 *   deferred — see spec §9 risks; multiline is the headline, not 200-col lines.)
 */
import type { EditBuffer } from './buffer'
import { inverse } from '../render/ansi'

export interface InputRowOpts {
  width: number
}

export function renderInputRows(buf: EditBuffer, _opts: InputRowOpts): string[] {
  return buf.lines.map((line, row) => {
    const prefix = row === 0 ? '› ' : '  '
    if (row !== buf.row) return prefix + line
    const col = buf.col
    const under = col < line.length ? line[col]! : ' '
    return prefix + line.slice(0, col) + inverse(under) + line.slice(col + 1)
  })
}
