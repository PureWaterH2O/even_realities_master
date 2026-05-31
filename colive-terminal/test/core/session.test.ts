import { describe, it, expect, vi } from 'vitest'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ClaudeSession } from '../../src/core/session'
import type { QueryFn } from '../../src/core/session'
import type { CoLiveEvent } from '../../src/core/events'

/**
 * Build a fake SDK `query` fn from a list of message-producing factories.
 * Each call to the returned fn yields the next scripted turn's messages.
 * The fake records the `options` it was called with (per turn) for assertions.
 */
function fakeQuery(turns: unknown[][]): {
  fn: QueryFn
  calls: { prompt: unknown; options: any }[]
} {
  const calls: { prompt: unknown; options: any }[] = []
  let turnIndex = 0
  const fn = ((args: { prompt: unknown; options?: any }) => {
    const messages = turns[turnIndex] ?? []
    turnIndex += 1
    calls.push({ prompt: args.prompt, options: args.options })
    return (async function* () {
      for (const m of messages) {
        yield m
      }
    })()
  }) as unknown as QueryFn

  return { fn, calls }
}

/** A minimal config object the session needs. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-4-8',
    permissionMode: 'default' as const,
    settingSources: [] as const,
    ...overrides,
  }
}

/** A stub canUseTool (permission logic is Task 1.4; here it's just injected). */
const stubCanUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))

/** A full, ordered "happy turn": init -> text stream -> tool -> result. */
function happyTurnMessages(sessionId = 'sess-abc') {
  return [
    // init / system
    { type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-opus-4-8' },
    // message framing + text streaming
    { type: 'stream_event', event: { type: 'message_start' } },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
    },
    // thinking delta must NOT be emitted as text
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'secret' } },
    },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    // a tool_use block via content_block_start
    {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      },
    },
    { type: 'stream_event', event: { type: 'message_stop' } },
    // result
    {
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      result: 'Hello world',
      total_cost_usd: 0.0123,
      num_turns: 1,
      duration_ms: 4567,
      usage: { input_tokens: 11, output_tokens: 22 },
    },
  ]
}

