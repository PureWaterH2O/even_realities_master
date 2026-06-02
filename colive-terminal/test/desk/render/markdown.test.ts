import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../../src/desk/render/markdown'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('renderMarkdown', () => {
  it('renders a heading without the raw # marker', () => {
    const out = renderMarkdown('# Title', 80)
    expect(stripAnsi(out)).toContain('Title')
    expect(stripAnsi(out)).not.toContain('# Title')
  })
  it('renders bullets and bold (no raw * markers)', () => {
    const out = stripAnsi(renderMarkdown('- one\n- two\n\n**bold**', 80))
    expect(out).toContain('one')
    expect(out).toContain('two')
    expect(out).toContain('bold')
    expect(out).not.toContain('**bold**')
  })
  it('applies ANSI styling (output differs from its plain text)', () => {
    const out = renderMarkdown('# Title', 80)
    expect(out).not.toBe(stripAnsi(out))
  })
})
