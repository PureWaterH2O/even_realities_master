import { describe, it, expect } from 'vitest'
import { extractEditDiff, renderDiff } from '../../../src/desk/render/diff'
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
