# Co-Live Terminal M3.3a — Streaming-input Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `ClaudeSession` to drive the SDK in streaming-input mode via one persistent `Query` per session, with `Query.interrupt()` and lazy reopen-with-resume — while keeping emitted `CoLiveEvent`s byte-identical and `SessionManager`/Hub/desk/glasses untouched.

**Architecture:** A new pushable `PromptInbox` (`AsyncIterable<SDKUserMessage>`) is the `prompt` arg to a single `query()` opened lazily per session. A long-lived consumer loop iterates the returned `Query`, routes every message through the **existing** `handleMessage*` mapping layer (unchanged → identical events), and detects turn-end from the `result` message (not stream-end). Interrupt becomes `Query.interrupt()`; a fatal consumer error self-heals by reopening with `resume` on the next prompt.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, vitest 4, ink (desk render unchanged). Commands run from `colive-terminal/`.

**Spec:** `docs/superpowers/specs/2026-06-03-colive-terminal-m3.3a-streaming-input-core-design.md`

**The one rule that makes this safe:** the `handleMessage*` event-mapping methods are **moved, not modified**. If you find yourself changing what an event contains, stop — that's a regression, not a refactor.

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `src/core/promptInbox.ts` | **new** | Pushable `AsyncIterable<SDKUserMessage>` (`push`/`close`) + `textUserMessage(text)` builder. Pure, no SDK calls. |
| `src/core/session.ts` | modify | Persistent-`Query` driver: lazy open fed by the inbox, single consumer loop, `result`-based turn-end, `Query.interrupt()`, lazy reopen-with-resume. **Reuses `handleMessage*` verbatim.** |
| `test/core/promptInbox.test.ts` | **new** | Inbox semantics (buffer/await/close/FIFO). |
| `test/core/session.test.ts` | modify | Upgrade the local `fakeQuery` to the persistent-`Query` shape; keep ALL existing event assertions (the equivalence net); add persistent/interrupt/reopen/golden tests. |
| `test/preview/m33a.preview.test.tsx` | **new** | Desk-render regression frames (events unchanged ⇒ frames unchanged). |
| `projects/colive-terminal/m3.3a-uat-runbook.md` | **new** | Hardware UAT D1–D5 **with copy-paste commands**. |
| `scripts/screenshots.sh` | modify | Add the M3.3a frame→PNG entries. |
| `knowledge/terminal-mode/streaming-input-probe.md` | **new** | The Task 1 probe finding. |

**Accepted M3.3a boundary:** `SessionManager` is **not** changed — `run(text)` and `interrupt()` keep their signatures (`interrupt()` stays `void`; the manager calls both fire-and-forget). A persistent query lives until process exit (no per-session GC); session eviction/GC is M3.4's concern, explicitly out of scope here.

---

### Task 1: Live streaming-input probe (spike — DO THIS FIRST)

**Goal:** verify spec §6 — does streaming-input mode emit the same SDK messages as string mode? Everything downstream assumes "one `init`, one `result` per turn, same `stream_event` shapes." This is a spike (not TDD); its deliverable is a recorded finding. **Requires the user's API auth — run locally.**

**Files:**
- Create: `knowledge/terminal-mode/streaming-input-probe.md`
- Scratch: a throwaway script (do not commit) e.g. `scratch/probe.ts`

- [ ] **Step 1: Write a throwaway probe script** — `scratch/probe.ts`:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

async function* inbox() {
  yield { type: 'user', message: { role: 'user', content: 'say hello in one word' }, parent_tool_use_id: null }
  await new Promise((r) => setTimeout(r, 8000)) // let turn 1 finish, then send turn 2
  yield { type: 'user', message: { role: 'user', content: 'now say goodbye in one word' }, parent_tool_use_id: null }
}

