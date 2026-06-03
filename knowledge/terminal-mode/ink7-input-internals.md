# ink 7 input internals — paste & mouse (for desk-TUI work)

**Confidence:** 🧪 self-verified — read `node_modules/ink/build/{input-parser,components/App,hooks/use-paste,parse-keypress}.js`
in `colive-terminal` (ink **7.0.5**), 2026-06-02, while probing M3.2A "Composer".

**Why this matters:** the M3.1 build struggled partly because we didn't know ink's input plumbing. These are the
load-bearing facts for building a real input editor (cursor/multiline/history) and mouse-wheel scrolling on top of ink.

## Bracketed paste is built in — use it, don't hand-roll
- `usePaste(handler)` (exported hook) **auto-enables** bracketed paste (`\x1b[?2004h`) via `setBracketedPasteMode(true)`
  while active, and calls `handler(fullText)` with the **entire pasted string including newlines**.
- Paste rides a **separate channel** — it is **never forwarded to `useInput`** (App.js gates on
  `internal_eventEmitter.listenerCount('paste')`). So pasted multiline text can't trigger per-char or submit logic.
- The parser recognizes `\x1b[200~ … \x1b[201~` and emits a `{ paste }` event (`input-parser.js`).

## ink does NOT enable mouse — but it cleanly delivers mouse sequences if you do
- No `1000h`/`1006h`/`1003h`/mouse code anywhere in ink's build. You enable SGR mouse yourself by writing
  `\x1b[?1000h\x1b[?1006h` to stdout (disable `\x1b[?1006l\x1b[?1000l`) — do it where you enable the alt-screen.
- ink's `input-parser` is a proper CSI assembler: an SGR mouse report `\x1b[<{btn};{col};{row}M|m` (`<`=0x3c is a CSI
  parameter byte; `M`/`m` are final bytes) is assembled as **one complete sequence** and re-emitted **as the raw string**.
- That raw string reaches you two ways (App.js): (a) `internal_eventEmitter.emit('input', raw)` — the clean tap,
  exposed via `useStdin().internal_eventEmitter`; and (b) `useInput`'s handler (after `parse-keypress`). **Prefer the
  `'input'` emitter** for mouse — it's the guaranteed-raw string, no `parse-keypress` massaging.
- SGR wheel buttons: **64 = wheel-up, 65 = wheel-down**.
- Defensive rule: have `useInput` ignore any `input` starting with `\x1b[<` so a stray mouse report never fires a key binding.

## Other useful facts
- `useStdin()` / `useStdinContext()` exposes `{ stdin, setRawMode, setBracketedPasteMode, internal_eventEmitter,
  isRawModeSupported }`.
- `input-parser` splits backspace bytes (`0x7F`/`0x08`) into individual events (held-backspace arrives as one chunk);
  `\r`/`\t` are NOT split (they can appear inside paste).
- `parse-keypress.js` understands kitty-protocol and legacy fn-key CSI/SS3 sequences — arrow keys & fn-keys come through
  as proper `key.{upArrow,downArrow,pageUp,pageDown,end,…}` booleans (M3.1 relied on this).
- Cost of enabling mouse: terminal text-selection then needs **Option-drag (macOS)** / Shift-drag (the vim/less/tmux
  convention). Graceful fallback if a terminal won't forward SGR mouse: `PageUp`/`PageDown` still scroll.

