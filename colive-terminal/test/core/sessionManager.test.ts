import { describe, it, expect } from 'vitest'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { SessionManager } from '../../src/core/sessionManager'
import type { QueryFn, QueryLike } from '../../src/core/session'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { TaggedEvent } from '../../src/core/sessionManager'

/** A minimal config the manager needs (mirrors the session/permission slices). */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-4-8',
    permissionMode: 'default' as const,
    settingSources: [] as const,
    projectDir: realpathSync(tmpdir()),
    ...overrides,
  }
}

/**
 * Build a persistent-Query fake from scripted per-turn message lists: ONE
 * query() consumes the inbox, yielding each turn's messages as prompts arrive
 * (each turn ends with its `result`). Records the `options` per query() OPEN
 * (once per session, twice only after a reopen) and the text of every pushed
 * prompt drained from the inbox. interrupt() is a no-op stub.
 */
function fakeQuery(turns: unknown[][]): {
  fn: QueryFn
  calls: Array<{ options?: any }>
  pushed: string[]
} {
  const calls: Array<{ options?: any }> = []
  const pushed: string[] = []
  const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
    calls.push({ options: args.options })
    let turn = 0
    const gen = (async function* () {
      for await (const msg of args.prompt) {
        pushed.push(pushedText(msg))
        const messages = turns[turn] ?? []
        turn += 1
        for (const m of messages) yield m
      }
    })()
    const q = gen as unknown as QueryLike
    ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
    return q
  }) as unknown as QueryFn
  return { fn, calls, pushed }
}

/** Extract the text of a pushed SDKUserMessage (textUserMessage shape). */
function pushedText(msg: SDKUserMessage): string {
  const content = (msg as { message?: { content?: unknown } }).message?.content
  return typeof content === 'string' ? content : ''
}

