// src/desk/render/rows.ts
import type { Block, TodoItem } from './blocks'
import { green, red, gray, yellow, dim, italic, bold, bgGray } from './ansi'
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
  Agent: ['description', 'prompt'],
  Task: ['description', 'prompt'],
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
    case 'user': {
      // Native: a full-width dark bar, "› text" in bold, spanning the terminal
      // width (D-003). Pad each visual row to `width` so the dark background runs
      // edge-to-edge; continuation lines align under the text (2-space indent).
      const out: string[] = []
      block.text.split('\n').forEach((ln, i) => {
        const prefix = i === 0 ? '› ' : '  '
        for (const seg of wrapAnsi(prefix + ln, width)) {
          out.push(bgGray(bold(seg.padEnd(width))))
        }
      })
      return out
    }

    case 'assistant': {
      // Native marks every assistant message with a leading green "●" on its first
      // line (D-010/D-011); continuation lines flow at the left margin. Stream raw
      // while open; markdown-render once closed (avoids half-parsed flicker).
      const rendered = block.closed ? renderMarkdown(block.text, width) : block.text
      const rows = toRows(rendered, width)
      if (rows.length === 0) return [`${green('●')} `]
      rows[0] = `${green('●')} ${rows[0]}`
      return rows
    }

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
      // Native-style header: a filled "●" status dot (green ok / red error, D-004)
      // + a natural-language summary (D-005). The Core summary is generic ("Bash
      // completed"), so we synthesise the native form: Read collapses to a count
      // ("Read 1 file"); everything else keeps Name(keyArg) (Bash → command,
      // Write/Edit → path, Agent → description).
      const isErr = /\bfailed\b/i.test(block.summary ?? '')
      const arg = block.detail ? toolArg(block.name, block.detail.input) : ''
      const dot = isErr ? red('●') : green('●')
      // Read collapses to a count ("Read 1 file"); every other tool keeps a bold
      // Name(arg) (Agent shows "Agent(description)", per native). On error the
      // name is tinted red instead of bold.
      let head: string
      if (block.name === 'Read') {
        head = isErr ? red('Read 1 file') : 'Read 1 file'
      } else {
        const name = isErr ? red(block.name) : bold(block.name)
        head = arg ? `${name}(${arg})` : name
      }
      // D-006: a "(ctrl+o to expand)" affordance on collapsed tools; dropped under
      // Ctrl-O verbose, where the full detail is already shown.
      const hint = block.detail && !verbose ? dim(' (ctrl+o to expand)') : ''
      const rows = toRows(`${dot} ${head}${hint}`, width)
      // D-006: a "└" result sub-line for tools with a one-line outcome (Write →
      // "Wrote N lines to <path>"). The numbered body / diff follows below.
      const resultLine = block.detail ? toolResultLine(block.name, block.detail.input) : undefined
      if (resultLine) rows.push(...toRows(dim(`  └ ${resultLine}`), width))
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

    case 'footer':
      // D-007: native turn-completion footer — a dim "✱ <verb> for Ns".
      return toRows(dim(`✱ ${block.verb} for ${block.seconds}s`), width)

    case 'note':
    default:
      return toRows(dim((block as { text: string }).text), width)
  }
}

/**
 * D-006: a one-line "⌐" result summary shown under a tool header. Native renders
 * one for tools with a concrete outcome — currently Write (`Wrote N lines to
 * <path>`). Returns undefined for tools whose outcome lives behind Ctrl-O.
 */
function toolResultLine(name: string, input: unknown): string | undefined {
  if (name !== 'Write' || input === null || typeof input !== 'object') return undefined
  const i = input as Record<string, unknown>
  const path = typeof i.file_path === 'string' ? i.file_path : ''
  const content = typeof i.content === 'string' ? i.content : ''
  const n = content === '' ? 0 : content.replace(/\n$/, '').split('\n').length
  return `Wrote ${n} line${n === 1 ? '' : 's'} to ${path}`
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
