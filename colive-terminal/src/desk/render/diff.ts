// src/desk/render/diff.ts
import { diffLines } from 'diff'
import { green, red, gray, stripAnsi } from './ansi'
import { highlight } from './highlight'

export interface DiffInput {
  oldStr: string
  newStr: string
  /** language hint for syntax highlighting, derived from the file extension. */
  lang?: string
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c',
  cpp: 'cpp', sh: 'bash', json: 'json', md: 'markdown', html: 'html',
  css: 'css', yml: 'yaml', yaml: 'yaml',
}
const langOf = (path: unknown): string | undefined => {
  if (typeof path !== 'string') return undefined
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext]
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/**
 * Map an edit-family tool's input to one or more (old,new) diffs, with a
 * language hint. Returns undefined for non-edit tools (the caller renders those
 * as a plain tool line).
 */
export function extractEditDiff(toolName: string, input: unknown): DiffInput[] | undefined {
  const i = rec(input)
  const lang = langOf(i.file_path)
  switch (toolName) {
    case 'Edit':
      return [{ oldStr: str(i.old_string), newStr: str(i.new_string), lang }]
    case 'Write':
      return [{ oldStr: '', newStr: str(i.content), lang }]
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? i.edits : []
      return edits.map((e) => {
        const er = rec(e)
        return { oldStr: str(er.old_string), newStr: str(er.new_string), lang }
      })
    }
    default:
      return undefined
  }
}

/**
 * Render a single (old,new) diff as colored ANSI lines: removed lines red with
 * a "- " gutter, added lines green with "+ ", context dim with "  ". Code is
 * syntax-highlighted per `lang` (added/context lines; removed lines are dimmed).
 */
export function renderDiff(d: DiffInput, _width: number): string {
  const parts = diffLines(d.oldStr, d.newStr)
  const out: string[] = []
  for (const part of parts) {
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop() // drop trailing empty
    for (const line of lines) {
      if (part.added) out.push(green('+ ' + stripAnsi(highlight(line, d.lang))))
      else if (part.removed) out.push(red('- ' + line))
      else out.push(gray('  ' + line))
    }
  }
  return out.join('\n')
}
