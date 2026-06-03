import { describe, it, expect } from 'vitest'
import { filterSlash, atContext, type MenuItem } from '../../../src/desk/input/menu'
import { slashMenuItems } from '../../../src/desk/slash'

const ITEMS: MenuItem[] = slashMenuItems()

describe('slashMenuItems', () => {
  it('exposes the existing commands with descriptions', () => {
    const names = ITEMS.map((i) => i.name)
    expect(names).toContain('clear')
    expect(names).toContain('help')
    expect(ITEMS.find((i) => i.name === 'clear')?.desc).toMatch(/new session/i)
  })

  it('exposes the mouse-mode commands (/select, /scroll) with descriptions', () => {
    const names = ITEMS.map((i) => i.name)
    expect(names).toContain('select')
    expect(names).toContain('scroll')
    expect(ITEMS.find((i) => i.name === 'select')?.desc).toMatch(/select|copy/i)
    expect(ITEMS.find((i) => i.name === 'scroll')?.desc).toMatch(/scroll/i)
  })
})

describe('filterSlash', () => {
  it('returns all items for a bare "/"', () => {
    expect(filterSlash('/', ITEMS)?.length).toBe(ITEMS.length)
  })
  it('filters by prefix (case-insensitive)', () => {
    const r = filterSlash('/CL', ITEMS)
    expect(r?.map((i) => i.name)).toEqual(['clear'])
  })
  it('returns null when the text is not a single slash token (has a space)', () => {
    expect(filterSlash('/clear now', ITEMS)).toBeNull()
  })
  it('returns null when the text does not start with "/"', () => {
    expect(filterSlash('hello', ITEMS)).toBeNull()
  })
  it('returns null when nothing matches the prefix', () => {
    expect(filterSlash('/zzz', ITEMS)).toBeNull()
  })
})

describe('atContext', () => {
  it('returns the @-token under the cursor at end of token', () => {
    expect(atContext('see @src/app', 12)).toEqual({ query: 'src/app', start: 4, end: 12 })
  })
  it('bare "@" gives an empty query (lists everything)', () => {
    expect(atContext('@', 1)).toEqual({ query: '', start: 0, end: 1 })
  })
  it('works mid-token (cursor inside the path)', () => {
    expect(atContext('@app', 2)).toEqual({ query: 'app', start: 0, end: 4 })
  })
  it('returns null when the cursor is not in an @-token', () => {
    expect(atContext('hello world', 5)).toBeNull()
  })
  it('returns null right after a completed @token + space', () => {
    expect(atContext('@a ', 3)).toBeNull()
  })
  it('picks the token under the cursor when multiple @ exist', () => {
    expect(atContext('@a @b', 5)).toEqual({ query: 'b', start: 3, end: 5 })
  })
})
