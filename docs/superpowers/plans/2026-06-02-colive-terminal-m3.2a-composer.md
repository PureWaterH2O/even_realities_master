# M3.2A "Composer" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desk's primitive single-line input into a real composer — multi-line authoring, cursor + word navigation, per-project command history, paste, and a slash-command menu — desk-side only, zero Core change.

**Architecture:** A new pure, fully-unit-tested `src/desk/input/` layer (an immutable `EditBuffer` model + ops, a history state-machine over an injected store, a pure SGR-mouse parser, and slash-menu filtering). `app.tsx`'s `useInput` becomes a thin key→op dispatcher; paste rides ink's built-in `usePaste`; mouse-wheel is read off `useStdin().internal_eventEmitter`'s `'input'` channel. The desk stays a pure Hub client (DI'd `HubClient`); the history store is DI'd the same way for testability.

**Tech Stack:** TypeScript, React 19, ink 7.0.5 (`usePaste`, `useStdin`, `useInput`), vitest 4 + ink-testing-library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-02-colive-terminal-m3.2a-composer-design.md`. **Definition of done (M3.0 §0):** green tests are the *precondition*; M3.2A is DONE only when the user runs the UAT run-book (Task 12) on the real G2 + R1 and signs off. **Do not merge before hardware sign-off.**

**Conventions for the builder:**
- TDD every task: write the failing test, run it red, implement minimally, run it green, commit. Small frequent commits.
- Run a single test file with: `npx vitest run test/desk/input/<name>.test.ts`. Full suite: `npm test`. Types: `npm run typecheck`. All commands from `colive-terminal/`.
- The repo currently passes **314 tests, typecheck clean** — never let either regress.
- **Naming guard:** the model type is `EditBuffer`, NOT `Buffer` (avoid shadowing Node's global `Buffer`).

---

## File Structure

**New (pure logic + render — `src/desk/input/`):**
- `src/desk/input/buffer.ts` — `EditBuffer` model + pure cursor/edit ops.
- `src/desk/input/history.ts` — pure history navigation + `appendEntry` (dedup/cap) + a `HistoryStore` interface and a `fileHistoryStore` adapter.
- `src/desk/input/mouse.ts` — pure `parseSgrMouse(seq)`.
- `src/desk/input/menu.ts` — pure slash-menu filtering (`filterSlash`).
- `src/desk/input/input-rows.ts` — render an `EditBuffer` (with a visible cursor) to ANSI rows.

**Modified:**
- `src/desk/render/ansi.ts` — add an `inverse` helper (for the cursor cell).
- `src/desk/slash.ts` — export `slashMenuItems()` (menu source from the existing command table).
- `src/index.ts:217,224` — enable/disable SGR mouse reporting alongside the alt-screen.
- `src/desk/app.tsx` — replace the single-line `input` state with the `EditBuffer` + dispatcher; wire history, paste, mouse, the slash menu, and dynamic viewport reservation.

**Tests:**
- `test/desk/input/{buffer,history,mouse,menu,input-rows}.test.ts`
- `test/desk/app.test.tsx` — extended with composer integration tests.

---

## Task 1: ANSI `inverse` helper + pure SGR-mouse parser

**Files:**
- Modify: `src/desk/render/ansi.ts`
- Create: `src/desk/input/mouse.ts`
- Test: `test/desk/input/mouse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/desk/input/mouse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSgrMouse } from '../../../src/desk/input/mouse'

