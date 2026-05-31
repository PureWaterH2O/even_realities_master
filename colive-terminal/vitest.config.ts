import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vitest 4 transforms .tsx via oxc, which defaults to React's automatic JSX
  // runtime (matches tsconfig "jsx": "react-jsx") — no extra jsx config needed.
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
})
