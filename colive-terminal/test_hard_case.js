// A harder case: single long word with mid-word ANSI codes
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
      rows.push(w.slice(0, width))  // BUG is here
      w = w.slice(width)
    }
    cur = w
  }
  flush()
  return rows
}

// Single long word with multiple color changes
// A real case from syntax highlighting: variable names in different colors
const word = 'verylongvariablename\x1b[36mwith\x1b[39mcolorsinthe\x1b[32mmiddle\x1b[39mhere'
// visible: verylongvariablenamewithacolorsinthehere (36 chars)

console.log('Input (single word):', JSON.stringify(word))
console.log('Visible text:', stripAnsi(word))
console.log('Visible length:', vlen(word))

const result = wrapAnsi(word, 15)
console.log('\nResult with width=15:')
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
    console.log(`           ${JSON.stringify(r)}`)
    broken = true
  }
})
if (!broken) console.log('  All rows have balanced escapes')
