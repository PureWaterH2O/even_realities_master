// What the comment likely means: never sever an ANSI escape sequence in the middle
// This prevents corruption like "hello\x1b[3" (incomplete escape)

// BROKEN case: current implementation
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length

function wrapAnsiBroken(line, width) {
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

// Test: does the broken version sever ANSI codes mid-sequence?
const input = 'hello\x1b[32mworld\x1b[39mmore'
const result = wrapAnsiBroken(input, 8)

console.log('BROKEN version - checking if escapes are SEVERED mid-sequence:')
result.forEach((r, i) => {
  // Check if row ends with incomplete escape (e.g., "hello\x1b[3")
  const endsWithPartialEscape = /\x1b\[/.test(r) && !/m$/.test(r)
  const startsWithPartialEscape = /^\[/.test(stripAnsi(r)) && /\x1b$/.test(r.slice(0, -1))
  
  if (endsWithPartialEscape) {
    console.log(`  Row ${i} ends with SEVERED escape: ${JSON.stringify(r)}`)
  }
  if (startsWithPartialEscape) {
    console.log(`  Row ${i} starts with SEVERED escape: ${JSON.stringify(r)}`)
  }
})

console.log('\nAnalysis:')
console.log('Row 0 = ' + JSON.stringify(result[0]))
console.log('  Ends with: ...\\x1b[3 <- This is a SEVERED escape code!')
console.log('  The sequence \\x1b[32m (cyan) is split as \\x1b[3 and 2m')
