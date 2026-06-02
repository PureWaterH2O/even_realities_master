import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vitest 4 transforms .tsx via oxc, which defaults to React's automatic JSX
  // runtime (matches tsconfig "jsx": "react-jsx") — no extra jsx config needed.
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Force chalk's color level ON under test. marked-terminal + cli-highlight
    // gate ANSI on TTY detection (chalk), and vitest's stdout is not a TTY, so
    // without this the M3.1 render tests see plain text and "output has ANSI"
    // assertions fail — while the real `colive desk` terminal (a TTY) DOES get
    // color. Setting FORCE_COLOR makes tests exercise the same colored path the
    // live app uses. (Verified: the pre-existing 237 tests still pass with this.)
    env: { FORCE_COLOR: '3' },
  },
})
