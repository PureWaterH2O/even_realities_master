// Final verification of the bug
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length

function wrapAnsi(line, width) {
  if (width <= 0) return [line]
  if (vlen(line) <= width) return [line]
  const rows = []
  let cur = ''
  const flush = () => { rows.push(cur); cur = '' }
  for (const word of line.split(' ')) {
    const sep = cur === '' ? '' : ' '
    if (vlen(cur) + sep.length + vlen(word) <= width) {
      cur += sep + word
      continue
    }
    if (cur !== '') flush()
    let w = word
    while (vlen(w) > width) {
      rows.push(w.slice(0, width))
      w = w.slice(width)
    }
    cur = w
  }
  flush()
  return rows
}

// Exact example from the issue claim
console.log('ISSUE CLAIM TEST:')
console.log('=================')
const exactExample = 'hello\x1b[32mworld\x1b[39mmore'
const result = wrapAnsi(exactExample, 8)
console.log('Input: wrapAnsi("hello\\x1b[32mworld\\x1b[39mmore", 8)')
console.log('row[0] = ' + JSON.stringify(result[0]))
console.log('Claim: row[0] should be "hello\\x1b[3"')
console.log('Match: ' + (result[0] === 'hello\x1b[3' ? 'YES - BUG CONFIRMED' : 'NO'))
