// Better fix: preserve ANSI codes that started before width boundary
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const vlen = (s) => stripAnsi(s).length

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
      // Slice based on visible character boundaries, preserving complete ANSI escapes
      let visibleCount = 0
      let slicePos = 0
      let inEscape = false
      let escapeStart = -1
      
      for (let i = 0; i < w.length; i++) {
        const char = w[i]
        
        // Track if we're inside an ANSI escape sequence
        if (char === '\x1b' && w[i + 1] === '[') {
          inEscape = true
          escapeStart = i
          // Skip to end of escape
          while (i < w.length && w[i] !== 'm') i++
          continue
        }
        
        // Regular visible character
        if (!inEscape) {
          visibleCount++
          if (visibleCount === width) {
            slicePos = i + 1
            break
          }
        }
      }
      
      // If we never reached width, take everything
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
  const visible = stripAnsi(row)
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${visible}" (length ${visible.length})`)
})

// Also test another case: code with embedded escapes
const testString2 = 'a\x1b[32mb\x1b[39mc\x1b[32md\x1b[39me'
console.log('\n\nTest 2:')
console.log('Input:', JSON.stringify(testString2))
console.log('Visible length:', vlen(testString2))

const result2 = wrapAnsiFixed(testString2, 3)
console.log('\nFixed result rows (width=3):')
result2.forEach((row, i) => {
  const visible = stripAnsi(row)
  console.log(`  [${i}] = ${JSON.stringify(row)}`)
  console.log(`      visible: "${visible}" (length ${visible.length})`)
})