describe('ClaudeSession — event normalization', () => {
  it('maps an SDK happy turn to the normalized event sequence', async () => {
    const emitted: CoLiveEvent[] = []
    const { fn, calls } = fakeQuery([happyTurnMessages('sess-xyz')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })

    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('do a thing')

    // the prompt is echoed as user_prompt
    expect(emitted[0]).toEqual({ type: 'user_prompt', text: 'do a thing' })

    // busy on turn start
    expect(emitted).toContainEqual({ type: 'status', state: 'busy' })

    // text streaming: text_start, deltas (in order), text_end
    const textDeltas = emitted.filter((e) => e.type === 'text_delta')
    expect(textDeltas).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
    ])
    expect(emitted).toContainEqual({ type: 'status', state: 'text_start' })
    expect(emitted).toContainEqual({ type: 'status', state: 'text_end' })

    // a text block close emits text_end (not think_end): no spurious think_end
    // since this turn opened no thinking block via content_block_start.
    expect(emitted).not.toContainEqual({ type: 'status', state: 'think_start' })
    expect(emitted).not.toContainEqual({ type: 'status', state: 'think_end' })

    // exact ordered status/text/tool sequence for the streamed portion
    const streamSeq = emitted.filter(
      (e) =>
        e.type === 'text_delta' ||
        e.type === 'tool_start' ||
        (e.type === 'status' &&
          (e.state === 'text_start' || e.state === 'text_end' || e.state === 'think_start' || e.state === 'think_end')),
    )
    expect(streamSeq).toEqual([
      { type: 'status', state: 'text_start' },
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'status', state: 'text_end' },
      { type: 'tool_start', name: 'Read', toolId: 'tool-1' },
    ])

    // tool_start for the tool_use block
    expect(emitted).toContainEqual({ type: 'tool_start', name: 'Read', toolId: 'tool-1' })

    // result event carries the SDK result fields, provider claude
    const result = emitted.find((e) => e.type === 'result')
    expect(result).toEqual({
      type: 'result',
      success: true,
      text: 'Hello world',
      sessionId: 'sess-xyz',
      costUsd: 0.0123,
      provider: 'claude',
      turns: 1,
      durationMs: 4567,
      inputTokens: 11,
      outputTokens: 22,
    })

    // captured sessionId exposed for resume
    expect(session.sessionId).toBe('sess-xyz')

    // NO thinking text ever leaks: no text_delta carries the thinking content
    expect(emitted.some((e) => e.type === 'text_delta' && e.text.includes('secret'))).toBe(false)

    // query was called with our owned config + includePartialMessages + an abortController
    expect(calls).toHaveLength(1)
    expect(calls[0].prompt).toBe('do a thing')
    expect(calls[0].options.model).toBe('claude-opus-4-8')
    expect(calls[0].options.permissionMode).toBe('default')
    expect(calls[0].options.settingSources).toEqual([])
    expect(calls[0].options.includePartialMessages).toBe(true)
    expect(calls[0].options.canUseTool).toBe(stubCanUseTool)
    expect(calls[0].options.abortController).toBeInstanceOf(AbortController)
    // fresh session => no resume id
    expect(calls[0].options.resume).toBeUndefined()
  })

  it('never emits a thinking_delta as any event', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's1' },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'top secret reasoning' } },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      { type: 'result', subtype: 'success', session_id: 's1', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('think please')

    // no event anywhere carries the thinking text
    const serialized = JSON.stringify(emitted)
    expect(serialized).not.toContain('top secret reasoning')
    // think_start / think_end status is fine; text_delta for thinking is NOT
    expect(emitted.filter((e) => e.type === 'text_delta')).toEqual([])
    expect(emitted).toContainEqual({ type: 'status', state: 'think_start' })
    expect(emitted).toContainEqual({ type: 'status', state: 'think_end' })
  })

  it('emits status idle on session_state_changed idle', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's2' },
      { type: 'system', subtype: 'session_state_changed', state: 'idle' },
      { type: 'result', subtype: 'success', session_id: 's2', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('hi')
    expect(emitted).toContainEqual({ type: 'status', state: 'idle' })
  })

  it('emits error on a result error subtype', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's3' },
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 's3',
        errors: [{ message: 'kaboom' }],
        total_cost_usd: 0,
        num_turns: 1,
        duration_ms: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('break it')
    const err = emitted.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect(err).toMatchObject({ type: 'error' })
    // result event still reports success:false
    const result = emitted.find((e) => e.type === 'result')
    expect(result).toMatchObject({ type: 'result', success: false })
  })
})

