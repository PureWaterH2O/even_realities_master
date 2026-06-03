// src/desk/render/ansi.ts
/** Minimal ANSI SGR helpers so the desk can emit pre-colored rows into ink
 *  <Text> nodes without pulling in chalk. Color codes reset with 39/49; style
 *  codes reset with their specific off-code. */
const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`
export const green = sgr(32, 39)
export const red = sgr(31, 39)
export const cyan = sgr(36, 39)
export const yellow = sgr(33, 39)
export const gray = sgr(90, 39)
export const dim = sgr(2, 22)
export const bold = sgr(1, 22)
export const italic = sgr(3, 23)
export const inverse = sgr(7, 27)
/** Strip every CSI/SGR sequence — used for width measurement and tests. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')
