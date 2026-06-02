# M3.1 "Readable Transcript" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desk transcript readable — scrollback viewport, inline diffs, syntax highlighting, markdown, a Ctrl-O verbose toggle, a todos panel, and desk-only thinking display — with exactly one tiny Core change.

**Architecture:** Flatten-to-ANSI-rows. The desk reducer turns the `CoLiveEvent` stream into a `Block[]`; pure `render/*` helpers turn each block into an array of ANSI-styled, width-wrapped terminal rows; a pure window function slices `rows[offset .. offset+H]` into the viewport; `app.tsx` wires reducer → rows → window and handles PageUp/PageDown/End/Ctrl-O. The desk client stays a pure Hub client (DI'd `HubClient`, no SDK). The only non-desk change is a new `thinking_delta` event emitted by the Core and passed through the Hub unchanged.

**Tech Stack:** TypeScript, React 19 + ink 7, vitest 4 + ink-testing-library. New deps: `marked` + `marked-terminal` (markdown→ANSI, uses cli-highlight for fenced code), `cli-highlight` (syntax→ANSI), `diff` (jsdiff line diff).

**Spec:** `docs/superpowers/specs/2026-06-01-colive-terminal-m3.1-design.md`. **UAT run-book:** `projects/colive-terminal/m3.1-uat-runbook.md`.

**Conventions:** All commands run from `colive-terminal/`. `npm test` = `vitest run`. `npm run typecheck` = `tsc --noEmit`. Commit small and often. **Do NOT merge — M3.1 is DONE only on user hardware-UAT sign-off (spec §0).**

---

## File structure

**Core (the only non-desk change):**
- Modify `src/core/events.ts` — add `ThinkingDeltaEvent` to the union.
- Modify `src/core/session.ts:473-481` — emit `thinking_delta` on a thinking delta.

**New desk render layer (`src/desk/render/`), each file one responsibility:**
- `ansi.ts` — tiny ANSI color helpers (no new dep).
- `wrap.ts` — ANSI-aware hard-wrap to a width.
- `highlight.ts` — `cli-highlight` wrapper with a plain-text fallback.
- `markdown.ts` — `marked` + `marked-terminal` wrapper.
- `diff.ts` — edit-family input extraction + jsdiff coloring.
- `blocks.ts` — the `Block` model + the event→`Block[]` reducer.
- `rows.ts` — `Block` → ANSI rows dispatch + flatten.
- `window.ts` — pure viewport window/scroll/pin math.

**Modify:**
- `src/desk/app.tsx` — swap the flat `Line[]` reducer for the block model + viewport + keybindings.

**Tests (mirror under `test/`):** `test/core/events.test.ts`, `test/core/session.test.ts` (extend), `test/desk/render/*.test.ts` (new), `test/desk/app.test.tsx` (extend), `test/e2e.test.ts` (extend).

---

## Task 1: Add dependencies

**Files:** Modify `colive-terminal/package.json` + lockfile.

- [ ] **Step 1: Install runtime deps + types**

Run (from `colive-terminal/`):
```bash
npm install marked@^12 marked-terminal@^7 cli-highlight@^2.1.11 diff@^5.2.0
npm install -D @types/diff@^5
```
Expected: installs succeed; `package.json` `dependencies` now lists `marked`, `marked-terminal`, `cli-highlight`, `diff`.

- [ ] **Step 2: Verify typecheck still clean**

Run: `npm run typecheck`
Expected: PASS (no errors). Note: `marked` (v12), `marked-terminal` (v7), and `cli-highlight` ship their own type declarations; only `diff` needs `@types/diff`. If `tsc` reports `Could not find a declaration file for 'marked-terminal'`, create `src/desk/render/marked-terminal.d.ts` with `declare module 'marked-terminal';` and re-run — otherwise skip this.

- [ ] **Step 3: Verify audit + existing tests**

Run: `npm audit --omit=dev && npm test`
Expected: audit reports 0 vulnerabilities (or record any found in the commit message); **237 tests pass**.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(m3.1): add marked, marked-terminal, cli-highlight, diff"
```

---

## Task 2: Core — emit a `thinking_delta` event (the only non-desk change)

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/core/session.ts:473-481`
- Test: `test/core/events.test.ts`, `test/core/session.test.ts`

- [ ] **Step 1: Write the failing Core test (session emits thinking_delta)**

In `test/core/session.test.ts`, inside `describe('ClaudeSession — event normalization', ...)`, add:
```ts
it('emits thinking_delta carrying the SDK thinking text (desk-only render)', async () => {
  const emitted: CoLiveEvent[] = []
  const { fn } = fakeQuery([happyTurnMessages('sess-think')])
  const session = new ClaudeSession({
    config: makeConfig(),
    emit: (e) => emitted.push(e),
    canUseTool: stubCanUseTool,
    query: fn,
  })
  await session.start(undefined, realpathSync(tmpdir()))
  await session.run('think hard')

  // the happy turn streams a thinking_delta with thinking:'secret'
  expect(emitted).toContainEqual({ type: 'thinking_delta', text: 'secret' })
  // and it is STILL never surfaced as assistant text
  expect(emitted.some((e) => e.type === 'text_delta' && e.text.includes('secret'))).toBe(false)
})
```

- [ ] **Step 1b: REWRITE the pre-existing contradictory test (REQUIRED)**

`test/core/session.test.ts:~220` `it('never emits a thinking_delta as any event', ...)` encodes the OLD
desk-leak-suppression behavior and **will fail** once the Core emits `thinking_delta` (its
`expect(serialized).not.toContain('top secret reasoning')` inverts). **Delete that whole test** — the Step-1
test above already covers the positive assertion. To keep its still-valid coverage, append these two lines to the
Step-1 test body (status still brackets thinking, no thinking-as-text):
```ts
  expect(emitted).toContainEqual({ type: 'status', state: 'think_start' })
  expect(emitted).toContainEqual({ type: 'status', state: 'think_end' })
```
**Net:** 1 existing test rewritten/removed (it tested the now-reversed behavior), not "all unchanged."

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/core/session.test.ts`
Expected: FAIL — the new test fails (no `thinking_delta` emitted); the TS compile also flags `{ type: 'thinking_delta' }` as not assignable to `CoLiveEvent` until Step 3.

- [ ] **Step 3: Add the event type**

In `src/core/events.ts`, after `TextDeltaEvent` (around line 56), add:
```ts
/**
 * A streamed chunk of assistant *thinking* text. Desk-only by convention: the
 * closed Even app ignores unknown event types, so the glasses never render it.
 * 🧪 Sourced from the SDK's `content_block_delta` `delta.thinking` (NOT `text`).
 */
export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  text: string
}
```
Add `ThinkingDeltaEvent` to the `CoLiveEvent` union (after `TextDeltaEvent`):
```ts
  | TextDeltaEvent
  | ThinkingDeltaEvent
