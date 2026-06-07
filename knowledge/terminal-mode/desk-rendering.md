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

- 🧪 **Layout = fixed-height outer `<Box>`, everything TOP-anchored, slack pushed to a
  trailing `flexGrow` spacer + alt-screen.** Native renders INLINE — the input follows
  the content, so short content leaves the empty space at the FOOT of the screen (below
  the input), NOT in the middle. The layout is a column: outer
  `<Box flexDirection="column" height={termRows}>` (`termRows = stdout?.rows ?? 24`)
  stacking, in order: a `flexShrink={0}` transcript section (windowed transcript +
  scroll indicator + pending prompt + spinner), the pinned todos panel (`flexShrink={0}`,
  see next fact), a `flexShrink={0}` BOTTOM chrome (dim full-width `─` rule + status +
  hint + menu + input), and finally a trailing `<Box flexGrow={1} flexShrink={1} />`
  SPACER that absorbs all slack at the bottom. When content overflows, the transcript
  window clips to `height`, the spacer collapses to ~0, and the input ends up at the
  foot as before. Three gotchas: (a) ink/yoga does **not** vertically clip Text — the
  transcript must still be windowed to a computed `height` and EVERY non-transcript row
  reserved, INCLUDING the pending prompt's height (a `pendingRowCount()` mirror of the
  prompt's structure) AND the pinned todos panel's flattened height; (b) filling the
  screen exactly is only safe because `src/index.ts` enters the alt-screen
  (`\x1b[?1049h`) — the alt buffer doesn't scroll, so the last row+newline can't drift
  scrollback; (c) ❌ **the earlier D-029/D-031 version (`a7c57a2`) used a `flexGrow={1}`
  TOP section, so slack landed ABOVE the input — a big gap in the MIDDLE for short
  content. That MISREAD native (native top-anchors); superseded by the spacer-at-bottom
  version (`e79f2c5`), which matches the `01-idle.png` reference.** _Self-verified
  2026-06-07 (wasted-space fix): preview frames `01-idle`/`02-simple-qa` show
  content+chrome at the top, gap at the foot._

- 🧪 **The todos/tasks panel is PINNED outside the scrollable transcript.** The reducer
  (`blocks.ts setTodos`) keeps exactly ONE `todos` block; `app.tsx` pulls it out of
  `transcript.blocks`, EXCLUDES it from the windowed transcript rows (else it
  double-renders — once scrolling, once pinned), renders it as its own `flexShrink={0}`
  section between the transcript and the bottom chrome, and reserves its flattened height
  in the viewport `height` calc. So it stays visible while tool output scrolls past
  (native keeps it as a persistent widget). Test it by scrolling the transcript to the
  top and asserting the panel is still present (a transcript-block todos would scroll
  off). _Self-verified 2026-06-07 (M3.5 D-035 fix): `4d89118`;
  `test/preview/d035-todos-pinned.preview.test.tsx`._

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
- 2026-06-07: M3.5 UAT round-2 — layout fact UPDATED bottom-pin →❌ top-anchor +
  bottom-spacer (wasted-space fix supersedes D-029/D-031's flexGrow-top; native
  top-anchors, gap belongs at the foot, `e79f2c5`); +1 fact: todos panel pinned
  outside the viewport (D-035, `4d89118`).
