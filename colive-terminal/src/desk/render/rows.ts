// src/desk/render/rows.ts
import type { Block, TodoItem } from './blocks'
import { cyan, green, gray, dim, italic, bold } from './ansi'
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

const TODO_MARK: Record<TodoItem['status'], string> = {
  completed: '[x]',
  in_progress: '[~]',
  pending: '[ ]',
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
      return toRows(dim(`💭 thinking (${n} lines) — Ctrl-O`), width)
    }

    case 'tool': {
      const head = `${dim('⚙')} ${block.name}${block.summary ? ` — ${block.summary}` : ''}`
      const rows = toRows(dim(head), width)
      // inline diff for edit-family tools (always, not just verbose)
      const diffs = block.detail ? extractEditDiff(block.name, block.detail.input) : undefined
      if (diffs) for (const d of diffs) rows.push(...toRows(renderDiff(d, width), width))
      // verbose: raw input/output for any tool
      if (verbose && block.detail) {
        rows.push(...toRows(gray('  input:  ' + safeJson(block.detail.input)), width))
        rows.push(...toRows(gray('  output: ' + safeJson(block.detail.output)), width))
      }
      return rows
    }

    case 'todos': {
      const header = bold('Todos')
      const items = block.items.map((t) => {
        const line = `  ${TODO_MARK[t.status]} ${t.content}`
        return t.status === 'completed' ? gray(line) : t.status === 'in_progress' ? green(line) : line
      })
      return [header, ...items].flatMap((line) => wrapAnsi(line, width))
    }

    case 'note':
    default:
      return toRows(dim((block as { text: string }).text), width)
  }
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Flatten every block to a single ANSI row buffer (the viewport input). */
export function flattenRows(blocks: Block[], opts: RenderOpts): string[] {
  return blocks.flatMap((b) => renderBlockRows(b, opts))
}
