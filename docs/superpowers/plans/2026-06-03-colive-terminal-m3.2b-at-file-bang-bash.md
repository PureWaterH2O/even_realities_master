# Co-Live Terminal M3.2B — `@`-file autocomplete + `!`bash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mid-line `@`-file fuzzy autocomplete and a whole-line `!`bash affordance to the desk composer, as pure typing aids that produce clean text Claude acts on (its Read / Bash tools) — with **zero Core/Hub change**.

**Architecture:** New pure/DI'd input modules (`files.ts` file source + fuzzy ranker; `atContext` in `menu.ts`; `replaceRange` in `buffer.ts`; `formatBashPrompt` + a `bash` result kind in `slash.ts`). `app.tsx` gains a unified completion menu (the existing slash menu OR the new `@`-file menu — mutually exclusive) with a *dismissed* flag so Esc closes the `@` menu without nuking a half-typed line, plus a `bash` dispatch in `submitLine`. The desk reads **filenames only** (`git ls-files`, walk fallback) — never file contents, never a shell. Self-tested via the preview/screenshot rig before hardware UAT.

**Tech Stack:** TypeScript, React 19, ink 7.0.5, vitest 4, ink-testing-library. Commands run from `colive-terminal/`.

**Spec:** `docs/superpowers/specs/2026-06-03-colive-terminal-m3.2b-at-file-bang-bash-design.md`

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `src/desk/input/files.ts` | **new** | File source (`git ls-files` → walk fallback, DI'd) + pure fuzzy ranker. No ink. |
| `src/desk/input/menu.ts` | modify | add pure `atContext(line, col)`; `filterSlash` untouched. No ink. |
| `src/desk/input/buffer.ts` | modify | add `replaceRange(b, start, end, str)` to the immutable `EditBuffer`. |
| `src/desk/slash.ts` | modify | add `BashResult` to `InterpretedInput`; pure `formatBashPrompt`; `!`-branch in `interpretInput`. |
| `src/desk/app.tsx` | modify | DI'd `listFiles`; unified slash/`@` menu (derive + render + nav + Esc-dismiss); `bash` dispatch + history record. |
| `test/preview/replay.tsx` | modify | `capture()` accepts an optional `AppConfig` (to inject the file list). |
| `test/preview/m32b.preview.test.tsx` | **new** | Keystroke-driven preview frames for the `@` menu + `!`bash (self-test before UAT). |
| `scripts/screenshots.sh` | modify | add the M3.2B frame→PNG entries. |
| `projects/colive-terminal/m3.2b-uat-runbook.md` | **new** | UAT walk C1–C6 (filled in Task 10). |

Test files mirror source paths under `test/` (e.g. `test/desk/input/files.test.ts`).

---

### Task 1: `EditBuffer.replaceRange`

**Files:**
- Modify: `src/desk/input/buffer.ts`
- Test: `test/desk/input/buffer.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('EditBuffer', …)` block in `test/desk/input/buffer.test.ts`:

```ts
  it('replaceRange swaps a column span on the cursor line and lands the cursor after it', () => {
    const b = { lines: ['see @ap and more'], row: 0, col: 7 }
    const r = B.replaceRange(b, 4, 7, '@src/app.tsx')
    expect(B.toText(r)).toBe('see @src/app.tsx and more')
    expect(r.col).toBe(4 + '@src/app.tsx'.length)
  })

  it('replaceRange only touches the cursor row in a multi-line buffer', () => {
    const b = { lines: ['first', '@ap'], row: 1, col: 3 }
    const r = B.replaceRange(b, 0, 3, '@x.ts')
    expect(r.lines).toEqual(['first', '@x.ts'])
    expect(r.row).toBe(1)
    expect(r.col).toBe('@x.ts'.length)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/input/buffer.test.ts`
Expected: FAIL — `B.replaceRange is not a function`.

- [ ] **Step 3: Implement** — append to `src/desk/input/buffer.ts`:

```ts
/** Replace columns [start, end) on the CURSOR's line with `str`; cursor lands after `str`. */
export function replaceRange(b: EditBuffer, start: number, end: number, str: string): EditBuffer {
  const cur = b.lines[b.row]!
  const line = cur.slice(0, start) + str + cur.slice(end)
  const lines = b.lines.slice()
  lines[b.row] = line
  return { lines, row: b.row, col: start + str.length }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/input/buffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/buffer.ts test/desk/input/buffer.test.ts
git commit -m "feat(m3.2b): EditBuffer.replaceRange (token replacement for @-accept)"
```

---

### Task 2: `atContext` — detect the `@`-token under the cursor

**Files:**
- Modify: `src/desk/input/menu.ts`
- Test: `test/desk/input/menu.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `test/desk/input/menu.test.ts` (and add `atContext` to its import from `'../../../src/desk/input/menu'`):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/input/menu.test.ts`
Expected: FAIL — `atContext is not a function`.

- [ ] **Step 3: Implement** — append to `src/desk/input/menu.ts`:

```ts
/** The active "@"-mention token under the cursor on a single line. */
export interface AtContext {
  /** Text after the "@" (the fuzzy query; "" right after a bare "@"). */
  query: string
  /** Column where the "@" starts (inclusive). */
  start: number
  /** Column where the token ends (exclusive). */
  end: number
}

/**
 * Detect an "@"-file token under the cursor. The token is the whitespace-delimited
 * run surrounding `col`; it is an "@" context iff that run begins with "@".
 * Returns null when the cursor is not inside an "@"-token. The "@" never spans
 * lines, so this operates on a single line + column.
 */
export function atContext(line: string, col: number): AtContext | null {
  let start = col
  while (start > 0 && !/\s/.test(line[start - 1]!)) start--
  let end = col
  while (end < line.length && !/\s/.test(line[end]!)) end++
  if (line[start] !== '@') return null
  return { query: line.slice(start + 1, end), start, end }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/input/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/menu.ts test/desk/input/menu.test.ts
git commit -m "feat(m3.2b): atContext — detect the @-token under the cursor"
```

---

### Task 3: Fuzzy ranker (`files.ts`, pure half)

**Files:**
- Create: `src/desk/input/files.ts`
- Test: `test/desk/input/files.test.ts`

- [ ] **Step 1: Write the failing tests** — create `test/desk/input/files.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fuzzyFilter, isSubsequence, scorePath } from '../../../src/desk/input/files'

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/input/files.test.ts`
Expected: FAIL — cannot find module `files`.

- [ ] **Step 3: Implement the pure half** — create `src/desk/input/files.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/input/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/files.ts test/desk/input/files.test.ts
git commit -m "feat(m3.2b): fuzzy file ranker (pure, DI-ready)"
```

---

### Task 4: File source (`files.ts`, IO half — git-first, walk fallback)

**Files:**
- Modify: `src/desk/input/files.ts`
- Test: `test/desk/input/files.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `test/desk/input/files.test.ts` (and add `listProjectFiles` + the `FileSourceDeps` type to the import):

```ts
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
```

Update the import line at the top of the test file to:

```ts
import { fuzzyFilter, isSubsequence, scorePath, listProjectFiles, type FileSourceDeps } from '../../../src/desk/input/files'
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/input/files.test.ts`
Expected: FAIL — `listProjectFiles is not a function`.

- [ ] **Step 3: Implement** — add to the TOP of `src/desk/input/files.ts` (imports) and append the IO section:

```ts
import { execFileSync } from 'node:child_process'
import { readdirSync, type Dirent } from 'node:fs'
import { join, relative } from 'node:path'
```

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/input/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/files.ts test/desk/input/files.test.ts
git commit -m "feat(m3.2b): project file source (git ls-files, walk fallback, DI'd)"
```

---

### Task 5: `!bash` interpreter (`slash.ts`)

**Files:**
- Modify: `src/desk/slash.ts`
- Test: `test/desk/slash.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `test/desk/slash.test.ts` (ensure `formatBashPrompt` is in the import from `'../../src/desk/slash'`):

```ts
describe('!bash', () => {
  it('formatBashPrompt wraps the command in a run-and-show instruction', () => {
    const t = formatBashPrompt('npm test')
    expect(t).toContain('Run this shell command')
    expect(t).toContain('npm test')
  })
  it('a "!"-line is a bash result carrying the command + transformed text', () => {
    const r = interpretInput('!git status')
    expect(r.kind).toBe('bash')
    if (r.kind === 'bash') {
      expect(r.command).toBe('git status')
      expect(r.text).toBe(formatBashPrompt('git status'))
    }
  })
  it('a lone "!" is a no-op prompt (mirrors lone "/")', () => {
    expect(interpretInput('!')).toEqual({ kind: 'prompt', text: '' })
    expect(interpretInput('!   ')).toEqual({ kind: 'prompt', text: '' })
  })
  it('an @-bearing line stays a verbatim prompt (no @ handling at submit)', () => {
    expect(interpretInput('explain @src/app.tsx')).toEqual({ kind: 'prompt', text: 'explain @src/app.tsx' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/slash.test.ts`
Expected: FAIL — `formatBashPrompt is not a function`.

- [ ] **Step 3: Implement** — in `src/desk/slash.ts`:

(a) Add the result type and extend the union:

```ts
/** A line beginning with "!" — a shell command delegated to Claude's Bash tool. */
export interface BashResult {
  kind: 'bash'
  /** The raw command (everything after the leading "!", trimmed). */
  command: string
  /** The prompt text actually POSTed — a "run this and show output" instruction. */
  text: string
}

export type InterpretedInput = CommandResult | HintResult | PromptResult | BashResult
```

(b) Add the formatter:

```ts
/** Wrap a shell command as an explicit instruction the raw SDK reliably runs via its Bash tool. */
export function formatBashPrompt(cmd: string): string {
  return ['Run this shell command and show me its output:', '```', cmd, '```'].join('\n')
}
```

(c) In `interpretInput`, immediately after `const trimmed = raw.trim()` and BEFORE the `if (!trimmed.startsWith('/'))` line, insert:

```ts
  // A line beginning with "!" is a shell command — delegated to Claude's Bash tool.
  if (trimmed.startsWith('!')) {
    const command = trimmed.slice(1).trim()
    if (command === '') return { kind: 'prompt', text: '' } // lone "!" -> no-op (mirrors lone "/")
    return { kind: 'bash', command, text: formatBashPrompt(command) }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/slash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/slash.ts test/desk/slash.test.ts
git commit -m "feat(m3.2b): interpretInput handles !bash (delegate to Claude's Bash tool)"
```

---

### Task 6: `app.tsx` — wire the `@`-file menu

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

This task unifies the slash menu with the new `@` menu and adds an Esc-dismiss flag. Read the current wiring at `src/desk/app.tsx` lines ~167–183 (menu derivation), ~460–480 (Esc + menu nav), and ~591–600 (menu render) before editing.

- [ ] **Step 1: Write the failing tests** — append to `test/desk/app.test.tsx` (reuse the file's existing `makeFakeHub`, `write`, `render`, `stripAnsi`):

```ts
describe('@-file autocomplete', () => {
  it('@ opens a fuzzy file menu and Tab inserts the repo-relative path mid-line', async () => {
    const hub = makeFakeHub()
    const FILES = ['src/desk/app.tsx', 'src/hub/routes.ts', 'README.md']
    const { lastFrame, stdin, unmount } = render(
      <App client={hub} sessionId="s1" config={{ listFiles: () => FILES }} />,
    )
    try {
      await write(stdin, 'see @app')
      expect(lastFrame()).toContain('@src/desk/app.tsx') // menu shows the match
      await write(stdin, '\t')                           // Tab accepts the highlighted path
      const f = stripAnsi(lastFrame()!)
      expect(f).toContain('see @src/desk/app.tsx')       // inserted into the composer mid-line
      expect(f).not.toContain('@src/hub/routes.ts')      // menu closed after accept
    } finally {
      unmount()
    }
  })

  it('@ menu: ↓ then Tab inserts the SECOND match', async () => {
    const hub = makeFakeHub()
    const FILES = ['src/a.ts', 'src/ab.ts']
    const { lastFrame, stdin, unmount } = render(
      <App client={hub} sessionId="s1" config={{ listFiles: () => FILES }} />,
    )
    try {
      await write(stdin, '@a')
      expect(lastFrame()).toContain('@src/a.ts')
      await write(stdin, '\x1b[B') // ↓ -> highlight second
      await write(stdin, '\t')
      expect(stripAnsi(lastFrame()!)).toContain('@src/ab.ts')
    } finally {
      unmount()
    }
  })

  it('Esc dismisses the @ menu but preserves the typed line', async () => {
    const hub = makeFakeHub()
    const { lastFrame, stdin, unmount } = render(
      <App client={hub} sessionId="s1" config={{ listFiles: () => ['src/desk/app.tsx'] }} />,
    )
    try {
      await write(stdin, 'hello @app')
      expect(lastFrame()).toContain('@src/desk/app.tsx') // menu open
      await write(stdin, '\x1b')                         // Esc
      const f = stripAnsi(lastFrame()!)
      expect(f).not.toContain('src/desk/app.tsx')        // menu gone
      expect(f).toContain('hello @app')                  // line preserved (not nuked)
    } finally {
      unmount()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — `config.listFiles` ignored; no `@` menu renders.

- [ ] **Step 3: Implement** — edit `src/desk/app.tsx`:

(a) Imports — change the menu import and add the files import:

```ts
import { filterSlash, atContext } from './input/menu'
import { fuzzyFilter, defaultListFiles } from './input/files'
```

(b) Add a constant near `ARROW_BURST_THRESHOLD`:

```ts
/** Max completion-menu rows shown (slash + @-file). */
const MENU_LIMIT = 10
```

(c) Extend `AppConfig` (the interface around line 71) with:

```ts
  /** Injected project file lister for @-autocomplete (defaults to git-backed defaultListFiles). */
  listFiles?: (cwd: string) => string[]
```

(d) Inside the component, near the other derived state, add the file source + cache:

```ts
  const listFiles = config?.listFiles ?? defaultListFiles
  const fileCwd = config?.cwd ?? process.cwd()
  const filesRef = useRef<string[] | null>(null)
  const ensureFiles = useCallback((): string[] => {
    if (filesRef.current === null) {
      try {
        filesRef.current = listFiles(fileCwd)
      } catch {
        filesRef.current = []
      }
    }
    return filesRef.current
  }, [listFiles, fileCwd])
```

(e) Replace the menu-derivation block (current lines ~167–174, from `const [menuIndex, setMenuIndex] = useState(0)` through the `useEffect(() => { setMenuIndex(0) }, ...)`) with:

```ts
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const menuItems = useMemo(() => slashMenuItems(), [])

  // Two mutually-exclusive completion menus. The slash menu owns the WHOLE buffer (a single
  // leading-"/" token); the "@" menu owns a mid-line token under the cursor. Compute slash
  // first; only look for an "@" context when the slash menu is closed — they can never both open.
  const slashMenu = filterSlash(B.toText(buf), menuItems)
  const atCtx = slashMenu === null && !menuDismissed ? atContext(buf.lines[buf.row]!, buf.col) : null
  const atMatches = atCtx ? fuzzyFilter(ensureFiles(), atCtx.query, MENU_LIMIT) : []
  const atMenu = atCtx && atMatches.length > 0 ? atMatches : null

  const menuOpen = slashMenu !== null || atMenu !== null
  const menuLength = slashMenu ? slashMenu.length : atMenu ? atMenu.length : 0
  const clampedMenuIndex = menuOpen ? Math.min(menuIndex, menuLength - 1) : 0
  // Reset the highlight + un-dismiss whenever the composer text changes (a re-filter).
  useEffect(() => { setMenuIndex(0); setMenuDismissed(false) }, [B.toText(buf)])
```

(f) Update `menuRowCount` (current line ~182) to use `menuLength`:

```ts
  const menuRowCount = menuOpen ? menuLength : 0
```

(g) Replace the Esc handler (current ~465–470) so `@` dismisses and slash keeps its existing clear behavior:

```ts
    if (key.escape) {
      if (atMenu) { setMenuDismissed(true); return }   // @ menu: hide, keep the typed line
      if (slashMenu) { setBuf(B.empty()); return }      // slash menu: clear the lone "/" token (unchanged)
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }
```

(h) Replace the menu-nav block (current ~476–480) with one that handles both menus (Tab accepts either; Enter accepts the `@` menu only — the slash menu lets Enter fall through to submit):

```ts
    if (menuOpen && !pending) {
      if (key.upArrow)   { setMenuIndex((i) => Math.max(0, Math.min(i, menuLength - 1) - 1)); return }
      if (key.downArrow) { setMenuIndex((i) => Math.min(menuLength - 1, i + 1)); return }
      if (key.tab) {
        if (slashMenu) { setBuf(B.fromText('/' + slashMenu[clampedMenuIndex]!.name)); setMenuIndex(0); return }
        if (atMenu && atCtx) {
          const chosen = '@' + atMenu[clampedMenuIndex]! + ' ' // trailing space ends the token -> closes the menu
          setBuf((b) => B.replaceRange(b, atCtx.start, atCtx.end, chosen))
          setMenuIndex(0)
          return
        }
      }
      // The "@" menu also accepts on Enter; the slash menu deliberately does NOT (Enter submits it).
      if (atMenu && atCtx && key.return) {
        const chosen = '@' + atMenu[clampedMenuIndex]! + ' '
        setBuf((b) => B.replaceRange(b, atCtx.start, atCtx.end, chosen))
        setMenuIndex(0)
        return
      }
    }
```

(i) Replace the menu render block (current ~591–600) to render either menu:

```tsx
      {menuOpen ? (
        <Box flexDirection="column">
          {slashMenu
            ? slashMenu.map((item, i) => (
                <Text key={item.name} inverse={i === clampedMenuIndex}>
                  {`/${item.name}  `}<Text dimColor>{item.desc}</Text>
                </Text>
              ))
            : atMenu!.map((path, i) => (
                <Text key={path} inverse={i === clampedMenuIndex}>{`@${path}`}</Text>
              ))}
        </Box>
      ) : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS — including the pre-existing slash-menu tests (slash Esc-clears and Enter-submits are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2b): @-file menu in the composer (unified slash/@ menu + Esc-dismiss)"
```

---

### Task 7: `app.tsx` — dispatch `!bash` + record in history

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `test/desk/app.test.tsx`:

```ts
describe('!bash delegation', () => {
  it('a "!"-line is POSTed as a "run this" prompt (not executed locally)', async () => {
    const hub = makeFakeHub()
    const { stdin, lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await write(stdin, '!npm test')
      await write(stdin, '\r')
      expect(hub.prompts).toHaveLength(1)
      expect(hub.prompts[0]!.text).toContain('Run this shell command')
      expect(hub.prompts[0]!.text).toContain('npm test')
      expect(stripAnsi(lastFrame()!)).toContain('npm test') // transcript echoes the command
    } finally {
      unmount()
    }
  })

  it('a submitted "!"-line is recalled by ↑ (recorded in history)', async () => {
    const hub = makeFakeHub()
    const store = memoryHistoryStore()
    const { stdin, lastFrame, unmount } = render(
      <App client={hub} sessionId="s1" config={{ historyStore: store, historyKey: 'k' }} />,
    )
    try {
      await write(stdin, '!ls -la')
      await write(stdin, '\r')
      await write(stdin, '\x1b[A') // ↑ recalls the last submitted line
      expect(stripAnsi(lastFrame()!)).toContain('!ls -la')
    } finally {
      unmount()
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — `hub.prompts` empty (bash kind falls through unhandled) and ↑ recalls nothing.

- [ ] **Step 3: Implement** — edit `src/desk/app.tsx`:

(a) In `submitLine`, add a `bash` branch immediately after the `if (result.kind === 'hint') { … }` block and before the `// result.kind === 'command'` switch:

```ts
      if (result.kind === 'bash') {
        const current = sessionIdRef.current
        dispatch({ type: 'localUser', text: `! ${result.command}` })
        void (async () => {
          try {
            const args = current !== undefined
              ? { text: result.text, sessionId: current }
              : { text: result.text, cwd: config?.cwd }
            const res = await client.sendPrompt(args)
            if (res.sessionId && res.sessionId !== sessionIdRef.current) setSessionId(res.sessionId)
          } catch (err) {
            dispatch({ type: 'note', text: `bash failed: ${err instanceof Error ? err.message : String(err)}` })
          }
        })()
        return
      }
```

(b) In the Enter handler, extend the history-record condition (current ~511–513) so submitted `!`-lines are recalled verbatim:

```ts
      const interpreted = interpretInput(text)
      if (interpreted.kind === 'prompt' && interpreted.text !== '') {
        historyStore.append(historyKey, interpreted.text)
      } else if (interpreted.kind === 'bash') {
        historyStore.append(historyKey, text.trim())
      }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2b): dispatch !bash to the Hub + record it in composer history"
```

---

### Task 8: Preview/self-test rig (see it before UAT)

**Files:**
- Modify: `test/preview/replay.tsx`
- Create: `test/preview/m32b.preview.test.tsx`
- Modify: `scripts/screenshots.sh`

This is the mandatory "see it before UAT" loop (memory rule: *self-test the TUI before UAT*). It drives the REAL `App` via scripted keystrokes and dumps frames, then renders them to PNGs.

- [ ] **Step 1: Extend `capture()` to inject an `AppConfig`** — in `test/preview/replay.tsx`:

Add to the imports near the top:

```ts
import type { AppConfig } from '../../src/desk/app'
```

Change the `capture` signature + the `render(...)` call:

```ts
export async function capture(steps: Step[], sessionId = 's-preview', config?: AppConfig): Promise<Frame[]> {
  const client = makeReplayClient()
  const inst = render(<App client={client} sessionId={sessionId} config={config} />)
```

(Leave the rest of `capture` unchanged.)

- [ ] **Step 2: Create the M3.2B preview test** — `test/preview/m32b.preview.test.tsx`:

```tsx
/**
 * M3.2B preview rig — drive the REAL composer's @-file menu + !bash via scripted
 * keystrokes and capture the rendered frames, so the controller SEES the menu,
 * mid-line insertion, and bash echo before the hardware UAT.
 *
 *   PREVIEW=1 npx vitest run test/preview/m32b.preview.test.tsx   # dump frames
 *   npx vitest run test/preview/m32b.preview.test.tsx             # smoke assertions only
 *   ./scripts/screenshots.sh                                      # frames -> PNGs (needs vhs)
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, key, emit, type Frame } from './replay'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
const written: string[] = []

function dump(frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  for (const f of frames) {
    writeFileSync(resolve(OUT, `${f.label}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${f.label}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(f.label)
  }
}

afterAll(() => {
  // eslint-disable-next-line no-console
  if (WRITE) console.log(`\n[m32b preview] wrote ${written.length} frame(s) to preview-out/:\n  ${written.join('\n  ')}`)
})

const FILES = ['src/desk/app.tsx', 'src/desk/slash.ts', 'src/hub/routes.ts', 'src/index.ts', 'README.md']
const CFG = { listFiles: () => FILES }

describe('M3.2B @-file + !bash preview', () => {
  it('C1 @ opens a fuzzy file menu; Tab inserts the path', async () => {
    const frames = await capture([
      key('explain @app'),
      snap('m32b-c1-at-menu'),
      key('\t'),
      snap('m32b-c1-at-inserted'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames.find((f) => f.label === 'm32b-c1-at-menu')!.plain).toContain('@src/desk/app.tsx')
    expect(frames.find((f) => f.label === 'm32b-c1-at-inserted')!.plain).toContain('explain @src/desk/app.tsx')
  })

  it('C2 @ works mid-line on a later token', async () => {
    const frames = await capture([
      key('compare @app.tsx with @rou'),
      snap('m32b-c2-at-midline'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames[0]!.plain).toContain('@src/hub/routes.ts')
  })

  it('C3 !bash echoes the command on submit', async () => {
    const frames = await capture([
      key('!git status'),
      snap('m32b-c3-bash-typed'),
      key('\r'),
      snap('m32b-c3-bash-submitted'),
    ], 's-preview', CFG)
    dump(frames)
    expect(frames.find((f) => f.label === 'm32b-c3-bash-typed')!.plain).toContain('!git status')
    expect(frames.find((f) => f.label === 'm32b-c3-bash-submitted')!.plain).toContain('git status')
  })

  it('C4 layout: transcript above, composer with an open @ menu below', async () => {
    const frames = await capture([
      emit({ type: 'user_prompt', text: 'wire up the file picker' }),
      emit({ type: 'text_delta', text: 'Sure — point me at the file.' }),
      key('start from @app'),
      snap('m32b-layout'),
    ], 's-preview', CFG)
    dump(frames)
    const f = frames[0]!.plain
    expect(f).toContain('wire up the file picker')
    expect(f).toContain('@src/desk/app.tsx')
  })
})
```

> Note: if the `user_prompt` / `text_delta` event shapes in C4 don't match the current `CoLiveEvent` union, copy the exact shapes used by the `layout` test in `test/preview/m32a.preview.test.tsx` (it uses the same two event kinds).

- [ ] **Step 3: Run the preview smoke assertions**

Run: `npx vitest run test/preview/m32b.preview.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 4: Add the frame→PNG entries** — in `scripts/screenshots.sh`, append to the `FRAMES=( … )` array (before the closing `)`):

```bash
  # M3.2B @-file + !bash (scripted keystrokes in m32b.preview.test.tsx)
  "m32b-c1-at-menu:shot-m32b-c1-at-menu"
  "m32b-c1-at-inserted:shot-m32b-c1-at-inserted"
  "m32b-c2-at-midline:shot-m32b-c2-at-midline"
  "m32b-c3-bash-typed:shot-m32b-c3-bash-typed"
  "m32b-c3-bash-submitted:shot-m32b-c3-bash-submitted"
  "m32b-layout:shot-m32b-layout"
```

- [ ] **Step 5: Commit**

```bash
git add test/preview/replay.tsx test/preview/m32b.preview.test.tsx scripts/screenshots.sh
git commit -m "test(m3.2b): preview/self-test rig for @-file menu + !bash"
```

---

### Task 9: Self-test gate — render, screenshot, eyeball, fix

**Files:** none (verification + any fixes loop back to Tasks 6–8).

This is a GATE, not a formality: the desk must be self-tested and visually correct before it goes to hardware UAT.

- [ ] **Step 1: Dump the frames**

Run: `PREVIEW=1 npx vitest run test/preview/m32b.preview.test.tsx`
Expected: writes `preview-out/m32b-*.txt` and `.ansi` (the console prints the frame list).

- [ ] **Step 2: Render screenshots (if `vhs` is installed)**

Run: `./scripts/screenshots.sh m32b-c1-at-menu m32b-c1-at-inserted m32b-c2-at-midline m32b-c3-bash-typed m32b-c3-bash-submitted m32b-layout`
Expected: `preview-out/shot-m32b-*.png` written. If `vhs` is absent, skip — the `.txt` frames below are sufficient to eyeball.

- [ ] **Step 3: Eyeball each frame and confirm** — open the `preview-out/m32b-*.txt` (and PNGs if present) and verify:
  - The `@` menu lists paths and the highlighted row is visibly inverse.
  - A long path does not overflow / wrap badly at width 100; the composer rows still align under `> `.
  - After Tab, the path is inserted mid-line and the menu is gone (no stray rows).
  - The `!`bash line echoes into the transcript on submit.
  - The transcript-above / composer-below layout holds with the menu open (no overlap, no leaked lines).
  - Fix any rendering issue by looping back to Task 6/7/8, then re-run Steps 1–3.

- [ ] **Step 4: Commit any fixes** (only if Step 3 required changes)

```bash
git add -A && git commit -m "fix(m3.2b): preview self-test rendering fixes"
```

---

### Task 10: Final verification + invariant proof + UAT runbook

**Files:**
- Create: `projects/colive-terminal/m3.2b-uat-runbook.md`

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: PASS, with the new M3.2B tests included; no `.skip`/`.only`; no deleted tests.

- [ ] **Step 2: Typecheck clean**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Prove the invariant (zero Core/Hub change)**

Run: `git diff main -- src/core src/hub`
Expected: **empty output.** If anything prints, a change leaked into Core/Hub — revert it; M3.2B must be desk-only.

- [ ] **Step 4: Write the UAT runbook** — create `projects/colive-terminal/m3.2b-uat-runbook.md`:

```markdown
# M3.2B UAT — @-file autocomplete + !bash (hardware G2 + R1)

Run `colive serve` and `colive desk` from the project root on the same machine.

| # | Walk | Pass = |
|---|------|--------|
| C1 | Type `@app`, Tab to pick `src/desk/app.tsx`, finish the line, submit | Path inserted mid-line; **Claude actually reads the file** and answers about it (spec R1 checkpoint) |
| C2 | One line with two `@` mentions | Both files read |
| C3 | `!git status` | Renders as a `Bash` tool call; **permission prompt fires**; output shown |
| C4 | `@` popup nav: ↑/↓ move, Tab/Enter insert, Esc closes (keeps the line); confirm `/` menu still works and they never collide | All nav correct; no menu conflict |
| C5 | `@` suggestions exclude `node_modules`/ignored files | Only tracked / untracked-not-ignored paths offered |
| C6 | A `!` command that needs approval (e.g. a write) vs a safe read | Permission flow correct both ways |

**Watch item (spec R1):** if `@`-mentions are NOT auto-read by Claude, note it here — the fix is the desk-appended nudge (spec §6 R1), added only if this fails.

Sign-off: ___  Date: ___
```

- [ ] **Step 5: Commit**

```bash
git add projects/colive-terminal/m3.2b-uat-runbook.md
git commit -m "docs(m3.2b): UAT runbook (C1-C6) + final verification"
```

- [ ] **Step 6: Hand back to the planning/validation chat** — do NOT merge. Report: test count delta, the empty `git diff main -- src/core src/hub`, and the self-test frames, for the planner's spec→claims→code validation before merge.

---

## Self-Review

**1. Spec coverage:**
- §1 philosophy (desk reads names only, never contents/shell) → Tasks 3/4 (file source is names-only), enforced in Task 10 Step 3. ✓
- §2.1 trigger (mid-line `@` token) → Task 2 `atContext`, Task 6 derivation. ✓
- §2.2 source (`git ls-files` + walk fallback, cached) → Task 4 + Task 6 `filesRef` cache. ✓
- §2.3 fuzzy matching → Task 3. ✓
- §2.4 accept (token replacement) → Task 1 `replaceRange` + Task 6 Tab/Enter. ✓
- §2.5 delivery verbatim → Task 5 test ("@-bearing line stays a verbatim prompt"). ✓
- §3.1 whole-line `!` → Task 5. §3.2 transform + delegation → Task 5 + Task 7. ✓
- §5 no menu conflict + history → Task 6 (mutual exclusion) + Task 7 (history record). ✓
- §6 R1 (UAT checkpoint + nudge fallback) → Task 10 runbook watch item. ✓
- §7 invariants → Task 10 Step 3 (diff) + Steps 1–2 (no gaming/typecheck). ✓
- §8 self-test before UAT → Tasks 8–9. §9 UAT C1–C6 → Task 10 runbook. ✓
- Listing root = desk cwd → Task 6 `fileCwd = config?.cwd ?? process.cwd()`. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows the command + expected result. ✓

**3. Type consistency:** `FileSourceDeps`/`listProjectFiles`/`fuzzyFilter`/`defaultListFiles` (files.ts) used consistently in Tasks 3/4/6. `AtContext`/`atContext` (menu.ts) → Task 6 uses `atCtx.start`/`atCtx.end`/`atCtx.query`. `replaceRange(b, start, end, str)` defined Task 1, called Task 6. `BashResult` (`kind`/`command`/`text`) defined Task 5, consumed Task 7. `config.listFiles` added to `AppConfig` (Task 6) and injected via `capture()` (Task 8). ✓

No gaps found.
