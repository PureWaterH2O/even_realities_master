// src/desk/render/wrap.ts
import { stripAnsi } from './ansi'

/** Visible length of a string (ANSI escapes don't count). */
const vlen = (s: string): number => stripAnsi(s).length

/**
 * Hard-wrap one logical line to `width` visible columns, ANSI-aware.
 * Greedy word-wrap; a single word longer than width is hard-split. ANSI codes
 * are kept inline (we never split inside an escape because we split on spaces or
 * on visible-character boundaries of plain text). Returns >=1 row; '' -> [''].
 *
 * NOTE: blocks that carry their own ANSI styling (markdown, highlighted code)
 * are wrapped by their producing library to `width` already and pass through
 * here as already-short lines; this function is the safety net + plain-text path.
 */
export function wrapAnsi(line: string, width: number): string[] {
  if (width <= 0) return [line]
  if (vlen(line) <= width) return [line]
  const rows: string[] = []
  let cur = ''
  const flush = () => { rows.push(cur); cur = '' }
  for (const word of line.split(' ')) {
    const sep = cur === '' ? '' : ' '
    if (vlen(cur) + sep.length + vlen(word) <= width) {
      cur += sep + word
      continue
    }
    if (cur !== '') flush()
    // word itself may exceed width -> hard split on visible chars
    let w = word
    while (vlen(w) > width) {
      rows.push(w.slice(0, width))
      w = w.slice(width)
    }
    cur = w
  }
  flush()
  return rows
}