## Enter vs newline — the multiline linchpin (🧪 M3.2A build, 2026-06-03)
Verified in `parse-keypress.js` + `hooks/use-input.js` (ink 7.0.5):
- **`\r` (0x0d, Enter):** `keypress.name = 'return'` → `key.return === true`; `input === '\r'`.
- **`\n` (0x0a, Ctrl-J / line-feed):** `keypress.name = 'enter'` (ink's own comment: "should have been called linefeed")
  → **`key.return === false`**, and `'enter'` is **NOT** in `nonAlphanumericKeys`, so `input` is the raw **`'\n'`** (not blanked).
- `nonAlphanumericKeys = [...Object.values(keyName), 'backspace']`; `keyName`'s values are
  `clear, delete, down, end, f1–f12, home, insert, left, pagedown, pageup, right, tab, up` — **no `enter`, no `return`**.
- ⇒ A composer can treat **Enter = submit** (`key.return`) and **Ctrl-J = newline** (`input === '\n'`) with **no collision** —
  exactly how M3.2A's "Enter submits / Ctrl-J inserts a newline" works in every terminal (incl. the VS Code integrated terminal).
- Backspace (`\x7f`/`\x08`): `key.backspace === true`, `input === ''` (`'backspace'` IS in `nonAlphanumericKeys`). Tab: `key.tab`,
  `input === ''`. So branch on the `key.*` boolean for these, never on `input`.

## The ESC asymmetry — `useInput` strips it, the `'input'` emitter keeps it (🧪 M3.2A, 2026-06-03)
- `use-input.js` strips a leading ESC from the value it hands `useInput` (`if (input.startsWith('')) input = input.slice(1)`),
  so a mouse report reaching `useInput` arrives as `[<…M` (no ESC) → the defensive guard `if (ch.startsWith('[<')) return` works as-is.
- BUT `internal_eventEmitter.emit('input', raw)` delivers the **raw, ESC-prefixed** string `\x1b[<…M`. A wheel handler reading that
  channel **must strip the leading ESC before a `^\[<`-anchored parser** (M3.2A: `parseSgrMouse(raw.startsWith('\x1b') ? raw.slice(1) : raw)`).
  Get this wrong and the wheel silently no-ops.

## Testable in ink-testing-library (🧪 throwaway probe, 2026-06-03)
Rendering a component + writing bytes to the fake `stdin` exercises the REAL plumbing — these all work in the harness:
- `usePaste` **fires**: writing `\x1b[200~alpha\nbeta\x1b[201~` calls the handler with `"alpha\nbeta"` (full multi-line string).
- `useStdin().internal_eventEmitter` **exists**; writing `\x1b[<64;1;1M` re-emits `"\x1b[<64;1;1M"` on its `'input'` channel (ESC-prefixed, per above).
- `PageUp`/`PageDown` = `\x1b[5~`/`\x1b[6~` → `key.pageUp`/`key.pageDown`. A lone ESC is **debounced** — assert after a ~60 ms flush.
- `render()` returns a per-instance `cleanup`; `unmount` is idempotent.
- **Gotcha:** a bracketed paste with **no `usePaste` listener** falls back to `useInput` (App.js gates on `listenerCount('paste')`),
  so a paste test that only checks "text landed / didn't submit" passes even when unwired. Prove the real path with a **`\r`-in-paste**
  case — only `usePaste` keeps a carriage-return inside a paste from submitting.

## `useInput` batches synchronously — state-dependent handlers MUST use functional setState (🧪 M3.2A UAT A4, 2026-06-03)
The single most expensive bug of the M3.2A build. When several input events arrive in **one stdin tick**, every handler call runs against the **same stale closure** — so a key handler that computes its next state from the closure-captured value and calls the **non-functional** setter silently **drops all but the last** event.
- **Mechanism (read in the build):** `App.handleReadable` drains stdin in a `while ((chunk = stdin.read()) !== null)` loop and calls `emitInput(event)` **synchronously, back-to-back**, once per parsed event (`components/App.js`). ink 7's `useInput` subscribes the handler **once** (deps `[isActive, internal_eventEmitter]`) and wraps it in React 19 `useEffectEvent`; the wrapped impl is only refreshed to the latest render's closure **at React commit**. Each call runs inside `reconciler.discreteUpdates(...)` which sets priority but does **not** flush a synchronous commit. ⇒ during the whole emit loop, **no commit happens and the closure stays frozen**.
- **Symptom we hit:** after a multi-line paste, ↑/↓ "jumped to top/bottom instead of stepping one line." `setBuf(B.moveUp(buf).buffer)` read the closure `buf`; batched arrows all computed from the same `buf`, only the last applied (looked like "doesn't move line by line"), and an edge move fired history recall that collapsed the draft ("jump").
- **Fix / rule:** any handler whose next value depends on current state must use the **functional updater** so each batched event sees the freshest **queued** state: `setBuf((b) => B.moveUp(b).buffer)`, **not** `setBuf(B.moveUp(buf).buffer)`. (`←` was always correct because it used `setBuf(B.moveLeft)`.) For sibling state read in the same handler (we had `nav` history state), put it in a **`useRef`** read/written inside the updater — a ref has no stale-closure problem and (absent `React.StrictMode`, which ink does not use) the updater runs once so the ref write is safe.
- **Why our rig missed it:** the preview/test rigs **settle between keystrokes** (await a flush), so each event committed before the next — never reproducing a batch. **Regression test that catches it:** write multiple sequences in **one** `stdin.write('\x1b[A\x1b[A')` with **no settle between**, then assert multi-step movement. On real hardware, key auto-repeat / a buffered link coalesces keystrokes into one tick, so this is not theoretical.

## Alternate scroll mode: the terminal sends wheel/trackpad scroll as ARROW KEYS (🧪 M3.2A mouse-leak, 2026-06-03)
In the **alternate screen** (`?1049h`), xterm-family terminals — confirmed on **VS Code's integrated terminal** — translate mouse-wheel / trackpad scroll into **arrow-key sequences** (`\x1b[A`/`\x1b[B`, and `\x1b[C`/`\x1b[D` for horizontal) so pagers like `less` scroll with the wheel. This is **DECSET 1007 ("alternate scroll mode")**. It collides head-on with M3.2A's composer, where ↑/↓ drive the input: a scroll gesture recalled history / moved the cursor instead of scrolling. The arrows are **byte-identical to real keypresses** (`key.upArrow`, empty `ch`) — no string/`isMouseReport` guard can tell them apart from a genuine Up.
- **Captured proof (`COLIVE_A4_LOG`):** a single trackpad gesture emits a **dense burst** — e.g. `ARROW-UP ×33`, `×47`, `×61`, `×66` — all within ~3 ms in **one stdin tick**. A real keypress is **1 arrow/tick**; the A4 coalesced case is **2–3**.
- **Disabling 1007 is only a PARTIAL fix.** Writing `\x1b[?1007l` on entry (restore `\x1b[?1007h` on exit) makes *plain vertical* wheel scroll report as **SGR** (button 64/65 — what our wheel handler reads) instead of arrows. But VS Code **still** sends arrow bursts for *gesture / horizontal / diagonal* scroll even with 1007 off. So 1007l helps but doesn't fully close it.
- **The robust fix — burst detection by density.** Collect plain (non-meta) arrows into a `useRef` batch and decide in a **`queueMicrotask`** that sees the whole synchronous tick: `>= ARROW_BURST_THRESHOLD` (we use **4**) arrows in one tick = a scroll-gesture artifact → **ignore**; `< 4` = real input → apply each (preserves single keypress + the A4 2–3 batched case). Threshold cleanly separates real (≤3) from phantom (≥8); a human can't produce 4+ arrows in ~3 ms. Microtask deferral adds ~0 latency (it runs at the end of the same synchronous tick, before paint) and lets you classify the *whole* batch before acting — so no stray "first arrow navigates" leak. Keep meta word-nav (`Option+arrow`), slash-menu ↑/↓, and `pending` handling **synchronous** (return before the collector).
- **Cost:** dropped bursts don't scroll either; reliable transcript scroll is **PageUp/PageDown**. A future enhancement can *route* the dropped vertical bursts to transcript scroll instead of ignoring them (turns the artifact into the wheel-scroll feature).

**Applies to:** Co-Live desk client (M3.2A Composer, M3.2B `@`/`!`, the dedicated copy/paste-mouse phase), and any future ink-based TUI here.
