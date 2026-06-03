# Co-Live Terminal — M3.2A "Composer" design

> **Status:** ✅ design complete (Opus 4.8 planner, 2026-06-02) — awaiting user review before writing-plans.
> All decisions locked; the mouse/paste feasibility probe (§7) is done.
> **Parent:** the LOCKED M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` §7 row **M3.2 — Input & autocomplete**,
> which the user split into two rungs: **M3.2A (this doc) = the editor core** and **M3.2B = `@`-file autocomplete + `!`bash**.
> **Governing rule:** M3.0 **§0 (definition of done)** applies in full — green tests + clean typecheck are the
> *precondition only*; **M3.2A is DONE only when the user exercises it on the real G2 + R1 and signs off.**
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK/lib) · 🟡 community · 🔴 unverified.

## 0. Scope (one sentence)

Make the **desk** input a real composer — multi-line authoring, cursor + word navigation, command history, paste,
and a slash-command menu — **desk-side only, with zero Core change**. (`@`-file autocomplete and `!`bash are M3.2B.)

Today (🧪 `app.tsx`) the input is a hand-rolled **single-line** buffer via `useInput`: it only appends characters
and backspaces at the end. No cursor movement, no history, no multiline, no menu. M3.2A replaces it.

## 1. Locked decision — multiline submit / newline

- **Enter = submit.**
- **Insert a newline** via **`\`+Enter** (backslash-continuation) **or `Ctrl-J`** (sends `\n`, reliably distinct
  from Enter's `\r` in every terminal, incl. the VS Code integrated terminal with zero config). Also honor
  **Shift+Enter** if the terminal happens to send it.
- **Paste** of multi-line text builds a multi-line buffer **without submitting** (bracketed paste — §TBD).

Rejected: "Enter = newline, Ctrl-D submits" (inverts chat/REPL muscle memory) and "paste-only multiline" (can't
hand-author a multi-line prompt).

## 2. Locked decision — the `↑`/`↓` overload → **Native**

Three features wanted the arrow keys (M3.1 transcript scroll, command history, multiline cursor). Resolution:
- **Enable real mouse-wheel reporting** so the wheel is **distinct** from the `↑`/`↓` key codes. This *replaces*
  M3.1's "alt-screen maps wheel→`↑`/`↓`" behavior with proper mouse reporting.
- `↑`/`↓` now drive the **input** (history + multiline cursor); the **mouse-wheel scrolls the transcript**;
  `PageUp`/`PageDown` page it.
- **Cost accepted:** with mouse reporting on, selecting/copying transcript text uses **Option-drag (macOS)** or
  Shift-drag — the same convention as vim / less / tmux. (M3.1 had parked mouse mode for this reason; M3.2A
  deliberately reopens it to get native arrow-key parity.)

## 3. Keybinding map (LOCKED) — with macOS-laptop equivalents

> On a Mac laptop keyboard there are no dedicated `PageUp`/`PageDown`/`Home`/`End` keys — they are `Fn`+arrow
> combos. M3.1 hardware UAT already confirmed `PageUp`/`PageDown` = `Fn+↑`/`Fn+↓`.

| Key | macOS-laptop equivalent | Action |
|---|---|---|
| **Enter** | Return | Submit the prompt |
| **`\`+Enter** / **Ctrl-J** | same | Insert a newline (Shift+Enter too if the terminal sends it) |
| **↑ / ↓** | ↑ / ↓ | History prev/next **when the cursor is on the top/bottom line** of the draft; otherwise **move the cursor** between draft lines |
| **← / →** | ← / → | Move cursor by character |
| **Option+← / Option+→** | ⌥+← / ⌥+→ | Move cursor by word |
| **Home / End** | **Fn+← / Fn+→** (or **Ctrl-A / Ctrl-E**) | Cursor to line start / end |
| **Backspace** | Delete | Delete char before cursor |
| **Ctrl-W** | ⌃W (or ⌥+Delete) | Delete the word before cursor |
| **Mouse wheel** | two-finger scroll on the trackpad | Scroll the transcript (real mouse reporting) |
| **PageUp / PageDown** | **Fn+↑ / Fn+↓** | Page the transcript up / down |
| **End** *(when the input is empty)* | **Fn+→** | Re-pin the transcript to the bottom (M3.1 behavior, preserved when not editing) |
| **`/` …** | same | Open the slash menu; ↑/↓ navigate it, Tab/Enter completes, Esc closes (arrows captured by the menu **only while it is open**) |
| **Ctrl-O** | ⌃O | Toggle global verbose (unchanged from M3.1) |
| **Esc** | esc | Close the slash menu if open; else interrupt a running turn (M1) |
| **Ctrl-C** | ⌃C | Quit |

Confirmed dual-roles: **End** = re-pin when the input is empty / line-end when editing; **Esc** = close-menu
then interrupt (precedence: menu first).

## 4. Editor architecture — a pure, testable `src/desk/input/` layer

Mirrors M3.1's `render/` ethos (small pure functions, fully unit-tested; hand-rolled, **no new deps** — `ink-text-input`
can't do multiline or our keymap). `app.tsx`'s `useInput` becomes a thin **dispatcher**: key → buffer op.

- **`buffer.ts`** — the immutable editor model and pure operations.
  - Model: `{ lines: string[]; cursor: { row: number; col: number } }` (an empty buffer is `{ lines: [''], cursor: {0,0} }`).
  - Ops (all pure `(buf, …) => buf`): `insertText` (handles embedded `\n` from paste → splits into lines),
    `insertNewline`, `deleteBackward`, `deleteWordBackward`, `moveLeft`/`moveRight`/`moveWordLeft`/`moveWordRight`/
    `moveLineStart`/`moveLineEnd`, and `moveUp`/`moveDown` which **return a flag when the cursor is already on the
    top/bottom line** (so the dispatcher knows to hand the keystroke to history instead).
  - `toText(buf): string` (join with `\n`) for submit; `fromText(s): buf` for loading a history entry.
- **`render` (in `render/rows.ts` or a small `input-rows.ts`)** — draw the multi-line buffer with a **visible cursor**
  (reuse M3.1 ANSI helpers; the cursor cell is rendered via inverse video so it shows inside ink's static frame).
- **`app.tsx` dispatcher** — maps the keymap (§3) to buffer ops; routes `↑`/`↓` to history when `moveUp/Down` reports
  a top/bottom edge; owns the open/closed state of the slash menu (§6).

## 5. Command history — persisted, per-project (LOCKED)

- **Scope:** submitted prompts only (not slash commands — those route locally and are noise in recall). Keyed by the
  **project the Hub is serving**: read it from the Hub's `GET /info` (the project path/cwd); fall back to the Hub
  base URL if `/info` doesn't carry a path. 🧪 `GET /info` exists (M1 routes).
- **Storage:** a desk-local file under the existing desk state/config dir (reuse whatever M1/M2 established; build
  confirms the path), e.g. one JSONL file per project key. Append on submit; **consecutive-duplicate-deduped**;
  **capped at 500** (drop oldest).
- **Navigation:** `↑` from the top line walks back through history (newest→oldest); `↓` walks forward and, past the
  newest, restores the in-progress draft (standard shell behavior — the live draft is stashed when you first press `↑`).
- **`history.ts`** is pure over an injected reader/writer (file I/O is a thin adapter) so the navigation + cap + dedup
  logic is unit-tested without touching disk.

## 6. Slash menu

A completion popup over the **existing** `slash.ts` command set (🧪 `SLASH_COMMANDS = [clear, compact, context, usage,
help]`, with the existing one-line summaries) — no new command plumbing; the load-bearing invariant ("anything starting
with `/` is handled locally, never POSTed") is unchanged.

- **Open:** when the buffer is a single leading-`/` token at line start (e.g. `/cl`). Filters the list by the typed
  prefix. **Closes** when the token no longer matches, on Esc, or on completion.
- **Keys (while open):** `↑`/`↓` move the highlight, **Tab** completes the highlighted command into the buffer, **Enter**
  submits the buffer (routed through the existing `interpretInput` → local command). Esc closes without changing the buffer.
- **Reusable widget:** the popup is a generic `CompletionMenu` (items + highlight + filter) — **M3.2B's `@`-file
  autocomplete reuses it verbatim**.
- **Pluggable source (forward-compat):** the command list is injected. M3.2A feeds it the local `SLASH_COMMANDS`; M3.3
  (streaming-input) will merge Hub-reported agent commands (`/model`, `/compact`, …) into the same menu.

## 7. Paste & mouse — PROBE RESULT (🟢 feasible; ink 7 does most of it)

🧪 Verified by reading `node_modules/ink/build/{input-parser,components/App,hooks/use-paste}.js` (ink 7.0.5):

- **Bracketed paste = built-in.** `usePaste(handler)` (ink hook) auto-enables `\x1b[?2004h`, delivers the **full pasted
  string incl. newlines** on a channel that is **never forwarded to `useInput`** (App.js:186–192). M3.2A calls
  `usePaste(text => dispatch(insertText(text)))` — pasted multiline text lands in the buffer and **cannot** trigger
  per-char or submit logic. No custom paste parsing needed.
- **Mouse wheel = we enable, ink delivers.** ink does **not** enable mouse, but its `input-parser` assembles an SGR
  mouse sequence (`\x1b[<{btn};{col};{row}M|m`) as one complete CSI and re-emits it **as the raw string** on
  `internal_eventEmitter`'s `'input'` channel (App.js:162), exposed via `useStdin()`. Plan:
  1. At the **CLI entry point** (where the desk already enters the alternate screen on the real `process.stdout` —
     🧪 `c04d5c7`), also write `\x1b[?1000h\x1b[?1006h` to enable SGR mouse reporting; write `\x1b[?1006l\x1b[?1000l`
     on exit (alongside the alt-screen teardown).
  2. In the app, `useStdin().internal_eventEmitter.on('input', raw => …)`; if `raw` starts with `\x1b[<`, parse the
     SGR mouse report — **button `64` = wheel-up, `65` = wheel-down** → `scrollLine` (reuse M3.1's window math).
  3. Arrow keys arrive as their own sequences → `useInput` → history/cursor. Mouse and arrows never collide.
  - Defensive: the dispatcher ignores any `useInput` `input` beginning with `\x1b[<` (so a stray mouse report can
    never fire a key binding).
- **Hardware caveat (the only open unknown — a UAT item, not a blocker):** whether the user's terminals (esp. the VS
  Code integrated terminal) actually forward SGR mouse. **Graceful degradation:** if mouse isn't forwarded,
  `PageUp`/`PageDown` and `↑`/`↓`-when-empty still scroll, so the transcript is never unreachable.

## 8. Invariants (must not regress) + testing (the precondition, not done)

**Invariants:**
- 🧪 Desk stays a **pure Hub client** (DI'd `HubClient`, no SDK). Submit still POSTs a prompt; the `slash.ts`
  "never-POST a `/`-command" invariant is unchanged; co-live, permission dismiss, transcript seeding all intact.
- **Zero Core change.** No event shape changes; the Hub is untouched. (So no e2e change — but keep a regression
  assertion that submit POSTs and slash routes locally.)
- All M3.1 + co-live tests stay green; typecheck stays clean.

**Automated tests (vitest + the existing fake-`HubClient`/ink-testing-library harness):**
- `buffer`: every op — char/word/line cursor moves, multiline insert/newline, delete/delete-word, `insertText` with
  embedded `\n`, and the `moveUp/Down` top/bottom-edge flags.
- `history`: append + consecutive-dedup + cap-at-500; `↑`/`↓` navigation incl. draft-stash/restore; per-project keying;
  pure over an injected store (no real disk).
- `slash menu`: open/close conditions, prefix filtering, highlight move, Tab-completes, Enter-routes-via-`interpretInput`.
- `paste`: a `usePaste` payload with newlines becomes a multiline buffer and does **not** submit.
- `dispatcher/viewport`: dynamic `reserved` rows = f(input line count + menu height + status/indicator); the transcript
  `H` shrinks as the composer grows (the one integration point with M3.1's `window` math).
- `mouse parse`: pure `parseSgrMouse('\x1b[<64;…M')` → wheel-up/down (unit-testable without a real terminal).

## 9. Hardware UAT (the real definition of done) + risks

**Run-book shape** (`projects/colive-terminal/m3.2a-uat-runbook.md`, written at plan time):
- **Part A (desk):** A1 multiline authoring (`Ctrl-J` / `\`+Enter); A2 cursor + word nav incl. the **Mac Fn-key
  equivalents** (`Fn+←/→` Home/End, `⌥+←/→` word); A3 history recall **across a desk restart** (per-project); A4 paste
  a multi-line block (no premature submit); A5 slash menu filter→Tab→Enter; A6 **mouse-wheel scroll + Option-drag text
  selection** (the §7 caveat) with PageUp/PageDown as the documented fallback.
- **Part B (co-live regression, light — input is desk-only):** desk-typed prompts still reach the glasses; **no
  double-render** regression (M3.1 `8cd4535`); permission round-trip unaffected.

**Risks:**
- **Visible cursor inside ink's frame** — rendering a cursor cell (inverse video) that tracks `{row,col}` across wrapped
  lines is fiddly. Mitigation: unit-test cursor placement; it's pure.
- **Dynamic `reserved` rows** interacting with M3.1's viewport window. Mitigation: covered by the dispatcher/viewport test.
- **Terminal variance** for Fn-keys / `⌥`-word-jump / SGR mouse across macOS Terminal vs the VS Code terminal.
  Mitigation: graceful degradation (§7) + the Part-A UAT walk catches it.

## 10. Out of scope (later rungs)
- `@`-file autocomplete, `!`bash → **M3.2B** (reuses §6's `CompletionMenu`).
- Streaming-input Core, `/model`, mode cycle, `/compact`, MCP, image paste, `settingSources` flip → **M3.3**.
- `#`memory capture (mentioned in the M3.0 §3 composing list) is **not** in M3.2 — revisit when the Obsidian/KB
  milestone lands.
