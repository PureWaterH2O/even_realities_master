# Co-Live Terminal — M3.1 "Readable transcript" design

> **Status:** ✅ accepted by the user 2026-06-01 (brainstorm w/ Opus 4.8, visual companion).
> **Parent:** the LOCKED M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` (this is the M3.1 row of §7).
> **Governing rule:** M3.0 **§0 (definition of done)** applies in full — green tests + clean typecheck are the
> *precondition only*; **M3.1 is DONE only when the user exercises it on the real G2 + R1 and signs off.** Build
> (ultracode) agents produce *candidates*; the controller re-verifies from a clean tree; bugs found on hardware
> are fixed and re-UAT'd. The UAT run-book is `projects/colive-terminal/m3.1-uat-runbook.md`.
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK/lib) · 🟡 community · 🔴 unverified.

## 0. Scope (one sentence)

Make the **desk** transcript readable — a scrollback viewport, inline diffs, syntax highlighting, markdown, a
Ctrl-O verbose toggle, a todos panel, and desk-only thinking display — **desk-side only**, with exactly **one**
tiny Core change (a `thinking_delta` event). Glasses / HUD rendering and the M1/M2 co-live path are untouched.

## 1. Decisions locked in the brainstorm

| # | Decision | Rationale |
|---|---|---|
| D1 | **Render architecture: flatten-to-ANSI-rows.** Every transcript block renders to an array of ANSI-styled terminal rows; a viewport keeps a flat row buffer and windows it by row. | Native-like row-accurate scrolling; a single tall block (e.g. a 50-row file read) is fully reachable, not all-or-nothing per entry; diff/markdown/syntax all fall out of the same row mechanism. (Chosen over entry-windowing via the visual companion A/B demo.) |
| D2 | **Add focused ANSI-emitting libraries:** `marked` + `marked-terminal` (markdown→ANSI), `cli-highlight` (highlight.js syntax→ANSI), `diff` / jsdiff (line diff; we color +/- ourselves). | Real syntax highlighting (UAT A2) and robust markdown (UAT A4) are impractical to hand-roll. Libraries emit ANSI strings that ink renders verbatim inside a `<Text>`. Cost accepted: re-run `npm audit`, pin versions. (Departs from the M1/M2 "zero new deps" ethos, deliberately.) |
| D3 | **Ctrl-O = global verbose toggle.** Toggles ALL tool blocks between a one-line summary and full `input`+`output`. | Matches native Claude Code's Ctrl-O; avoids a selection cursor that would fight the scroll keys. Per-tool focus cursor is deferred. **Updates runbook A3 wording** ("that tool" → "all tool blocks"). |
| D4 | **Diffs render inline**, not behind Ctrl-O. Edit-family tool blocks show the colored +/- diff the moment the edit lands. | Matches native; satisfies UAT A2 without an extra keystroke. Ctrl-O remains purely for raw full input/output. |
| D5 | **Thinking broadcasts to all subscribers; the closed Even app ignores it.** The Hub is pull-based with no per-client filtering, so the new `thinking_delta` event reaches every subscriber; the desk renders it, the glasses' closed app ignores unknown event types. | Spec §4 design; exactly what **UAT B2** verifies on hardware. Fallback if B2 ever fails: server-side filtering. Shipped as broadcast-and-ignore. |

## 2. The Core change (the ONLY change outside `src/desk/`)

🧪 Today the SDK streams thinking but the Core deliberately drops it (`src/core/session.ts:479`,
`// thinking_delta and input_json_delta: NO event (never leak thinking)`). `think_start`/`think_end` *status*
already flows; only the **text** is dropped.

1. **`src/core/events.ts`** — add to the union:
   ```ts
   /** A streamed chunk of assistant *thinking* text. Desk-only by convention:
    *  the closed Even app ignores unknown event types, so the glasses never render it. */
   export interface ThinkingDeltaEvent { type: 'thinking_delta'; text: string }
   ```
   Add `ThinkingDeltaEvent` to `CoLiveEvent` and (transitively) `CoLiveEventType`.
