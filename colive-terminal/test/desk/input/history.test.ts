import { describe, it, expect } from 'vitest'
import * as H from '../../../src/desk/input/history'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('fileHistoryStore (temp-dir round-trip — never touches the real home dir)', () => {
  it('append then load round-trips and collapses a consecutive duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'colive-hist-'))
    try {
      const store = H.fileHistoryStore(dir)
      store.append('proj', 'one')
      store.append('proj', 'one') // append-only log writes it; load must collapse it
      store.append('proj', 'two')
      expect(store.load('proj')).toEqual(['one', 'two'])
      expect(store.load('missing')).toEqual([]) // unknown key
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('load applies consecutive-dedup defensively and skips corrupt lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'colive-hist-'))
    try {
      // sanitize('proj') === 'proj' (alphanumerics only) -> proj.jsonl
      const file = join(dir, 'proj.jsonl')
      writeFileSync(
        file,
        [JSON.stringify('a'), JSON.stringify('a'), 'not-json', JSON.stringify('b')].join('\n') + '\n',
        'utf8',
      )
      expect(H.fileHistoryStore(dir).load('proj')).toEqual(['a', 'b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('appendEntry purity', () => {
  it('does not mutate the input array', () => {
    const arr = ['a']
    const out = H.appendEntry(arr, 'b')
    expect(arr).toEqual(['a'])
    expect(out).toEqual(['a', 'b'])
  })
})
