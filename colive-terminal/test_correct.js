// Demonstrate the fix: visible-character-aware slicing
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length

// Corrected version: slice based on visible characters
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
      // NEW: slice based on visible character boundaries
      let visibleCount = 0
      let slicePos = 0
      for (let i = 0; i < w.length; i++) {
        const char = w[i]
        // Check if we're at the start of an ANSI escape
        if (char === '\x1b' && w[i + 1] === '[') {
          // Find the end of this escape sequence (ends with 'm')
          let j = i + 2
          while (j < w.length && w[j] !== 'm') j++
          // Skip the entire escape sequence
          i = j
          continue
        }
        // Regular visible character
        visibleCount++
        if (visibleCount === width) {
          slicePos = i + 1
          break
        }
      }
      // If we never hit width (edge case), use everything
      if (slicePos === 0) slicePos = w.length
      
      rows.push(w.slice(0, slicePos))
      w = w.slice(slicePos)
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
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${stripAnsi(row)}" (length ${stripAnsi(row).length})`)
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

// Verify visible widths
console.log('\nVerifying visible widths:')
result.forEach((row, i) => {
  const visible = stripAnsi(row)
  console.log(`  Row ${i}: visible length = ${visible.length} (expected <= 8)`)
})
