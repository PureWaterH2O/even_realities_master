import { describe, it, expect } from 'vitest'
import { extractEditDiff, renderDiff, renderWriteContent } from '../../../src/desk/render/diff'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('extractEditDiff', () => {
  it('extracts old/new for an Edit', () => {
    const d = extractEditDiff('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' })
    expect(d).toEqual([{ oldStr: 'x', newStr: 'y', lang: 'typescript' }])
  })
  it('treats a Write as all-additions', () => {
    const d = extractEditDiff('Write', { file_path: '/a.md', content: 'hello' })
    expect(d).toEqual([{ oldStr: '', newStr: 'hello', lang: 'markdown' }])
  })
  it('expands MultiEdit into one entry per edit', () => {
    const d = extractEditDiff('MultiEdit', {
      file_path: '/a.ts',
      edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }],
    })
    expect(d?.length).toBe(2)
  })
  it('returns undefined for a non-edit tool', () => {
    expect(extractEditDiff('Bash', { command: 'ls' })).toBeUndefined()
  })
  it('returns undefined for null / non-object input (no phantom empty diff)', () => {
    expect(extractEditDiff('Edit', null)).toBeUndefined()
    expect(extractEditDiff('Edit', undefined)).toBeUndefined()
    expect(extractEditDiff('Edit', 'not an object')).toBeUndefined()
  })
})

describe('renderDiff', () => {
  it('marks removed lines with - and added lines with + (visible text)', () => {
    const out = stripAnsi(renderDiff({ oldStr: 'a\n', newStr: 'b\n' }, 80))
    expect(out).toContain('- a')
    expect(out).toContain('+ b')
  })
  it('colors output (differs from plain text)', () => {
    const out = renderDiff({ oldStr: 'a\n', newStr: 'b\n' }, 80)
    expect(out).not.toBe(stripAnsi(out))
  })
})

describe('renderWriteContent (D-016)', () => {
  it('renders a Write body as native dim-numbered content lines, not a +/- diff', () => {
    const lines = renderWriteContent({ file_path: '/tmp/x.txt', content: 'hello from m3.5' })
    expect(lines.map(stripAnsi)).toEqual(['    1 hello from m3.5'])
    expect(lines[0]).not.toContain('+ ') // not a green-plus diff
  })
  it('right-aligns multi-digit line numbers and drops a trailing newline', () => {
    const lines = renderWriteContent({ content: Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n' })
    expect(lines).toHaveLength(10)
    expect(stripAnsi(lines[0]!)).toBe('     1 line 1')   // gutter width 2 → " 1"
    expect(stripAnsi(lines[9]!)).toBe('    10 line 10')
  })
  it('returns [] for missing/non-string content', () => {
    expect(renderWriteContent({ file_path: '/x' })).toEqual([])
    expect(renderWriteContent(null)).toEqual([])
  })
})
