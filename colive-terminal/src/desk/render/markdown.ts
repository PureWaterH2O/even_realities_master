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
  // tab:2 tightens marked-terminal's default 4-space list/blockquote indent so
  // it reads like native rather than deeply nested. The custom `blockquote`
  // prepends a gray vertical bar (the default is just gray-italic with no marker,
  // so quotes are indistinguishable from body text) and dims the quoted lines.
  m.use(
    markedTerminal({
      width,
      reflowText: true,
      showSectionPrefix: false,
      tab: 2,
      blockquote: (text: string) =>
        text
          .split('\n')
          .map((l) => `\x1b[90m▌\x1b[39m \x1b[2;3m${l.replace(/^\s+/, '')}\x1b[0m`)
          .join('\n'),
    }) as Parameters<typeof m.use>[0],
  )
  let out = m.parse(md, { async: false }) as string
  // marked-terminal hardcodes "* " as the unordered bullet; swap to a cleaner
  // middot. The marker sits literally after the indent (no ANSI between), so an
  // anchored per-line match is safe — highlighted code/table rows have ANSI or
  // box chars right after the indent and won't match.
  out = out.replace(/^(\s*)\* /gm, '$1• ')
  // marked appends a trailing newline; trim it so row-flattening is exact.
  return out.replace(/\n+$/, '')
}