2. **`src/core/session.ts`** — in the `content_block_delta` case, alongside the existing `text_delta` branch:
   ```ts
   } else if (delta.type === 'thinking_delta') {
     // 🧪 the SDK carries thinking text in `delta.thinking`, NOT `delta.text`
     // (verified in test/core/session.test.ts happyTurn). Our event field is `text`.
     this.emit({ type: 'thinking_delta', text: asString(delta.thinking) })
   }
   ```
   Leave `think_start`/`think_end` and the `input_json_delta` drop unchanged. Update the file-header comment
   (lines 27–28) to note thinking text is now emitted for desk-only render.
3. **Hub:** no change. `src/hub/sse.ts:72` serializes any event via `JSON.stringify(event)` — 🧪 **no allowlist**,
   so the new type flows to subscribers automatically. The Even app ignores unknown `type`s (verified by **UAT B2**).

Everything else in this spec lives under `src/desk/`.

## 3. Desk architecture

### 3.1 Block model (replaces the flat `Line[]` in `app.tsx`)
The reducer produces **`Block[]`** instead of `Line[]`. A `Block` is a discriminated union; each kind has a pure
`renderRows(block, opts): AnsiRow[]` function (`opts` carries terminal width + the global expand flag).

| Block kind | Source events | Render |
|---|---|---|
| `user` | `user_prompt` / local user | `you  <text>` (cyan label) |
| `assistant` | `text_delta` (accumulated), closed by `text_end`/`result` | **markdown→ANSI** (marked-terminal) once closed; streamed *raw* while open (prettified on close to avoid half-parsed flicker) |
| `tool` | `tool_start` → `tool_end` (keyed by `toolId`) | one-line summary always; **edit-family** (Edit/MultiEdit/Write) also renders an inline colored +/- **diff**; holds `detail.{input,output}` for the Ctrl-O verbose view |
| `thinking` | `thinking_delta` (accumulated), bracketed by `think_start`/`think_end` status | distinct dim/italic block, header `💭 thinking`; visually separate from the answer; **always streams live** while the model is thinking; once closed it collapses to a stub (`💭 thinking (N lines) — Ctrl-O`) unless verbose is on |
| `todos` | `tool_start`/`tool_end` for **TodoWrite** | a checklist rendered from `detail.input.todos`; **updates in place** — a new TodoWrite replaces the prior `todos` block (keyed), not appends |
| `note` | `permission_result`, `error`, slash hints/notes, notifications | unchanged dimmed line |

Block-keying: `tool` blocks are keyed by `toolId` so `tool_start` then `tool_end` mutate the **same** block
(today they append two separate lines). `todos` is a singleton-by-latest (replace in place).

### 3.2 Viewport (`useViewport`)
- **Flatten:** map `Block[]` → flat `AnsiRow[]`, hard-wrapped to `process.stdout.columns` so the scroll indicator
  is exact. Cache rows per block; only re-flatten a block when it changes (the open streaming block, or a tool/
  todos block on update).
- **Window:** render `rows[offset .. offset+H]` into a column of `<Text>` rows. `H` = terminal rows minus the
  status line + input chrome.
- **Pinning:** while a turn streams, `offset` auto-tracks the bottom. Any scroll-up unpins; `End` (or scrolling
  back to the bottom) re-pins. New streaming content while unpinned does **not** yank the view.
- **Keys:** `PageUp`/`PageDown` = scroll one page; `End` = jump to bottom / re-pin; `Ctrl-O` = toggle global
  verbose (**default OFF** = tool blocks show one-liners and closed thinking shows a stub; ON = full tool
  input/output and expanded thinking). Live-streaming thinking is shown regardless of the toggle. Arrow keys are
  **left untouched** (reserved for M3.2 history/editor). Mouse-wheel scroll is **not** supported (ink mouse mode
  fights terminal text selection) — accepted ceiling.
- **Indicator:** `rows 412–438 of 901 ▲▼` (and a `(pinned ▼)` marker when at bottom).

### 3.3 Rendering helpers (new `src/desk/render/` modules)
Small, individually-testable pure functions, each one purpose:
- `markdown.ts` — `renderMarkdown(md, width): string` wrapping marked + marked-terminal (configured to use
  cli-highlight for fenced code).
- `diff.ts` — `renderDiff(oldStr, newStr, lang?): string` (jsdiff line diff → green `+`/red `-`/dim context),
  plus the edit-family `detail.input` → (old,new) extraction (Edit: `old_string`/`new_string`; Write: ``''``→
  `content`; MultiEdit: each edit in sequence).
