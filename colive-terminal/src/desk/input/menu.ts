/**
 * Pure slash-menu filtering. The completion popup is open exactly when the
 * composer holds a single leading-"/" token (no spaces / newlines) that matches
 * at least one command. app.tsx owns the highlight index; this module only
 * decides the visible item list. The popup widget itself is reused by M3.2B's
 * @-file autocomplete.
 */
export interface MenuItem {
  name: string
  desc: string
}

/**
 * Returns the filtered items when `text` is an open slash-menu context, else null.
 * - text must be a single token beginning with "/" (no whitespace).
 * - "/" alone lists everything; "/cl" filters by prefix (case-insensitive).
 * - no matches ⇒ null (menu closed).
 */
export function filterSlash(text: string, items: MenuItem[]): MenuItem[] | null {
  if (!text.startsWith('/')) return null
  if (/\s/.test(text)) return null
  const prefix = text.slice(1).toLowerCase()
  const matches = items.filter((i) => i.name.toLowerCase().startsWith(prefix))
  return matches.length > 0 ? matches : null
}

/** The active "@"-mention token under the cursor on a single line. */
export interface AtContext {
  /** Text after the "@" (the fuzzy query; "" right after a bare "@"). */
  query: string
  /** Column where the "@" starts (inclusive). */
  start: number
  /** Column where the token ends (exclusive). */
  end: number
}

/**
 * Detect an "@"-file token under the cursor. The token is the whitespace-delimited
 * run surrounding `col`; it is an "@" context iff that run begins with "@".
 * Returns null when the cursor is not inside an "@"-token. The "@" never spans
 * lines, so this operates on a single line + column.
 */
export function atContext(line: string, col: number): AtContext | null {
  let start = col
  while (start > 0 && !/\s/.test(line[start - 1]!)) start--
  let end = col
  while (end < line.length && !/\s/.test(line[end]!)) end++
  if (line[start] !== '@') return null
  return { query: line.slice(start + 1, end), start, end }
}
