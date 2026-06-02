// src/desk/render/wrap.ts
import { stripAnsi } from './ansi'

/** Visible length of a string (ANSI escapes don't count). */
const vlen = (s: string): number => stripAnsi(s).length

const ESC = String.fromCharCode(27)

/**
 * Split `s` after exactly `width` VISIBLE characters, copying any ANSI escape
 * sequences whole (never cut mid-escape). Returns [head, tail].
 */
function splitVisible(s: string, width: number): [string, string] {
  let i = 0
  let visible = 0
  while (i < s.length && visible < width) {
    if (s[i] === ESC && s[i + 1] === '[') {
      const end = s.indexOf('m', i)
      if (end === -1) break // malformed escape — stop here, take the rest as head
      i = end + 1 // copy the whole SGR sequence; it costs no visible width
    } else {
      i += 1
      visible += 1
    }
  }
  return [s.slice(0, i), s.slice(i)]
}

/**
 * Hard-wrap one logical line to `width` visible columns, ANSI-aware.
 * Greedy word-wrap; a single word longer than width is hard-split on VISIBLE
 * character boundaries (never inside an ANSI escape). Returns >=1 row; '' -> [''].
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
    // word itself may exceed width -> hard split on visible chars, ANSI-safe
    let w = word
    while (vlen(w) > width) {
      const [head, tail] = splitVisible(w, width)
      if (head === '') break // no progress (e.g. all-escape) — avoid an infinite loop
      rows.push(head)
      w = tail
    }
    cur = w
  }
  flush()
  return rows
}
