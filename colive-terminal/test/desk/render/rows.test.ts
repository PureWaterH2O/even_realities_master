import { describe, it, expect } from 'vitest'
import { renderBlockRows, flattenRows } from '../../../src/desk/render/rows'
import type { Block } from '../../../src/desk/render/blocks'
import { stripAnsi } from '../../../src/desk/render/ansi'

const opts = { width: 80, verbose: false }

describe('renderBlockRows', () => {
  it('user block renders one labeled row', () => {
    const rows = renderBlockRows({ kind: 'user', text: 'hi there' }, opts)
    expect(rows.map(stripAnsi).join('\n')).toContain('hi there')
  })

  it('tool block collapsed = one summary line; verbose = adds input/output', () => {
    const block: Block = { kind: 'tool', toolId: 't1', name: 'Read', summary: 'read /a', detail: { input: { file_path: '/a' }, output: 'contents' } }
    const collapsed = renderBlockRows(block, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(collapsed).toContain('Read')
    expect(collapsed).not.toContain('contents')
    const verbose = renderBlockRows(block, { width: 80, verbose: true }).map(stripAnsi).join('\n')
    expect(verbose).toContain('contents')
  })

  it('tool head shows the key argument native-style, not the redundant summary', () => {
    const bash: Block = { kind: 'tool', toolId: 't1', name: 'Bash', summary: 'Bash completed', detail: { input: { command: 'touch /tmp/x' }, output: '' } }
    const head = renderBlockRows(bash, opts).map(stripAnsi).join('\n')
    expect(head).toContain('Bash(touch /tmp/x)')
    expect(head).not.toContain('Bash completed') // drop the generic Core summary
  })

  it('tool head extracts file_path for read/edit-family tools', () => {
    const read: Block = { kind: 'tool', toolId: 't1', name: 'Read', summary: 'Read completed', detail: { input: { file_path: '/a/b.ts' }, output: 'x' } }
    expect(renderBlockRows(read, opts).map(stripAnsi).join('\n')).toContain('Read(/a/b.ts)')
  })

  it('edit-family tool renders an inline diff regardless of verbose', () => {
    const block: Block = { kind: 'tool', toolId: 't2', name: 'Edit', summary: 'edit /a.ts', detail: { input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' }, output: 'ok' } }
    const rows = renderBlockRows(block, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(rows).toContain('- x')
    expect(rows).toContain('+ y')
  })

  it('thinking block collapses to a stub when closed and not verbose', () => {
    const open = renderBlockRows({ kind: 'thinking', text: 'a\nb', closed: false }, opts).map(stripAnsi).join('\n')
    expect(open).toContain('a')
    const closed = renderBlockRows({ kind: 'thinking', text: 'a\nb', closed: true }, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(closed).toContain('thinking')
    expect(closed).not.toContain('\nb')
  })

  it('todos block renders distinct glyphs per status (✔ / ▶ / ☐)', () => {
    const rows = renderBlockRows({ kind: 'todos', items: [
      { content: 'Adone', status: 'completed' },
      { content: 'Bnow', status: 'in_progress' },
      { content: 'Csoon', status: 'pending' },
    ] }, opts).map(stripAnsi).join('\n')
    expect(rows).toMatch(/✔\s+Adone/)  // completed
    expect(rows).toMatch(/▶\s+Bnow/)   // in-progress, highlighted
    expect(rows).toMatch(/☐\s+Csoon/)  // pending
  })

  it('assistant renders raw while open, markdown once closed', () => {
    const open = renderBlockRows({ kind: 'assistant', text: '# Title', closed: false }, opts).map(stripAnsi).join('\n')
    expect(open).toContain('# Title') // raw passthrough while streaming (no flicker)
    const closed = renderBlockRows({ kind: 'assistant', text: '# Title', closed: true }, opts).map(stripAnsi).join('\n')
    expect(closed).toContain('Title')
    expect(closed).not.toContain('# Title') // markdown-rendered: the raw # marker is gone
  })
})

describe('flattenRows', () => {
  it('concatenates rows for all blocks in order', () => {
    const rows = flattenRows([{ kind: 'user', text: 'one' }, { kind: 'note', text: 'two' }], opts)
    const text = rows.map(stripAnsi).join('\n')
    expect(text.indexOf('one')).toBeLessThan(text.indexOf('two'))
  })
  it('every produced row fits within width', () => {
    const long = 'word '.repeat(60).trim()
    const rows = flattenRows([{ kind: 'user', text: long }], { width: 20, verbose: false })
    expect(rows.every((r) => stripAnsi(r).length <= 20)).toBe(true)
  })
})