const q = query({ prompt: inbox() as any, options: { includePartialMessages: true } as any })
let resultCount = 0
for await (const m of q as any) {
  const type = (m as any).type
  const subtype = (m as any).subtype
  if (type === 'result') resultCount++
  console.log(JSON.stringify({ type, subtype, resultCount }))
}
```

- [ ] **Step 2: Run it and capture the stream**

Run: `npx tsx scratch/probe.ts > scratch/probe-out.jsonl 2>&1` (uses the user's logged-in auth)
Expected: messages stream for both prompts.

- [ ] **Step 3: Confirm the three assumptions** — inspect `scratch/probe-out.jsonl`:
  1. Exactly **one** `system`/`init` message (at the start, not per turn).
  2. Exactly **one** `result` message **per turn** (so `resultCount` reaches 2).
  3. The `stream_event` content-block shapes (`content_block_start`/`_delta`/`_stop`, `tool_use`/`text`/`thinking`) match what `handleStreamEvent` reads today.
  Also note: does `interrupt()` (not exercised here) produce a `result`? (Flagged for Task 4.)

- [ ] **Step 4: Record the finding** — write `knowledge/terminal-mode/streaming-input-probe.md` (confidence-tagged): what the stream looked like, whether the three assumptions held, and — **if any diverged** — the concrete adjustment needed (e.g. "turn-end is signalled by X, not `result`"). If assumptions hold, the rest of the plan proceeds as written. **Delete `scratch/` before any commit.**

- [ ] **Step 5: Commit the knowledge note only**

```bash
git add knowledge/terminal-mode/streaming-input-probe.md
git commit -m "docs(m3.3a): streaming-input SDK probe — message-shape finding"
```

---

### Task 2: `PromptInbox` + `textUserMessage`

**Files:**
- Create: `src/core/promptInbox.ts`
- Test: `test/core/promptInbox.test.ts`

- [ ] **Step 1: Write the failing tests** — `test/core/promptInbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PromptInbox, textUserMessage } from '../../src/core/promptInbox'

async function take<T>(it: AsyncIterator<T>): Promise<IteratorResult<T>> {
  return it.next()
}

describe('textUserMessage', () => {
  it('builds the SDK text user-message shape', () => {
    expect(textUserMessage('hi')).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      parent_tool_use_id: null,
    })
  })
})

describe('PromptInbox', () => {
  it('push-before-next: a buffered message is delivered on next()', async () => {
    const box = new PromptInbox()
    box.push(textUserMessage('a'))
    const it = box[Symbol.asyncIterator]()
    const r = await take(it)
    expect(r.done).toBe(false)
    expect((r.value as any).message.content).toBe('a')
  })

  it('next-before-push: next() awaits, then resolves when push arrives', async () => {
    const box = new PromptInbox()
    const it = box[Symbol.asyncIterator]()
    const pending = take(it)
    box.push(textUserMessage('b'))
    const r = await pending
    expect((r.value as any).message.content).toBe('b')
  })

  it('preserves FIFO order', async () => {
    const box = new PromptInbox()
    box.push(textUserMessage('1'))
    box.push(textUserMessage('2'))
    const it = box[Symbol.asyncIterator]()
    expect(((await take(it)).value as any).message.content).toBe('1')
    expect(((await take(it)).value as any).message.content).toBe('2')
  })

  it('close() ends iteration (done:true), even with a pending next()', async () => {
    const box = new PromptInbox()
    const it = box[Symbol.asyncIterator]()
    const pending = take(it)
    box.close()
    expect((await pending).done).toBe(true)
    box.push(textUserMessage('ignored')) // no throw; no effect after close
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/promptInbox.test.ts`
Expected: FAIL — cannot find module `promptInbox`.

- [ ] **Step 3: Implement** — `src/core/promptInbox.ts`:

```ts
/**
 * The desk Core's streaming-input feed: a single-consumer, pushable async
 * iterable of SDKUserMessage. It is the `prompt` argument to the one persistent
 * query() per session — run() pushes a message; the SDK pulls them as turns.
 *
 * Single-consumer by contract (only ClaudeSession's consumer loop iterates it).
 */
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/** Build the SDK text user-message shape (sdk.d.ts SDKUserMessage). */
export function textUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  } as SDKUserMessage
}

export class PromptInbox implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = []
  private pendingNext: ((r: IteratorResult<SDKUserMessage>) => void) | undefined
  private closed = false

  /** Hand a message to the consumer (or buffer it until the consumer asks). */
  push(msg: SDKUserMessage): void {
    if (this.closed) return
    if (this.pendingNext !== undefined) {
      const resolve = this.pendingNext
      this.pendingNext = undefined
      resolve({ value: msg, done: false })
    } else {
      this.buffer.push(msg)
    }
  }

  /** End iteration; a pending next() resolves done, future pushes are ignored. */
  close(): void {
    this.closed = true
    if (this.pendingNext !== undefined) {
      const resolve = this.pendingNext
      this.pendingNext = undefined
      resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () =>
        new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          if (this.buffer.length > 0) {
            resolve({ value: this.buffer.shift()!, done: false })
          } else if (this.closed) {
            resolve({ value: undefined as unknown as SDKUserMessage, done: true })
          } else {
            this.pendingNext = resolve
          }
        }),
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/core/promptInbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/promptInbox.ts test/core/promptInbox.test.ts
git commit -m "feat(m3.3a): PromptInbox — pushable AsyncIterable<SDKUserMessage> feed"
```

---

### Task 3: Refactor `ClaudeSession` to the persistent `Query`

This is the core task. Read `src/core/session.ts` end-to-end first. You will **move** the per-turn lifecycle out of `driveTurn` into a `beginTurn` (turn-start) + a long-lived consumer loop (turn-end on `result`), and feed one `query()` via the inbox. The `handleMessage`/`handleSystem`/`handleStreamEvent`/`handleAssistant`/`handleUser`/`handleResult`/`absorbUsage`/`startStatsTimer`/`stopStatsTimer`/`emitIdle`/`settleIdentified` methods are **moved unchanged**.

**Files:**
- Modify: `src/core/session.ts`
- Test: `test/core/session.test.ts`

- [ ] **Step 1: Upgrade the test `fakeQuery` to the persistent-`Query` shape** — in `test/core/session.test.ts`, replace the `fakeQuery` helper so ONE query consumes the inbox and yields each turn's messages as prompts arrive, exposing `interrupt()`:

```ts
import type { QueryFn, QueryLike } from '../../src/core/session'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * A persistent-Query fake: a single query() whose generator pulls one message
 * from the inbox per turn and yields that turn's scripted SDK messages (ending
 * with the turn's `result`). interrupt() makes the in-flight turn emit a result
 * so the driver can frame turn-end (matches the real SDK per the Task 1 probe).
 */
function fakeQuery(turns: unknown[][]): {
  fn: QueryFn
  calls: Array<{ options?: unknown }>
} {
  const calls: Array<{ options?: unknown }> = []
  const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: unknown }) => {
    calls.push({ options: args.options })
    let turn = 0
    const gen = (async function* () {
      for await (const _msg of args.prompt) {
        const messages = turns[turn] ?? [resultMessage(`sess-${turn}`)]
        turn++
        for (const m of messages) yield m
      }
    })()
    const q = gen as unknown as QueryLike
    ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
      /* no-op stub; interrupt-emits-result is asserted in Task 4 via a custom turn */
    }
    return q
  }) as unknown as QueryFn
  return { fn, calls }
}