```

- [ ] **Step 4: Emit it in the Core**

In `src/core/session.ts`, the `content_block_delta` case (around lines 473-481). Replace:
```ts
        if (delta.type === 'text_delta') {
          this.emit({ type: 'text_delta', text: asString(delta.text) })
        }
        // thinking_delta and input_json_delta: NO event (never leak thinking).
        return
```
with:
```ts
        if (delta.type === 'text_delta') {
          this.emit({ type: 'text_delta', text: asString(delta.text) })
        } else if (delta.type === 'thinking_delta') {
          // 🧪 thinking text lives in delta.thinking (not delta.text). Emitted for
          // DESK-ONLY render; the closed Even app ignores unknown event types.
          this.emit({ type: 'thinking_delta', text: asString(delta.thinking) })
        }
        // input_json_delta: still NO event.
        return
```
Also update the file-header comment (lines 27-28) to: `Thinking text is emitted as a desk-only 'thinking_delta' event (the closed Even app ignores it); think_start/think_end status still bracket it.`

- [ ] **Step 5: Run the Core test to verify it passes**

Run: `npm test -- test/core/session.test.ts`
Expected: PASS — the new thinking test passes and all OTHER session tests stay green. (The old `never emits a thinking_delta as any event` test was **rewritten/removed in Step 1b**, not left as-is — it asserted the now-reversed behavior. Net: 1 test rewritten, the rest unchanged.)

- [ ] **Step 6: Extend the vocabulary test**

In `test/core/events.test.ts`: add the import `ThinkingDeltaEvent`; add to the `events` array (after the `text_delta` entry):
```ts
      { type: 'thinking_delta', text: 'hmm' } satisfies ThinkingDeltaEvent,
```
and add `'thinking_delta'` to the expected `new Set([...])` discriminator set.

- [ ] **Step 7: Run it to verify it passes**

Run: `npm test -- test/core/events.test.ts`
Expected: PASS.

- [ ] **Step 8: Full re-verify + commit**

Run: `npm test && npm run typecheck`
Expected: **238+ tests pass**, typecheck clean.
```bash
git add src/core/events.ts src/core/session.ts test/core/events.test.ts test/core/session.test.ts
git commit -m "feat(m3.1): emit desk-only thinking_delta event from the Core"
```

---

## Task 3: `render/ansi.ts` — ANSI color helpers

**Files:** Create `src/desk/render/ansi.ts`, Test `test/desk/render/ansi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { green, red, dim, cyan, bold, italic, gray, stripAnsi } from '../../../src/desk/render/ansi'

