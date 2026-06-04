/**
 * The desk composer's @-file source: enumerate project FILENAMES (never contents)
 * for autocomplete, and rank them against a fuzzy query. The IO (git/fs) is
 * dependency-injected so the ranking + selection logic is unit-tested without a
 * real repo. The desk never reads file bodies and never runs a shell — `@path`
 * is delivered to Claude verbatim and Claude reads it with its Read tool.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, type Dirent } from 'node:fs'
import { join, relative } from 'node:path'

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

/** Injectable IO so the ranking/selection logic is unit-tested without a real repo. */
export interface FileSourceDeps {
  /** `git ls-files` stdout for `cwd`, or null if not a git repo / git unavailable. */
  gitList: (cwd: string) => string | null
  /** Fallback file walk (repo-relative paths) when git is unavailable. */
  walk: (cwd: string) => string[]
}

/** Repo-relative candidate paths: git-tracked + untracked-not-ignored, else a bounded walk. */
export function listProjectFiles(cwd: string, deps: FileSourceDeps): string[] {
  const out = deps.gitList(cwd)
  if (out !== null) {
    return out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
  }
  return deps.walk(cwd)
}

/** Real git invocation; returns null on ANY failure (not a repo, git missing, etc.). */
function realGitList(cwd: string): string | null {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git'])
const WALK_CAP = 5000

/** Bounded recursive walk (skips dotdirs + node_modules/.git), repo-relative paths. */
function realWalk(cwd: string): string[] {
  const out: string[] = []
  const stack = [cwd]
  while (stack.length > 0 && out.length < WALK_CAP) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else {
        out.push(relative(cwd, full))
        if (out.length >= WALK_CAP) break
      }
    }
  }
  return out
}

/** Real DI bundle. */
export const realFileSourceDeps: FileSourceDeps = { gitList: realGitList, walk: realWalk }

/** The bound, real file lister the app uses by default (DI'd as a prop in tests). */
export function defaultListFiles(cwd: string): string[] {
  return listProjectFiles(cwd, realFileSourceDeps)
}
