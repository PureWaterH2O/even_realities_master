# Co-Live Terminal — M3.2A "Composer" design

> **Status:** 🟨 DRAFT — in active brainstorm (Opus 4.8 planner, 2026-06-02). Decisions in §1–§3 are **locked**;
> §4+ are still being brainstormed and will be appended before this is marked accepted.
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

## 4+. Still brainstorming (to be appended)
- History scope & persistence (session-only vs persisted file; dedup; cap).
- Slash-menu UX (filtering, what populates it, completion behavior).
- Paste handling + the mouse-reporting mechanics (bracketed paste; enable/disable sequences alongside alt-screen).
- Editor architecture (a pure, testable buffer-with-cursor module + dynamic viewport row reservation).
- Testing (automated precondition) + the hardware-UAT run-book shape.
- Risks.
