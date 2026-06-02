// Proper fix: visible-character-aware slicing
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
      // FIXED: slice based on visible character boundaries, not byte positions
      let visibleCount = 0
      let slicePos = 0
      for (let i = 0; i < w.length; i++) {
        // Check if we're at the start of an ANSI escape
        if (w[i] === '\x1b' && w[i + 1] === '[') {
          // Skip to the end of the escape sequence (ends with 'm')
          while (i < w.length && w[i] !== 'm') {
            i++
          }
          // i is now at 'm', loop will increment to next char after 'm'
        } else {
          // Regular visible character
          visibleCount++
          if (visibleCount === width) {
            slicePos = i + 1
            break
          }
        }
      }
      if (slicePos === 0) slicePos = w.length
      rows.push(w.slice(0, slicePos))
      w = w.slice(slicePos)
    }
    cur = w
  }
  flush()
  return rows
}

const word = 'verylongvariablename\x1b[36mwith\x1b[39mcolorsinthe\x1b[32mmiddle\x1b[39mhere'

console.log('Input (single word):', JSON.stringify(word))
console.log('Visible text:', stripAnsi(word))
console.log('Visible length:', vlen(word))

const result = wrapAnsiFixed(word, 15)
console.log('\nFixed result with width=15:')
result.forEach((r, i) => {
  console.log(`  [${i}] ${JSON.stringify(r)}`)
  console.log(`       visible: "${stripAnsi(r)}" (len=${stripAnsi(r).length})`)
})

console.log('\nChecking for broken escapes:')
let broken = false
result.forEach((r, i) => {
  const opens = (r.match(/\x1b\[/g) || []).length
  const closes = (r.match(/m/g) || []).length
  if (opens !== closes) {
    console.log(`  Row ${i}: BROKEN - ${opens} opens vs ${closes} closes`)
    broken = true
  }
})
if (!broken) console.log('  All rows have balanced escapes!')
