// src/desk/render/window.ts
export interface ViewportState {
  /** Index of the first visible row. */
  offset: number
  /** True when tracking the bottom (streaming auto-follows). */
  pinned: boolean
}

export interface WindowResult {
  visible: string[]
  offset: number
  total: number
  pinned: boolean
}

const maxOffset = (total: number, height: number): number => Math.max(0, total - height)
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export const initialViewport = (): ViewportState => ({ offset: 0, pinned: true })

export const pinBottom = (total: number, height: number): ViewportState => ({
  offset: maxOffset(total, height),
  pinned: true,
})

export function computeWindow(rows: string[], height: number, vp: ViewportState): WindowResult {
  const total = rows.length
  const off = vp.pinned ? maxOffset(total, height) : clamp(vp.offset, 0, maxOffset(total, height))
  return { visible: rows.slice(off, off + height), offset: off, total, pinned: vp.pinned }
}

/** Scroll by `step` rows; negative = up, positive = down. Re-pins at the bottom. */
function scrollBy(vp: ViewportState, total: number, height: number, step: number): ViewportState {
  const max = maxOffset(total, height)
  const base = vp.pinned ? max : vp.offset
  const offset = clamp(base + step, 0, max)
  return { offset, pinned: offset >= max }
}

/** Scroll by one page; dir -1 = up, +1 = down. Re-pins when it lands at bottom. */
export function scrollPage(vp: ViewportState, total: number, height: number, dir: -1 | 1): ViewportState {
  return scrollBy(vp, total, height, dir * height)
}

/**
 * Scroll by `lines` rows (default 1); dir -1 = up, +1 = down. Arrow keys and the
 * mouse-wheel land here — bumping `lines` makes a wheel notch travel further.
 */
export function scrollLine(
  vp: ViewportState,
  total: number,
  height: number,
  dir: -1 | 1,
  lines = 1,
): ViewportState {
  return scrollBy(vp, total, height, dir * lines)
}

/** After the row buffer changes: follow bottom if pinned, else hold (clamped). */
export function afterContentChange(vp: ViewportState, total: number, height: number): ViewportState {
  const max = maxOffset(total, height)
  if (vp.pinned) return { offset: max, pinned: true }
  return { offset: clamp(vp.offset, 0, max), pinned: false }
}