/** Minimal SDK result message used to close a scripted turn. */
function resultMessage(sessionId: string): Record<string, unknown> {
  return { type: 'result', subtype: 'success', session_id: sessionId, result: '', usage: {} }
}
```

> Keep the existing `happyTurnMessages(...)` / per-test message scripts AS-IS. Only the `fakeQuery` constructor shape and the `QueryFn` import change. The per-test **event assertions do not change** — that is the equivalence guarantee.

- [ ] **Step 2: Run the existing suite to see it fail against the old driver shape**

Run: `npx vitest run test/core/session.test.ts`
Expected: FAIL — `QueryLike` is not exported; the old string-prompt driver doesn't consume an inbox.

- [ ] **Step 3: Refactor `session.ts` — types** — replace the `QueryFn`/`QueryOptions` declarations:

```ts
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { PromptInbox, textUserMessage } from './promptInbox'

/** The streaming Query: the async-iterable of SDK messages + the control methods we use. */
export interface QueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<void>
}

/** The injectable streaming-input `query` driver. Default = real SDK; tests inject a fake. */
export type QueryFn = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}) => QueryLike

/** The subset of SDK `Options` we set at query-open. (No abortController — interrupt is Query.interrupt().) */
export interface QueryOptions {
  model: string
  permissionMode: PermissionMode
  settingSources: readonly SettingSource[]
  cwd: string
  resume?: string
  includePartialMessages: boolean
  canUseTool: CanUseTool
  maxTurns?: number
}
```

- [ ] **Step 4: Refactor `session.ts` — fields + run/interrupt/lifecycle** — replace the `_busy`/`queue`/`currentAbort` machinery and the `run`/`interrupt`/`enqueue`/`drainQueue`/`driveTurn` methods with the persistent-query driver. Add these fields:

```ts
  /** The held streaming Query + its inbox (one per open). Undefined until first run / after death. */
  private q: QueryLike | undefined
  private inbox: PromptInbox | undefined
  /** True once a fatal consumer error killed the query; next run() reopens with resume. */
  private dead = false
  /** Resolver for the in-flight turn's run() promise (settled on its `result`). */
  private currentTurnResolve: (() => void) | undefined
