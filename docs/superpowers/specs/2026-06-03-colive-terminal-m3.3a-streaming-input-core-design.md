# Co-Live Terminal M3.3a — Streaming-input Core — Design

> **Parent:** the LOCKED M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` §5 (the streaming-input decision)
> + §7 row **M3.3 — Streaming-input Core + controls**, which the user split into three sub-rungs (2026-06-03):
> **M3.3a (this doc) = the refactor**; **M3.3b = runtime controls** (`/model`, mode/plan toggle, `/compact` +
> `supportedCommands`); **M3.3c = power features** (`settingSources`+skills, image paste, MCP).
> **Governing rule:** M3.0 **§0 (definition of done)** applies in full — green tests + clean typecheck are the
> *precondition only*; **M3.3a is DONE only when the user exercises it on the real G2 + R1 and signs off.**
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK/lib) · 🟡 community · 🔴 unverified.

## 0. Scope (one sentence)

Refactor `ClaudeSession` (`src/core/session.ts`) to drive the SDK in **streaming-input mode** via **one persistent
`Query` per session** — preserving byte-identical `CoLiveEvent`s, the FIFO/single-writer serialization, the
`whenIdentified` id-capture, and full glasses (Even-app) compatibility — and replace the abort-based interrupt with
`Query.interrupt()`, self-healing a dead query by lazy reopen-with-`resume`. **No new user-facing feature except a clean
interrupt.** This rung sets up — but does **not** ship — the b/c control layer.

## 1. Why this rung exists (the locked decision it executes)

✅ Today Core drives the SDK in **string-prompt mode**: `query({ prompt: string })`, one fresh `query()` per turn, stop
via `AbortController` (`src/core/session.ts`). The SDK also supports **streaming-input mode**
(`query({ prompt: string | AsyncIterable<SDKUserMessage> })`, ✅ `sdk.d.ts:2392`), and **only that mode** exposes the
`Query` control methods the M3.3 control layer needs — all documented *"only supported when streaming input/output is
used"* (✅ `sdk.d.ts`): `interrupt()` (2172), `setPermissionMode()` (2179), `setModel()` (2186),
`setMaxThinkingTokens()` (2203), the settings-merge, `supportedCommands()` (2237), `mcpServerStatus()` (2255). The
returned `Query` **is** the async generator we already iterate for messages (`Query extends
AsyncGenerator<SDKMessage, void>`, ✅ `sdk.d.ts:2162`).

The M3.0 §5 decision to upgrade to streaming-input is **already locked**. M3.3a is the isolated, regression-gated rung
that lands the plumbing once, safely, before any control feature rides on it.

**Locked architecture decisions (with the user, 2026-06-03):**
- **One persistent `Query` per session** (NOT a per-turn streaming query). It's the only shape that unlocks the full
  b/c control layer (live `setModel`/`setPermissionMode`/`supportedCommands`/`mcpServerStatus`/settings-merge) — so we
  do the scary refactor exactly once. 🧪
- **Failure recovery = transparent self-heal (Option 1):** on a fatal query error, emit an `error` event, then **lazily
  reopen** the query on the next prompt with `resume: sessionId` (the transcript is restored from disk; re-apply our
  held config). NOT surface-and-die; NOT eager background reconnect. 🧪

## 2. The persistent-`Query` lifecycle

A new internal abstraction, the **prompt inbox** — a pushable async iterable that is the `prompt` argument to the
single `query()` call:

- It is an `AsyncIterable<SDKUserMessage>` that **yields each pushed user message and awaits the next when empty**
  (an async generator backed by a one-slot hand-off: a pending `next()` resolves when `push(msg)` is called, else
  `push` buffers). It ends only when explicitly closed (session teardown / reopen).
- `push(text)` constructs a text `SDKUserMessage` (see §5) and hands it to the iterable.

Lifecycle of the `Query`:

| Event | Action |
|---|---|
| `start(sessionId?, cwd)` | record realpath'd cwd + optional resume id; **open nothing** (lazy). |
| first `run()` / no live query | open `query({ prompt: inbox, options })` with `resume: sessionId` if known; hold the `Query`; start the **single consumer loop** (§3). |
| later `run()` | `inbox.push(text)` — **no** new `query()`. |
| `/clear` / new session | close the query + inbox; the next prompt reopens **fresh** (no `resume`); new sessionId from `init`. |
| `interrupt()` | `await query.interrupt()`; query + inbox **stay alive** (§4). |
| fatal query error | emit `error`; mark the query dead; **reopen lazily with `resume` on the next `run()`** (Option 1). |
| session teardown | close inbox → query generator returns; clear timers. |

Options at open are **exactly today's** (`model`, `permissionMode`, `settingSources`, `cwd`, `includePartialMessages:
true`, `canUseTool`, optional `resume`/`maxTurns`) — see §5. The `abortController` option is dropped from the per-turn
path (interrupt is now `Query.interrupt()`); an `AbortController` is retained only for hard teardown.

## 3. Turn boundaries in a continuous stream

The load-bearing change. Today turn-over is implicit: the `for await` over `query()` **ends**, and the `finally` block
emits terminal idle + drains the queue. With a persistent query the loop **does not end per turn** — it spans the whole
session. So:

- A **single long-lived consumer loop** iterates the `Query` and routes every message through the **existing
  `handleMessage` dispatch UNCHANGED** (`handleSystem`/`handleStreamEvent`/`handleAssistant`/`handleUser`/`handleResult`).
- **Turn start** (when a pushed prompt begins its turn) re-anchors the per-turn resets currently done at the top of
  `driveTurn`: `openBlocks.clear()`, `announcedToolIds.clear()`, `openTools.clear()`, `inputTokens/outputTokens = 0`,
  `turnStartedAt = clock.now()`, `startStatsTimer()`, `idleEmitted = false`, emit `user_prompt` + `status: busy`.
- **Turn end is detected from the `result` message** (the SDK emits exactly one per turn): on `result`, after
  `handleResult` emits the `result` event, stop the stats timer, emit terminal idle (deduped via `idleEmitted`), resolve
  **this prompt's** `run()` promise, and let the FIFO drain push the next queued prompt onto the inbox.
- A `session_state_changed: idle` still emits idle (deduped), exactly as today.

This moves the turn framing from "stream ended" to "`result` arrived" — but the *emitted events* are unchanged.

## 4. Interrupt → `Query.interrupt()`

- `interrupt()` calls `await query.interrupt()` (Promise; `sdk.d.ts:2172`) instead of `abortController.abort()`.
- The SDK ends the in-flight turn; we frame terminal idle (the turn's `result`/abort still flows through the loop). The
  **persistent query and inbox stay alive** — the next `run()` pushes the next prompt with no reopen. "Session usable
  immediately after Esc" is M3.3a's single user-visible improvement over today's abort.
- The current `currentAbort?.abort()` interrupt path is removed; the only remaining `AbortController` use is hard
  session teardown (closing the consumer loop), not a per-turn stop.

## 5. Message shape + config (what stays the same)

- The prompt is now an `SDKUserMessage`, not a bare string. M3.3a constructs a **text-only** user message (the SDK's
  `{ type: 'user', message: { role: 'user', content: <string-or-text-block> }, ... }` shape — exact field set 🔴 to be
  confirmed against `sdk.d.ts` `SDKUserMessage` during the build, before any other work). This is functionally today's
  behavior. The **structured-content** path (image blocks) is left as the natural c-rung extension; M3.3a does not build
  image UI/encoding (YAGNI) but does not preclude it.
- **`settingSources` stays `[]`; `model`/`permissionMode` stay from config** exactly as today. The flip + live control
  methods are b/c, NOT a. M3.3a changes **how** we drive the SDK, not **what** config it runs with.

## 6. The biggest unknown (verify before committing)

🔴 **Does streaming-input mode emit the same SDK message stream as string-prompt mode?** — `init` first, exactly one
`result` per turn, the same `stream_event`/`assistant`/`user` shapes the mapping layer expects. This is the load-bearing
assumption and is **a verification target, not a given.** **Mitigation (do this FIRST in the build):** a live probe —
open a persistent streaming query, push two prompts, log the raw message stream, and confirm (a) one `init`, (b) one
`result` per turn, (c) the same `stream_event` content-block shapes. If any differ, adjust the turn-boundary/mapping
before building the rest. Record the probe finding in `knowledge/terminal-mode/`.

## 7. Decomposition / units

| Unit | File | Responsibility |
|---|---|---|
| **Prompt inbox** | `src/core/promptInbox.ts` (**new**) | pushable `AsyncIterable<SDKUserMessage>`: `push(text)`, `close()`; pure + unit-tested (no SDK). |
| **Turn driver** | `src/core/session.ts` (modify) | open one persistent `query()` per session; single consumer loop; turn-start resets + `result`-based turn-end; `Query.interrupt()`; lazy reopen-with-resume. **Reuses `handleMessage*` verbatim.** |
| **QueryFn type** | `src/core/session.ts` (modify) | `QueryFn` now returns a `Query`-like object (async-generator + `interrupt()`); `prompt` is the inbox iterable, not a string. |

`sessionManager.ts`, `events.ts` (the `CoLiveEvent` vocabulary), `hub/*`, `desk/*` — **unchanged**. The new file keeps
`session.ts` from absorbing the inbox's buffering logic (it already does a lot).

## 8. Invariants (must hold) 🧪

- **Byte-identical `CoLiveEvent`s** — the entire `handleMessage*` layer is reused unchanged; proven by §9 replay-diff.
- **FIFO / single-writer** — one turn at a time per session; queued-while-busy prompts run in order; per-prompt resolve.
- **`whenIdentified` / id-capture** — `init` still arrives first and settles the signal; turn-end without an id still
  settles it (now on `result`/teardown instead of stream-end).
- **Glasses byte-compat** — SessionManager/Hub/SSE/Even-app untouched; the SSE event stream is identical.
- **Config unchanged** — `settingSources: []`, same model/permissionMode.
- No test gaming (no deleted tests, no `.skip`/`.only`); typecheck clean.

## 9. Testing (how we prove a pure refactor is safe)

- **Equivalence (the core guarantee):** the existing `ClaudeSession` unit tests feed a fake `query` a scripted SDK
  message stream and assert the emitted `CoLiveEvent`s. The fake `query` is upgraded to return a `Query`-like
  async-generator (+ `interrupt()` stub) that consumes the inbox `AsyncIterable`. **The same event assertions must pass
  against the refactored driver** — this is the regression net.
- **Tier-3 record/replay (M3.1 harness):** replay a recorded real SDK message stream through the old and new drivers and
  **diff the emitted event sequences → byte-identical proof.** (If no suitable recording exists, capture one via the
  existing record path during the §6 probe.)
- **New unit tests:**
  - one `query()` opened across N sequential prompts (assert the fake `query` is constructed **once**, N messages pushed);
  - turn-end detected on `result` (not stream-end): two prompts on one query each produce a full event arc + terminal idle;
  - `interrupt()` calls `query.interrupt()`, frames idle, and the **next** prompt still drives a turn on the same query;
  - fatal error → next `run()` reopens with `resume` (assert a second `query()` with `resume: sessionId`);
  - prompt inbox (`promptInbox.ts`): push-before-next buffers; next-before-push awaits; `close()` ends iteration; FIFO order.
- All existing Core + Hub tests stay green.

## 10. Acceptance (hardware UAT — the real bar)

No new feature but interrupt, so this is a **regression walk** on real G2 + R1:

| # | Walk | Pass = |
|---|------|--------|
| D1 | Run a real multi-tool session end-to-end (desk + glasses) | Transcript, thinking, diffs, tools, todos, status all render **exactly as today** |
| D2 | Send several prompts in one session; queue one mid-turn | Sequential turns work; the mid-turn prompt runs **after** the current one (FIFO holds) |
| D3 | Esc mid-turn (clean interrupt) | Turn stops promptly; **the session is immediately usable** — the next prompt drives a new turn on the same session |
| D4 | Send a prompt from the **glasses**; observe events | Glasses send + receive **unchanged** (co-live byte-compat) |
| D5 | Induce a transient failure (e.g. brief connectivity drop), then prompt | Session **self-heals** — next prompt reopens with `resume` and continues the transcript |

Sign-off recorded in `projects/colive-terminal/m3.3a-uat-runbook.md`.

## 11. Risks + mitigations

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | **SDK stream differs in streaming mode** (no per-turn `result`, different shapes) | Med | §6 live probe FIRST; replay-diff; adjust turn-boundary before building the rest. |
| R2 | **Prompt-inbox deadlock** (closes early / never yields → query hangs or ends) | Med | pure unit tests for buffer/await/close ordering; the consumer loop owns close. |
| R3 | **Interrupt leaves the query unusable** | Med | explicit "next prompt after interrupt" test + D3 hardware check. |
| R4 | **Hidden event drift** vs string mode | Med | the equivalence + replay-diff tests are the gate; not merged until byte-identical. |
| R5 | **Persistent connection cost / leak** | Low | one query per session; close on teardown; long sessions exercised in D1/D5. |
| R6 | **Glasses regression** (the co-live contract) | Low-Med | zero change to Hub/SSE/Even path; D4 is a dedicated hardware check. |

## 12. Out of scope (b/c rungs)
- `/model`, mode/plan toggle, `/compact`, `supportedCommands` probe → **M3.3b**.
- `settingSources` flip + skills/hooks loading (latency + HUD-leak handling), **image paste** (`SDKUserMessage` content
  blocks), **MCP** servers/auth/status → **M3.3c** (likely split further; MCP + image paste to be YAGNI-pressure-tested then).
- Multi-session command-center, source tags → **M3.4**. Aesthetics → **M3.5**.
