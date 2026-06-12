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

// Any mouse report, tolerating a leading ESC and the [ that ink may strip. Two encodings:
//  - SGR `<btn;col;row{M|m}`, optionally with a leading `[` (full `[<…M`) and/or ESC. This
//    also matches the split tail `<…M` that arrives when the escape-flush timer fires mid-report.
//  - Legacy X10 header, which is ALWAYS exactly `[M` (optionally ESC-prefixed): ink's input
//    parser treats `M` as the CSI final byte, so the 3 coordinate bytes ALWAYS arrive as a
//    SEPARATE following event. The header is therefore matched EXACTLY (end-anchored `$`), not
//    as a prefix — otherwise ordinary text like `[Mood]` / `[Markdown](x)` delivered as a single
//    event would over-match and be silently dropped.
// Both are anchored at start AND end so they cannot match ordinary typed text — note we deliberately
// require the `<` (or full `[M`) so a bare `"5M"`/`"M"` (indistinguishable from typed text) never matches.
const SGR_REPORT_RE = /^\x1b?\[?<\d+;\d+;\d+[Mm]$/
const X10_HEADER_RE = /^\x1b?\[M$/

/**
 * True iff `seq` is any mouse report (SGR or legacy X10), tolerating an optional leading ESC
 * (and, for SGR, an optionally-missing `[`). The input dispatcher uses this as the broad
 * "drop any mouse report before key handling" gate; `parseSgrMouse` stays the narrow wheel
 * decoder. Returns false for ordinary typed text (e.g. `"5M"`, `"M"`, `"<"`, `"["`, `""`).
 */
export function isMouseReport(seq: string): boolean {
  return SGR_REPORT_RE.test(seq) || X10_HEADER_RE.test(seq)
}

// A left-button PRESS (button 0, final byte M) with its 1-based coordinates.
// Releases (m), wheel (64/65), and drag/motion (32+) deliberately don't match —
// only the press positions the composer cursor (click-to-position).
const SGR_CLICK_RE = /^\x1b?\[?<0;(\d+);(\d+)M$/

/**
 * Parse a left-click press into its 1-based terminal {col, row}, or null for
 * anything else. Tolerates the leading ESC / optionally-missing `[` exactly
 * like {@link isMouseReport} (the internal-channel and split-tail forms).
 */
export function parseSgrClick(seq: string): { col: number; row: number } | null {
  const m = SGR_CLICK_RE.exec(seq)
  if (!m) return null
  return { col: Number(m[1]), row: Number(m[2]) }
}