```

Replace `run`/`interrupt` and the turn machinery with:

```ts
  /**
   * Run one turn with `text`. If a turn is in flight, `text` is queued (FIFO) and
   * runs after the current turn's `result`. Resolves once `text`'s own turn ends.
   */
  async run(text: string): Promise<void> {
    if (this._busy) {
      return new Promise<void>((resolve) => this.queue.push({ text, resolve }))
    }
    return new Promise<void>((resolve) => this.beginTurn(text, resolve))
  }

  /**
   * Interrupt the in-flight turn via Query.interrupt(). The query stays alive for
   * the next prompt. No-op when idle. Stays `void` so SessionManager is unchanged.
   */
  interrupt(): void {
    void this.q?.interrupt().catch(() => {})
  }

  /** Begin a turn: per-turn resets, ensure the query is open, push the prompt. */
  private beginTurn(text: string, resolve: () => void): void {
    this._busy = true
    this.currentTurnResolve = resolve
    this.idleEmitted = false
    this.openBlocks.clear()
    this.announcedToolIds.clear()
    this.openTools.clear()
    this.inputTokens = 0
    this.outputTokens = 0
    this.turnStartedAt = this.clock.now()
    this.emit({ type: 'user_prompt', text })
    this.emit({ type: 'status', state: 'busy' })
    this.startStatsTimer()
    this.ensureQueryOpen()
    this.inbox!.push(textUserMessage(text))
  }

  /** Open the persistent query (lazy / after death) and start its consumer loop. */
  private ensureQueryOpen(): void {
    if (this.q !== undefined && !this.dead) return
    this.dead = false
    this.inbox = new PromptInbox()
    const options: QueryOptions = {
      model: this.config.model,
      permissionMode: this.config.permissionMode,
      settingSources: this.config.settingSources,
      cwd: this.cwd ?? realpathSync(process.cwd()),
      includePartialMessages: true,
      canUseTool: this.canUseTool,
      ...(this._sessionId !== undefined ? { resume: this._sessionId } : {}),
      ...(this.config.maxTurns !== undefined ? { maxTurns: this.config.maxTurns } : {}),
    }
    const q = this.query({ prompt: this.inbox, options })
    this.q = q
    this.startConsumer(q)
  }

  /** The single long-lived loop: map every message; detect turn-end on `result`. */
  private startConsumer(q: QueryLike): void {
    void (async () => {
      try {
        for await (const message of q) {
          this.handleMessage(message)
          if (isRecord(message) && message.type === 'result') this.onTurnEnd()
        }
      } catch (err) {
        this.onConsumerError(err)
      }
    })()
  }

  /** Turn-end (on `result`): close out the turn, resolve run(), drain the FIFO. */
  private onTurnEnd(): void {
    this.stopStatsTimer()
    this.settleIdentified()
    this.emitIdle()
    this._busy = false
    const resolve = this.currentTurnResolve
    this.currentTurnResolve = undefined
    resolve?.()
    const next = this.queue.shift()
    if (next !== undefined) this.beginTurn(next.text, next.resolve)
  }

  /**
   * Fatal consumer error: surface it, mark the query dead, settle the in-flight
   * turn, and let the next prompt reopen with `resume` (self-heal, spec Option 1).
   */
  private onConsumerError(err: unknown): void {
    this.dead = true
    this.q = undefined
    this.inbox = undefined
    this.stopStatsTimer()
    this.emit({ type: 'error', message: errorMessage(err) })
    this.settleIdentified()
    this.emitIdle()
    this._busy = false
    const resolve = this.currentTurnResolve
    this.currentTurnResolve = undefined
    resolve?.()
    const next = this.queue.shift()
    if (next !== undefined) this.beginTurn(next.text, next.resolve) // beginTurn -> ensureQueryOpen reopens (dead)
  }

  /** Close the persistent query (session teardown / new-session reset). */
  close(): void {
    this.inbox?.close()
    this.q = undefined
    this.inbox = undefined
    this.dead = false
    this.stopStatsTimer()
  }
