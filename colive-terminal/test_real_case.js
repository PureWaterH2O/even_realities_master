// Test a real highlighted code case
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
      rows.push(w.slice(0, width))  // BUG: treats width as byte position!
      w = w.slice(width)
    }
    cur = w
  }
  flush()
  return rows
}

// Simulate a syntax-highlighted token like cli-highlight might produce
// Python code: def foo(bar):  with various syntax coloring
const highlighted = 'def\x1b[36m \x1b[39mfoo\x1b[36m(\x1b[39mbar\x1b[36m)\x1b[39m:'
console.log('Highlighted code:', JSON.stringify(highlighted))
console.log('Visible text:', stripAnsi(highlighted))
console.log('Visible length:', vlen(highlighted))

const result = wrapAnsi(highlighted, 10)
console.log('\nResult with width=10:')
result.forEach((r, i) => {
  console.log(`  [${i}] ${JSON.stringify(r)} => visible: "${stripAnsi(r)}"`)
})

console.log('\nChecking for broken escapes:')
let broken = false
result.forEach((r, i) => {
  const opens = (r.match(/\x1b\[/g) || []).length
  const closes = (r.match(/m/g) || []).length
  if (opens !== closes) {
    console.log(`  Row ${i}: ${opens} opens vs ${closes} closes - BROKEN`)
    broken = true
  }
})
if (!broken) console.log('  All rows have balanced escapes')