/** Drain the microtask queue so an in-flight (ungated) turn runs to completion. */
async function drain(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

/** Await a real macrotask (a setTimeout tick), past the microtask queue. */
function macrotask(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** A short scripted "happy turn" surfacing `sessionId` via the init message. */
function happyTurn(sessionId: string, text = '') {
  return [
    { type: 'system', subtype: 'init', session_id: sessionId },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    {
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      result: text,
      total_cost_usd: 0,
      num_turns: 1,
      duration_ms: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  ]
}

describe('SessionManager — slash guard at the boundary', () => {
  it('rejects a slash prompt without creating a session or calling query', async () => {
    const tagged: TaggedEvent[] = []
    const { fn, calls } = fakeQuery([])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => tagged.push(e))

    const id = await mgr.prompt(undefined, '/context', makeConfig().projectDir)

    // No session id is returned for a rejected slash prompt.
    expect(id).toBeUndefined()
    // query() was never called (the slash prompt never reached the model).
    expect(calls).toHaveLength(0)
    // the slash error was emitted (tagged, but no real session => empty id).
    const errs = tagged.filter((e) => e.event.type === 'error')
    expect(errs).toHaveLength(1)
    expect(errs[0].event).toEqual({ type: 'error', message: 'slash commands are client-side' })
  })
})

describe('SessionManager — fan-out tagged with sessionId', () => {
  it('fans every session event out to subscribers, tagged with the real sessionId', async () => {
    const subA: TaggedEvent[] = []
    const subB: TaggedEvent[] = []
    const { fn } = fakeQuery([happyTurn('real-sess-1', 'hi there')])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => subA.push(e))
    mgr.subscribe((e) => subB.push(e))

    const id = await mgr.prompt(undefined, 'say hi', makeConfig().projectDir)
    expect(id).toBe('real-sess-1')
    await drain() // let the (ungated) turn run to completion

    // Both subscribers see the same stream (fan-out).
    expect(subA.map((t) => t.event)).toEqual(subB.map((t) => t.event))

    // every tagged event carries the real sessionId learned from the stream.
    expect(subA.length).toBeGreaterThan(0)
    for (const t of subA) expect(t.sessionId).toBe('real-sess-1')

    // the underlying normalized events flowed through (prompt echo + result).
    const types = subA.map((t) => t.event.type)
    expect(types).toContain('user_prompt')
    expect(types).toContain('result')
    expect(subA.some((t) => t.event.type === 'text_delta' && t.event.text === 'hi there')).toBe(true)
  })

  it('an unsubscribe stops further events to that subscriber', async () => {
    const seen: TaggedEvent[] = []
    const { fn } = fakeQuery([happyTurn('s-unsub', 'x'), happyTurn('s-unsub', 'y')])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    const unsub = mgr.subscribe((e) => seen.push(e))

    const id = await mgr.prompt(undefined, 'one', makeConfig().projectDir)
    await drain()
    const countAfterFirst = seen.length
    expect(countAfterFirst).toBeGreaterThan(0)

    unsub()
    await mgr.prompt(id, 'two', makeConfig().projectDir)
    await drain()
    // no new events arrived after unsubscribing
    expect(seen.length).toBe(countAfterFirst)
  })
})

describe('SessionManager — delayed init (real SDK timing, not mock timing)', () => {
  it('learns the REAL id when init arrives a macrotask later; never leaks a local: id', async () => {
    // Regression for the id-learning busy-spin bug: the SDK can lag many seconds
    // before the `init` message arrives, and `init` emits NO event of its own.
    // Here init is yielded only AFTER a real setTimeout tick — past every
    // microtask. A microtask busy-spin exits before this lands and fabricates a
    // `local:<uuid>` id; the real signal (whenIdentified) must wait for it.
    const tagged: TaggedEvent[] = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          const text = pushedText(msg)
          // Delay the init past the microtask queue (the real first-turn lag).
          await new Promise((r) => setTimeout(r, 5))
          yield { type: 'system', subtype: 'init', session_id: 'REAL-ID' }
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text' },
            },
          }
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text },
            },
          }
          yield { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'REAL-ID',
            result: text,
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => tagged.push(e))

    // prompt() must resolve with the REAL id, not a fabricated local: placeholder.
    const id = await mgr.prompt(undefined, 'hello', makeConfig().projectDir)
    expect(id).toBe('REAL-ID')

    // getStatus / respond / interrupt all key by the real id (the map re-keyed).
    expect(mgr.getStatus('REAL-ID')).not.toBe('unknown')
    expect(() => mgr.respondPermission('REAL-ID', 'tu', 'allow')).not.toThrow()
    expect(() => mgr.interrupt('REAL-ID')).not.toThrow()

    // let the turn run to completion (it spans real macrotasks now)
    await macrotask(10)
    await drain()

    // EVERY event a subscriber saw carries the real id; no local: id ever leaked.
    expect(tagged.length).toBeGreaterThan(0)
    for (const t of tagged) {
      expect(t.sessionId).toBe('REAL-ID')
      expect(t.sessionId.startsWith('local:')).toBe(false)
    }
    // the pre-init prompt echo is tagged with the real id (buffered until init).
    expect(tagged[0]).toEqual({
      sessionId: 'REAL-ID',
      event: { type: 'user_prompt', text: 'hello' },
    })
    // the turn completed under the real id.
    expect(mgr.getStatus('REAL-ID')).toBe('idle')
    const types = tagged.map((t) => t.event.type)
    expect(types).toContain('result')
  })

  it('re-keys to the real id even when init is delayed; a second prompt continues the same live query', async () => {
    // A second prompt at the learned id must reach the SAME live session — proving
    // the map was re-keyed to the real id (not stranded under a local:
    // placeholder). With the persistent streaming query, a live idle session keeps
    // its query OPEN, so the second prompt is PUSHED onto the same inbox (no
    // reopen, no per-turn resume) and the SDK continues the same transcript.
    const resumeArgs: (string | undefined)[] = []
    const pushed: string[] = []
    let turn = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      resumeArgs.push(args.options?.resume)
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          pushed.push(pushedText(msg))
          const idx = turn
          turn += 1
          if (idx === 0) await new Promise((r) => setTimeout(r, 5))
          yield { type: 'system', subtype: 'init', session_id: 'DELAYED-ID' }
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'DELAYED-ID',
            result: '',
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    const id = await mgr.prompt(undefined, 'first', makeConfig().projectDir)
    expect(id).toBe('DELAYED-ID')
    await macrotask(10)
    await drain()
    expect(mgr.getStatus('DELAYED-ID')).toBe('idle')

    const again = await mgr.prompt(id, 'second', makeConfig().projectDir)
    // the map was re-keyed to the real id: the second prompt found the live session.
    expect(again).toBe('DELAYED-ID')
    await drain()
    // ONE persistent query() opened (fresh, so no resume); the second prompt was
    // pushed onto the same inbox — the SDK saw BOTH prompts on one open query.
    expect(resumeArgs).toEqual([undefined])
    expect(pushed).toEqual(['first', 'second'])
  })
})