describe('ansi helpers', () => {
  it('wraps text in SGR codes and resets', () => {
    expect(green('x')).toBe('\x1b[32mx\x1b[39m')
    expect(red('y')).toBe('\x1b[31my\x1b[39m')
  })
  it('stripAnsi removes all escape sequences (for width math)', () => {
    expect(stripAnsi(green(bold('hi')))).toBe('hi')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/ansi.test.ts`
Expected: FAIL ("Cannot find module ansi").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/ansi.ts
/** Minimal ANSI SGR helpers so the desk can emit pre-colored rows into ink
 *  <Text> nodes without pulling in chalk. Color codes reset with 39/49; style
 *  codes reset with their specific off-code. */
const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`
export const green = sgr(32, 39)
export const red = sgr(31, 39)
export const cyan = sgr(36, 39)
export const gray = sgr(90, 39)
export const dim = sgr(2, 22)
export const bold = sgr(1, 22)
export const italic = sgr(3, 23)
/** Strip every CSI/SGR sequence — used for width measurement and tests. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g
export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/ansi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/ansi.ts test/desk/render/ansi.test.ts
git commit -m "feat(m3.1): ansi color helpers for the row renderer"
```

---

## Task 4: `render/wrap.ts` — ANSI-aware hard-wrap

**Files:** Create `src/desk/render/wrap.ts`, Test `test/desk/render/wrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { wrapAnsi } from '../../../src/desk/render/wrap'
import { green, stripAnsi } from '../../../src/desk/render/ansi'

describe('wrapAnsi', () => {
  it('splits a long plain line into rows no wider than width', () => {
    const rows = wrapAnsi('aaaa bbbb cccc dddd', 9)
    expect(rows.every((r) => stripAnsi(r).length <= 9)).toBe(true)
    expect(rows.join(' ')).toContain('dddd')
  })
  it('measures width ignoring ANSI codes', () => {
    const rows = wrapAnsi(green('aaaaa') + ' ' + green('bbbbb'), 6)
    expect(rows.length).toBe(2)
    expect(stripAnsi(rows[0])).toBe('aaaaa')
  })
  it('hard-breaks a single token longer than width', () => {
    const rows = wrapAnsi('abcdefghij', 4)
    expect(rows.map(stripAnsi)).toEqual(['abcd', 'efgh', 'ij'])
  })
  it('preserves an empty line as a single empty row', () => {
    expect(wrapAnsi('', 10)).toEqual([''])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/wrap.test.ts`
Expected: FAIL ("Cannot find module wrap").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/wrap.ts
import { stripAnsi } from './ansi'

/** Visible length of a string (ANSI escapes don't count). */
const vlen = (s: string): number => stripAnsi(s).length

/**
 * Hard-wrap one logical line to `width` visible columns, ANSI-aware.
 * Greedy word-wrap; a single word longer than width is hard-split. ANSI codes
 * are kept inline (we never split inside an escape because we split on spaces or
 * on visible-character boundaries of plain text). Returns >=1 row; '' -> [''].
 *
 * NOTE: blocks that carry their own ANSI styling (markdown, highlighted code)
 * are wrapped by their producing library to `width` already and pass through
 * here as already-short lines; this function is the safety net + plain-text path.
 */
export function wrapAnsi(line: string, width: number): string[] {
  if (width <= 0) return [line]
  if (vlen(line) <= width) return [line]
  const rows: string[] = []
  let cur = ''
  const flush = () => { rows.push(cur); cur = '' }
  for (const word of line.split(' ')) {
    const sep = cur === '' ? '' : ' '
    if (vlen(cur) + sep.length + vlen(word) <= width) {
      cur += sep + word
      continue
    }
    if (cur !== '') flush()
    // word itself may exceed width -> hard split on visible chars
    let w = word
    while (vlen(w) > width) {
      rows.push(w.slice(0, width))
      w = w.slice(width)
    }
    cur = w
  }
  flush()
  return rows
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/wrap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/wrap.ts test/desk/render/wrap.test.ts
git commit -m "feat(m3.1): ANSI-aware hard-wrap"
```

---

## Task 5: `render/highlight.ts` — syntax highlighting with fallback

**Files:** Create `src/desk/render/highlight.ts`, Test `test/desk/render/highlight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { highlight } from '../../../src/desk/render/highlight'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('highlight', () => {
  it('returns the same visible text it was given', () => {
    const out = highlight('const x = 1', 'typescript')
    expect(stripAnsi(out)).toBe('const x = 1')
  })
  it('adds ANSI color for a known language', () => {
    const out = highlight('const x = 1', 'typescript')
    expect(out).not.toBe(stripAnsi(out)) // some escapes were added
  })
  it('falls back to plain text for an unknown language (no throw)', () => {
    const out = highlight('weird ::: code', 'no-such-lang-xyz')
    expect(stripAnsi(out)).toBe('weird ::: code')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/highlight.test.ts`
Expected: FAIL ("Cannot find module highlight").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/highlight.ts
import { highlight as cliHighlight } from 'cli-highlight'

/**
 * Syntax-highlight a code string to ANSI. Safe by construction: an unknown
 * language or any throw falls back to the original plain text. `cli-highlight`
 * auto-detects when `language` is omitted/unknown via `ignoreIllegals`.
 */
export function highlight(code: string, language?: string): string {
  try {
    return cliHighlight(code, { language, ignoreIllegals: true })
  } catch {
    return code
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/highlight.test.ts`
Expected: PASS. (If `cli-highlight` throws on an unknown `language` rather than auto-detecting, the `catch` returns plain text — the test still passes.)

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/highlight.ts test/desk/render/highlight.test.ts
git commit -m "feat(m3.1): syntax highlighting with plain-text fallback"
```

---

## Task 6: `render/markdown.ts` — markdown→ANSI

**Files:** Create `src/desk/render/markdown.ts`, Test `test/desk/render/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../../src/desk/render/markdown'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('renderMarkdown', () => {
  it('renders a heading without the raw # marker', () => {
    const out = renderMarkdown('# Title', 80)
    expect(stripAnsi(out)).toContain('Title')
    expect(stripAnsi(out)).not.toContain('# Title')
  })
  it('renders bullets and bold (no raw * markers)', () => {
    const out = stripAnsi(renderMarkdown('- one\n- two\n\n**bold**', 80))
    expect(out).toContain('one')
    expect(out).toContain('two')
    expect(out).toContain('bold')
    expect(out).not.toContain('**bold**')
  })
  it('applies ANSI styling (output differs from its plain text)', () => {
    const out = renderMarkdown('# Title', 80)
    expect(out).not.toBe(stripAnsi(out))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/markdown.test.ts`
Expected: FAIL ("Cannot find module markdown").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/markdown.ts
import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

/**
 * Render Markdown to an ANSI string sized to `width`. marked-terminal handles
 * headings/lists/bold/blockquotes and uses cli-highlight for fenced code. We
 * configure once per width (cheap) and parse synchronously.
 */
export function renderMarkdown(md: string, width: number): string {
  const m = new marked.Marked()
  // marked-terminal returns a renderer extension; options control wrapping width.
  m.use(markedTerminal({ width, reflowText: true }) as Parameters<typeof m.use>[0])
  const out = m.parse(md, { async: false }) as string
  // marked appends a trailing newline; trim it so row-flattening is exact.
  return out.replace(/\n+$/,'')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/markdown.test.ts`
Expected: PASS. (If the `marked-terminal` v7 export/signature differs, adapt the `m.use(...)` call so the three assertions hold — the contract under test is observable output, not the library's internal API.)

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/markdown.ts test/desk/render/markdown.test.ts
git commit -m "feat(m3.1): markdown to ANSI via marked-terminal"
```

---

## Task 7: `render/diff.ts` — edit extraction + colored diff

**Files:** Create `src/desk/render/diff.ts`, Test `test/desk/render/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { extractEditDiff, renderDiff } from '../../../src/desk/render/diff'
import { stripAnsi } from '../../../src/desk/render/ansi'

describe('extractEditDiff', () => {
  it('extracts old/new for an Edit', () => {
    const d = extractEditDiff('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' })
    expect(d).toEqual([{ oldStr: 'x', newStr: 'y', lang: 'typescript' }])
  })
  it('treats a Write as all-additions', () => {
    const d = extractEditDiff('Write', { file_path: '/a.md', content: 'hello' })
    expect(d).toEqual([{ oldStr: '', newStr: 'hello', lang: 'markdown' }])
  })
  it('expands MultiEdit into one entry per edit', () => {
    const d = extractEditDiff('MultiEdit', {
      file_path: '/a.ts',
      edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }],
    })
    expect(d?.length).toBe(2)
  })
  it('returns undefined for a non-edit tool', () => {
    expect(extractEditDiff('Bash', { command: 'ls' })).toBeUndefined()
  })
})

describe('renderDiff', () => {
  it('marks removed lines with - and added lines with + (visible text)', () => {
    const out = stripAnsi(renderDiff({ oldStr: 'a\n', newStr: 'b\n' }, 80))
    expect(out).toContain('- a')
    expect(out).toContain('+ b')
  })
  it('colors output (differs from plain text)', () => {
    const out = renderDiff({ oldStr: 'a\n', newStr: 'b\n' }, 80)
    expect(out).not.toBe(stripAnsi(out))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/diff.test.ts`
Expected: FAIL ("Cannot find module diff" — our module, not the npm one).

- [ ] **Step 3: Implement**

```ts
// src/desk/render/diff.ts
import { diffLines } from 'diff'
import { green, red, gray, stripAnsi } from './ansi'
import { highlight } from './highlight'

export interface DiffInput {
  oldStr: string
  newStr: string
  /** language hint for syntax highlighting, derived from the file extension. */
  lang?: string
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c',
  cpp: 'cpp', sh: 'bash', json: 'json', md: 'markdown', html: 'html',
  css: 'css', yml: 'yaml', yaml: 'yaml',
}
const langOf = (path: unknown): string | undefined => {
  if (typeof path !== 'string') return undefined
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext]
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/**
 * Map an edit-family tool's input to one or more (old,new) diffs, with a
 * language hint. Returns undefined for non-edit tools (the caller renders those
 * as a plain tool line).
 */
export function extractEditDiff(toolName: string, input: unknown): DiffInput[] | undefined {
  const i = rec(input)
  const lang = langOf(i.file_path)
  switch (toolName) {
    case 'Edit':
      return [{ oldStr: str(i.old_string), newStr: str(i.new_string), lang }]
    case 'Write':
      return [{ oldStr: '', newStr: str(i.content), lang }]
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? i.edits : []
      return edits.map((e) => {
        const er = rec(e)
        return { oldStr: str(er.old_string), newStr: str(er.new_string), lang }
      })
    }
    default:
      return undefined
  }
}

/**
 * Render a single (old,new) diff as colored ANSI lines: removed lines red with
 * a "- " gutter, added lines green with "+ ", context dim with "  ". Code is
 * syntax-highlighted per `lang` (added/context lines; removed lines are dimmed).
 */
export function renderDiff(d: DiffInput, _width: number): string {
  const parts = diffLines(d.oldStr, d.newStr)
  const out: string[] = []
  for (const part of parts) {
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop() // drop trailing empty
    for (const line of lines) {
      if (part.added) out.push(green('+ ' + stripAnsi(highlight(line, d.lang))))
      else if (part.removed) out.push(red('- ' + line))
      else out.push(gray('  ' + line))
    }
  }
  return out.join('\n')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/diff.ts test/desk/render/diff.test.ts
git commit -m "feat(m3.1): edit-family diff extraction + colored rendering"
```

---

## Task 8: `render/blocks.ts` — the Block model + reducer

**Files:** Create `src/desk/render/blocks.ts`, Test `test/desk/render/blocks.test.ts`

This replaces the `Line[]` model and the `transcriptReducer`/`applyEvent` logic currently inside `app.tsx` (lines 62-162). The reducer is pure and lives here so it is unit-tested without ink.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { reduceBlocks, initialBlockState } from '../../../src/desk/render/blocks'
import type { BlockState } from '../../../src/desk/render/blocks'

const run = (events: any[]): BlockState =>
  events.reduce((s, event) => reduceBlocks(s, { type: 'event', event }), initialBlockState())

describe('reduceBlocks', () => {
  it('accumulates text_delta into one open assistant block', () => {
    const s = run([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ])
    expect(s.blocks).toEqual([{ kind: 'assistant', text: 'Hello', closed: false }])
  })

  it('folds tool_start then tool_end into ONE keyed tool block', () => {
    const s = run([
      { type: 'tool_start', name: 'Read', toolId: 't1' },
      { type: 'tool_end', name: 'Read', toolId: 't1', summary: 'read a', detail: { input: { file_path: '/a' }, output: 'x' } },
    ])
    const tools = s.blocks.filter((b) => b.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ kind: 'tool', toolId: 't1', name: 'Read', summary: 'read a' })
  })

  it('accumulates thinking_delta into a thinking block, even with no think_start', () => {
    const s = run([
      { type: 'thinking_delta', text: 'mulling ' },
      { type: 'thinking_delta', text: 'it over' },
    ])
    expect(s.blocks).toEqual([{ kind: 'thinking', text: 'mulling it over', closed: false }])
  })

  it('closes the open assistant on result so the next reply starts fresh', () => {
    const s = run([
      { type: 'text_delta', text: 'a' },
      { type: 'result', success: true, text: 'a', sessionId: 's', costUsd: 0, provider: 'claude', turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 },
      { type: 'text_delta', text: 'b' },
    ])
    const assistants = s.blocks.filter((b) => b.kind === 'assistant')
    expect(assistants).toHaveLength(2)
    // the first (pre-result) assistant is CLOSED so it renders markdown, not raw text
    expect((assistants[0] as { closed: boolean }).closed).toBe(true)
  })

  it('renders TodoWrite as a single todos block that updates in place', () => {
    const s = run([
      { type: 'tool_start', name: 'TodoWrite', toolId: 'td1' },
      { type: 'tool_end', name: 'TodoWrite', toolId: 'td1', summary: '', detail: { input: { todos: [{ content: 'A', status: 'pending' }] }, output: '' } },
      { type: 'tool_start', name: 'TodoWrite', toolId: 'td2' },
      { type: 'tool_end', name: 'TodoWrite', toolId: 'td2', summary: '', detail: { input: { todos: [{ content: 'A', status: 'completed' }] }, output: '' } },
    ])
    const todos = s.blocks.filter((b) => b.kind === 'todos')
    expect(todos).toHaveLength(1)
    expect(todos[0]).toEqual({ kind: 'todos', items: [{ content: 'A', status: 'completed' }] })
  })

  it('clear empties the blocks; reset seeds from transcript entries', () => {
    const seeded = reduceBlocks(initialBlockState(), {
      type: 'reset',
      entries: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }],
    })
    expect(seeded.blocks).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'yo', closed: true },
    ])
    expect(reduceBlocks(seeded, { type: 'clear' }).blocks).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/blocks.test.ts`
Expected: FAIL ("Cannot find module blocks").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/blocks.ts
import type { CoLiveEvent } from '../../core/events'
import type { TranscriptEntry } from '../client'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One logical unit of the transcript. Each kind renders to ANSI rows (rows.ts). */
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; closed: boolean }
  | { kind: 'tool'; toolId: string; name: string; summary?: string; detail?: { input: unknown; output: unknown } }
  | { kind: 'thinking'; text: string; closed: boolean }
  | { kind: 'todos'; items: TodoItem[] }
  | { kind: 'note'; text: string }

export interface BlockState {
  blocks: Block[]
  /** Index of the open assistant block (text_delta target), or -1. */
  openAssistant: number
  /** Index of the open thinking block (thinking_delta target), or -1. */
  openThinking: number
}

export const initialBlockState = (): BlockState => ({ blocks: [], openAssistant: -1, openThinking: -1 })

export type BlockAction =
  | { type: 'reset'; entries: TranscriptEntry[] }
  | { type: 'clear' }
  | { type: 'event'; event: CoLiveEvent }
  | { type: 'localUser'; text: string }
  | { type: 'note'; text: string }

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

/** Parse the TodoWrite input.todos into typed items (defensive). */
function parseTodos(input: unknown): TodoItem[] {
  const todos = rec(input).todos
  if (!Array.isArray(todos)) return []
  return todos.map((t) => {
    const r = rec(t)
    const status = r.status === 'in_progress' || r.status === 'completed' ? r.status : 'pending'
    return { content: typeof r.content === 'string' ? r.content : '', status }
  })
}

function entryToBlock(entry: TranscriptEntry): Block {
  if (entry.role === 'assistant') return { kind: 'assistant', text: entry.text, closed: true }
  if (entry.role === 'user') return { kind: 'user', text: entry.text }
  return { kind: 'note', text: `${entry.role}: ${entry.text}` }
}

export function reduceBlocks(state: BlockState, action: BlockAction): BlockState {
  switch (action.type) {
    case 'reset':
      return { blocks: action.entries.map(entryToBlock), openAssistant: -1, openThinking: -1 }
    case 'clear':
      return initialBlockState()
    case 'note':
      return { ...state, blocks: [...state.blocks, { kind: 'note', text: action.text }], openAssistant: -1, openThinking: -1 }
    case 'localUser':
      return { ...state, blocks: [...state.blocks, { kind: 'user', text: action.text }], openAssistant: -1, openThinking: -1 }
    case 'event':
      return applyEvent(state, action.event)
    default:
      return state
  }
}

/**
 * Mark the currently-open assistant + thinking blocks `closed: true`, so a finished
 * assistant renders markdown (rows.ts gates markdown on `closed`) and finished
 * thinking collapses to its stub. Pure — returns a new blocks array. Call this
 * whenever we move off an open block.
 */
function closeOpen(state: BlockState): Block[] {
  const next = state.blocks.slice()
  if (state.openAssistant >= 0 && next[state.openAssistant]?.kind === 'assistant') {
    const a = next[state.openAssistant] as Extract<Block, { kind: 'assistant' }>
    next[state.openAssistant] = { ...a, closed: true }
  }
  if (state.openThinking >= 0 && next[state.openThinking]?.kind === 'thinking') {
    const t = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
    next[state.openThinking] = { ...t, closed: true }
  }
  return next
}

function applyEvent(state: BlockState, event: CoLiveEvent): BlockState {
  const blocks = state.blocks
  switch (event.type) {
    case 'user_prompt':
      // close any open assistant/thinking from the prior turn before the new prompt
      return { blocks: [...closeOpen(state), { kind: 'user', text: event.text }], openAssistant: -1, openThinking: -1 }

    case 'text_delta': {
      const next = blocks.slice()
      if (state.openAssistant >= 0 && next[state.openAssistant]?.kind === 'assistant') {
        const open = next[state.openAssistant] as Extract<Block, { kind: 'assistant' }>
        next[state.openAssistant] = { ...open, text: open.text + event.text }
        return { ...state, blocks: next }
      }
      next.push({ kind: 'assistant', text: event.text, closed: false })
      return { ...state, blocks: next, openAssistant: next.length - 1, openThinking: -1 }
    }

    case 'thinking_delta': {
      const next = blocks.slice()
      if (state.openThinking >= 0 && next[state.openThinking]?.kind === 'thinking') {
        const open = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
        next[state.openThinking] = { ...open, text: open.text + event.text }
        return { ...state, blocks: next }
      }
      next.push({ kind: 'thinking', text: event.text, closed: false })
      return { ...state, blocks: next, openThinking: next.length - 1, openAssistant: -1 }
    }

    case 'status': {
      // close the open thinking block when thinking ends; close assistant on text_end
      if (event.state === 'think_end' && state.openThinking >= 0) {
        const next = blocks.slice()
        const open = next[state.openThinking] as Extract<Block, { kind: 'thinking' }>
        next[state.openThinking] = { ...open, closed: true }
        return { ...state, blocks: next, openThinking: -1 }
      }
      return state
    }

    case 'tool_start': {
      if (event.name === 'TodoWrite') return state // panel is built on tool_end
      // close the open assistant/thinking first so a pre-tool answer segment renders markdown
      return { blocks: [...closeOpen(state), { kind: 'tool', toolId: event.toolId, name: event.name }], openAssistant: -1, openThinking: -1 }
    }

    case 'tool_end': {
      if (event.name === 'TodoWrite') {
        const items = parseTodos(event.detail?.input)
        const next = blocks.slice()
        const idx = next.findIndex((b) => b.kind === 'todos')
        if (idx >= 0) next[idx] = { kind: 'todos', items }
        else next.push({ kind: 'todos', items })
        return { ...state, blocks: next, openAssistant: -1, openThinking: -1 }
      }
      // fold into the matching open tool block (keyed by toolId)
      const next = blocks.slice()
      const idx = next.findIndex((b) => b.kind === 'tool' && b.toolId === event.toolId)
      const folded: Block = { kind: 'tool', toolId: event.toolId, name: event.name, summary: event.summary, detail: event.detail }
      if (idx >= 0) next[idx] = folded
      else next.push(folded)
      return { ...state, blocks: next, openAssistant: -1, openThinking: -1 }
    }

    case 'result':
      // close the open assistant + thinking so the finished answer renders markdown
      // (rows.ts gates markdown on `closed`) and thinking collapses to its stub.
      return { ...state, blocks: closeOpen(state), openAssistant: -1, openThinking: -1 }

    case 'notification':
      return { ...state, blocks: [...blocks, { kind: 'note', text: `${event.title}: ${event.message}` }], openAssistant: -1, openThinking: -1 }

    case 'error':
      return { ...state, blocks: [...blocks, { kind: 'note', text: `error: ${event.message}` }], openAssistant: -1, openThinking: -1 }

    default:
      // running_stats / permission_* / user_question / task_progress: handled outside the transcript
      return state
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/blocks.ts test/desk/render/blocks.test.ts
git commit -m "feat(m3.1): block model + event reducer (tools keyed, todos in place, thinking)"
```

---

## Task 9: `render/rows.ts` — blocks → ANSI rows

**Files:** Create `src/desk/render/rows.ts`, Test `test/desk/render/rows.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { renderBlockRows, flattenRows } from '../../../src/desk/render/rows'
import type { Block } from '../../../src/desk/render/blocks'
import { stripAnsi } from '../../../src/desk/render/ansi'

const opts = { width: 80, verbose: false }

describe('renderBlockRows', () => {
  it('user block renders one labeled row', () => {
    const rows = renderBlockRows({ kind: 'user', text: 'hi there' }, opts)
    expect(rows.map(stripAnsi).join('\n')).toContain('hi there')
  })

  it('tool block collapsed = one summary line; verbose = adds input/output', () => {
    const block: Block = { kind: 'tool', toolId: 't1', name: 'Read', summary: 'read /a', detail: { input: { file_path: '/a' }, output: 'contents' } }
    const collapsed = renderBlockRows(block, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(collapsed).toContain('Read')
    expect(collapsed).not.toContain('contents')
    const verbose = renderBlockRows(block, { width: 80, verbose: true }).map(stripAnsi).join('\n')
    expect(verbose).toContain('contents')
  })

  it('edit-family tool renders an inline diff regardless of verbose', () => {
    const block: Block = { kind: 'tool', toolId: 't2', name: 'Edit', summary: 'edit /a.ts', detail: { input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' }, output: 'ok' } }
    const rows = renderBlockRows(block, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(rows).toContain('- x')
    expect(rows).toContain('+ y')
  })

  it('thinking block collapses to a stub when closed and not verbose', () => {
    const open = renderBlockRows({ kind: 'thinking', text: 'a\nb', closed: false }, opts).map(stripAnsi).join('\n')
    expect(open).toContain('a')
    const closed = renderBlockRows({ kind: 'thinking', text: 'a\nb', closed: true }, { width: 80, verbose: false }).map(stripAnsi).join('\n')
    expect(closed).toContain('thinking')
    expect(closed).not.toContain('\nb')
  })

  it('todos block renders a checklist with status markers', () => {
    const rows = renderBlockRows({ kind: 'todos', items: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }] }, opts).map(stripAnsi).join('\n')
    expect(rows).toContain('A')
    expect(rows).toContain('B')
    expect(rows).toMatch(/\[x\]|✔|done/i)
  })

  it('assistant renders raw while open, markdown once closed', () => {
    const open = renderBlockRows({ kind: 'assistant', text: '# Title', closed: false }, opts).map(stripAnsi).join('\n')
    expect(open).toContain('# Title') // raw passthrough while streaming (no flicker)
    const closed = renderBlockRows({ kind: 'assistant', text: '# Title', closed: true }, opts).map(stripAnsi).join('\n')
    expect(closed).toContain('Title')
    expect(closed).not.toContain('# Title') // markdown-rendered: the raw # marker is gone
  })
})

describe('flattenRows', () => {
  it('concatenates rows for all blocks in order', () => {
    const rows = flattenRows([{ kind: 'user', text: 'one' }, { kind: 'note', text: 'two' }], opts)
    const text = rows.map(stripAnsi).join('\n')
    expect(text.indexOf('one')).toBeLessThan(text.indexOf('two'))
  })
  it('every produced row fits within width', () => {
    const long = 'word '.repeat(60).trim()
    const rows = flattenRows([{ kind: 'user', text: long }], { width: 20, verbose: false })
    expect(rows.every((r) => stripAnsi(r).length <= 20)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/rows.test.ts`
Expected: FAIL ("Cannot find module rows").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/rows.ts
import type { Block, TodoItem } from './blocks'
import { cyan, green, gray, dim, italic, bold } from './ansi'
import { wrapAnsi } from './wrap'
import { renderMarkdown } from './markdown'
import { extractEditDiff, renderDiff } from './diff'

export interface RenderOpts {
  width: number
  /** Ctrl-O global verbose: show tool input/output + expand closed thinking. */
  verbose: boolean
}

/** Split a possibly-multiline ANSI string into width-wrapped rows. */
const toRows = (s: string, width: number): string[] =>
  s.split('\n').flatMap((line) => wrapAnsi(line, width))

const TODO_MARK: Record<TodoItem['status'], string> = {
  completed: '[x]',
  in_progress: '[~]',
  pending: '[ ]',
}

export function renderBlockRows(block: Block, opts: RenderOpts): string[] {
  const { width, verbose } = opts
  switch (block.kind) {
    case 'user':
      return toRows(`${cyan('you')}  ${block.text}`, width)

    case 'assistant':
      // stream raw while open; markdown-render once closed (avoids half-parsed flicker)
      return block.closed
        ? toRows(renderMarkdown(block.text, width), width)
        : toRows(`${green('claude')}  ${block.text}`, width)

    case 'thinking': {
      if (!block.closed || verbose) {
        const header = dim(italic('💭 thinking'))
        const body = block.text.split('\n').map((l) => dim(italic(l)))
        return [header, ...body].flatMap((line) => wrapAnsi(line, width))
      }
      const n = block.text.split('\n').length
      return toRows(dim(`💭 thinking (${n} lines) — Ctrl-O`), width)
    }

    case 'tool': {
      const head = `${dim('⚙')} ${block.name}${block.summary ? ` — ${block.summary}` : ''}`
      const rows = toRows(dim(head), width)
      // inline diff for edit-family tools (always, not just verbose)
      const diffs = block.detail ? extractEditDiff(block.name, block.detail.input) : undefined
      if (diffs) for (const d of diffs) rows.push(...toRows(renderDiff(d, width), width))
      // verbose: raw input/output for any tool
      if (verbose && block.detail) {
        rows.push(...toRows(gray('  input:  ' + safeJson(block.detail.input)), width))
        rows.push(...toRows(gray('  output: ' + safeJson(block.detail.output)), width))
      }
      return rows
    }

    case 'todos': {
      const header = bold('Todos')
      const items = block.items.map((t) => {
        const line = `  ${TODO_MARK[t.status]} ${t.content}`
        return t.status === 'completed' ? gray(line) : t.status === 'in_progress' ? green(line) : line
      })
      return [header, ...items].flatMap((line) => wrapAnsi(line, width))
    }

    case 'note':
    default:
      return toRows(dim((block as { text: string }).text), width)
  }
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Flatten every block to a single ANSI row buffer (the viewport input). */
export function flattenRows(blocks: Block[], opts: RenderOpts): string[] {
  return blocks.flatMap((b) => renderBlockRows(b, opts))
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/rows.ts test/desk/render/rows.test.ts
git commit -m "feat(m3.1): block-to-ANSI-rows renderer (inline diff, verbose, thinking stub, todos)"
```

---

## Task 10: `render/window.ts` — viewport window/scroll/pin math

**Files:** Create `src/desk/render/window.ts`, Test `test/desk/render/window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeWindow, scrollPage, pinBottom, afterContentChange, initialViewport } from '../../../src/desk/render/window'

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
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/desk/render/window.test.ts`
Expected: FAIL ("Cannot find module window").

- [ ] **Step 3: Implement**

```ts
// src/desk/render/window.ts
export interface ViewportState {
  /** Index of the first visible row. */
  offset: number
  /** True when tracking the bottom (streaming auto-follows). */
  pinned: boolean
}

export interface WindowResult {
  visible: string[]
  offset: number
  total: number
  pinned: boolean
}

const maxOffset = (total: number, height: number): number => Math.max(0, total - height)
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

export const initialViewport = (): ViewportState => ({ offset: 0, pinned: true })

export const pinBottom = (total: number, height: number): ViewportState => ({
  offset: maxOffset(total, height),
  pinned: true,
})

export function computeWindow(rows: string[], height: number, vp: ViewportState): WindowResult {
  const total = rows.length
  const off = vp.pinned ? maxOffset(total, height) : clamp(vp.offset, 0, maxOffset(total, height))
  return { visible: rows.slice(off, off + height), offset: off, total, pinned: vp.pinned }
}

/** Scroll by one page; dir -1 = up, +1 = down. Re-pins when it lands at bottom. */
export function scrollPage(vp: ViewportState, total: number, height: number, dir: -1 | 1): ViewportState {
  const max = maxOffset(total, height)
  const base = vp.pinned ? max : vp.offset
  const offset = clamp(base + dir * height, 0, max)
  return { offset, pinned: offset >= max }
}

/** After the row buffer changes: follow bottom if pinned, else hold (clamped). */
export function afterContentChange(vp: ViewportState, total: number, height: number): ViewportState {
  const max = maxOffset(total, height)
  if (vp.pinned) return { offset: max, pinned: true }
  return { offset: clamp(vp.offset, 0, max), pinned: false }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- test/desk/render/window.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/render/window.ts test/desk/render/window.test.ts
git commit -m "feat(m3.1): pure viewport window/scroll/pin math"
```

---

## Task 11: Integrate into `app.tsx` — viewport + keybindings

**Files:** Modify `src/desk/app.tsx`, Test `test/desk/app.test.tsx` (extend)

Replace the `Line[]` model (lines 62-162), the transcript render (lines 438-489), and the input handler additions. Keep ALL existing behavior: sendPrompt/new-session/permission/question/Esc/Ctrl-C, the `permission_result` dismiss, status line, transcript seeding. The reducer becomes `reduceBlocks`; rendering goes through `flattenRows` + `computeWindow`.

- [ ] **Step 1: Write the failing tests (extend app.test.tsx)**

Add these tests (the file already builds a `FakeHub` and renders `<App>`); use the existing `render`/`act`/`lastFrame` patterns:
```ts
it('renders streamed assistant text in the viewport', async () => {
  const hub = makeFakeHub()
  const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
  try {
    await act(async () => {})
    act(() => { hub.emit({ type: 'text_delta', text: 'hello viewport' }) })
    expect(lastFrame()).toContain('hello viewport')
  } finally { unmount() }
})

it('Ctrl-O toggles tool verbose detail', async () => {
  const hub = makeFakeHub()
  const { lastFrame, stdin, unmount } = render(<App client={hub} sessionId="s1" />)
  try {
    await act(async () => {})
    act(() => {
      hub.emit({ type: 'tool_start', name: 'Read', toolId: 't1' })
      hub.emit({ type: 'tool_end', name: 'Read', toolId: 't1', summary: 'read', detail: { input: { file_path: '/a' }, output: 'SECRET_OUTPUT' } })
    })
    expect(lastFrame()).not.toContain('SECRET_OUTPUT')
    act(() => { stdin.write('\x0f') }) // Ctrl-O
    expect(lastFrame()).toContain('SECRET_OUTPUT')
  } finally { unmount() }
})

it('renders an inline diff for an Edit tool', async () => {
  const hub = makeFakeHub()
  const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
  try {
    await act(async () => {})
    act(() => {
      hub.emit({ type: 'tool_start', name: 'Edit', toolId: 'e1' })
      hub.emit({ type: 'tool_end', name: 'Edit', toolId: 'e1', summary: 'edit', detail: { input: { file_path: '/a.ts', old_string: 'OLDLINE', new_string: 'NEWLINE' }, output: 'ok' } })
    })
    const f = lastFrame() ?? ''
    expect(f).toContain('OLDLINE')
    expect(f).toContain('NEWLINE')
  } finally { unmount() }
})

it('renders thinking text on the desk, distinct from the answer', async () => {
  const hub = makeFakeHub()
  const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
  try {
    await act(async () => {})
    act(() => { hub.emit({ type: 'thinking_delta', text: 'pondering deeply' }) })
    expect(lastFrame()).toContain('pondering deeply')
  } finally { unmount() }
})
```
(Keep every existing app.test.tsx test unchanged — they must still pass.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -- test/desk/app.test.tsx`
Expected: the four new tests FAIL (no viewport/verbose/diff/thinking rendering yet); existing tests still pass.

- [ ] **Step 3: Rewire `app.tsx`**

Make these concrete edits:

1. **Imports** — replace the `Line`/transcript types with the render layer:
```ts
import { reduceBlocks, initialBlockState } from './render/blocks'
import { flattenRows } from './render/rows'
import { computeWindow, scrollPage, pinBottom, afterContentChange, initialViewport } from './render/window'
import type { ViewportState } from './render/window'
import { useStdout } from 'ink'
```
Delete the local `Line`, `TranscriptState`, `TranscriptAction`, `entryToLine`, `transcriptReducer`, `applyEvent`, and `TranscriptLine` definitions (lines ~62-162 and ~463-489) — they now live in `render/`.

2. **State** — swap the reducer + add viewport/verbose/size:
```ts
const [transcript, dispatch] = useReducer(reduceBlocks, undefined, initialBlockState)
const [verbose, setVerbose] = useState(false)
const [viewport, setViewport] = useState<ViewportState>(initialViewport)
const { stdout } = useStdout()
const width = (stdout?.columns ?? 80)
const reserved = 3 // status line + input line + prompt chrome
const height = Math.max(4, (stdout?.rows ?? 24) - reserved)
```

3. **Dispatch shape** — the reducer actions changed names: `{ type:'reset', entries }` (was `lines`), `{ type:'localUser', text }`, `{ type:'note', text }`, `{ type:'clear' }`, `{ type:'event', event }`. Update the four call sites accordingly (e.g. `dispatch({ type: 'reset', entries: seeded })` instead of mapping to lines).

4. **Rows + window** — compute each render, but **MEMOIZE the flatten** so `marked` + `cli-highlight`
   don't re-run over every block on each keystroke / 10s `running_stats` tick. `transcript.blocks` only
   changes on a transcript event (not on input edits), so the memo skips the expensive work while typing.
   **Add `useMemo` to the existing `react` import.**
```ts
const rows = useMemo(
  () => flattenRows(transcript.blocks, { width, verbose }),
  [transcript.blocks, width, verbose],
)
// follow bottom while streaming; hold position when scrolled up
useEffect(() => { setViewport((vp) => afterContentChange(vp, rows.length, height)) }, [rows.length, height])
const win = computeWindow(rows, height, viewport)
```

5. **Keybindings** — in the existing `useInput`, BEFORE the printable-char branch and only when no `pending` prompt is open, add:
```ts
if (key.pageUp)   { setViewport((vp) => scrollPage(vp, rows.length, height, -1)); return }
if (key.pageDown) { setViewport((vp) => scrollPage(vp, rows.length, height, 1)); return }
if (key.ctrl && (ch === 'o' || ch === 'O')) { setVerbose((v) => !v); return }
// End key: ink exposes it as key.end on most terminals
if ((key as { end?: boolean }).end) { setViewport(pinBottom(rows.length, height)); return }
```
(Leave the existing Esc / Ctrl-C / Enter / backspace / printable handlers exactly as they are. Arrow keys remain untouched.)

6. **Render** — replace the transcript `<Box>` (lines 438-443) with the windowed rows, and add a scroll indicator:
```tsx
<Box flexDirection="column">
  {win.visible.map((row, i) => (
    <Text key={win.offset + i} wrap="truncate-end">{row}</Text>
  ))}
</Box>
{rows.length > height ? (
  <Box>
    <Text dimColor>
      rows {win.offset + 1}–{Math.min(win.offset + height, win.total)} of {win.total} {win.pinned ? '(pinned ▼)' : '▲▼ PgUp/PgDn · End'}
    </Text>
  </Box>
) : null}
```
Keep the `pending` prompt block, the status line, and the input line exactly as they are.

- [ ] **Step 4: Run the desk tests**

Run: `npm test -- test/desk/app.test.tsx`
Expected: PASS — the four new tests pass and **all pre-existing app tests still pass** (co-live, permission dismiss, /clear, Esc, question text). If ink's `key.end`/`key.pageUp` names differ in this ink version, verify against `node_modules/ink/build/components/useInput` and adjust the property names so the keybinding tests pass.

- [ ] **Step 5: Full re-verify + commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean.
```bash
git add src/desk/app.tsx test/desk/app.test.tsx
git commit -m "feat(m3.1): viewport + block rendering + PgUp/PgDn/End/Ctrl-O in the desk app"
```

---

## Task 12: e2e — thinking_delta flows end-to-end; full regression

**Files:** Modify `test/e2e.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that drives the REAL Core+Hub (the existing e2e harness) so a turn whose SDK stream includes a `thinking_delta` produces a `thinking_delta` SSE frame received by a subscriber, and a separate subscriber that ignores unknown types is unaffected. Follow the file's existing harness (its fake `query`, `createApp`, `createSseHub`, real `createHubClient`); model the thinking message on `test/core/session.test.ts`'s `content_block_delta` `{ type:'thinking_delta', thinking:'...' }`. Assert:
```ts
// the desk subscriber receives a thinking_delta carrying the text
expect(received.some((e) => e.type === 'thinking_delta' && e.text === '<the thinking text>')).toBe(true)
// a co-live subscriber that ignores unknown types still gets the normal stream intact
expect(otherReceived.filter((e) => e.type === 'text_delta').length).toBeGreaterThan(0)
```
(Match the exact harness shape already in `test/e2e.test.ts` — reuse its scripted-turn builder rather than inventing a new one.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/e2e.test.ts`
Expected: FAIL only if the harness doesn't yet script a thinking delta; once the message is added it should pass against the Task 2 Core change.

- [ ] **Step 3: Make it pass**

Add the thinking `stream_event` message to the e2e's scripted turn (mirroring the session test). No further Core/Hub change is needed — `thinking_delta` already serializes via `sse.ts` and the union already includes it.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/e2e.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/e2e.test.ts
git commit -m "test(m3.1): e2e proves thinking_delta reaches a subscriber, co-live intact"
```

---

## Task 13: Candidate verification (NOT a merge)

**Files:** none (verification only).

- [ ] **Step 1: Controller re-verify from a clean tree**

Run:
```bash
git status   # expect: clean
npm ci
npm run typecheck
npm test
```
Expected: typecheck clean; **all tests pass** (≈250+). Record the exact test count in the handoff. Do NOT trust any agent's self-reported "done" — this clean-tree run is the precondition gate.

- [ ] **Step 2: Capture findings (CLAUDE.md auto-capture)**

- Append a dated bullet to `PROGRESS.md` (M3.1 candidate built; what shipped; test count; "awaiting hardware UAT").
- Note in `knowledge/terminal-mode/overview.md` the new `thinking_delta` event + the flatten-to-rows desk renderer (tagged 🧪, sourced to this plan/spec).
- Update `projects/colive-terminal/status.md` to "M3.1 candidate — awaiting hardware UAT."
- Commit:
```bash
git add PROGRESS.md knowledge/terminal-mode/overview.md projects/colive-terminal/status.md
git commit -m "docs(m3.1): record Readable-transcript candidate; awaiting hardware UAT"
```

- [ ] **Step 3: HARD STOP — hand to the user for hardware UAT**

Per spec §0: green tests are the precondition, **not done**. The build produces a CANDIDATE. The user runs `projects/colive-terminal/m3.1-uat-runbook.md` on the real **G2 + R1** (Part A A1–A6 desk features + Part B B1–B4 co-live regression). Bugs found → fix → re-UAT the affected items. **Do NOT merge** until the user signs off with a date. Only the user closes the rung.

---

## Self-review (completed against the spec)

- **Spec coverage:** scrollback viewport → Tasks 9-11; diff inline → Tasks 7,9 + app test; syntax highlight → Tasks 5,6,7; markdown → Task 6,9; Ctrl-O global verbose → Tasks 9,11; todos in place → Tasks 8,9; thinking (Core event + desk render + collapse) → Tasks 2,8,9,11; broadcast-and-ignore (B2) → Task 12; deps → Task 1; invariants/237-green + clean-tree gate → Tasks 11,13; UAT hand-off → Task 13.
- **Placeholders:** none — every code step has full code; the two library-API caveats (marked-terminal `use` signature in Task 6; ink `key.end`/`key.pageUp` names in Task 11) name the exact file to check and the observable contract to satisfy, not a vague "handle it."
- **Type consistency:** `Block`, `BlockState`, `BlockAction`, `reduceBlocks`, `initialBlockState`, `RenderOpts`, `flattenRows`, `renderBlockRows`, `ViewportState`, `computeWindow`, `scrollPage`, `pinBottom`, `afterContentChange`, `DiffInput`, `extractEditDiff`, `renderDiff`, `wrapAnsi`, `highlight`, `renderMarkdown`, `ThinkingDeltaEvent`{text} are used identically across tasks.
- **Planner-review patches (2026-06-01, Opus 4.8 validator) — 3 fixes applied to this plan:**
  1. **Task 2 Step 1b:** rewrites/removes the pre-existing `never emits a thinking_delta as any event` test (`session.test.ts:~220`), which the new desk-only behavior inverts — without this an existing test fails and "237 stay green" is false. Invariant restated as "1 rewritten, rest unchanged."
  2. **Task 8:** the reducer now marks the open assistant/thinking `closed: true` on `result` / `tool_start` / `user_prompt` via a new pure `closeOpen()` helper — without this, **live answers never render markdown** (only seeded history did), failing UAT A4. Covered by a reducer assertion (closed===true) + a `rows` test (raw-while-open, markdown-once-closed).
  3. **Task 11:** `app.tsx` memoizes `flattenRows` (`useMemo` on `[transcript.blocks, width, verbose]`) so markdown/syntax-highlight don't re-run on every keystroke / 10s tick — perf for long daily-driver sessions.
