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
  it('preserves single newlines as hard breaks (D-030: line-per-line counting)', () => {
    // Native keeps a line-by-line response (e.g. counting) one item per line after
    // the turn closes. Default markdown reflow collapses single \n into spaces.
    const out = stripAnsi(renderMarkdown('1\n2\n3\n4\n5', 80))
    expect(out).not.toContain('1 2 3 4 5')
    const lines = out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    expect(lines).toEqual(['1', '2', '3', '4', '5'])
  })
  it('still collapses paragraph word-wrap (breaks:true only affects explicit newlines)', () => {
    // A normal prose paragraph (no embedded newlines) must still reflow to width —
    // breaks:true must not turn ordinary wrapping into one-word-per-line.
    const out = stripAnsi(renderMarkdown('the quick brown fox jumps', 80))
    expect(out).toContain('the quick brown fox jumps')
  })
})
