// src/desk/render/highlight.ts
import { highlight as cliHighlight } from 'cli-highlight'

/**
 * Syntax-highlight a code string to ANSI. Safe by construction: an unknown
 * language or any throw falls back to the original plain text. `cli-highlight`
 * auto-detects when `language` is omitted/unknown via `ignoreIllegals`.
 */
export function highlight(code: string, language?: string): string {
  try {
    return cliHighlight(code, { language, ignoreIllegals: true })
  } catch {
    return code
  }
}
