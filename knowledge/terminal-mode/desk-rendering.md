---
title: Desk TUI rendering (Co-Live M3 cockpit)
domain: terminal-mode
last_updated: 2026-06-06
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

## Open questions

- Does native Claude render a **textual** tool-error indicator (and how)? → to be
  answered by the M3.5 reference capture (`reference/13-error.png`).

## Change log

- 2026-06-06: created during M3.5 Builder Run 1 (comparison-infra build).
