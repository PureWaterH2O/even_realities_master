import { describe, it, expect } from 'vitest'
import * as H from '../../../src/desk/input/history'

describe('appendEntry (dedup + cap)', () => {
  it('appends a new entry (chronological: newest last)', () => {
    expect(H.appendEntry(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('drops a consecutive duplicate', () => {
    expect(H.appendEntry(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
  it('ignores blank/whitespace entries', () => {
    expect(H.appendEntry(['a'], '   ')).toEqual(['a'])
  })
  it('caps at the limit, dropping the oldest', () => {
    expect(H.appendEntry(['x', 'y'], 'z', 2)).toEqual(['y', 'z'])
  })
})

describe('history navigation', () => {
  it('initNav starts at the draft position (index === length)', () => {
    const nav = H.initNav(['a', 'b'])
    expect(nav.index).toBe(2)
  })
  it('prev (↑) walks newest→oldest, stashing the draft on first press', () => {
    let nav = H.initNav(['old', 'new'])
    let r = H.prev(nav, 'my draft')
    expect(r.text).toBe('new')
    nav = r.nav
    r = H.prev(nav, 'new')
    expect(r.text).toBe('old')
  })
  it('next (↓) walks back toward the draft and restores it past the newest', () => {
    let nav = H.initNav(['old', 'new'])
    let up = H.prev(H.prev(nav, 'draft').nav, 'new') // now at "old"
    let r = H.next(up.nav, 'old')
    expect(r.text).toBe('new')
    r = H.next(r.nav, 'new')
    expect(r.text).toBe('draft') // restored the stashed draft
  })
  it('prev on empty history is a no-op (keeps the current text)', () => {
    const r = H.prev(H.initNav([]), 'draft')
    expect(r.text).toBe('draft')
  })
})

describe('memoryHistoryStore (test double)', () => {
  it('append then load round-trips per key', () => {
    const store = H.memoryHistoryStore()
    store.append('proj-a', 'one')
    store.append('proj-a', 'two')
    store.append('proj-b', 'other')
    expect(store.load('proj-a')).toEqual(['one', 'two'])
    expect(store.load('proj-b')).toEqual(['other'])
    expect(store.load('unknown')).toEqual([])
  })
})