describe('SessionManager — same-session serialization (M0 co-live finding)', () => {
  it('enqueues a second prompt to the SAME session; it runs after the first completes', async () => {
    // The first turn blocks on a gate; while it is in flight we fire a second
    // prompt() at the same id. It must be enqueued and only run after the first.
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    let turnIndex = 0
    const order: string[] = []
    const calls: Array<{ options?: any }> = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      calls.push({ options: args.options })
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          const idx = turnIndex
          turnIndex += 1
          const text = pushedText(msg)
          yield { type: 'system', subtype: 'init', session_id: 'co-live' }
          if (idx === 0) await firstGate
          order.push(text)
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'co-live',
            result: '',
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: fn })

    // Fire the first prompt; prompt() resolves with the real id as soon as the
    // init message surfaces it — NOT when the (gated) turn completes.
    const id = await mgr.prompt(undefined, 'first', makeConfig().projectDir)

    expect(id).toBe('co-live')
    expect(mgr.getStatus(id!)).toBe('busy')
    // ONE persistent query has opened.
    expect(calls).toHaveLength(1)

    // Second prompt to the SAME id while busy → enqueued onto the FIFO, NOT a new
    // query (the persistent query stays open).
    const secondId = await mgr.prompt(id, 'second', makeConfig().projectDir)
    expect(secondId).toBe('co-live')
    expect(calls).toHaveLength(1)

    // Release the first; both turns now drain in FIFO order on the same query.
    releaseFirst()
    // allow the queue to drain
    for (let i = 0; i < 30; i++) await Promise.resolve()

    // still ONE query() OPEN; both prompts ran on it, in FIFO order.
    expect(calls).toHaveLength(1)
    expect(order).toEqual(['first', 'second'])
    expect(mgr.getStatus(id!)).toBe('idle')
  })
})

describe('SessionManager — resume an existing-id session', () => {
  it('continues the same live query when prompted with a known id that is idle', async () => {
    // (Was: a second turn passed query.resume === id.) With the persistent
    // streaming query, a LIVE idle session keeps its query OPEN — so a second
    // prompt at the same id pushes onto the same inbox and the SDK continues the
    // same transcript, rather than reopening with a per-turn resume.
    const { fn, calls, pushed } = fakeQuery([happyTurn('known-id', 'a'), happyTurn('known-id', 'b')])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })

    const id = await mgr.prompt(undefined, 'first', makeConfig().projectDir)
    expect(id).toBe('known-id')
    await drain()
    expect(mgr.getStatus(id!)).toBe('idle')

    // a second prompt at the same id (now idle) continues that live transcript.
    await mgr.prompt(id, 'again', makeConfig().projectDir)
    await drain()
    // ONE persistent query() OPEN (fresh start, so no per-turn resume); BOTH
    // prompts reached the SDK on that one open query, in order.
    expect(calls).toHaveLength(1)
    expect(calls[0].options.resume).toBeUndefined()
    expect(pushed).toEqual(['first', 'again'])
  })

  it('resumes a COLD on-disk session: an id never created in this manager → query.resume === that id', async () => {
    // The normal client flow: list sessions via GET /api/sessions, pick an OLD
    // (on-disk) session, POST /api/prompt with that sessionId. That id was never
    // created in THIS manager instance (it is not live in-memory), so the manager
    // must resume the existing transcript — NOT silently fork a brand-new session.
    // Regression for the gap where an unknown id was treated as "start fresh",
    // discarding the id so the SDK minted a new sessionId instead of resuming.
    const tagged: TaggedEvent[] = []
    const { fn, calls } = fakeQuery([happyTurn('on-disk-sess', 'resumed reply')])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => tagged.push(e))

    // The id was produced by some EARLIER process (it is on disk), not by us.
    const coldId = 'on-disk-sess'
    const returned = await mgr.prompt(coldId, 'continue please', makeConfig().projectDir)
    await drain()

    // The same (existing) id comes back — the transcript was continued, not forked.
    expect(returned).toBe('on-disk-sess')
    // Exactly one turn ran, and it resumed the on-disk transcript by that id.
    expect(calls).toHaveLength(1)
    expect(calls[0].options.resume).toBe('on-disk-sess')
    // Events fan out tagged with the resumed id (never a local: placeholder).
    expect(tagged.length).toBeGreaterThan(0)
    for (const t of tagged) {
      expect(t.sessionId).toBe('on-disk-sess')
      expect(t.sessionId.startsWith('local:')).toBe(false)
    }
    // The manager now tracks the resumed session live (status keyed by the real id).
    expect(mgr.getStatus('on-disk-sess')).toBe('idle')
  })
})

