// Verify the exact claim: "wrapAnsi('hello\x1b[32mworld\x1b[39mmore', 8) produces row[0]='hello\x1b[3'"

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
      rows.push(w.slice(0, width))  // LINE 33
      w = w.slice(width)             // LINE 34
    }
    cur = w
  }
  flush()
  return rows
}

const input = 'hello\x1b[32mworld\x1b[39mmore'
const result = wrapAnsi(input, 8)

console.log('CLAIM: wrapAnsi produces row[0]="hello\\x1b[3"')
console.log('ACTUAL: wrapAnsi produces row[0]=' + JSON.stringify(result[0]))
console.log('MATCH: ' + (result[0] === 'hello\x1b[3' ? 'YES' : 'NO'))
console.log('')
console.log('Expected by the claim:')
console.log('  row[0] = ' + JSON.stringify('hello\x1b[3'))
console.log('Actual output:')
result.forEach((r, i) => {
  console.log(`  row[${i}] = ${JSON.stringify(r)}`)
})
