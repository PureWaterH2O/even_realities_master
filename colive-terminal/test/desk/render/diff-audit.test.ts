import { describe, it } from 'vitest'
import { renderDiff } from '../../../src/desk/render/diff'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('diff audit: context line highlighting', () => {
  it('shows what context lines actually look like', () => {
    const diff = {
      oldStr: 'const x = 1\nconst y = 2\n',
      newStr: 'const x = 1\nconst y = 3\n',
      lang: 'typescript'
    }
    const output = renderDiff(diff, 80)
    console.log('\n=== RAW ANSI ===')
    console.log(JSON.stringify(output))
    console.log('\n=== STRIPPED ===')
    console.log(stripAnsi(output))
    console.log('\n=== VISUAL ===')
    console.log(output)
  })
})