```

> Keep `_busy`, `idleEmitted`, `queue`, `openBlocks`, `announcedToolIds`, `openTools`, `inputTokens`, `outputTokens`, `turnStartedAt`, `statsTimer`, and ALL the `handle*`/`emitIdle`/`startStatsTimer`/`stopStatsTimer`/`settleIdentified`/`absorbUsage` methods exactly as they are. Delete the old `currentAbort` field and any `abortController` wiring.

- [ ] **Step 5: Run the existing suite (the equivalence net) to verify pass**

Run: `npx vitest run test/core/session.test.ts`
Expected: PASS — every pre-existing event assertion still holds against the new driver.

- [ ] **Step 6: Add persistent-query behaviour tests** — append to `test/core/session.test.ts`:

```ts
describe('ClaudeSession — persistent streaming query', () => {
  it('opens ONE query() across N sequential prompts', async () => {
    const { fn, calls } = fakeQuery([happyTurnMessages('s'), happyTurnMessages('s')])
    const session = new ClaudeSession({ config: baseConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('first')
    await session.run('second')
    expect(calls).toHaveLength(1) // one query(), two turns
  })

  it('detects turn-end on the result message and resolves run() per turn', async () => {
    const events: string[] = []
    const { fn } = fakeQuery([happyTurnMessages('s'), happyTurnMessages('s')])
    const session = new ClaudeSession({ config: baseConfig(), emit: (e) => events.push(e.type), canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('one')
    await session.run('two')
    expect(events.filter((t) => t === 'user_prompt')).toHaveLength(2)
    expect(events.filter((t) => t === 'result')).toHaveLength(2)
  })
})
```

> Use whatever `baseConfig()` / `stubCanUseTool` / `stubClock()` helpers the existing tests use; if they're inline, factor tiny local helpers mirroring the existing `new ClaudeSession({...})` calls. `happyTurnMessages` already exists.

- [ ] **Step 7: Run + commit**

Run: `npx vitest run test/core/session.test.ts` → PASS

```bash
git add src/core/session.ts test/core/session.test.ts
git commit -m "feat(m3.3a): drive the SDK via one persistent streaming Query per session"
```

---

### Task 4: Interrupt leaves the session usable

**Files:**
- Modify: `test/core/session.test.ts` (impl already added `interrupt()` in Task 3)

- [ ] **Step 1: Write the failing test** — append; this fake's `interrupt()` ends the current turn by emitting a `result`, then keeps awaiting the inbox (the spec §4 + Task 1 expectation):

```ts
describe('ClaudeSession — clean interrupt', () => {
  it('interrupt ends the current turn and the session accepts the next prompt on the SAME query', async () => {
    const calls: Array<{ options?: unknown }> = []
    let emitResult: (() => void) | undefined
    // A query whose turn streams text then PAUSES; interrupt() flushes a result.
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: unknown }) => {
      calls.push({ options: args.options })
      const pending: unknown[] = []
      let wake: (() => void) | undefined
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } }
          // wait until interrupt() flushes a result for this turn
          await new Promise<void>((r) => { wake = r })
          while (pending.length) yield pending.shift()
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
        pending.push({ type: 'result', subtype: 'success', session_id: 's', result: '', usage: {} })
        wake?.()
      }
      return q
    }) as unknown as QueryFn

    const events: string[] = []
    const session = new ClaudeSession({ config: baseConfig(), emit: (e) => events.push(e.type), canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    const turn1 = session.run('long thing')
    await Promise.resolve()
    session.interrupt()
    await turn1                 // resolves once the flushed result frames turn-end
    await session.run('next thing') // SAME query (no reopen)
    expect(calls).toHaveLength(1)
    expect(events).toContain('user_prompt')
  })
})
```

- [ ] **Step 2: Run to verify it fails or passes** — if Task 3's `interrupt()` + `onTurnEnd` are correct this may already PASS. Run: `npx vitest run test/core/session.test.ts`. If it FAILS (e.g. the turn never frames end on interrupt), fix `interrupt()`/`onTurnEnd` until the next prompt runs on the same query.

- [ ] **Step 3: Commit**

```bash
git add test/core/session.test.ts src/core/session.ts
git commit -m "test(m3.3a): clean interrupt — session usable on the same query after Esc"
```

---

### Task 5: Lazy reopen-with-resume self-heal

**Files:**
- Modify: `test/core/session.test.ts`

- [ ] **Step 1: Write the failing test** — append; the first query throws mid-stream, the next run() must reopen with `resume`:

```ts
describe('ClaudeSession — self-heal on fatal query error', () => {
  it('a dead query reopens with resume:<sessionId> on the next prompt', async () => {
    const calls: Array<{ options?: { resume?: string } }> = []
    let openCount = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string } }) => {
      calls.push({ options: args.options })
      const which = openCount++
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          if (which === 0) {
            // first open: surface the session id, then die mid-turn
            yield { type: 'system', subtype: 'init', session_id: 'sess-1' }
            throw new Error('stream blew up')
          }
          yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const events: string[] = []
    const session = new ClaudeSession({ config: baseConfig(), emit: (e) => events.push(e.type), canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('boom')          // opens, captures sess-1, dies -> error + idle
    await session.run('recover')       // reopens with resume:sess-1
    expect(events).toContain('error')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.options?.resume).toBe('sess-1')
  })
})
```

- [ ] **Step 2: Run to verify** — Run: `npx vitest run test/core/session.test.ts`. Should PASS given Task 3's `onConsumerError` + `ensureQueryOpen` resume logic. Fix if not.

- [ ] **Step 3: Commit**

```bash
git add test/core/session.test.ts src/core/session.ts
git commit -m "test(m3.3a): self-heal — dead query reopens with resume on next prompt"
```

---

### Task 6: Golden-master event equivalence

**Files:**
- Modify: `test/core/session.test.ts`

- [ ] **Step 1: Write the golden test** — a representative multi-block turn (thinking + text + a tool round-trip) asserted as a whole event sequence, so any drift in the mapping is caught:

```ts
describe('ClaudeSession — golden event sequence', () => {
  it('a thinking+text+tool turn maps to the exact event arc', async () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'g1' },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hi' } } },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Read', input: {} } } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false }] } },
      { type: 'result', subtype: 'success', session_id: 'g1', result: 'done', usage: { input_tokens: 5, output_tokens: 7 } },
    ]
    const events: unknown[] = []
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({ config: baseConfig(), emit: (e) => events.push(e), canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('go')
    expect(events.map((e: any) => e.type)).toEqual([
      'user_prompt', 'status', 'status', 'thinking_delta', 'status',
      'status', 'text_delta', 'status', 'tool_start', 'tool_end', 'result', 'status',
    ])
  })
})
```

> If the Task 1 probe found a different real ordering, reconcile this golden to the probe's truth (the probe is ground truth, this is the regression pin).

- [ ] **Step 2: Run + commit**

Run: `npx vitest run test/core/session.test.ts` → PASS

```bash
git add test/core/session.test.ts
git commit -m "test(m3.3a): golden-master event sequence (byte-identical mapping guard)"
```

---

### Task 7: Internal self-test A — desk-render regression (preview rig + screenshots)

The desk render is unchanged by this Core refactor, so this is a **cheap regression frame**: prove the desk still renders a representative session identically (catches any accidental coupling), per the "self-test before UAT" rule. The preview rig drives the desk with canned events (a fake client) — it does NOT exercise Core; Task 8 does that.

**Files:**
- Create: `test/preview/m33a.preview.test.tsx`
- Modify: `scripts/screenshots.sh`

- [ ] **Step 1: Create the preview test** — `test/preview/m33a.preview.test.tsx` (mirror `m32a`/`m32b`; uses `capture()` with emitted events):

```tsx
/**
 * M3.3a desk-render regression preview. The Core refactor must NOT change what
 * the desk renders (events are byte-identical), so these frames should match the
 * pre-refactor render of the same canned session.
 *
 *   PREVIEW=1 npx vitest run test/preview/m33a.preview.test.tsx
 *   ./scripts/screenshots.sh m33a-session m33a-thinking
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, emit, type Frame } from './replay'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
const written: string[] = []
function dump(frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  for (const f of frames) {
    writeFileSync(resolve(OUT, `${f.label}.txt`), `${f.plain}\n`, 'utf8')
    writeFileSync(resolve(OUT, `${f.label}.ansi`), `${f.ansi}\n`, 'utf8')
    written.push(f.label)
  }
}
afterAll(() => { if (WRITE) console.log(`[m33a preview] wrote ${written.length} frame(s)`) })

describe('M3.3a desk-render regression', () => {
  it('renders a multi-tool session unchanged', async () => {
    const frames = await capture([
      emit({ type: 'user_prompt', text: 'refactor the turn driver' }),
      emit({ type: 'text_delta', text: 'On it — reading the session module.' }),
      emit({ type: 'tool_start', name: 'Read', toolId: 't1' }),
      emit({ type: 'tool_end', name: 'Read', toolId: 't1', summary: 'Read completed', detail: { input: { path: 'session.ts' }, output: '...' } }),
      emit({ type: 'status', state: 'idle' }),
      snap('m33a-session'),
    ])
    dump(frames)
    expect(frames[0]!.plain).toContain('refactor the turn driver')
    expect(frames[0]!.plain).toContain('Read')
  })
})
```

> Match the exact `CoLiveEvent` field names to `src/core/events.ts` (the `m32a`/`m32b` preview tests are the reference for the real shapes).

- [ ] **Step 2: Run the smoke assertion**

Run: `npx vitest run test/preview/m33a.preview.test.tsx`
Expected: PASS.

- [ ] **Step 3: Add the screenshot entry** — append to the `FRAMES=( … )` array in `scripts/screenshots.sh`:

```bash
  # M3.3a desk-render regression
  "m33a-session:shot-m33a-session"
```

- [ ] **Step 4: Dump + screenshot + eyeball**

Run: `PREVIEW=1 npx vitest run test/preview/m33a.preview.test.tsx`
Run: `./scripts/screenshots.sh m33a-session` (skip if `vhs` absent — the `.txt` frame suffices)
Confirm the rendered session looks identical to the M3.2 baseline (no layout/coupling regression).

- [ ] **Step 5: Commit**

```bash
git add test/preview/m33a.preview.test.tsx scripts/screenshots.sh
git commit -m "test(m3.3a): desk-render regression preview frame"
```

---

### Task 8: Internal self-test B — LIVE local run (real Core) + screenshots

This is the real internal UAT: it exercises the **actual refactored Core** end-to-end (minus the glasses) before the user touches hardware. **Requires the user's API auth — run locally on the user's machine.**

**Files:** none (verification; fixes loop back to Tasks 2–6).

- [ ] **Step 1: Start a real Hub + desk locally (two panes)**

Pane A: `npx tsx src/index.ts serve --host 127.0.0.1 --project-dir "$(pwd)"`
(note the **token** and **port** it prints in the banner)
Pane B: `npx tsx src/index.ts desk --host 127.0.0.1 --port <PORT> --token <TOKEN>`

- [ ] **Step 2: Drive a real multi-tool turn** — in the desk, send a prompt that uses tools, e.g.:

`read package.json and tell me the test script, then list the src/core files`

Confirm: streaming text, a tool round-trip, thinking, and a terminal idle all render — identical to today.

- [ ] **Step 3: Sequential turns + clean interrupt** — send a second prompt; confirm it runs after the first. Start a long turn (e.g. `summarize every file in src/core`) and press **Esc** mid-turn. Confirm the turn stops promptly and the session **immediately accepts the next prompt** (the M3.3a win).

- [ ] **Step 4: Self-heal** — with a turn idle, briefly drop connectivity (toggle Wi-Fi off ~5s then on), then send a prompt. Confirm an `error` surfaces if the query died and the **next prompt continues the same session** (reopened with resume).

- [ ] **Step 5: Capture screenshots of the live desk** — screenshot the desk pane after Step 2 (multi-tool turn) and after Step 3 (post-interrupt, session ready). Save to `preview-out/shot-m33a-live-*.png`. Eyeball: the live refactored Core renders exactly like the pre-refactor desk.

- [ ] **Step 6: Record the result** — note pass/fail of Steps 2–4 in the runbook's "internal self-test" section (Task 9). If anything misbehaves, fix in Tasks 3–5 and re-run. **Do not proceed to handback until this passes.**

---

### Task 9: Final verification + invariant proof + UAT runbook

**Files:**
- Create: `projects/colive-terminal/m3.3a-uat-runbook.md`

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: PASS; no `.skip`/`.only`; no deleted tests.

- [ ] **Step 2: Typecheck clean**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Prove the M3.3a invariant (Core change confined to session.ts + promptInbox.ts)**

Run: `git diff main --name-only -- src | grep -vE 'src/core/(session|promptInbox)\.ts$' || echo "CONFINED ✓"`
Expected: prints `CONFINED ✓` (no other `src/` file changed — `events.ts`, `sessionManager.ts`, `hub/`, `desk/` untouched).

- [ ] **Step 4: No test gaming**

Run: `git diff main -- test | grep -E "^-\s*(it|test|describe)\(" || echo "[none removed ✓]"`
Expected: `[none removed ✓]`.

- [ ] **Step 5: Write the UAT runbook (copy-paste commands)** — create `projects/colive-terminal/m3.3a-uat-runbook.md`:

````markdown
# M3.3a UAT — Streaming-input Core (hardware G2 + R1)

Pure refactor: behaviour must be **identical to today**, plus a clean interrupt and self-heal.

## Setup (copy-paste)

Two terminal panes on the Mac, from the project dir:

```bash
# Pane A — Hub + Core (note the TOKEN + PORT it prints)
cd ~/Documents/random_claude_stuff/even_realities/colive-terminal
npx tsx src/index.ts serve --host 127.0.0.1 --project-dir "$(pwd)"
```

```bash
# Pane B — desk client (fill in TOKEN + PORT from Pane A's banner)
cd ~/Documents/random_claude_stuff/even_realities/colive-terminal
npx tsx src/index.ts desk --host 127.0.0.1 --port <PORT> --token <TOKEN>
```

For the glasses walk (D4): start the Hub with Tailscale instead — `npx tsx src/index.ts serve` (no `--host`) and connect the Even app as in the M2 runbook.

## Walk

| # | Do this (copy-paste / keystroke) | Pass = |
|---|---|---|
| D1 | Send: `read package.json, then list src/core, then summarize the test setup` | Streaming text + tool round-trips + thinking + final idle render exactly as today |
| D2 | Send `say one`, then immediately send `say two` (queue mid-turn) | `two` runs only after `one` finishes (FIFO); both answered in order |
| D3 | Send `summarize every file in src/core in detail`, then press **Esc** mid-turn | Turn stops promptly; then send `now just say hi` → it runs on the same session immediately |
| D4 | From the **glasses**, send any prompt | Glasses send + receive events unchanged (co-live byte-compat) |
| D5 | Idle, toggle Wi-Fi off ~5s then on, then send `still there?` | Session self-heals — the prompt continues the same transcript (resume) |

## Internal self-test (filled by the builder, Task 8)
- Live local multi-tool turn: ___
- Clean interrupt + reuse: ___
- Self-heal: ___
- Screenshots: `preview-out/shot-m33a-*.png`

Sign-off: ___  Date: ___
````

- [ ] **Step 6: Commit**

```bash
git add projects/colive-terminal/m3.3a-uat-runbook.md
git commit -m "docs(m3.3a): UAT runbook (D1-D5) with copy-paste setup + verification"
```

- [ ] **Step 7: Hand back to the planning/validation chat** — do NOT merge. Report: the Task 1 probe finding, test-count delta, the `CONFINED ✓` invariant output, the no-gaming output, and the Task 8 live self-test result + screenshots, for planner validation before merge.

---

## Self-Review

**1. Spec coverage:**
- §0/§1 persistent Query + locked decisions → Tasks 2–3. ✓
- §2 lifecycle (lazy open, push, /clear close, reopen, teardown) → Task 3 (`ensureQueryOpen`/`close`/`onConsumerError`). ✓ (`/clear` uses `close()`; manager unchanged per boundary note.)
- §3 turn-boundary on `result` + single consumer loop + reused mapping → Task 3 (`startConsumer`/`onTurnEnd`). ✓
- §4 interrupt → `Query.interrupt()`, session usable → Task 4. ✓
- §5 `SDKUserMessage` text shape + config unchanged → Task 2 (`textUserMessage`) + Task 3 (`buildOptions` keeps today's config). ✓
- §6 probe FIRST → Task 1. ✓
- §7 units (promptInbox.ts new, session.ts modified, mapping reused) → file structure + Tasks 2–3. ✓
- §8 invariants (byte-identical events, FIFO, whenIdentified, glasses, config) → Tasks 3/6 + Task 9 Step 3 (confinement) + Step 4 (no gaming). ✓
- §9 testing (equivalence net, golden, new unit tests) → Tasks 3/4/5/6. ✓ (Tier-3 desk replay = Task 7's preview frame; record.ts records events, so Core equivalence rests on the session.test assertions + golden — noted in spec.)
- §10 UAT D1–D5 → Task 9 runbook. ✓
- §11 risks (R1 probe, R2 inbox tests, R3 interrupt test, R4 golden, R6 glasses D4) → covered. ✓
- User asks: screenshot self-test before UAT → Tasks 7 (deterministic) + 8 (live); runbook copy-paste → Task 9 Step 5. ✓

**2. Placeholder scan:** No TBD/TODO. The `<PORT>`/`<TOKEN>` in the runbook are real runtime values the user fills from the banner (intended), not plan gaps. Every code step has complete code; every run step has a command + expected result.

**3. Type consistency:** `QueryLike` (extends `AsyncIterable<unknown>`, `interrupt(): Promise<void>`) and `QueryFn` (prompt `AsyncIterable<SDKUserMessage>`) defined Task 3, used in the Task 3/4/5 fakes. `PromptInbox`/`textUserMessage` defined Task 2, used Task 3. `QueryOptions` drops `abortController` (Task 3) — consistent with removing `currentAbort`. `interrupt()` stays `void` (manager unchanged). `close()` defined Task 3, referenced by the §2 `/clear`/teardown lifecycle.

No gaps found.
