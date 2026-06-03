/**
 * The desk composer's @-file source: enumerate project FILENAMES (never contents)
 * for autocomplete, and rank them against a fuzzy query. The IO (git/fs) is
 * dependency-injected so the ranking + selection logic is unit-tested without a
 * real repo. The desk never reads file bodies and never runs a shell — `@path`
 * is delivered to Claude verbatim and Claude reads it with its Read tool.
 */

/** Case-insensitive subsequence test: do all chars of `q` appear in `s` in order? */
export function isSubsequence(q: string, s: string): boolean {
  if (q === '') return true
  const ql = q.toLowerCase()
  const sl = s.toLowerCase()
  let i = 0
  for (let j = 0; j < sl.length && i < ql.length; j++) {
    if (sl[j] === ql[i]) i++
  }
  return i === ql.length
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

/** Rank score (higher = better); 0 means "no match" (excluded by fuzzyFilter). */
export function scorePath(path: string, q: string): number {
  if (q === '') return 1
  const ql = q.toLowerCase()
  const base = basename(path).toLowerCase()
  if (base.startsWith(ql)) return 4
  if (base.includes(ql)) return 3
  if (path.toLowerCase().includes(ql)) return 2
  if (isSubsequence(q, path)) return 1
  return 0
}

/** Top-`limit` candidates for `query`, best first. Empty query -> first `limit` paths. */
export function fuzzyFilter(paths: string[], query: string, limit: number): string[] {
  if (query === '') return paths.slice(0, limit)
  return paths
    .map((p) => ({ p, s: scorePath(p, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length || a.p.localeCompare(b.p))
    .slice(0, limit)
    .map((x) => x.p)
}
