import { describe, it, expect } from 'vitest'
import { green, red, dim, cyan, bold, italic, gray, stripAnsi } from '../../../src/desk/render/ansi'

describe('ansi helpers', () => {
  it('wraps text in SGR codes and resets', () => {
    expect(green('x')).toBe('\x1b[32mx\x1b[39m')
    expect(red('y')).toBe('\x1b[31my\x1b[39m')
  })
  it('stripAnsi removes all escape sequences (for width math)', () => {
    expect(stripAnsi(green(bold('hi')))).toBe('hi')
  })
})
