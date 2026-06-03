import { describe, it, expect } from 'vitest'
import { fuzzyFilter, isSubsequence, scorePath, listProjectFiles, type FileSourceDeps } from '../../../src/desk/input/files'

describe('isSubsequence', () => {
  it('is order-sensitive and case-insensitive', () => {
    expect(isSubsequence('atx', 'app.tsx')).toBe(true)
    expect(isSubsequence('xta', 'app.tsx')).toBe(false)
    expect(isSubsequence('', 'anything')).toBe(true)
  })
})

describe('scorePath', () => {
  it('basename-prefix > basename-substring > path-substring', () => {
    expect(scorePath('x/app.ts', 'app')).toBeGreaterThan(scorePath('x/myapp.ts', 'app'))
    expect(scorePath('x/myapp.ts', 'app')).toBeGreaterThan(scorePath('app/x.ts', 'app'))
  })
  it('non-match scores 0', () => {
    expect(scorePath('readme.md', 'zzz')).toBe(0)
  })
})

describe('fuzzyFilter', () => {
  it('empty query returns the first `limit` paths in order', () => {
    expect(fuzzyFilter(['a', 'b', 'c'], '', 2)).toEqual(['a', 'b'])
  })
  it('ranks a basename hit above a scattered subsequence', () => {
    const r = fuzzyFilter(['x/y/app.tsx', 'a-p-p/z.ts'], 'app', 10)
    expect(r[0]).toBe('x/y/app.tsx')
  })
  it('excludes non-matches', () => {
    expect(fuzzyFilter(['readme.md'], 'zzz', 10)).toEqual([])
  })
  it('honors the limit', () => {
    expect(fuzzyFilter(['app1.ts', 'app2.ts', 'app3.ts'], 'app', 2)).toHaveLength(2)
  })
})

describe('listProjectFiles', () => {
  it('uses git ls-files output (split by line, trimmed, empties dropped)', () => {
    const deps: FileSourceDeps = { gitList: () => 'a.ts\nsrc/b.ts\n\n', walk: () => ['SHOULD_NOT_USE'] }
    expect(listProjectFiles('/x', deps)).toEqual(['a.ts', 'src/b.ts'])
  })
  it('falls back to the walk when git is unavailable (null)', () => {
    const deps: FileSourceDeps = { gitList: () => null, walk: () => ['w/one.ts'] }
    expect(listProjectFiles('/x', deps)).toEqual(['w/one.ts'])
  })
})