describe('ClaudeSession — resume', () => {
  it('passes the resume id to query when started with one', async () => {
    const emitted: CoLiveEvent[] = []
    const { fn, calls } = fakeQuery([happyTurnMessages('resumed-session')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start('prior-session-id', realpathSync(tmpdir()))
    expect(session.sessionId).toBe('prior-session-id')
    await session.run('continue')
    expect(calls[0].options.resume).toBe('prior-session-id')
  })

  it('realpaths the cwd passed to start (symlink stability)', async () => {
    const emitted: CoLiveEvent[] = []
    const { fn, calls } = fakeQuery([happyTurnMessages()])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    // /tmp on macOS is a symlink to /private/tmp; start must realpath it.
    await session.start(undefined, tmpdir())
    await session.run('x')
    expect(calls[0].options.cwd).toBe(realpathSync(tmpdir()))
  })
})

describe('ClaudeSession — busy + enqueue', () => {
  it('queues a run() issued while busy and runs it after the current turn', async () => {
    const emitted: CoLiveEvent[] = []
    // Two scripted turns. The first turn's stream blocks on a gate we control,
    // so we can fire a second run() while the first is mid-flight.
    let releaseFirstTurn!: () => void
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve
    })

    let turnIndex = 0
    const calls: any[] = []
    const fn = ((args: { prompt: unknown; options?: any }) => {
      const idx = turnIndex
      turnIndex += 1
      calls.push({ prompt: args.prompt, options: args.options })
      return (async function* () {
        if (idx === 0) {
          yield { type: 'system', subtype: 'init', session_id: 'busy-sess' }
          // block until the test releases the gate
          await firstTurnGate
          yield { type: 'result', subtype: 'success', session_id: 'busy-sess', result: 'first', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
        } else {
          yield { type: 'system', subtype: 'init', session_id: 'busy-sess' }
          yield { type: 'result', subtype: 'success', session_id: 'busy-sess', result: 'second', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
        }
      })()
    }) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    // Start the first turn but DO NOT await it yet.
    const firstRun = session.run('first prompt')
    // Give the microtask queue a tick so the first turn enters its loop and is busy.
    await Promise.resolve()
    expect(session.busy).toBe(true)

    // Issue a second run() while busy: it should be queued, not call query yet.
    const secondRun = session.run('second prompt')
    expect(calls).toHaveLength(1) // second query not yet started

    // Release the first turn; both should now complete in order.
    releaseFirstTurn()
    await firstRun
    await secondRun

    expect(calls).toHaveLength(2)
    expect(calls[0].prompt).toBe('first prompt')
    expect(calls[1].prompt).toBe('second prompt')

    // both user_prompts were echoed, second after first's result
    const promptTexts = emitted.filter((e) => e.type === 'user_prompt').map((e: any) => e.text)
    expect(promptTexts).toEqual(['first prompt', 'second prompt'])

    // not busy after the queue drains
    expect(session.busy).toBe(false)
  })

  it('resolves each queued run() even when two prompts share the same text', async () => {
    const emitted: CoLiveEvent[] = []
    let releaseFirstTurn!: () => void
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve
    })

    let turnIndex = 0
    const order: number[] = []
    const fn = (() => {
      const idx = turnIndex
      turnIndex += 1
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'dup-sess' }
        if (idx === 0) await firstTurnGate
        order.push(idx)
        yield { type: 'result', subtype: 'success', session_id: 'dup-sess', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
      })()
    }) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const first = session.run('continue')
    await Promise.resolve()
    // two identical-text prompts queued behind the first
    const second = session.run('continue')
    const third = session.run('continue')

    releaseFirstTurn()
    // all three resolve (the duplicate text must not cross-resolve waiters)
    await Promise.all([first, second, third])

    // three turns ran, in FIFO order
    expect(order).toEqual([0, 1, 2])
    expect(session.busy).toBe(false)
  })
})

describe('ClaudeSession — interrupt', () => {
  it('aborts the current turn via the abortController', async () => {
    const emitted: CoLiveEvent[] = []
    let capturedSignal!: AbortSignal
    let releaseTurn!: () => void
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })

    const fn = ((args: { prompt: unknown; options?: any }) => {
      capturedSignal = args.options.abortController.signal
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'int-sess' }
        // Wait until aborted OR released, then end the turn.
        await new Promise<void>((resolve) => {
          if (capturedSignal.aborted) return resolve()
          capturedSignal.addEventListener('abort', () => resolve(), { once: true })
          turnGate.then(() => resolve())
        })
      })()
    }) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const run = session.run('long task')
    await Promise.resolve()
    expect(session.busy).toBe(true)
    expect(capturedSignal.aborted).toBe(false)

    session.interrupt()
    expect(capturedSignal.aborted).toBe(true)

    releaseTurn()
    await run
    expect(session.busy).toBe(false)
  })

  it('interrupt is a no-op when idle', async () => {
    const emitted: CoLiveEvent[] = []
    const { fn } = fakeQuery([])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    expect(() => session.interrupt()).not.toThrow()
    expect(session.busy).toBe(false)
  })
})
