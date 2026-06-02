// src/desk/render/rows.ts
import type { Block, TodoItem } from './blocks'
import { cyan, green, gray, yellow, dim, italic, bold } from './ansi'
import { wrapAnsi } from './wrap'
import { renderMarkdown } from './markdown'
import { extractEditDiff, renderDiff } from './diff'

export interface RenderOpts {
  width: number
  /** Ctrl-O global verbose: show tool input/output + expand closed thinking. */
  verbose: boolean
}

/** Split a possibly-multiline ANSI string into width-wrapped rows. */
const toRows = (s: string, width: number): string[] =>
  s.split('\n').flatMap((line) => wrapAnsi(line, width))

/** Per-status glyph + line styling for the todos panel (mirrors native's look:
 *  a green check for done, a highlighted arrow for the active item, a dim box
 *  for what's queued). Each entry colors the glyph and the whole line. */
const TODO_STYLE: Record<TodoItem['status'], { glyph: string; line: (s: string) => string }> = {
  completed: { glyph: green('✔'), line: gray },
  in_progress: { glyph: yellow('▶'), line: bold },
  pending: { glyph: dim('☐'), line: dim },
}

export function renderBlockRows(block: Block, opts: RenderOpts): string[] {
  const { width, verbose } = opts
  switch (block.kind) {
    case 'user':
      return toRows(`${cyan('you')}  ${block.text}`, width)

    case 'assistant':
      // stream raw while open; markdown-render once closed (avoids half-parsed flicker)
      return block.closed
        ? toRows(renderMarkdown(block.text, width), width)
        : toRows(`${green('claude')}  ${block.text}`, width)

    case 'thinking': {
      if (!block.closed || verbose) {
        const header = dim(italic('💭 thinking'))
        const body = block.text.split('\n').map((l) => dim(italic(l)))
        return [header, ...body].flatMap((line) => wrapAnsi(line, width))
      }
      const n = block.text.split('\n').length
      return toRows(dim(`💭 thinking (${n} line${n === 1 ? '' : 's'}) — Ctrl-O`), width)
    }

    case 'tool': {
      const head = `${dim('⚙')} ${block.name}${block.summary ? ` — ${block.summary}` : ''}`
      const rows = toRows(dim(head), width)
      // inline diff for edit-family tools (always, not just verbose)
      const diffs = block.detail ? extractEditDiff(block.name, block.detail.input) : undefined
      if (diffs) for (const d of diffs) rows.push(...toRows(renderDiff(d, width), width))
      // verbose: full input/output for any tool (Ctrl-O), pretty-printed + capped
      // so a huge tool result stays scannable instead of one giant JSON line.
      if (verbose && block.detail) {
        rows.push(...renderDetail('input', block.detail.input, width))
        rows.push(...renderDetail('output', block.detail.output, width))
      }
      return rows
    }

    case 'todos': {
      const header = bold('Todos')
      const items = block.items.map((t) => {
        const { glyph, line } = TODO_STYLE[t.status]
        // glyph keeps its own color; the rest of the line gets the status style.
        return `  ${glyph} ${line(t.content)}`
      })
      return [header, ...items].flatMap((line) => wrapAnsi(line, width))
    }

    case 'note':
    default:
      return toRows(dim((block as { text: string }).text), width)
  }
}

/** Render one labelled detail field (input/output) as indented, capped rows. */
function renderDetail(label: string, v: unknown, width: number): string[] {
  const out = [gray(`  ${label}:`)]
  for (const line of previewLines(v, 40)) out.push(gray('    ' + line))
  return out.flatMap((l) => wrapAnsi(l, width))
}

/** A value as pretty-printed lines, capped at `maxLines` with a "…(N more)" tail. */
function previewLines(v: unknown, maxLines: number): string[] {
  let s: string
  if (typeof v === 'string') s = v
  else {
    try {
      s = JSON.stringify(v, null, 2) ?? String(v)
    } catch {
      s = String(v)
    }
  }
  const lines = s.split('\n')
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines), `…(${lines.length - maxLines} more lines)`]
}

/** Flatten every block to a single ANSI row buffer (the viewport input). */
export function flattenRows(blocks: Block[], opts: RenderOpts): string[] {
  return blocks.flatMap((b) => renderBlockRows(b, opts))
}