describe('SessionManager — respondPermission / respondQuestion routing', () => {
  it('routes a permission decision to the right session broker (allow)', async () => {
    // A turn that calls a tool, so the broker emits a permission_request and the
    // turn proceeds only once the manager routes the decision back in. The fake
    // query drives canUseTool itself (as the SDK does) and records the result.
    const tagged: TaggedEvent[] = []
    const wrapped = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'system', subtype: 'init', session_id: 'perm-sess' }
          const decision = await args.options.canUseTool(
            'Read',
            { file_path: 'x' },
            { signal: new AbortController().signal, toolUseID: 'tu-1' },
          )
          ;(wrapped as any).__decision = decision
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'perm-sess',
            result: '',
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: wrapped })
    mgr.subscribe((e) => tagged.push(e))

    const runP = mgr.prompt(undefined, 'read it', makeConfig().projectDir)
    // let the turn reach the permission_request
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const req = tagged.find((t) => t.event.type === 'permission_request')
    expect(req).toBeDefined()
    expect(req!.sessionId).toBe('perm-sess')

    // route the allow decision back into the manager
    mgr.respondPermission('perm-sess', 'tu-1', 'allow')
    await runP
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // allow echoes the original tool input back as updatedInput (SDK-required).
    expect((wrapped as any).__decision).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'x' },
    })
  })

  it('routes a question answer to the right session broker', async () => {
    const tagged: TaggedEvent[] = []
    const wrapped = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'system', subtype: 'init', session_id: 'q-sess' }
          const decision = await args.options.canUseTool(
            'AskUserQuestion',
            { questions: [{ question: 'pick', options: [{ label: 'A' }] }] },
            { signal: new AbortController().signal, toolUseID: 'q-1' },
          )
          ;(wrapped as any).__decision = decision
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'q-sess',
            result: '',
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: wrapped })
    mgr.subscribe((e) => tagged.push(e))

    const runP = mgr.prompt(undefined, 'ask', makeConfig().projectDir)
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const q = tagged.find((t) => t.event.type === 'user_question')
    expect(q).toBeDefined()
    expect(q!.sessionId).toBe('q-sess')

    mgr.respondQuestion('q-sess', 'q-1', 'A')
    await runP
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect((wrapped as any).__decision).toEqual({ behavior: 'allow', updatedInput: { answer: 'A' } })
  })

  it('respondPermission / respondQuestion on an unknown session are no-ops', () => {
    const mgr = new SessionManager({ config: makeConfig(), query: fakeQuery([]).fn })
    expect(() => mgr.respondPermission('nope', 'tu', 'allow')).not.toThrow()
    expect(() => mgr.respondQuestion('nope', 'tu', 'A')).not.toThrow()
  })
})

