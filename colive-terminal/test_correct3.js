// Simpler, clearer fix: iterate through visible chars and track byte position
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length

function sliceAtVisibleWidth(s, visibleWidth) {
  // Return a slice of s that contains exactly visibleWidth visible characters,
  // never splitting an ANSI escape sequence in the middle.
  let bytePos = 0
  let visibleCount = 0
  
  while (bytePos < s.length && visibleCount < visibleWidth) {
    if (s[bytePos] === '\x1b' && s[bytePos + 1] === '[') {
      // Start of an ANSI escape - skip the entire sequence
      while (bytePos < s.length && s[bytePos] !== 'm') {
        bytePos++
      }
      bytePos++ // skip the 'm'
    } else {
      // Regular visible character
      visibleCount++
      bytePos++
    }
  }
  
  return s.slice(0, bytePos)
}

function wrapAnsiFixed(line, width) {
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
      const chunk = sliceAtVisibleWidth(w, width)
      rows.push(chunk)
      w = w.slice(chunk.length)
    }
    cur = w
  }
  flush()
  return rows
}

const testString = 'hello\x1b[32mworld\x1b[39mmore'
console.log('Input:', JSON.stringify(testString))
console.log('Visible length:', vlen(testString))

const result = wrapAnsiFixed(testString, 8)
console.log('\nFixed result rows:')
result.forEach((row, i) => {
  const visible = stripAnsi(row)
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${visible}" (length ${visible.length})`)
})

// Verify all rows have valid escapes
console.log('\nChecking for incomplete escapes:')
let hasIssues = false
result.forEach((row, i) => {
  const matches = row.match(/\x1b\[/g) || []
  const closes = row.match(/m/g) || []
  if (matches.length !== closes.length) {
    console.log(`  Row ${i} has unmatched escapes: ${matches.length} opens, ${closes.length} closes`)
    hasIssues = true
  }
})
if (!hasIssues) {
  console.log('  All rows have balanced ANSI escapes!')
}

// Also test another case
const testString2 = 'a\x1b[32mb\x1b[39mc\x1b[32md\x1b[39me'
console.log('\n\nTest 2:')
console.log('Input:', JSON.stringify(testString2))
const result2 = wrapAnsiFixed(testString2, 3)
console.log('\nFixed result rows (width=3):')
result2.forEach((row, i) => {
  const visible = stripAnsi(row)
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${visible}" (length ${visible.length})`)
})
