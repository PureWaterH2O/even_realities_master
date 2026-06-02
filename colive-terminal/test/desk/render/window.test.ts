import { describe, it, expect } from 'vitest'
import { computeWindow, scrollPage, scrollLine, pinBottom, afterContentChange, initialViewport } from '../../../src/desk/render/window'

const rows = (n: number) => Array.from({ length: n }, (_, i) => `row${i}`)

describe('viewport window', () => {
  it('pinned shows the last H rows', () => {
    const r = rows(100)
    const w = computeWindow(r, 10, pinBottom(100, 10))
    expect(w.visible).toEqual(r.slice(90, 100))
    expect(w.offset).toBe(90)
    expect(w.total).toBe(100)
    expect(w.pinned).toBe(true)
  })

  it('reaches the MIDDLE of a tall block (row-accurate)', () => {
    const r = rows(100)
    let vp = pinBottom(100, 10)
    vp = scrollPage(vp, 100, 10, -1) // page up once -> offset 80
    vp = scrollPage(vp, 100, 10, -1) // -> 70
    const w = computeWindow(r, 10, vp)
    expect(w.offset).toBe(70)
    expect(w.visible[0]).toBe('row70')
    expect(w.pinned).toBe(false)
  })

  it('page up unpins; paging back to bottom re-pins', () => {
    let vp = pinBottom(50, 10)
    vp = scrollPage(vp, 50, 10, -1)
    expect(vp.pinned).toBe(false)
    vp = scrollPage(vp, 50, 10, 1)
    expect(vp.pinned).toBe(true)
    expect(vp.offset).toBe(40)
  })

  it('content growth follows the bottom only when pinned', () => {
    const pinned = afterContentChange(pinBottom(50, 10), 60, 10)
    expect(pinned.offset).toBe(50)
    const unpinned = afterContentChange({ offset: 20, pinned: false }, 60, 10)
    expect(unpinned.offset).toBe(20)
    expect(unpinned.pinned).toBe(false)
  })

  it('clamps offset within [0, total-H]', () => {
    expect(scrollPage({ offset: 0, pinned: false }, 50, 10, -1).offset).toBe(0)
    expect(scrollPage(pinBottom(5, 10), 5, 10, 1).offset).toBe(0) // total < H
  })

  it('scrollLine moves the window by exactly one row (arrow / wheel)', () => {
    // start pinned at bottom (offset 90), one line up -> 89, unpinned
    let vp = scrollLine(pinBottom(100, 10), 100, 10, -1)
    expect(vp.offset).toBe(89)
    expect(vp.pinned).toBe(false)
    // one more line up -> 88
    vp = scrollLine(vp, 100, 10, -1)
    expect(vp.offset).toBe(88)
    // line down -> 89
    vp = scrollLine(vp, 100, 10, 1)
    expect(vp.offset).toBe(89)
  })

  it('scrollLine clamps and re-pins at the bottom edge', () => {
    // already at top: up stays at 0
    expect(scrollLine({ offset: 0, pinned: false }, 50, 10, -1).offset).toBe(0)
    // one line above bottom: down lands at max and re-pins
    const vp = scrollLine({ offset: 39, pinned: false }, 50, 10, 1)
    expect(vp.offset).toBe(40)
    expect(vp.pinned).toBe(true)
  })
})