describe('parseSgrMouse', () => {
  it('maps wheel-up (button 64) to -1', () => {
    expect(parseSgrMouse('[<64;10;5M')).toBe(-1)
  })
  it('maps wheel-down (button 65) to 1', () => {
    expect(parseSgrMouse('[<65;10;5M')).toBe(1)
  })
  it('accepts the release form (lowercase m)', () => {
    expect(parseSgrMouse('[<64;1;1m')).toBe(-1)
  })
  it('returns null for a non-wheel button (e.g. left click = 0)', () => {
    expect(parseSgrMouse('[<0;3;4M')).toBeNull()
  })
  it('returns null for a non-mouse sequence (arrow up)', () => {
    expect(parseSgrMouse('[A')).toBeNull()
  })
  it('returns null for plain text', () => {
    expect(parseSgrMouse('hello')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/input/mouse.test.ts`
Expected: FAIL — `Cannot find module '.../mouse'`.

- [ ] **Step 3: Implement**

Create `src/desk/input/mouse.ts`:

```ts
/**
 * Pure parser for SGR mouse reports (`\x1b[<{btn};{col};{row}{M|m}`).
 *
 * We enable SGR mouse reporting at the CLI entry point (src/index.ts) and read
 * the raw sequence off ink's internal 'input' channel (App re-emits every
 * non-paste event there verbatim). Only the wheel matters for M3.2A:
 * button 64 = wheel-up, 65 = wheel-down. Everything else (clicks, drags) → null.
 */
const SGR_MOUSE_RE = /^\[<(\d+);\d+;\d+[Mm]$/

/** -1 = scroll up (wheel-up), 1 = scroll down (wheel-down), null = not a wheel event. */
export function parseSgrMouse(seq: string): -1 | 1 | null {
  const m = SGR_MOUSE_RE.exec(seq)
  if (!m) return null
  const button = Number(m[1])
  if (button === 64) return -1
  if (button === 65) return 1
  return null
}
```

Add the `inverse` helper to `src/desk/render/ansi.ts` (next to the existing `italic` on line 13):

```ts
export const inverse = sgr(7, 27)
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/input/mouse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/mouse.ts src/desk/render/ansi.ts test/desk/input/mouse.test.ts
git commit -m "feat(m3.2a): pure SGR mouse-wheel parser + ansi inverse helper"
```

---

## Task 2: `EditBuffer` model + pure edit/cursor ops

**Files:**
- Create: `src/desk/input/buffer.ts`
- Test: `test/desk/input/buffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/desk/input/buffer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as B from '../../../src/desk/input/buffer'

describe('EditBuffer', () => {
  it('empty buffer is one blank line, cursor at 0,0', () => {
    const b = B.empty()
    expect(b.lines).toEqual([''])
    expect(b.row).toBe(0)
    expect(b.col).toBe(0)
    expect(B.isBlank(b)).toBe(true)
  })

  it('insertText appends chars and advances the cursor', () => {
    const b = B.insertText(B.empty(), 'hi')
    expect(B.toText(b)).toBe('hi')
    expect(b.col).toBe(2)
  })

  it('insertText with embedded newlines splits into lines (paste path)', () => {
    const b = B.insertText(B.empty(), 'a\nbb\nc')
    expect(b.lines).toEqual(['a', 'bb', 'c'])
    expect(b.row).toBe(2)
    expect(b.col).toBe(1)
  })

  it('insertNewline splits the current line at the cursor', () => {
    let b = B.insertText(B.empty(), 'abcd')
    b = B.moveLeft(B.moveLeft(b)) // cursor between b and c
    b = B.insertNewline(b)
    expect(b.lines).toEqual(['ab', 'cd'])
    expect(b.row).toBe(1)
    expect(b.col).toBe(0)
  })

  it('deleteBackward removes the char before the cursor', () => {
    const b = B.deleteBackward(B.insertText(B.empty(), 'abc'))
    expect(B.toText(b)).toBe('ab')
    expect(b.col).toBe(2)
  })

  it('deleteBackward at col 0 merges with the previous line', () => {
    const b = B.deleteBackward(B.insertText(B.empty(), 'ab\ncd'))
    // cursor was at end of "cd"; move to start of line 2 first
    const start = B.deleteBackward(B.moveLineStart(B.insertText(B.empty(), 'ab\ncd')))
    expect(start.lines).toEqual(['abcd'])
    expect(start.row).toBe(0)
    expect(start.col).toBe(2)
    expect(B.toText(b)).toBe('ab\nc') // sanity: plain backspace at end deletes 'd'
  })

  it('deleteWordBackward removes the preceding word', () => {
    const b = B.deleteWordBackward(B.insertText(B.empty(), 'foo bar'))
    expect(B.toText(b)).toBe('foo ')
  })

  it('moveLeft/moveRight wrap across line boundaries', () => {
    let b = B.insertText(B.empty(), 'ab\ncd')
    b = B.moveLineStart(b)        // start of "cd" (row 1, col 0)
    b = B.moveLeft(b)             // wrap to end of "ab"
    expect(b.row).toBe(0)
    expect(b.col).toBe(2)
    b = B.moveRight(b)            // wrap back to start of "cd"
    expect(b.row).toBe(1)
    expect(b.col).toBe(0)
  })

  it('moveWordLeft / moveWordRight jump by word within a line', () => {
    let b = B.insertText(B.empty(), 'foo bar baz') // cursor at end
    b = B.moveWordLeft(b)
    expect(b.col).toBe(8) // start of "baz"
    b = B.moveWordRight(b)
    expect(b.col).toBe(11) // end of "baz"
  })

  it('moveLineStart / moveLineEnd', () => {
    let b = B.insertText(B.empty(), 'hello')
    b = B.moveLineStart(b)
    expect(b.col).toBe(0)
    b = B.moveLineEnd(b)
    expect(b.col).toBe(5)
  })

  it('moveUp reports atEdge=true on the top line and leaves the buffer unchanged', () => {
    const b = B.insertText(B.empty(), 'one line')
    const r = B.moveUp(b)
    expect(r.atEdge).toBe(true)
    expect(r.buffer).toEqual(b)
  })

  it('moveDown reports atEdge=true on the bottom line', () => {
    const b = B.insertText(B.empty(), 'one line')
    expect(B.moveDown(b).atEdge).toBe(true)
  })

  it('moveUp inside a multiline buffer moves the cursor and clamps the column', () => {
    const b = B.insertText(B.empty(), 'longline\nx') // cursor row1 col1
    const r = B.moveUp(b)
    expect(r.atEdge).toBe(false)
    expect(r.buffer.row).toBe(0)
    expect(r.buffer.col).toBe(1) // clamped within "longline"
  })

  it('fromText round-trips through toText with the cursor at the end', () => {
    const b = B.fromText('a\nbc')
    expect(B.toText(b)).toBe('a\nbc')
    expect(b.row).toBe(1)
    expect(b.col).toBe(2)
  })
})
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/input/buffer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/desk/input/buffer.ts`:

```ts
/**
 * The desk composer's text model: an immutable multi-line buffer with a cursor.
 * Every operation returns a NEW EditBuffer (pure) so it is trivially testable
 * and the React reducer/dispatch in app.tsx never mutates state in place.
 *
 * Named EditBuffer (not Buffer) to avoid shadowing Node's global Buffer.
 */
export interface EditBuffer {
  /** One entry per logical line; always at least one (possibly empty) line. */
  lines: string[]
  /** Cursor line index (0-based). */
  row: number
  /** Cursor column within `lines[row]` (0..line.length). */
  col: number
}

/** Result of a vertical move: the (possibly unchanged) buffer + whether we were already at the edge. */
export interface VerticalMove {
  buffer: EditBuffer
  /** true when the cursor was already on the top (moveUp) / bottom (moveDown) line. */
  atEdge: boolean
}

const WORD_BOUNDARY = /\s/

export const empty = (): EditBuffer => ({ lines: [''], row: 0, col: 0 })

export const toText = (b: EditBuffer): string => b.lines.join('\n')

export const fromText = (s: string): EditBuffer => {
  const lines = s.split('\n')
  const row = lines.length - 1
  return { lines, row, col: lines[row]!.length }
}

export const isBlank = (b: EditBuffer): boolean => b.lines.length === 1 && b.lines[0] === ''

/** Insert arbitrary text at the cursor; embedded "\n" creates new lines (paste path). */
export function insertText(b: EditBuffer, text: string): EditBuffer {
  if (text === '') return b
  const parts = text.split('\n')
  const cur = b.lines[b.row]!
  const before = cur.slice(0, b.col)
  const after = cur.slice(b.col)
  if (parts.length === 1) {
    const line = before + parts[0] + after
    const lines = b.lines.slice()
    lines[b.row] = line
    return { lines, row: b.row, col: b.col + parts[0]!.length }
  }
  const first = before + parts[0]
  const last = parts[parts.length - 1]! + after
  const middle = parts.slice(1, -1)
  const inserted = [first, ...middle, last]
  const lines = [...b.lines.slice(0, b.row), ...inserted, ...b.lines.slice(b.row + 1)]
  const row = b.row + parts.length - 1
  return { lines, row, col: parts[parts.length - 1]!.length }
}

/** Split the current line at the cursor into two lines. */
export function insertNewline(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  const before = cur.slice(0, b.col)
  const after = cur.slice(b.col)
  const lines = [...b.lines.slice(0, b.row), before, after, ...b.lines.slice(b.row + 1)]
  return { lines, row: b.row + 1, col: 0 }
}

export function deleteBackward(b: EditBuffer): EditBuffer {
  if (b.col > 0) {
    const cur = b.lines[b.row]!
    const line = cur.slice(0, b.col - 1) + cur.slice(b.col)
    const lines = b.lines.slice()
    lines[b.row] = line
    return { lines, row: b.row, col: b.col - 1 }
  }
  if (b.row === 0) return b // start of buffer — nothing to delete
  const prev = b.lines[b.row - 1]!
  const cur = b.lines[b.row]!
  const lines = [...b.lines.slice(0, b.row - 1), prev + cur, ...b.lines.slice(b.row + 1)]
  return { lines, row: b.row - 1, col: prev.length }
}

export function deleteWordBackward(b: EditBuffer): EditBuffer {
  if (b.col === 0) return deleteBackward(b)
  const cur = b.lines[b.row]!
  let i = b.col
  while (i > 0 && WORD_BOUNDARY.test(cur[i - 1]!)) i-- // skip trailing spaces
  while (i > 0 && !WORD_BOUNDARY.test(cur[i - 1]!)) i-- // skip the word
  const line = cur.slice(0, i) + cur.slice(b.col)
  const lines = b.lines.slice()
  lines[b.row] = line
  return { lines, row: b.row, col: i }
}

export function moveLeft(b: EditBuffer): EditBuffer {
  if (b.col > 0) return { ...b, col: b.col - 1 }
  if (b.row === 0) return b
  return { ...b, row: b.row - 1, col: b.lines[b.row - 1]!.length }
}

export function moveRight(b: EditBuffer): EditBuffer {
  if (b.col < b.lines[b.row]!.length) return { ...b, col: b.col + 1 }
  if (b.row === b.lines.length - 1) return b
  return { ...b, row: b.row + 1, col: 0 }
}

export function moveWordLeft(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  let i = b.col
  while (i > 0 && WORD_BOUNDARY.test(cur[i - 1]!)) i--
  while (i > 0 && !WORD_BOUNDARY.test(cur[i - 1]!)) i--
  return { ...b, col: i }
}

export function moveWordRight(b: EditBuffer): EditBuffer {
  const cur = b.lines[b.row]!
  let i = b.col
  while (i < cur.length && WORD_BOUNDARY.test(cur[i]!)) i++
  while (i < cur.length && !WORD_BOUNDARY.test(cur[i]!)) i++
  return { ...b, col: i }
}

export const moveLineStart = (b: EditBuffer): EditBuffer => ({ ...b, col: 0 })
export const moveLineEnd = (b: EditBuffer): EditBuffer => ({ ...b, col: b.lines[b.row]!.length })

export function moveUp(b: EditBuffer): VerticalMove {
  if (b.row === 0) return { buffer: b, atEdge: true }
  const row = b.row - 1
  const col = Math.min(b.col, b.lines[row]!.length)
  return { buffer: { ...b, row, col }, atEdge: false }
}

export function moveDown(b: EditBuffer): VerticalMove {
  if (b.row === b.lines.length - 1) return { buffer: b, atEdge: true }
  const row = b.row + 1
  const col = Math.min(b.col, b.lines[row]!.length)
  return { buffer: { ...b, row, col }, atEdge: false }
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/input/buffer.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/buffer.ts test/desk/input/buffer.test.ts
git commit -m "feat(m3.2a): pure EditBuffer model + cursor/edit ops"
```

---

## Task 3: Command history — pure nav + dedup/cap + file store

**Files:**
- Create: `src/desk/input/history.ts`
- Test: `test/desk/input/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/desk/input/history.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/input/history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/desk/input/history.ts`:

```ts
/**
 * Per-project command history for the desk composer.
 *
 * Two layers:
 *  - PURE: `appendEntry` (consecutive-dedup + cap) and a small `prev`/`next`
 *    navigation state-machine. No I/O — fully unit-tested.
 *  - ADAPTER: a `HistoryStore` interface (load/append by project key) with a
 *    real `fileHistoryStore` (JSONL under ~/.colive/history) and an in-memory
 *    `memoryHistoryStore` test double. The store is dependency-injected into
 *    the App, exactly like the HubClient — so tests never touch disk.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HISTORY_CAP = 500

/** Append `entry` to chronological history (newest last); dedup consecutive; cap. */
export function appendEntry(entries: string[], entry: string, cap = HISTORY_CAP): string[] {
  const e = entry.trim()
  if (e === '') return entries
  if (entries.length > 0 && entries[entries.length - 1] === e) return entries
  const next = [...entries, e]
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Navigation cursor over a snapshot of history. `index === entries.length` ⇒ editing the draft. */
export interface HistoryNav {
  entries: string[]
  index: number
  /** The in-progress text stashed when the user first presses ↑. */
  draft: string | null
}

export const initNav = (entries: string[]): HistoryNav => ({
  entries,
  index: entries.length,
  draft: null,
})

/** ↑ — move toward older entries. Stashes the live draft on the first press. */
export function prev(nav: HistoryNav, currentText: string): { nav: HistoryNav; text: string } {
  if (nav.entries.length === 0) return { nav, text: currentText }
  const draft = nav.index === nav.entries.length ? currentText : nav.draft
  const index = Math.max(0, nav.index - 1)
  return { nav: { ...nav, index, draft }, text: nav.entries[index]! }
}

/** ↓ — move toward newer entries; past the newest, restore the stashed draft. */
export function next(nav: HistoryNav, currentText: string): { nav: HistoryNav; text: string } {
  if (nav.index >= nav.entries.length) return { nav, text: currentText }
  const index = nav.index + 1
  if (index >= nav.entries.length) {
    return { nav: { ...nav, index: nav.entries.length }, text: nav.draft ?? '' }
  }
  return { nav: { ...nav, index }, text: nav.entries[index]! }
}

/** Persistence boundary — injected into the App (DI, like HubClient). */
export interface HistoryStore {
  load(key: string): string[]
  append(key: string, entry: string): void
}

/** In-memory store for tests. */
export function memoryHistoryStore(): HistoryStore {
  const byKey = new Map<string, string[]>()
  return {
    load: (key) => byKey.get(key) ?? [],
    append: (key, entry) => byKey.set(key, appendEntry(byKey.get(key) ?? [], entry)),
  }
}

const sanitize = (key: string): string => key.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 120) || 'default'

/**
 * JSONL-on-disk store. One file per project key under ~/.colive/history. Each
 * line is a JSON-encoded string. Reads apply dedup/cap defensively; the append
 * is best-effort (a failed write must never crash the composer).
 */
export function fileHistoryStore(baseDir = join(homedir(), '.colive', 'history')): HistoryStore {
  const fileFor = (key: string): string => join(baseDir, `${sanitize(key)}.jsonl`)
  return {
    load(key) {
      try {
        const raw = readFileSync(fileFor(key), 'utf8')
        const out: string[] = []
        for (const line of raw.split('\n')) {
          if (line.trim() === '') continue
          try {
            const v = JSON.parse(line)
            if (typeof v === 'string') out.push(v)
          } catch {
            /* skip a corrupt line */
          }
        }
        return out.slice(-HISTORY_CAP)
      } catch {
        return []
      }
    },
    append(key, entry) {
      const e = entry.trim()
      if (e === '') return
      try {
        mkdirSync(baseDir, { recursive: true })
        appendFileSync(fileFor(key), JSON.stringify(e) + '\n', 'utf8')
      } catch {
        /* best-effort — never crash the UI on a history write */
      }
    },
  }
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/input/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/history.ts test/desk/input/history.test.ts
git commit -m "feat(m3.2a): per-project history — pure nav + dedup/cap + file/memory stores"
```

---

## Task 4: Slash-menu source + pure filter

**Files:**
- Modify: `src/desk/slash.ts`
- Create: `src/desk/input/menu.ts`
- Test: `test/desk/input/menu.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/desk/input/menu.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/input/menu.test.ts`
Expected: FAIL — `slashMenuItems` / `menu` not found.

- [ ] **Step 3: Implement**

Add to `src/desk/slash.ts` (after the `COMMAND_HELP` table; it reuses the existing `COMMAND_HELP` constant):

```ts
/** Menu source for the M3.2A slash-command completion popup, derived from COMMAND_HELP. */
export function slashMenuItems(): { name: string; desc: string }[] {
  return COMMAND_HELP.map(([name, desc]) => ({ name: name.replace(/^\//, ''), desc }))
}
```

Create `src/desk/input/menu.ts`:

```ts
/**
 * Pure slash-menu filtering. The completion popup is open exactly when the
 * composer holds a single leading-"/" token (no spaces / newlines) that matches
 * at least one command. app.tsx owns the highlight index; this module only
 * decides the visible item list. The popup widget itself is reused by M3.2B's
 * @-file autocomplete.
 */
export interface MenuItem {
  name: string
  desc: string
}

/**
 * Returns the filtered items when `text` is an open slash-menu context, else null.
 * - text must be a single token beginning with "/" (no whitespace).
 * - "/" alone lists everything; "/cl" filters by prefix (case-insensitive).
 * - no matches ⇒ null (menu closed).
 */
export function filterSlash(text: string, items: MenuItem[]): MenuItem[] | null {
  if (!text.startsWith('/')) return null
  if (/\s/.test(text)) return null
  const prefix = text.slice(1).toLowerCase()
  const matches = items.filter((i) => i.name.toLowerCase().startsWith(prefix))
  return matches.length > 0 ? matches : null
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/input/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/slash.ts src/desk/input/menu.ts test/desk/input/menu.test.ts
git commit -m "feat(m3.2a): slash-menu source (slashMenuItems) + pure filterSlash"
```

---

## Task 5: Render the composer (multi-line + visible cursor)

**Files:**
- Create: `src/desk/input/input-rows.ts`
- Test: `test/desk/input/input-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/desk/input/input-rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderInputRows } from '../../../src/desk/input/input-rows'
import * as B from '../../../src/desk/input/buffer'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('renderInputRows', () => {
  it('renders a single line with the "> " prompt and a trailing cursor cell', () => {
    const rows = renderInputRows(B.insertText(B.empty(), 'hi'), { width: 80 })
    expect(rows).toHaveLength(1)
    expect(stripAnsi(rows[0]!)).toBe('> hi ') // trailing space is the cursor cell at end-of-line
  })

  it('renders one visual row per logical line; continuation lines are indented', () => {
    const rows = renderInputRows(B.fromText('one\ntwo'), { width: 80 })
    expect(rows).toHaveLength(2)
    expect(stripAnsi(rows[0]!)).toBe('> one')
    expect(stripAnsi(rows[1]!)).toBe('  two ') // cursor at end of "two"
  })

  it('places the cursor (inverse video) on the char under it, not only at the end', () => {
    let b = B.insertText(B.empty(), 'abc')
    b = B.moveLeft(b) // cursor on "c"
    const row = renderInputRows(b, { width: 80 })[0]!
    expect(stripAnsi(row)).toBe('> abc') // no extra trailing cell when cursor is mid-line
    expect(row).toContain('[7m') // inverse SGR present (the cursor cell)
  })
})
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/input/input-rows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/desk/input/input-rows.ts`:

```ts
/**
 * Render an EditBuffer to terminal rows with a visible cursor.
 *
 * - The first line is prefixed with "> "; continuation lines with "  " so the
 *   text columns align (matches the prior single-line "> " prompt).
 * - The cursor is drawn as an inverse-video cell on the character under it; at
 *   end-of-line it is an inverse space appended after the text.
 * - One visual row per logical line. (Soft-wrapping long single lines is
 *   deferred — see spec §9 risks; multiline is the headline, not 200-col lines.)
 */
import type { EditBuffer } from './buffer'
import { inverse } from '../render/ansi'

export interface InputRowOpts {
  width: number
}

export function renderInputRows(buf: EditBuffer, _opts: InputRowOpts): string[] {
  return buf.lines.map((line, row) => {
    const prefix = row === 0 ? '> ' : '  '
    if (row !== buf.row) return prefix + line
    const col = buf.col
    const under = col < line.length ? line[col]! : ' '
    return prefix + line.slice(0, col) + inverse(under) + line.slice(col + 1)
  })
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/input/input-rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/input/input-rows.ts test/desk/input/input-rows.test.ts
git commit -m "feat(m3.2a): render the composer buffer with a visible cursor"
```

---

## Task 6: Enable SGR mouse reporting at the CLI entry point

**Files:**
- Modify: `src/index.ts:217` (enter) and `:224` (leave)

> This is a TTY side-effect at the process entry point; it is exercised by hardware UAT (Task 12 A6), not by a unit test (tests run non-TTY and skip this branch, exactly like the alt-screen). Keep the change minimal.

- [ ] **Step 1: Add the mouse enable next to the alt-screen enter**

In `src/index.ts`, change the alt-screen enter line (currently line 217):

```ts
  // enter alt-screen + clear + home, then enable SGR mouse reporting so the
  // wheel is delivered as distinct \x1b[<..M reports (M3.2A reads them off ink's
  // internal 'input' channel). 1000h = button tracking (incl. wheel), 1006h = SGR
  // encoding. Skipped when not a TTY (tests/pipes), like the alt-screen itself.
  if (isTTY) process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h')
```

- [ ] **Step 2: Disable mouse on every exit path (the `leaveAlt` fn, currently line 224)**

```ts
    const leaveAlt = (): void => {
      try {
        // disable SGR mouse BEFORE leaving the alt-screen, then restore the primary screen
        process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l')
      } catch {
        /* stream already closed — nothing to restore */
      }
    }
```

- [ ] **Step 3: Typecheck + full suite (no behavior change in tests)**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; **314 tests still pass** (the TTY branch is skipped under vitest).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(m3.2a): enable/disable SGR mouse reporting alongside the alt-screen"
```

---

## Task 7: Wire the composer into app.tsx — buffer + dispatcher

> This is the central modify. It replaces the `const [input, setInput] = useState('')` string and the editing branches of `useInput` with the `EditBuffer`. History, paste, mouse, and the menu are layered on in Tasks 8–10. Keep the permission/question number-key path and Esc-interrupt intact.

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Append to `test/desk/app.test.tsx` (uses the existing `makeFakeHub`, `mount`, `write` helpers):

```ts
import * as B from '../../src/desk/input/buffer' // add near the other imports if not present

it('composes a multiline prompt with Ctrl-J and submits the joined text on Enter', async () => {
  const fake = makeFakeHub()
  const sent: string[] = []
  fake.sendPrompt = async (args) => { sent.push(args.text); return { sessionId: 's1' } }
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)

  await write(stdin, 'line one')
  await write(stdin, '\n')          // Ctrl-J sends \n → newline, NOT submit
  await write(stdin, 'line two')
  expect(sent).toHaveLength(0)      // still composing
  await write(stdin, '\r')          // Enter (carriage return) submits
  expect(sent).toEqual(['line one\nline two'])
  cleanup()
})

it('backspace deletes within the buffer and the prompt re-renders', async () => {
  const fake = makeFakeHub()
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
  await write(stdin, 'abc')
  await write(stdin, '')       // backspace
  expect(lastFrame()).toContain('ab')
  cleanup()
})
```

> Note on keys in tests: ink-testing-library writes raw bytes. `\r` = Enter (`key.return`), `\n` = Ctrl-J/line-feed (we treat it as newline), `` = backspace.

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — the new multiline test fails (today `\n` and `\r` both submit a single-line string; Ctrl-J isn't a newline).

- [ ] **Step 3: Implement — swap the input state + dispatcher**

In `src/desk/app.tsx`:

(a) Add imports near the existing input imports (after line 43):

```ts
import * as B from '../input/buffer'
import type { EditBuffer } from '../input/buffer'
```

(Adjust the relative path to `./input/buffer` — `app.tsx` is in `src/desk/`, so it is `./input/buffer`.)

(b) Replace the input state declaration (line 115):

```ts
  const [buf, setBuf] = useState<EditBuffer>(B.empty)
```

(c) Replace the `useInput((ch, key) => { ... })` block (lines 303–361) with the dispatcher below. **Keep** the leading `key.escape` and `pending` branches exactly as they are today, except the question free-text path now edits `buf`:

```ts
  useInput((ch, key) => {
    if (key.escape) {
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }

    // Mouse reports can arrive through useInput on some terminals — never let one
    // fire a key binding (wheel is handled separately via the 'input' channel).
    if (ch.startsWith('[<')) return

    if (pending) {
      if (/^[1-9]$/.test(ch)) { resolvePending(Number.parseInt(ch, 10) - 1); return }
      if (pending.kind === 'question') {
        if (key.return) { submitQuestionText(B.toText(buf)); setBuf(B.empty()); return }
        if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
        if (ch && !key.ctrl && !key.meta) setBuf((b) => B.insertText(b, ch))
      }
      return
    }

    // Ctrl-C quits; Ctrl-O toggles verbose (unchanged).
    if (key.ctrl && (ch === 'c' || ch === 'C')) { exit(); return }
    if (key.ctrl && (ch === 'o' || ch === 'O')) { setVerbose((v) => !v); return }

    // Enter submits; Ctrl-J (\n) and "\\"+Enter insert a newline.
    if (key.return) {
      const text = B.toText(buf)
      // Backslash-continuation: a line ending in a single "\" means "newline, keep editing".
      if (text.endsWith('\\')) {
        setBuf((b) => B.insertNewline(trimTrailingBackslash(b)))
        return
      }
      setBuf(B.empty())
      submitLine(text)
      return
    }
    if (ch === '\n' || (key.ctrl && (ch === 'j' || ch === 'J'))) { setBuf(B.insertNewline); return }

    // Editing keys.
    if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
    if (key.ctrl && (ch === 'w' || ch === 'W')) { setBuf(B.deleteWordBackward); return }
    if (key.leftArrow && key.meta)  { setBuf(B.moveWordLeft); return }
    if (key.rightArrow && key.meta) { setBuf(B.moveWordRight); return }
    if (key.leftArrow)  { setBuf(B.moveLeft); return }
    if (key.rightArrow) { setBuf(B.moveRight); return }
    if (key.upArrow)   { setBuf((b) => B.moveUp(b).buffer); return }   // history wired in Task 8
    if (key.downArrow) { setBuf((b) => B.moveDown(b).buffer); return } // history wired in Task 8

    // Home/End: when the buffer is empty, End re-pins the transcript (M3.1); else line nav.
    if (key.pageUp)   { setViewport((vp) => scrollPage(vp, rows.length, height, -1)); return }
    if (key.pageDown) { setViewport((vp) => scrollPage(vp, rows.length, height, 1)); return }
    if (key.end) {
      if (B.isBlank(buf)) { setViewport(pinBottom(rows.length, height)); return }
      setBuf(B.moveLineEnd); return
    }
    // ink reports Home via key combos inconsistently; Ctrl-A / Ctrl-E are the reliable line-start/end.
    if (key.ctrl && (ch === 'a' || ch === 'A')) { setBuf(B.moveLineStart); return }
    if (key.ctrl && (ch === 'e' || ch === 'E')) { setBuf(B.moveLineEnd); return }

    // Printable characters extend the buffer at the cursor.
    if (ch && !key.ctrl && !key.meta) setBuf((b) => B.insertText(b, ch))
  })
```

(d) Add this helper near `renderView` at the bottom of the file:

```ts
/** Drop a single trailing "\" from the buffer's current line (backslash-continuation). */
function trimTrailingBackslash(b: EditBuffer): EditBuffer {
  const line = b.lines[b.row]!
  if (!line.endsWith('\\')) return b
  const lines = b.lines.slice()
  lines[b.row] = line.slice(0, -1)
  return { ...b, lines, col: Math.min(b.col, lines[b.row]!.length) }
}
```

(e) Update the render section. Replace the question-answer `input` reference in `<PendingPrompt>` and the bottom input row. Change the `PendingPrompt` call (line 387) to pass text:

```tsx
      {pending ? <PendingPrompt pending={pending} input={B.toText(buf)} /> : null}
```

Replace the bottom composer render (lines 395–400) with the multi-line renderer:

```tsx
      {pending && pending.kind === 'question' ? null : (
        <Box flexDirection="column">
          {renderInputRows(buf, { width }).map((r, i) => (
            <Text key={`in-${i}`}>{r}</Text>
          ))}
        </Box>
      )}
```

And add the import (top of file):

```ts
import { renderInputRows } from '../input/input-rows'
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS (new multiline + backspace tests) and **all prior app tests still pass** (Enter still submits, Esc still interrupts, number keys still answer prompts).

- [ ] **Step 5: Full suite + typecheck, then commit**

```bash
npm run typecheck && npm test
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2a): composer buffer + key dispatcher in the desk app"
```

---

## Task 8: Wire command history (↑/↓ at edges, persist on submit)

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `test/desk/app.test.tsx`:

```ts
import { memoryHistoryStore } from '../../src/desk/input/history' // add to imports

it('persists submitted prompts per project and recalls them with ↑ (across a remount)', async () => {
  const store = memoryHistoryStore()
  const fake1 = makeFakeHub()
  fake1.sendPrompt = async () => ({ sessionId: 's1' })

  // First run: submit two prompts.
  const run1 = mount(<App client={fake1} sessionId="s1" config={{ historyStore: store, historyKey: 'proj-x' }} />)
  await write(run1.stdin, 'first prompt')
  await write(run1.stdin, '\r')
  await write(run1.stdin, 'second prompt')
  await write(run1.stdin, '\r')
  run1.cleanup()

  // Second run (simulated restart): ↑ recalls the newest, ↑ again the older.
  const run2 = mount(<App client={makeFakeHub()} sessionId="s1" config={{ historyStore: store, historyKey: 'proj-x' }} />)
  await write(run2.stdin, '[A') // ↑
  expect(run2.lastFrame()).toContain('second prompt')
  await write(run2.stdin, '[A') // ↑
  expect(run2.lastFrame()).toContain('first prompt')
  run2.cleanup()
})
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — `config.historyStore` is unused; ↑ doesn't recall.

- [ ] **Step 3: Implement**

In `src/desk/app.tsx`:

(a) Extend `AppConfig` (lines 45–51):

```ts
export interface AppConfig {
  cwd?: string
  needReplay?: boolean
  /** Injected history persistence (defaults to an in-memory store if absent). */
  historyStore?: HistoryStore
  /** Project key for per-project history (the Hub base URL or cwd). */
  historyKey?: string
}
```

(b) Add imports:

```ts
import { initNav, prev as histPrev, next as histNext, memoryHistoryStore } from '../input/history'
import type { HistoryStore, HistoryNav } from '../input/history'
```

(c) Inside `App`, after the `buf` state, set up the store + nav (the store/key are stable for the component's life):

```ts
  const historyStore = useMemo<HistoryStore>(() => config?.historyStore ?? memoryHistoryStore(), [config?.historyStore])
  const historyKey = config?.historyKey ?? 'default'
  const [nav, setNav] = useState<HistoryNav>(() => initNav(historyStore.load(historyKey)))
```

(d) In the dispatcher, replace the placeholder ↑/↓ lines from Task 7 with edge-aware history routing:

```ts
    if (key.upArrow) {
      const m = B.moveUp(buf)
      if (!m.atEdge) { setBuf(m.buffer); return }
      const r = histPrev(nav, B.toText(buf))
      setNav(r.nav); setBuf(B.fromText(r.text)); return
    }
    if (key.downArrow) {
      const m = B.moveDown(buf)
      if (!m.atEdge) { setBuf(m.buffer); return }
      const r = histNext(nav, B.toText(buf))
      setNav(r.nav); setBuf(B.fromText(r.text)); return
    }
```

(e) On submit (the `key.return` non-backslash branch in the dispatcher and inside `submitLine`'s prompt path), append to history and reset the nav. The cleanest spot is right where we currently `setBuf(B.empty()); submitLine(text)`:

```ts
      setBuf(B.empty())
      if (text.trim() !== '') {
        historyStore.append(historyKey, text)
        setNav(initNav(historyStore.load(historyKey)))
      }
      submitLine(text)
      return
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS (history persists across the remount; ↑ recalls).

- [ ] **Step 5: Full suite + typecheck, commit**

```bash
npm run typecheck && npm test
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2a): per-project command history wired to ↑/↓ + submit"
```

---

## Task 9: Wire paste + mouse-wheel + dynamic viewport reservation

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `test/desk/app.test.tsx`:

```ts
it('a multi-line paste lands in the buffer without submitting', async () => {
  const fake = makeFakeHub()
  const sent: string[] = []
  fake.sendPrompt = async (args) => { sent.push(args.text); return { sessionId: 's1' } }
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
  // bracketed-paste wrapper: \x1b[200~ ... \x1b[201~ — ink delivers it via usePaste.
  await write(stdin, '[200~alpha\nbeta[201~')
  expect(sent).toHaveLength(0)        // paste must NOT auto-submit
  expect(lastFrame()).toContain('alpha')
  expect(lastFrame()).toContain('beta')
  cleanup()
})

it('mouse wheel-down scrolls the transcript (raw SGR report)', async () => {
  const fake = makeFakeHub()
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
  // Emit enough rows to overflow the viewport, then wheel-up to unpin/scroll.
  for (let i = 0; i < 60; i++) fake.emit({ type: 'text_delta', text: `row ${i}\n` })
  await write(stdin, '[<64;1;1M') // wheel-up
  // The scroll indicator should show we are no longer pinned to the bottom.
  expect(lastFrame()).toMatch(/rows \d+/)
  cleanup()
})
```

> If ink-testing-library does not route the bracketed-paste bytes through `usePaste` in your harness version, fall back to asserting the paste handler via a direct unit of the dispatch (the build agent: verify the harness first by logging; the `usePaste` path is confirmed present in ink 7.0.5 — see `knowledge/terminal-mode/ink7-input-internals.md`).

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — paste isn't handled; wheel does nothing.

- [ ] **Step 3: Implement**

In `src/desk/app.tsx`:

(a) Imports:

```ts
import { Box, Text, useApp, useInput, usePaste, useStdin, useStdout } from 'ink'
import { parseSgrMouse } from '../input/mouse'
```

(b) Paste — anywhere inside `App` alongside the other hooks:

```ts
  usePaste((text) => { setBuf((b) => B.insertText(b, text)) })
```

(c) Mouse wheel — tap ink's internal 'input' channel:

```ts
  const { internal_eventEmitter } = useStdin() as unknown as {
    internal_eventEmitter?: { on(e: string, l: (s: string) => void): void; removeListener(e: string, l: (s: string) => void): void }
  }
  useEffect(() => {
    const em = internal_eventEmitter
    if (!em) return
    const onInput = (raw: string): void => {
      const dir = parseSgrMouse(raw)
      if (dir !== null) setViewport((vp) => scrollLine(vp, rows.length, height, dir, WHEEL_STEP))
    }
    em.on('input', onInput)
    return () => em.removeListener('input', onInput)
  }, [internal_eventEmitter, rows.length, height])
```

(d) Dynamic reservation — replace the fixed `const reserved = 4` (line 111) with a computed value based on the composer + menu height. Compute the input rows first (they depend on `buf`), then reserve:

```ts
  const inputRowCount = pending && pending.kind === 'question' ? 0 : renderInputRows(buf, { width }).length
  // status line + 1 headroom + the composer's rows + the scroll indicator (assume 1).
  const reserved = 3 + inputRowCount
  const height = Math.max(4, (stdout?.rows ?? 24) - reserved)
```

> Place this AFTER `buf` is declared and `width` is available; move the `height` definition down accordingly so it uses the computed `reserved`. The existing `renderInputRows` import (Task 7) is reused.

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS (paste lands without submit; wheel scrolls). If the harness can't simulate `usePaste`, see the note in Step 1 and confirm via logging before adapting the assertion.

- [ ] **Step 5: Full suite + typecheck, commit**

```bash
npm run typecheck && npm test
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2a): paste (usePaste) + mouse-wheel scroll + dynamic viewport reserve"
```

---

## Task 10: Wire the slash menu (open/filter/Tab/Enter/Esc)

**Files:**
- Modify: `src/desk/app.tsx`
- Test: `test/desk/app.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `test/desk/app.test.tsx`:

```ts
it('typing "/" opens the slash menu, filters, and Tab completes the command', async () => {
  const fake = makeFakeHub()
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
  await write(stdin, '/')
  expect(lastFrame()).toContain('/clear')   // menu lists commands
  expect(lastFrame()).toContain('/help')
  await write(stdin, 'h')                    // "/h" filters to /help
  expect(lastFrame()).toContain('/help')
  expect(lastFrame()).not.toContain('/clear')
  await write(stdin, '\t')                   // Tab completes the highlighted item
  expect(lastFrame()).toContain('> /help')
  cleanup()
})

it('Esc closes an open slash menu without interrupting', async () => {
  const fake = makeFakeHub()
  const interrupts: string[] = []
  fake.interrupt = async (sid) => { interrupts.push(sid) }
  const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
  await write(stdin, '/')
  await write(stdin, '')               // Esc → close menu (no interrupt)
  expect(interrupts).toHaveLength(0)
  expect(lastFrame()).not.toContain('/clear')
  cleanup()
})
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — no menu renders; Esc currently always interrupts.

- [ ] **Step 3: Implement**

In `src/desk/app.tsx`:

(a) Imports:

```ts
import { filterSlash } from '../input/menu'
import { slashMenuItems } from './slash'
```

(b) Menu state + derived list (after `buf`):

```ts
  const [menuIndex, setMenuIndex] = useState(0)
  const menuItems = useMemo(() => slashMenuItems(), [])
  const menu = filterSlash(B.toText(buf), menuItems) // null when the menu is closed
  const menuOpen = menu !== null
  const clampedMenuIndex = menu ? Math.min(menuIndex, menu.length - 1) : 0
```

(c) In the dispatcher, handle the menu **before** the generic Esc/return/printable handling. Update the top `key.escape` branch and add menu navigation:

Replace the opening `if (key.escape) { ... }` with:

```ts
    if (key.escape) {
      if (menuOpen) { setBuf(B.empty()); return }       // close the menu, clear the token
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }
```

Immediately after the mouse-guard line (`if (ch.startsWith('[<')) return`) and BEFORE the `pending` block, add:

```ts
    if (menuOpen && !pending) {
      if (key.upArrow)   { setMenuIndex((i) => Math.max(0, (Math.min(i, menu!.length - 1)) - 1)); return }
      if (key.downArrow) { setMenuIndex((i) => Math.min(menu!.length - 1, i + 1)); return }
      if (key.tab) { setBuf(B.fromText('/' + menu![clampedMenuIndex]!.name)); setMenuIndex(0); return }
      // Enter falls through to submit the completed/typed command via the normal path.
    }
```

(d) Render the menu just above the composer (before the `{pending && pending.kind === 'question' ? null : (` composer block):

```tsx
      {menuOpen ? (
        <Box flexDirection="column">
          {menu!.map((item, i) => (
            <Text key={item.name} inverse={i === clampedMenuIndex}>
              {`/${item.name}  `}<Text dimColor>{item.desc}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
```

(e) Fold the menu height into the dynamic reservation (update Task 9's `reserved`):

```ts
  const menuRowCount = menuOpen ? menu!.length : 0
  const inputRowCount = pending && pending.kind === 'question' ? 0 : renderInputRows(buf, { width }).length
  const reserved = 3 + inputRowCount + menuRowCount
  const height = Math.max(4, (stdout?.rows ?? 24) - reserved)
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS (menu opens, filters, Tab completes, Esc closes without interrupt). All prior tests stay green (Esc still interrupts when the menu is closed).

- [ ] **Step 5: Full suite + typecheck, commit**

```bash
npm run typecheck && npm test
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.2a): slash-menu popup — open/filter/Tab-complete/Esc-close"
```

---

## Task 11: Default the real history store at the entry point

**Files:**
- Modify: `src/index.ts` (the desk launch — where `App` is constructed, near line 213)

- [ ] **Step 1: Pass the file store + a project key into the App**

In `src/index.ts`, where the desk renders `App` (currently `render(createElement(App, { client, sessionId: conn.sessionId }))`), thread the real history store and a per-project key derived from the Hub base URL:

```ts
  const instance = render(
    createElement(App, {
      client,
      sessionId: conn.sessionId,
      config: { historyStore: fileHistoryStore(), historyKey: conn.baseUrl },
    }),
  )
```

Add the import at the top of `src/index.ts`:

```ts
import { fileHistoryStore } from './desk/input/history'
```

> `conn.baseUrl` is already available (it's used a few lines above to build the Hub client). Keying history by the Hub base URL gives per-project history because each Hub serves one project. (Spec §5 noted `GET /info` as a future enrichment; the base URL is the zero-new-plumbing key.)

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests green (this path isn't exercised by unit tests, which inject their own store).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(m3.2a): default the desk to the on-disk per-project history store"
```

---

## Task 12: Verify the candidate + write the hardware UAT run-book

**Files:**
- Create: `projects/colive-terminal/m3.2a-uat-runbook.md`

- [ ] **Step 1: Controller re-verify from a clean tree (NOT agent self-report)**

```bash
npm ci && npm run typecheck && npm test
```
Expected: typecheck clean; **all tests pass** (the prior 314 + the new input-layer + app integration tests). Record the exact tail output.

- [ ] **Step 2: Write the UAT run-book**

Create `projects/colive-terminal/m3.2a-uat-runbook.md` following the M3.1 run-book's structure (Part A desk features + Part B light co-live regression), with the **§0 hardware-UAT gate** and the keymap (incl. macOS Fn-equivalents) from the spec. Items:

```markdown
# M3.2A "Composer" — Hardware UAT Run-Book

> Per M3.0 §0: DONE only when the user completes this on the real G2 + R1 and signs off.
> Green tests + clean typecheck are the precondition. Launch: `npm run dev -- serve` and `npm run dev -- desk`
> in a TALL terminal. macOS-laptop keys: PageUp/PageDown = Fn+↑/Fn+↓; Home/End = Fn+←/Fn+→; word = ⌥+←/→.

## Part A — composer (desk)
- [ ] A1 Multiline: type a line, press **Ctrl-J** (and try **\\ then Enter**) to add lines, **Enter** submits the
      joined text. A multi-line prompt reaches the agent as one prompt.
- [ ] A2 Cursor + word nav: ←/→ move by char; **⌥+←/→** by word; **Ctrl-A/Ctrl-E** (and **Fn+←/→**) to line ends;
      **Ctrl-W** deletes a word. Edits land where the cursor is, not only at the end.
- [ ] A3 History across a restart: submit 2–3 prompts, **quit and relaunch desk**, press **↑** — the prompts recall
      newest-first; **↓** walks back and restores the in-progress draft. (Per-project: a different Hub/project has its
      own history.)
- [ ] A4 Paste: copy a multi-line block and paste it — it fills the composer as multiple lines and does **not**
      auto-submit.
- [ ] A5 Slash menu: type **/** — the command menu appears; keep typing to filter; **↑/↓** highlight; **Tab** completes;
      **Enter** runs it (e.g. /help, /clear); **Esc** closes the menu without interrupting.
- [ ] A6 Mouse wheel + selection: the **wheel/trackpad scrolls the transcript**; **PageUp/PageDown** page it; **End**
      (empty input) re-pins to the bottom. Text selection works with **Option-drag**. (If your terminal doesn't forward
      SGR mouse, PageUp/PageDown + ↑/↓-when-empty still scroll — note which.)

## Part B — co-live regression (light; input is desk-only)
- [ ] B1 A desk-typed prompt still reaches the glasses and renders **once** (no double-render regression).
- [ ] B2 Permission ring round-trip still dismisses on both surfaces.

## Sign-off
- All Part A + B PASS: [ ] yes   Bugs: __________________________
- **User hardware-UAT sign-off (date): __________ → M3.2A DONE (may merge).**
```

- [ ] **Step 3: Commit**

```bash
git add projects/colive-terminal/m3.2a-uat-runbook.md
git commit -m "docs(m3.2a): hardware UAT run-book (composer Part A + co-live regression Part B)"
```

- [ ] **Step 4: STOP — hand the candidate to the user for hardware UAT**

Do **not** merge. Report: the clean-tree test/typecheck output, the commit range, and that M3.2A is a **candidate** awaiting the user's hardware sign-off per spec §0.

---

## Self-Review (completed by the plan author)

**Spec coverage:** §1 multiline (Task 7 + UAT A1) ✓ · §2 mouse/arrows split (Tasks 1,6,9 + A6) ✓ · §3 keymap — cursor/word/line/backspace-word (Task 7, A2), history ↑/↓ (Task 8, A3), wheel + PageUp/End (Task 9, A6), slash menu (Task 10, A5), Ctrl-O/Esc/Ctrl-C preserved (Task 7) ✓ · §4 buffer + dispatcher + render (Tasks 2,5,7) ✓ · §5 per-project persisted history (Tasks 3,8,11, A3) ✓ · §6 slash menu reusable popup (Tasks 4,10) ✓ · §7 paste (usePaste) + mouse enable + emitter tap (Tasks 6,9) ✓ · §8 invariants + tests (every task TDD; pure-Hub-client + zero Core change preserved — no Core file touched) ✓ · §9 UAT run-book (Task 12) ✓.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one judgement call (history key = Hub base URL rather than `/info`) is documented in Task 11 and is a deliberate zero-plumbing simplification of spec §5.

**Type consistency:** `EditBuffer` used throughout (never `Buffer`); `VerticalMove.{buffer,atEdge}` consumed correctly in Task 8; `HistoryStore.{load,append}` and `HistoryNav` consistent across Tasks 3/8; `MenuItem.{name,desc}` consistent across Tasks 4/10; `parseSgrMouse` return `-1|1|null` matches `scrollLine`'s `dir: -1|1` (guarded by the null check).

**Risk note for the builder:** Task 9's paste/wheel tests depend on ink-testing-library routing raw bytes through `usePaste`/`internal_eventEmitter`. The mechanism is confirmed in ink 7.0.5 (`knowledge/terminal-mode/ink7-input-internals.md`); if the *test harness* can't simulate it, verify by logging first and keep the production wiring (it's exercised on hardware in UAT A4/A6) — do not delete the wiring to make a harness limitation "pass".
