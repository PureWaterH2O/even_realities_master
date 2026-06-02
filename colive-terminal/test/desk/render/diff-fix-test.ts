import { describe, it } from 'vitest'
import { stripAnsi } from '../../../src/desk/render/ansi'
import { highlight } from '../../../src/desk/render/highlight'
import { green } from '../../../src/desk/render/ansi'

describe('diff fix verification', () => {
  it('shows the problem: stripAnsi removes syntax highlighting', () => {
    const line = 'const y = 2'
    const lang = 'typescript'
    
    // Current (broken) approach
    const highlighted = highlight(line, lang)
    console.log('1. highlight():', JSON.stringify(highlighted))
    
    const stripped = stripAnsi(highlighted)
    console.log('2. stripAnsi():', JSON.stringify(stripped))
    
    const wrapped = green('+ ' + stripped)
    console.log('3. green() wrapper:', JSON.stringify(wrapped))
    
    // Count ANSI in final result
    const finalAnsiCount = (wrapped.match(/\x1b\[[0-9;]*m/g) || []).length
    console.log('4. Final ANSI count:', finalAnsiCount, '(expected >2 if syntax highlighting worked)')
    
    // Proposed fix: skip stripAnsi
    console.log('\n--- PROPOSED FIX ---')
    const fixedResult = green('+ ' + highlighted)
    console.log('Fixed result:', JSON.stringify(fixedResult))
    
    const fixedAnsiCount = (fixedResult.match(/\x1b\[[0-9;]*m/g) || []).length
    console.log('Fixed ANSI count:', fixedAnsiCount, '(should have syntax highlighting codes)')
  })
})