describe('SessionManager — interrupt / getStatus', () => {
  it('interrupts the in-flight turn for that session via Query.interrupt()', async () => {
    // New contract (was: abortController.abort()). mgr.interrupt(id) routes to
    // the owning session's Query.interrupt(); the SDK flushes the in-flight turn's
    // `result` (per the Task 1 probe / Task 4 model). Here interrupt() resolves a
    // gate so the gated turn emits its result, returning the session to idle.
    let interruptCalled = false
    let releaseTurn!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'system', subtype: 'init', session_id: 'int-sess' }
          // Block until interrupt() (via the gate) flushes the turn's result.
          await gate
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'int-sess',
            result: '',
            total_cost_usd: 0,
            num_turns: 1,
            duration_ms: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
        interruptCalled = true
        releaseTurn()
      }
      return q
    }) as unknown as QueryFn

    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    const runP = mgr.prompt(undefined, 'long', makeConfig().projectDir)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const id = await runP // resolves with id once the init message surfaces
    expect(id).toBe('int-sess')
    expect(mgr.getStatus(id!)).toBe('busy')
    expect(interruptCalled).toBe(false)

    mgr.interrupt(id!)
    expect(interruptCalled).toBe(true)

    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(mgr.getStatus(id!)).toBe('idle')
  })

  it('getStatus is "unknown" for a session that does not exist; interrupt is a no-op', () => {
    const mgr = new SessionManager({ config: makeConfig(), query: fakeQuery([]).fn })
    expect(mgr.getStatus('ghost')).toBe('unknown')
    expect(() => mgr.interrupt('ghost')).not.toThrow()
  })
})

describe('SessionManager — pre-init buffering (consistent tagging)', () => {
  it('tags the early prompt-echo + busy with the real id (buffered until init surfaces it)', async () => {
    const tagged: TaggedEvent[] = []
    // user_prompt + busy are emitted at turn start, BEFORE the init message — so
    // they are buffered and only fanned out once the real id is known. Every
    // event a subscriber sees must carry the real id, in order.
    const { fn } = fakeQuery([happyTurn('buf-sess', 'hi')])
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => tagged.push(e))

    const id = await mgr.prompt(undefined, 'go', makeConfig().projectDir)
    await drain()

    expect(id).toBe('buf-sess')
    // the very first delivered events are the pre-init prompt echo + busy status,
    // and they carry the real id (not a placeholder).
    expect(tagged[0]).toEqual({ sessionId: 'buf-sess', event: { type: 'user_prompt', text: 'go' } })
    expect(tagged[1]).toEqual({ sessionId: 'buf-sess', event: { type: 'status', state: 'busy' } })
    for (const t of tagged) expect(t.sessionId).toBe('buf-sess')
    // no placeholder local id ever leaked.
    expect(tagged.some((t) => t.sessionId.startsWith('local:'))).toBe(false)
  })

  it('still delivers events when a turn errors before any init (flush under the local id)', async () => {
    const tagged: TaggedEvent[] = []
    // The stream throws before ever yielding an init — no real id is learned.
    // Buffered events (here, the error) must still reach subscribers, not vanish.
    const fn = (() =>
      (async function* () {
        throw new Error('boom before init')
        // eslint-disable-next-line no-unreachable
        yield {}
      })()) as unknown as QueryFn
    const mgr = new SessionManager({ config: makeConfig(), query: fn })
    mgr.subscribe((e) => tagged.push(e))

    const id = await mgr.prompt(undefined, 'go', makeConfig().projectDir)
    await drain()

    // No real id surfaced, so prompt() falls back to the local id.
    expect(id).toBeDefined()
    expect(id!.startsWith('local:')).toBe(true)
    // Task 1: a deterministic pre-init failure surfaces the error, retries once
    // (the reopen also fails before init), then gives up — TWO errors, both
    // flushed under the local id (no real id was ever learned).
    const errs = tagged.filter((t) => t.event.type === 'error')
    expect(errs).toHaveLength(2)
    for (const e of errs) {
      expect(e.event).toEqual({ type: 'error', message: 'boom before init' })
      expect(e.sessionId).toBe(id)
    }
  })
})
