// Let's analyze what SHOULD happen when we split colored text
const testString = 'hello\x1b[32mworld\x1b[39mmore'
//                  hello (no color) + \x1b[32m + world (green) + \x1b[39m + more (no color)

// When we split at visible position 8, we're splitting "helloworld" at character 8
// That's: h e l l o w o r | l d m o r e
// Position: 0 1 2 3 4 5 6 7 | 8,9,10,11,12,13

// The colors here are:
// h e l l o  [SET GREEN] w o r l d [RESET COLOR] m o r e
// So when we split, we get:
// Part 1: h e l l o [SET GREEN] w o r  (8 visible chars)
// Part 2: l d [RESET] m o r e (6 visible chars)

// The [SET GREEN] code STARTED before the split but was never closed on that line
// This is inherently problematic - we're splitting a colored word in two

// Let me check: does the original code even claim to handle this correctly?
console.log('Analyzing the test case...')
console.log('Input: hello\\x1b[32mworld\\x1b[39mmore')
console.log('This is: "hello" + GREEN + "world" + RESET + "more"')
console.log('Visible chars: h-e-l-l-o-w-o-r-l-d-m-o-r-e (14 total)')
console.log('')
console.log('When split at width=8:')
console.log('  Row 0 should have 8 visible chars: h,e,l,l,o,w,o,r')
console.log('  Row 1 should have remaining: l,d,m,o,r,e (6 chars)')
console.log('')
console.log('The issue: the GREEN code applies to chars 5-8 in row 0,')
console.log('but the RESET code is on row 1, not row 0.')
console.log('')
console.log('This is unavoidable when splitting colored words.')
