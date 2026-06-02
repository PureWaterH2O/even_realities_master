// src/desk/render/rows.ts
import type { Block, TodoItem } from './blocks'
import { cyan, green, red, gray, yellow, dim, italic, bold } from './ansi'
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

/** The most relevant input key to surface per tool, native-style: Name(arg). */
const TOOL_ARG_KEYS: Record<string, string[]> = {
  Bash: ['command'],
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  LS: ['path'],
  WebFetch: ['url'],
  WebSearch: ['query'],
}
const ARG_FALLBACK = ['file_path', 'command', 'pattern', 'path', 'url', 'query']

/** Pull the key argument from a tool's input, collapsed to one line + capped. */
function toolArg(name: string, input: unknown): string {
  if (input === null || typeof input !== 'object') return ''
  const rec = input as Record<string, unknown>
  for (const k of TOOL_ARG_KEYS[name] ?? ARG_FALLBACK) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim().length > 0) {
      const oneLine = v.replace(/\s+/g, ' ').trim()
      return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine
    }
  }
  return ''
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
      // Native-style header: a status dot + Name(keyArg). The Core summary is
      // generic ("Bash completed"), so we surface the actual argument instead
      // and only fall back to the bare name when no arg is extractable.
      const isErr = /\bfailed\b/i.test(block.summary ?? '')
      const arg = block.detail ? toolArg(block.name, block.detail.input) : ''
      const dot = isErr ? red('⏺') : green('⏺')
      const name = isErr ? red(block.name) : block.name
      const head = arg ? `${dot} ${name}(${dim(arg)})` : `${dot} ${name}`
      const rows = toRows(head, width)
      // inline diff for edit-family tools (always, not just verbose); a no-op
      // diff renders nothing (skip the empty string so no phantom blank row).
      const diffs = block.detail ? extractEditDiff(block.name, block.detail.input) : undefined
      if (diffs) {
        for (const d of diffs) {
          const rendered = renderDiff(d, width)
          if (rendered !== '') rows.push(...toRows(rendered, width))
        }
      }
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
