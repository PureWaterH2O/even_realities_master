---
title: Desk TUI rendering (Co-Live M3 cockpit)
domain: terminal-mode
last_updated: 2026-06-07
overall_confidence: 🧪
---

# Desk TUI rendering (Co-Live M3 cockpit)

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Summary

The desk client reduces the `CoLiveEvent` stream into typed `Block`s (`blocks.ts`)
and flattens each block to ANSI rows (`rows.ts`); `app.tsx` owns the chrome
(status line, scroll indicator, inline permission/question prompts, menus). This
doc curates the **non-obvious** rendering facts that bite testing or native-parity
work. The exhaustive per-element visual diff vs native Claude lives in the M3.5
catalog (`projects/colive-terminal/aesthetic/catalog.md`), not here.

## Facts

- 🧪 **Tool errors are color-only — there is no textual error marker.** `rows.ts`
  derives `isErr` from the `tool_end` **summary** (`/\bfailed\b/i.test(summary)`)
  and paints only the status dot + tool name **red**; the header text stays
  `⏺ Name(arg)`. The `summary` string itself is never rendered (it just drives the
  color). So in any **`stripAnsi`'d plain frame** (preview dumps, plain-text
  assertions) an errored tool is **indistinguishable** from a successful one — only
  the tool name + key arg survive. _Implications:_ (a) plain-frame tests must NOT
  assert on words like `error`/`failed` for tool failures — assert on the rendered
  name/arg instead; (b) this is a strong **native-parity candidate** for M3.5 Phase B
  (native Claude surfaces a visible diagnostic). _Self-verified 2026-06-06: read
  `src/desk/render/rows.ts:79-105` + the dumped `13-error` aesthetic frame
  (`⏺ Read(/tmp/no-such-file-12345.txt)` with no error text)._

- 🧪 **`running_stats` / `permission_request` / `user_question` are NOT transcript
  blocks** — `blocks.ts` `applyEvent` returns state unchanged for them (default
  branch); they are handled in `app.tsx` (status line for `running_stats`, the
  inline `PendingPrompt` for the other two). So `flattenAll()` (transcript-only)
  cannot show a permission/question prompt or the token counts — those scenarios
  must be driven through the real `App` via the preview harness's `capture()`.
  _Self-verified 2026-06-06 while building the M3.5 aesthetic preview suite._

- 🧪 **Bottom-pinning the input = fixed-height outer `<Box>` + a `flexGrow` top
  section + alt-screen.** The native look (transcript at top, input/status welded to
  the foot of the screen, empty space ABOVE the input when content is short) is a
  two-section column: outer `<Box flexDirection="column" height={termRows}>` (where
  `termRows = stdout?.rows ?? 24`) wrapping a `flexGrow={1}` TOP section (transcript
  window + scroll indicator + pending prompt + spinner — absorbs all slack at
  `flex-start`, so the gap lands below the content) and a `flexShrink={0}` BOTTOM
  section (dim full-width `─` rule + status + hint + menu + input). Two gotchas:
  (a) ink/yoga does **not** vertically clip Text — the transcript must still be
  windowed to a computed `height` and EVERY non-transcript row reserved, INCLUDING
  the pending prompt's height (a tall permission panel lives in the top section and
  would otherwise shove the pinned input off a fixed-height screen — reserve it via a
  `pendingRowCount()` mirror of the prompt's structure); (b) filling the screen
  exactly (`height === rows`) is only safe because `src/index.ts` enters the
  alt-screen (`\x1b[?1049h`) — the alt buffer doesn't scroll, so the last row+newline
  can't drift scrollback. _Self-verified 2026-06-07 (M3.5 D-029/D-031 fix): preview
  frames `01-idle`/`02-simple-qa`/`09-permission` show banner/content top, gap, chrome
  pinned at the foot; `a7c57a2`._

- 🧪 **`marked` newline collapse is fixed by `new Marked({ breaks: true })` — and it
  does NOT break prose wrapping.** The desk renders an assistant turn as raw text
  while streaming (newlines intact) but switches to `renderMarkdown()` once the turn
  closes; default markdown reflow collapses single `\n` into spaces, destroying
  line-per-line output (e.g. "count 1 to 100" reflowed into a paragraph). `breaks:
  true` (a **Marked constructor** option, not a `parse()` arg) turns a single `\n`
  into a hard `<br>`; ordinary multi-word paragraphs (no embedded `\n`) still reflow
  to `width` via marked-terminal's `reflowText`. Verified headings/lists/fenced-code/
  tables unaffected. _Self-verified 2026-06-07 (M3.5 D-030 fix): `render/markdown.ts`;
  `7997060`._

## Open questions

- Does native Claude render a **textual** tool-error indicator (and how)? → to be
  answered by the M3.5 reference capture (`reference/13-error.png`).

## Change log

- 2026-06-06: created during M3.5 Builder Run 1 (comparison-infra build).
- 2026-06-07: +2 facts from M3.5 UAT fixes — bottom-pin layout pattern (D-029/D-031)
  and `marked` `breaks:true` newline preservation (D-030).
