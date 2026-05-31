/**
 * Minimal ambient types for `qrcode-terminal` (it ships no types). Only the
 * `generate` surface we use is declared — we deliberately do NOT read its
 * node_modules to discover a fuller shape.
 */
declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean
  }
  export function generate(
    text: string,
    options?: GenerateOptions,
    callback?: (qr: string) => void,
  ): void
  export function setErrorLevel(level: 'L' | 'M' | 'Q' | 'H'): void
  const _default: { generate: typeof generate; setErrorLevel: typeof setErrorLevel }
  export default _default
}
