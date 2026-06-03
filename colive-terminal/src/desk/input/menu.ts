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
