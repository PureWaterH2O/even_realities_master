// Test the specific issue mentioned
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
    // word itself may exceed width -> hard split on visible chars
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

// Test case from the issue: hello\x1b[32mworld\x1b[39mmore with width 8
const testString = 'hello\x1b[32mworld\x1b[39mmore'
console.log('Input:', JSON.stringify(testString))
console.log('Visible length:', vlen(testString))

const result = wrapAnsi(testString, 8)
console.log('Result rows:')
result.forEach((row, i) => {
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${stripAnsi(row)}" (length ${stripAnsi(row).length})`)
})

// Check if we have incomplete escapes
console.log('\nChecking for incomplete escapes:')
result.forEach((row, i) => {
  const escapePattern = /\x1b\[[0-9;]*m/g
  const matches = row.match(/\x1b\[/g) || []
  const closes = row.match(/m/g) || []
  if (matches.length !== closes.length) {
    console.log(`  Row ${i} has unmatched escapes: ${matches.length} opens, ${closes.length} closes`)
  }
})
