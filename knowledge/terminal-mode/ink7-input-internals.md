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

**Applies to:** Co-Live desk client (M3.2A Composer, M3.2B `@`/`!`), and any future ink-based TUI here.
