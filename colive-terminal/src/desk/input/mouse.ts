/**
 * Pure parser for SGR mouse reports (`\x1b[<{btn};{col};{row}{M|m}`).
 *
 * We enable SGR mouse reporting at the CLI entry point (src/index.ts) and read
 * the raw sequence off ink's internal 'input' channel (App re-emits every
 * non-paste event there verbatim). Only the wheel matters for M3.2A:
 * button 64 = wheel-up, 65 = wheel-down. Everything else (clicks, drags) → null.
 */
const SGR_MOUSE_RE = /^\[<(\d+);\d+;\d+[Mm]$/

/** -1 = scroll up (wheel-up), 1 = scroll down (wheel-down), null = not a wheel event. */
export function parseSgrMouse(seq: string): -1 | 1 | null {
  const m = SGR_MOUSE_RE.exec(seq)
  if (!m) return null
  const button = Number(m[1])
  if (button === 64) return -1
  if (button === 65) return 1
  return null
}
