---
title: Streaming-input mode — SDK message-stream probe (M3.3a)
domain: terminal-mode
last_updated: 2026-06-03
overall_confidence: 🧪
---

# Streaming-input mode — SDK message-stream probe (M3.3a Task 1)

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Summary

Co-Live Terminal M3.3a refactors Core to drive the SDK in **streaming-input mode** via one persistent
`Query` per session (vs today's one `query({prompt:string})` per turn). The load-bearing assumption (spec §6)
was: *does streaming mode emit the same SDK message stream as string mode* — one `init`, exactly one `result`
per turn, identical `stream_event` shapes? **Probed live** against `@anthropic-ai/claude-agent-sdk@0.3.158`
(2026-06-03): a persistent streaming query was opened, two prompts pushed (turn 2 only after turn 1's `result`),
and every message's shape logged. **Verdict: build proceeds as written — no turn-boundary or mapping change
needed.** One assumption (a) diverged but is fully benign (see below).

## Facts (from the live probe)

- 🧪 **One `result` per turn — HOLDS.** Two pushed prompts produced exactly two `result` messages
  (`resultCount` reached 2, one per turn). Turn-end detection on `result` (spec §3) is correct.
- 🧪 **`stream_event` content-block shapes — UNCHANGED.** Observed envelope per turn:
  `message_start` → `content_block_start{content_block.type:'text', index}` →
  `content_block_delta{delta.type:'text_delta', index}` → `content_block_stop{index}` →
  `message_delta` → `message_stop`. This is exactly what `handleStreamEvent` reads today (text/thinking/tool_use
  blocks share this envelope; only text was exercised, but the envelope is the shape the mapping keys on).
- 🧪 **`init` arrives PER TURN, not once — DIVERGES from spec §6(a), but BENIGN.** Streaming mode emits a fresh
  `system/init` at the *start of every turn* (`initCount` = 2 for two turns). This actually matches today's
  string mode, where each per-turn `query()` emits its own `init`. It is harmless because `handleSystem`'s init
  path (`src/core/session.ts:404-411`) only **captures `session_id` and calls `settleIdentified()` — it emits
  zero CoLiveEvents.** Re-running it per turn is idempotent (`settleIdentified` is a no-op once settled).
- 🧪 **`session_id` is STABLE across turns.** Both inits, both `system/status` messages, and both results in
  one persistent query carried the **same** `session_id` (`fd2faf58-…`). So per-turn re-capture sets `_sessionId`
  to the same value every time → resume-on-self-heal (spec §2, Option 1) holds with the correct id.
- 🧪 **New benign message types appear — both ignored safely.** `system/status` (per turn) and a one-off
  `rate_limit_event` were observed. `system/status` hits the `handleSystem` no-op default
  (`session.ts:431`); `rate_limit_event` hits the `handleMessage` no-op default (`session.ts:398`,
  "other message types: no event in v1"). Neither emits a CoLiveEvent. No mapping change required.
- 🧪 **`SDKUserMessage` text shape — CONFIRMED LIVE (resolves spec §5's 🔴).** The SDK accepted pushed messages
  of shape `{ type:'user', message:{ role:'user', content:<string> }, parent_tool_use_id:null }` and produced
  turns. This is exactly the plan's `textUserMessage(text)` builder. (Matches `sdk.d.ts` `SDKUserMessage`
  ~line 3742: `type:'user'`, `message: MessageParam`, `parent_tool_use_id: string|null`, rest optional.)
- 🧪 **`assistant` interleaves before `content_block_stop`.** Real order within a turn was
  `…content_block_delta → assistant → content_block_stop…`. Irrelevant to emitted events: for text-only turns
  `handleAssistant` emits nothing; for tool turns it emits a `tool_start` already deduped via `announcedToolIds`,
  so its position never changes *which* events are emitted. Task 6's golden test scripts its own order and is a
  self-consistent regression pin.
- 🧪 **`Query.interrupt()` does NOT throw — it flushes a NON-SUCCESS `result` to end the interrupted turn**
  (verified live against the real SDK, twice, deterministically; 2026-06-04). The flushed result carries an
  `[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null` error. Our `handleResult` maps any
  non-success result to an `error` + failed-`result` event, so naïvely this surfaced a spurious error banner on a
  deliberate Esc (a regression vs the old `AbortController` path, which suppressed the aborted-stream throw and
  framed a clean idle). **Fixed:** an `interrupting` flag (set by `interrupt()`, reset on every turn-end) makes the
  consumer loop frame a clean idle for that flushed result and surface NO error/failed-result — matching the old
  abort path. The session stays usable afterward (the next prompt drives a fresh turn on the same query — verified
  in UAT D3). Genuine stream throws still go through `onConsumerError` and STILL surface an `error`.

## Implication for the build

The spec §6 mitigation ("if any differ, adjust the turn-boundary/mapping before building") is **not triggered**:
the only divergence (per-turn `init`) emits no events and re-captures a stable id, so the `handleMessage*` layer
maps streaming mode **byte-identically** to today. The existing `session.test.ts` fake already models per-turn
`init` (each `happyTurnMessages` turn includes one), so the equivalence net already covers this. **Plan proceeds
as written (Tasks 2–9).**

## Open questions

- Thinking/tool_use stream-block shapes were not exercised live here (text only). The golden test (Task 6) and the
  existing event-normalization suite pin those shapes against the known envelope.

> **Resolved 2026-06-04:** "Does `Query.interrupt()` emit a `result`?" — yes (non-success); now a fact above.

## Change log

- 2026-06-03: created. Live probe of streaming-input mode (SDK 0.3.158) for M3.3a Task 1. Three assumptions:
  one-result-per-turn ✅ HOLDS, stream_event shapes ✅ HOLD, one-init-at-start ❌ DIVERGES (per-turn init) but
  BENIGN (emits no events; stable session_id). Verdict: build proceeds as written.
- 2026-06-04: resolved the open `Query.interrupt()` question — verified live (twice, deterministic) that it does
  NOT throw but flushes a NON-SUCCESS `result` (with an `[ede_diagnostic]` error). Fixed the spurious-error-on-Esc
  regression via an `interrupting` flag that suppresses that flushed result (clean idle, no error/failed-result).
