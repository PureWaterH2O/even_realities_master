import { describe, it, expect } from 'vitest'
import { highlight } from './src/desk/render/highlight'
import { stripAnsi } from './src/desk/render/ansi'

describe('highlight debug', () => {
  it('check actual output', () => {
    const out = highlight('const x = 1', 'typescript')
    console.log('out:', JSON.stringify(out))
    console.log('stripAnsi(out):', JSON.stringify(stripAnsi(out)))
    console.log('out === stripAnsi(out):', out === stripAnsi(out))
    console.log('out !== stripAnsi(out):', out !== stripAnsi(out))
    expect(true).toBe(true) // always pass
  })
})
