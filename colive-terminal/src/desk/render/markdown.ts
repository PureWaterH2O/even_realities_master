// src/desk/render/markdown.ts
import { Marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

/**
 * Render Markdown to an ANSI string sized to `width`. marked-terminal handles
 * headings/lists/bold/blockquotes and uses cli-highlight for fenced code. We
 * configure once per width (cheap) and parse synchronously.
 */
export function renderMarkdown(md: string, width: number): string {
  const m = new Marked()
  // 🧪 VERIFIED (marked 12.0.2 + marked-terminal 7.3.0): `showSectionPrefix: false`
  // is REQUIRED — it defaults true, which PREPENDS the literal "# " to headings
  // (so UAT A4 "not raw #" fails without it). reflowText wraps to `width`.
  m.use(markedTerminal({ width, reflowText: true, showSectionPrefix: false }) as Parameters<typeof m.use>[0])
  const out = m.parse(md, { async: false }) as string
  // marked appends a trailing newline; trim it so row-flattening is exact.
  return out.replace(/\n+$/,'')
}