- `highlight.ts` — `highlight(code, lang): string` over cli-highlight, with a safe fallback to plain text on an
  unknown language or a throw.
- `wrap.ts` — width-aware hard-wrap that is ANSI-aware (never splits an escape sequence).
- `rows.ts` — the `renderRows` dispatch per block kind.

### 3.4 Streaming markdown rule
The open `assistant` block streams **raw** text_delta (fast, no flicker); on `text_end`/`result` it is replaced by
the markdown-rendered rows. Thinking streams raw dim/italic throughout (no markdown pass). This keeps per-delta
cost low and avoids rendering half-parsed markdown.

## 4. Invariants (must not regress)
- 🧪 The desk client stays a **pure Hub client** — DI'd `HubClient`, no SDK, no model. The M1/M2 co-live path,
  permission broker, `permission_result` dismiss signal, transcript seeding, and `/clear`→new-session all unchanged.
- All **237 existing tests stay green**; typecheck stays clean. The `thinking_delta` addition keeps the event union
  exhaustive (update any exhaustive `switch`).
- The Even-app wire contract is unchanged except for the additive `thinking_delta` event (which the app ignores).
  No existing event's shape changes.

## 5. Testing (automated — the precondition, not done)
Unit tests with the existing ink-testing-library + fake-`HubClient` harness:
- `block reducer`: tool_start+tool_end fold into one keyed block; todos replace-in-place; thinking accumulates
  between think_start/think_end; assistant markdown renders on close.
- `viewport`: flatten + window math; a tall (>H) block is reachable row-by-row; pin/unpin on scroll; exact
  indicator counts; ANSI-aware wrap never splits an escape.
- `render helpers`: diff coloring for Edit/Write/MultiEdit; markdown headings/lists/bold/fenced; highlight
  fallback on unknown language.
- `core`: `session.ts` emits `thinking_delta` on a thinking delta and still emits nothing for `input_json_delta`;
  event-union exhaustiveness compiles.
- Extend the in-process **e2e** to assert a `thinking_delta` frame reaches a subscriber and is rendered on the
  (fake) desk but is a no-op for a client that ignores it (mirrors UAT B2 in software).

## 6. Build method
Per M3.0 §7 + §0: **subagent-driven development** (impl → spec-check → quality fix-loops). The **controller
re-verifies `npm test` + `npm run typecheck` from a clean tree** — never on agent self-report. Output is a
**candidate**. Then the user runs the hardware UAT run-book; only the user's sign-off closes the rung. Small,
frequent commits; do **not** merge before hardware sign-off.

## 7. Risks
- **Render-layer rewrite touches the hottest file** (`app.tsx`). Mitigation: extract pure `render/` helpers +
  `useViewport`; keep the event reducer shape close to today's; full unit coverage; the Hub-client boundary is
  untouched so co-live can't regress from this.
- **Library / ink ANSI compatibility.** marked-terminal / cli-highlight emit ANSI that ink must render verbatim.
  Mitigation: a thin render layer, snapshot tests on the ANSI strings, and a plain-text fallback path.
- **`thinking_delta` on the glasses** (B2). Mitigation: it's additive + unknown-to-the-app by design; verified on
  hardware; server-side filtering is the fallback if the app misbehaves.
- **Streaming markdown flicker.** Mitigation: stream raw, prettify on close (§3.4).
- **Scroll/indicator drift from wrapping.** Mitigation: hard-wrap to `stdout.columns` before windowing so counts
  are exact; recompute on terminal resize.

## 8. Out of scope (later rungs)
Input editor / multiline / history / `@`-autocomplete / `!`bash → **M3.2**. Streaming-input Core, `/model`, mode
cycle / plan, `/compact`, MCP, image paste, `settingSources` flip → **M3.3**. Session command-center + file-watch
pane → **M3.4**. Theming/polish gate → **M3.5**. Mouse-wheel scroll and a per-tool focus cursor: parked.

## 9. Acceptance (hardware-UAT — the real definition of done)
The user, on the real **G2 + R1**, completes `projects/colive-terminal/m3.1-uat-runbook.md` Part A (A1–A6 desk
features) **and** Part B (B1–B4 glasses co-live regression), records any bugs, and signs off with a date. Only
then is M3.1 DONE and mergeable.
