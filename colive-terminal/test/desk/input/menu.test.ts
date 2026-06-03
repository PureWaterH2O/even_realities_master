import { describe, it, expect } from 'vitest'
import { filterSlash, type MenuItem } from '../../../src/desk/input/menu'
import { slashMenuItems } from '../../../src/desk/slash'

const ITEMS: MenuItem[] = slashMenuItems()

describe('slashMenuItems', () => {
  it('exposes the existing commands with descriptions', () => {
    const names = ITEMS.map((i) => i.name)
    expect(names).toContain('clear')
    expect(names).toContain('help')
    expect(ITEMS.find((i) => i.name === 'clear')?.desc).toMatch(/new session/i)
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
