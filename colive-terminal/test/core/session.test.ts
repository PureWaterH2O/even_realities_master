import { describe, it, expect, vi } from 'vitest'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ClaudeSession } from '../../src/core/session'
import type { QueryFn, QueryLike } from '../../src/core/session'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { CoLiveEvent } from '../../src/core/events'

/**
 * A persistent-Query fake: a single query() whose generator pulls one message
 * from the inbox per turn and yields that turn's scripted SDK messages (ending
 * with the turn's `result`). interrupt() is a no-op stub here; the
 * interrupt-emits-result contract is asserted in Task 4 via a custom turn.
 *
 * The fake records the `options` it was opened with (once per query() OPEN —
 * once per session, twice only after a reopen) and the text of every pushed
 * prompt (drained from the inbox), so mechanics tests can assert what was sent.
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
  return { fn, calls, pushed }
}

/** Extract the text of a pushed SDKUserMessage (textUserMessage shape). */
function pushedText(msg: SDKUserMessage): string {
  const content = (msg as { message?: { content?: unknown } }).message?.content
  return typeof content === 'string' ? content : ''
}

/** Minimal SDK result message used to close a scripted turn. */
function resultMessage(sessionId: string): Record<string, unknown> {
  return { type: 'result', subtype: 'success', session_id: sessionId, result: '', usage: {} }
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
    // final assistant message: re-carries the SAME tool_use (tool-1) already
    // streamed via content_block_start. Must NOT double-emit tool_start.
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
        ],
      },
    },
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
  it('emits a terminal status:idle exactly once at turn end (string-prompt mode)', async () => {
    // 🧪 Hardware finding: the Even app clears "thinking…" on status:idle. In
    // string-prompt mode the SDK sends no session_state_changed:idle, so the
    // stream just ends — the turn driver must still emit the terminal idle.
    const emitted: CoLiveEvent[] = []
    const { fn } = fakeQuery([happyTurnMessages('sess-idle')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })

    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('hi')

    const idles = emitted.filter((e) => e.type === 'status' && e.state === 'idle')
    expect(idles).toHaveLength(1)
    // idle is the FINAL event (after result), so the HUD reliably clears.
    expect(emitted.at(-1)).toEqual({ type: 'status', state: 'idle' })
  })

  it('maps an SDK happy turn to the normalized event sequence', async () => {
    const emitted: CoLiveEvent[] = []
    const { fn, calls, pushed } = fakeQuery([happyTurnMessages('sess-xyz')])
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

    // ...emitted EXACTLY ONCE, even though tool-1 also appears in the final
    // assistant message (includePartialMessages double-surfaces it).
    const toolStarts = emitted.filter((e) => e.type === 'tool_start')
    expect(toolStarts).toEqual([{ type: 'tool_start', name: 'Read', toolId: 'tool-1' }])

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

    // ONE persistent query() OPEN carries our owned config + includePartialMessages
    // (no abortController — interrupt is Query.interrupt() in streaming-input mode).
    expect(calls).toHaveLength(1)
    expect(calls[0].options.model).toBe('claude-opus-4-8')
    expect(calls[0].options.permissionMode).toBe('default')
    expect(calls[0].options.settingSources).toEqual([])
    expect(calls[0].options.includePartialMessages).toBe(true)
    expect(calls[0].options.canUseTool).toBe(stubCanUseTool)
    expect(calls[0].options.abortController).toBeUndefined()
    // fresh session => no resume id
    expect(calls[0].options.resume).toBeUndefined()
    // the prompt text reaches the SDK via the inbox (was calls[0].prompt) — and
    // is echoed as the user_prompt event (the real contract).
    expect(pushed).toEqual(['do a thing'])
    expect(emitted[0]).toEqual({ type: 'user_prompt', text: 'do a thing' })
  })

  it('emits thinking_delta carrying the SDK thinking text (desk-only render)', async () => {
    const emitted: CoLiveEvent[] = []
    // A turn that opens a real thinking content block and streams thinking:'secret'
    // (the shared happyTurnMessages fixture deliberately omits think_start/end).
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'sess-think' },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret' } },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      { type: 'result', subtype: 'success', session_id: 'sess-think', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('think hard')

    // the turn streams a thinking_delta with thinking:'secret'
    expect(emitted).toContainEqual({ type: 'thinking_delta', text: 'secret' })
    // and it is STILL never surfaced as assistant text
    expect(emitted.some((e) => e.type === 'text_delta' && e.text.includes('secret'))).toBe(false)
    // status still brackets thinking (no thinking-as-text)
    expect(emitted).toContainEqual({ type: 'status', state: 'think_start' })
    expect(emitted).toContainEqual({ type: 'status', state: 'think_end' })
  })

  it('tool_end.detail.input carries the COMPLETE input, not the empty streaming placeholder', async () => {
    // 🧪 Regression: content_block_start surfaces a tool_use with an EMPTY {} input
    // (the real args stream later via input_json_delta, which we don't reassemble).
    // The final assistant message carries the COMPLETE input and must overwrite the
    // placeholder, so tool_end.detail.input is the real input (desk diff + Ctrl-O).
    const fullInput = { file_path: '/a.ts', old_string: 'x', new_string: 'y' }
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'sess-tool' },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-9', name: 'Edit', input: {} } },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      { type: 'stream_event', event: { type: 'message_stop' } },
      // final assistant message re-carries the SAME tool_use, now with full input
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-9', name: 'Edit', input: fullInput }] } },
      // the SDK delivers the result as a type:'user' tool_result → pairs into tool_end
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-9', content: 'ok', is_error: false }] } },
      { type: 'result', subtype: 'success', session_id: 'sess-tool', result: 'done', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 1, output_tokens: 1 } },
    ]
    const emitted: CoLiveEvent[] = []
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('edit it')

    const end = emitted.find((e) => e.type === 'tool_end')
    expect(end).toBeDefined()
    expect((end as Extract<CoLiveEvent, { type: 'tool_end' }>).detail.input).toEqual(fullInput)
    // exactly one tool_start despite the double-surfacing (stream + final message)
    expect(emitted.filter((e) => e.type === 'tool_start')).toHaveLength(1)
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

  it('emits error on a result error subtype, parsing the real string[] errors shape', async () => {
    const emitted: CoLiveEvent[] = []
    // SDKResultError.errors is string[] (sdk.d.ts) — NOT an array of objects.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's3' },
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 's3',
        errors: ['kaboom', 'and then some'],
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
    // the human message is built from the string[] elements (joined)
    expect(err).toEqual({ type: 'error', message: 'kaboom; and then some' })
    // result event still reports success:false
    const result = emitted.find((e) => e.type === 'result')
    expect(result).toMatchObject({ type: 'result', success: false })
  })

  it('falls back to the subtype when an error result carries no errors[]', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 's3b' },
      {
        type: 'result',
        subtype: 'error_max_turns',
        session_id: 's3b',
        errors: [],
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
    await session.run('loop forever')
    expect(emitted.find((e) => e.type === 'error')).toEqual({
      type: 'error',
      message: 'error_max_turns',
    })
  })

  it('emits tool_start for a final-assistant tool_use that was never streamed', async () => {
    const emitted: CoLiveEvent[] = []
    // A turn where the ONLY signal of the tool is the final assistant message
    // (no content_block_start). Per the mapping table, final tool_use -> tool_start.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'fa1' },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'done' },
            { type: 'tool_use', id: 'final-tool', name: 'Write', input: { path: 'x' } },
          ],
        },
      },
      { type: 'result', subtype: 'success', session_id: 'fa1', result: 'done', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('write a file')

    const toolStarts = emitted.filter((e) => e.type === 'tool_start')
    expect(toolStarts).toEqual([{ type: 'tool_start', name: 'Write', toolId: 'final-tool' }])
  })

  it('does not double-emit tool_start when a streamed tool reappears in the final assistant message', async () => {
    const emitted: CoLiveEvent[] = []
    // tool-7 is announced via content_block_start AND repeated in the final
    // assistant message — exactly the includePartialMessages:true double-surface.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'dd1' },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool-7', name: 'Bash', input: {} },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool-7', name: 'Bash', input: {} }],
        },
      },
      { type: 'result', subtype: 'success', session_id: 'dd1', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('run a command')

    const toolStarts = emitted.filter((e) => e.type === 'tool_start')
    expect(toolStarts).toEqual([{ type: 'tool_start', name: 'Bash', toolId: 'tool-7' }])
  })

  it('dedups per-turn so a re-run of the same tool id emits tool_start again', async () => {
    const emitted: CoLiveEvent[] = []
    // Two turns, each streaming tool id 'reused'. The Set is cleared per turn,
    // so each turn must independently emit one tool_start (no cross-turn dedup).
    const turn = (sid: string) => [
      { type: 'system', subtype: 'init', session_id: sid },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'reused', name: 'Read', input: {} },
        },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'reused', name: 'Read', input: {} }] },
      },
      { type: 'result', subtype: 'success', session_id: sid, result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([turn('rt1'), turn('rt2')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('one')
    await session.run('two')

    const toolStarts = emitted.filter((e) => e.type === 'tool_start')
    expect(toolStarts).toEqual([
      { type: 'tool_start', name: 'Read', toolId: 'reused' },
      { type: 'tool_start', name: 'Read', toolId: 'reused' },
    ])
  })
})

describe('ClaudeSession — tool_end pairing', () => {
  it('pairs a streamed tool_start with a tool_end from the tool_result user message', async () => {
    const emitted: CoLiveEvent[] = []
    // The SDK delivers tool results as a `type:'user'` message whose
    // message.content carries `tool_result` blocks; a richer raw detail rides on
    // the top-level `tool_use_result`.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'te1' },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'a.txt' } },
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents', is_error: false },
          ],
        },
        tool_use_result: { stdout: 'file contents', exitCode: 0 },
      },
      { type: 'result', subtype: 'success', session_id: 'te1', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('read it')

    expect(emitted).toContainEqual({ type: 'tool_start', name: 'Read', toolId: 'tool-1' })
    const toolEnds = emitted.filter((e) => e.type === 'tool_end')
    expect(toolEnds).toEqual([
      {
        type: 'tool_end',
        name: 'Read',
        toolId: 'tool-1',
        summary: 'Read completed',
        detail: { input: { path: 'a.txt' }, output: { stdout: 'file contents', exitCode: 0 } },
      },
    ])
    // ordering: tool_start precedes tool_end
    const startIdx = emitted.findIndex((e) => e.type === 'tool_start')
    const endIdx = emitted.findIndex((e) => e.type === 'tool_end')
    expect(startIdx).toBeLessThan(endIdx)
  })

  it('pairs a final-assistant-only tool_use with its tool_end', async () => {
    const emitted: CoLiveEvent[] = []
    // No streaming content_block_start for the tool — only the final assistant
    // message announces it. The tool_result must still produce a tool_end.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'te2' },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'fin-1', name: 'Write', input: { path: 'x' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'fin-1', content: 'ok' }],
        },
      },
      { type: 'result', subtype: 'success', session_id: 'te2', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('write it')

    // falls back to the block content when there is no top-level tool_use_result
    expect(emitted.filter((e) => e.type === 'tool_end')).toEqual([
      {
        type: 'tool_end',
        name: 'Write',
        toolId: 'fin-1',
        summary: 'Write completed',
        detail: { input: { path: 'x' }, output: 'ok' },
      },
    ])
  })

  it('marks a tool_end as failed when the tool_result is an error', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'te3' },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'err-1', name: 'Bash', input: { command: 'false' } },
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'err-1', content: 'boom', is_error: true }],
        },
      },
      { type: 'result', subtype: 'success', session_id: 'te3', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('run')

    expect(emitted.filter((e) => e.type === 'tool_end')).toEqual([
      {
        type: 'tool_end',
        name: 'Bash',
        toolId: 'err-1',
        summary: 'Bash failed',
        detail: { input: { command: 'false' }, output: 'boom' },
      },
    ])
  })

  it('uses each block content (not the shared tool_use_result) when a user message carries multiple tool_results', async () => {
    const emitted: CoLiveEvent[] = []
    // Two parallel tools resolve in ONE user message. The top-level
    // tool_use_result is a single field and must NOT be attributed to both
    // blocks; each tool_end takes its own block content.
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'te5' },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't-a', name: 'Read', input: { path: 'a' } } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't-b', name: 'Read', input: { path: 'b' } } },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't-a', content: 'out-a' },
            { type: 'tool_result', tool_use_id: 't-b', content: 'out-b' },
          ],
        },
        // a shared raw detail that must NOT leak onto both ends
        tool_use_result: { shared: true },
      },
      { type: 'result', subtype: 'success', session_id: 'te5', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('two reads')

    expect(emitted.filter((e) => e.type === 'tool_end')).toEqual([
      { type: 'tool_end', name: 'Read', toolId: 't-a', summary: 'Read completed', detail: { input: { path: 'a' }, output: 'out-a' } },
      { type: 'tool_end', name: 'Read', toolId: 't-b', summary: 'Read completed', detail: { input: { path: 'b' }, output: 'out-b' } },
    ])
  })

  it('emits a tool_end at most once and ignores tool_results for unknown tools', async () => {
    const emitted: CoLiveEvent[] = []
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'te4' },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'known', name: 'Read', input: {} },
        },
      },
      // unknown tool result: no prior tool_start → must NOT emit a tool_end
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'x' }] },
      },
      // the known tool's result
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'known', content: 'y' }] },
      },
      // a duplicate result for the same known tool → must NOT emit a second tool_end
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'known', content: 'y again' }] },
      },
      { type: 'result', subtype: 'success', session_id: 'te4', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]
    const { fn } = fakeQuery([messages])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('go')

    const toolEnds = emitted.filter((e) => e.type === 'tool_end')
    expect(toolEnds).toEqual([
      {
        type: 'tool_end',
        name: 'Read',
        toolId: 'known',
        summary: 'Read completed',
        detail: { input: {}, output: 'y' },
      },
    ])
  })
})

describe('ClaudeSession — running_stats heartbeat', () => {
  it('emits running_stats roughly every 10s with duration + accumulated tokens', async () => {
    const emitted: CoLiveEvent[] = []
    // A controllable fake clock: we capture the scheduled callback + interval and
    // a monotonic now() we advance by hand.
    let scheduled: (() => void) | undefined
    let scheduledMs = 0
    let nowMs = 1_000
    const clock = {
      setInterval: (fn: () => void, ms: number) => {
        scheduled = fn
        scheduledMs = ms
        return 'handle'
      },
      clearInterval: vi.fn(),
      now: () => nowMs,
    }

    // A turn that stays open (gated) so we can fire the heartbeat mid-flight.
    let releaseTurn!: () => void
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    const fn = (() =>
      (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'rs1' }
        // usage arrives via stream events before the heartbeat fires
        yield { type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } } }
        yield { type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: 5, output_tokens: 12 } } }
        await turnGate
        yield { type: 'result', subtype: 'success', session_id: 'rs1', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 5, output_tokens: 12 } }
      })()) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
      clock,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const run = session.run('long')
    // let the generator run up to the gate: init + both usage stream events are
    // consumed (each yield needs a microtask turn) before we fire the heartbeat.
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(scheduledMs).toBe(10_000)
    expect(scheduled).toBeTypeOf('function')

    // advance the clock 10s and fire the heartbeat
    nowMs = 11_000
    scheduled!()
    expect(emitted).toContainEqual({
      type: 'running_stats',
      durationMs: 10_000,
      inputTokens: 5,
      outputTokens: 12,
    })

    releaseTurn()
    await run

    // timer cleared when the turn ends
    expect(clock.clearInterval).toHaveBeenCalledWith('handle')
    // no heartbeat lingers once the turn is over
    const statsCount = emitted.filter((e) => e.type === 'running_stats').length
    expect(statsCount).toBe(1)
  })

  it('does not emit running_stats for a turn that completes before the first tick', async () => {
    const emitted: CoLiveEvent[] = []
    const clock = {
      // Never invoke the callback (the turn finishes before any tick).
      setInterval: () => 'h',
      clearInterval: vi.fn(),
      now: () => 0,
    }
    const { fn } = fakeQuery([
      [
        { type: 'system', subtype: 'init', session_id: 'rs2' },
        { type: 'result', subtype: 'success', session_id: 'rs2', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } },
      ],
    ])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
      clock,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('quick')
    expect(emitted.filter((e) => e.type === 'running_stats')).toEqual([])
    expect(clock.clearInterval).toHaveBeenCalledWith('h')
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
    // ONE persistent query consuming the inbox. The first turn blocks on a gate
    // we control, so we can fire a second run() while the first is mid-flight.
    let releaseFirstTurn!: () => void
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve
    })

    const calls: any[] = []
    const pushed: string[] = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      calls.push({ options: args.options })
      let turn = 0
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          pushed.push(pushedText(msg))
          const idx = turn
          turn += 1
          yield { type: 'system', subtype: 'init', session_id: 'busy-sess' }
          // The first turn blocks on the gate before its result; later turns end at once.
          if (idx === 0) await firstTurnGate
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'busy-sess',
            result: idx === 0 ? 'first' : 'second',
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

    // Issue a second run() while busy: it should be queued (NOT a second query()).
    const secondRun = session.run('second prompt')
    expect(calls).toHaveLength(1) // still ONE query() — second prompt is queued

    // Release the first turn; both should now complete in order.
    releaseFirstTurn()
    await firstRun
    await secondRun

    // Persistent query: still ONE query() OPEN across both turns; the prompts
    // reached the SDK in order via the inbox (was calls[i].prompt).
    expect(calls).toHaveLength(1)
    expect(pushed).toEqual(['first prompt', 'second prompt'])

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

    // ONE persistent query consuming the inbox; the first turn is gated.
    const order: number[] = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      let turn = 0
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          const idx = turn
          turn += 1
          yield { type: 'system', subtype: 'init', session_id: 'dup-sess' }
          if (idx === 0) await firstTurnGate
          order.push(idx)
          yield { type: 'result', subtype: 'success', session_id: 'dup-sess', result: '', total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
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
  it('interrupts the in-flight turn via Query.interrupt() and stays usable', async () => {
    // New contract (was: abortController.abort()). interrupt() invokes the held
    // Query.interrupt(); the SDK flushes the in-flight turn's `result` (per the
    // Task 1 probe / Task 4 model). Here interrupt() resolves a gate so the turn
    // emits its result, ending the turn and leaving the session usable.
    const emitted: CoLiveEvent[] = []
    let interruptCalled = false
    let releaseTurn!: () => void
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })

    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'system', subtype: 'init', session_id: 'int-sess' }
          // Block until interrupt() (via the gate) flushes the turn's result.
          await turnGate
          // Real Query.interrupt() flushes a NON-SUCCESS result to end the
          // interrupted turn (verified live — see streaming-input-probe.md).
          yield { type: 'result', subtype: 'error_during_execution', session_id: 'int-sess', result: '', errors: [{ message: '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null' }], total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
        // Real Query.interrupt() flushes a result for the in-flight turn.
        interruptCalled = true
        releaseTurn()
      }
      return q
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
    expect(interruptCalled).toBe(false)

    session.interrupt()
    expect(interruptCalled).toBe(true)

    await run
    // session is usable again after interrupt (turn ended on the flushed result)
    expect(session.busy).toBe(false)
    // a clean interrupt surfaces NO error event (the result framed turn-end)
    expect(emitted.filter((e) => e.type === 'error')).toEqual([])
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

  it('emits NO error event when a deliberate interrupt ends the turn', async () => {
    // New contract (was: an aborted turn THROWS an AbortError and the catch guard
    // swallows it). In streaming-input mode there is no abortController; a
    // deliberate Query.interrupt() flushes the in-flight turn's `result` (per the
    // Task 1 probe / Task 4 model) — so turn-end is framed by that result, not a
    // thrown abort, and no error event is surfaced.
    const emitted: CoLiveEvent[] = []
    let releaseTurn!: () => void
    const turnGate = new Promise<void>((resolve) => {
      releaseTurn = resolve
    })
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: any }) => {
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          yield { type: 'system', subtype: 'init', session_id: 'ab1' }
          // Block until interrupt() (via the gate) flushes the turn's result.
          await turnGate
          // Real Query.interrupt() does NOT throw — it flushes a NON-SUCCESS
          // result (carrying an [ede_diagnostic] error) to end the interrupted
          // turn. handleResult maps any non-success result to an `error` +
          // failed-`result` event, so without the interrupt-suppression fix this
          // surfaces a spurious error banner on Esc (the live regression).
          yield { type: 'result', subtype: 'error_during_execution', session_id: 'ab1', result: '', errors: [{ message: '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null' }], total_cost_usd: 0, num_turns: 1, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
        releaseTurn()
      }
      return q
    }) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const run = session.run('abort me')
    await Promise.resolve()
    expect(session.busy).toBe(true)

    session.interrupt()
    await run

    // a deliberate interrupt frames a clean idle: NO error event AND no failed
    // `result` event are surfaced — pressing Esc is not an error.
    expect(emitted.filter((e) => e.type === 'error')).toEqual([])
    expect(emitted.filter((e) => e.type === 'result')).toEqual([])
    // and the turn still ends cleanly: terminal idle emitted, session idle.
    expect(emitted.filter((e) => e.type === 'status' && e.state === 'idle')).toHaveLength(1)
    expect(session.busy).toBe(false)
  })

  it('emits exactly ONE error event when a non-abort throw escapes the stream', async () => {
    const emitted: CoLiveEvent[] = []
    // A generic (non-abort) throw from the stream — the abort signal is NOT set,
    // so the catch guard must surface a single error event.
    let open = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage> }) => {
      const which = open++
      const gen = (async function* () {
        if (which === 0) {
          // first open: a non-abort throw escapes the stream (one error surfaced)
          yield { type: 'system', subtype: 'init', session_id: 'ab2' }
          throw new Error('boom from the stream')
        }
        // Task 1: the single retry reopens-with-resume and recovers cleanly, so
        // exactly ONE error is surfaced for the one escaped throw.
        for await (const _msg of args.prompt) {
          yield { type: 'result', subtype: 'success', session_id: 'ab2', result: '', usage: {} }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    // run() must not reject — the error is delivered as an event, not a throw.
    await expect(session.run('break')).resolves.toBeUndefined()

    expect(emitted.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', message: 'boom from the stream' },
    ])
    expect(session.busy).toBe(false)
  })
})

describe('ClaudeSession — clean interrupt', () => {
  it('interrupt ends the current turn and the session accepts the next prompt on the SAME query', async () => {
    // Proof of the persistent-query contract: after an interrupt flushes the
    // in-flight turn's result, the NEXT prompt drives a turn on the SAME query
    // (no reopen) — `calls` stays length 1.
    const calls: Array<{ options?: unknown }> = []
    // Eagerly-created gate (resolver captured synchronously, so interrupt() can
    // always wake the parked turn-1 generator regardless of microtask timing).
    const pending: unknown[] = []
    let wake!: () => void
    const gate = new Promise<void>((r) => {
      wake = r
    })
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: unknown }) => {
      calls.push({ options: args.options })
      let turn = 0
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          const which = turn++
          if (which === 0) {
            // Turn 1: stream something, then PAUSE on the gate. interrupt()
            // flushes a `result` (real Query.interrupt() ends the turn) + wakes.
            yield {
              type: 'stream_event',
              event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
            }
            await gate
            while (pending.length) yield pending.shift()
          } else {
            // Turn 2 (and beyond): no gate — complete immediately so the SAME
            // query's consumer loop resolves run() without hanging.
            yield { type: 'result', subtype: 'success', session_id: 's', result: '', usage: {} }
          }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {
        // Real Query.interrupt() flushes a NON-SUCCESS result to end the turn.
        pending.push({ type: 'result', subtype: 'error_during_execution', session_id: 's', result: '', errors: [{ message: '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null' }], usage: {} })
        wake()
      }
      return q
    }) as unknown as QueryFn

    const events: string[] = []
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => events.push(e.type),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const turn1 = session.run('long thing')
    await Promise.resolve()
    session.interrupt()
    await turn1

    // The second prompt runs on the SAME persistent query — no reopen.
    await session.run('next thing')

    expect(calls).toHaveLength(1)
    // BOTH turns drove (uniquely proves the 2nd turn ran on the same query, not
    // just turn 1) — one user_prompt per turn.
    expect(events.filter((t) => t === 'user_prompt')).toHaveLength(2)
  })
})

describe('ClaudeSession — whenIdentified signal (real id-learning signal)', () => {
  it('resolves whenIdentified only after a macrotask-delayed init captures the id', async () => {
    // The id-learning signal must be driven by real stream progress, not a
    // microtask spin: here init lands only after a setTimeout tick. Until then
    // whenIdentified() must NOT resolve, and sessionId must be undefined.
    let resolved = false
    const fn = (() =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 5))
        yield { type: 'system', subtype: 'init', session_id: 'late-id' }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'late-id',
          result: '',
          total_cost_usd: 0,
          num_turns: 1,
          duration_ms: 1,
          usage: { input_tokens: 0, output_tokens: 0 },
        }
      })()) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: () => {},
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const identified = session.whenIdentified().then(() => {
      resolved = true
    })
    void session.run('go')

    // Drain only the microtask queue: a busy-spin would have "resolved" here.
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(resolved).toBe(false)
    expect(session.sessionId).toBeUndefined()

    // Now allow the macrotask (the delayed init) to land.
    await identified
    expect(resolved).toBe(true)
    expect(session.sessionId).toBe('late-id')
  })

  it('resolves whenIdentified when a turn ends WITHOUT ever surfacing an id', async () => {
    // An immediate stream error before any init: the signal must still resolve
    // (the wait is over) so the manager does not hang, even though no id exists.
    const fn = (() =>
      (async function* () {
        throw new Error('boom before init')
        // eslint-disable-next-line no-unreachable
        yield {}
      })()) as unknown as QueryFn

    const session = new ClaudeSession({
      config: makeConfig(),
      emit: () => {},
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))

    const identified = session.whenIdentified()
    await session.run('go')
    await expect(identified).resolves.toBeUndefined()
    expect(session.sessionId).toBeUndefined()
  })

  it('resolves immediately when the id is already known (e.g. a resumed session)', async () => {
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: () => {},
      canUseTool: stubCanUseTool,
      query: fakeQuery([]).fn,
    })
    // start() with a resume id sets sessionId before any turn runs.
    await session.start('resumed-id', realpathSync(tmpdir()))
    expect(session.sessionId).toBe('resumed-id')
    await expect(session.whenIdentified()).resolves.toBeUndefined()
  })
})

describe('ClaudeSession — persistent streaming query', () => {
  it('opens ONE query() across N sequential prompts', async () => {
    const { fn, calls } = fakeQuery([happyTurnMessages('s'), happyTurnMessages('s')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: () => {},
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('first')
    await session.run('second')
    expect(calls).toHaveLength(1) // one query(), two turns
  })

  it('detects turn-end on the result message and resolves run() per turn', async () => {
    const events: string[] = []
    const { fn } = fakeQuery([happyTurnMessages('s'), happyTurnMessages('s')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => events.push(e.type),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('one')
    await session.run('two')
    expect(events.filter((t) => t === 'user_prompt')).toHaveLength(2)
    expect(events.filter((t) => t === 'result')).toHaveLength(2)
  })

  it('close() ends the query gracefully — no spurious error event', async () => {
    // Teardown closes the inbox, which ends the persistent generator gracefully
    // (the consumer loop completes, it does NOT throw) — so close() must NOT hit
    // the onConsumerError path and must NOT surface an error event.
    const emitted: CoLiveEvent[] = []
    const { fn } = fakeQuery([happyTurnMessages('s-close')])
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => emitted.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('one')
    session.close()
    // let any consumer-loop completion settle
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(emitted.filter((e) => e.type === 'error')).toEqual([])
  })
})

describe('ClaudeSession — self-heal on fatal query error', () => {
  it('a dead query reopens with resume:<sessionId> on the next prompt', async () => {
    // open #0 surfaces sess-1 via init, then THROWS -> onConsumerError emits
    // `error`, marks the query dead, and resolves run('boom'); the next
    // run('recover') reopens (open #1) carrying resume:'sess-1' (the captured id).
    const calls: Array<{ options?: { resume?: string } }> = []
    let openCount = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string } }) => {
      calls.push({ options: args.options })
      const which = openCount++
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          if (which === 0) {
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
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => events.push(e.type),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('boom') // opens, captures sess-1 via init, dies -> error + idle, run() resolves
    await session.run('recover') // reopens with resume:sess-1
    expect(events).toContain('error')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.options?.resume).toBe('sess-1')
  })
})

describe('ClaudeSession — golden event sequence', () => {
  it('a thinking+text+tool turn maps to the exact event arc', async () => {
    // Whole-sequence regression pin: thinking block -> text block -> streamed
    // tool_use (re-carried by the final assistant message, must NOT double-emit)
    // -> tool_result -> result. Locks the byte-identical event arc the mapping
    // emits, so any drift in the normalization is caught.
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
    const session = new ClaudeSession({
      config: makeConfig(),
      emit: (e) => events.push(e),
      canUseTool: stubCanUseTool,
      query: fn,
    })
    await session.start(undefined, realpathSync(tmpdir()))
    await session.run('go')
    expect(events.map((e: any) => e.type)).toEqual([
      'user_prompt', 'status', 'status', 'thinking_delta', 'status',
      'status', 'text_delta', 'status', 'tool_start', 'tool_end', 'result', 'status',
    ])
  })
})

describe('ClaudeSession — task 1: in-flight prompt survives a fatal query error', () => {
  it('re-drives the in-flight prompt once on reopen (not dropped), then gives up on a second death', async () => {
    let openCount = 0
    const seen: string[] = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string } }) => {
      const which = openCount++
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          seen.push((msg as any).message.content)
          if (which === 0) {
            yield { type: 'system', subtype: 'init', session_id: 'sess-1' }
            throw new Error('die-1') // first open: die mid-turn
          }
          if (which === 1) throw new Error('die-2') // reopen: die again -> must NOT loop forever
          yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const events: string[] = []
    const session = new ClaudeSession({ config: makeConfig(), emit: (e) => events.push(e.type), canUseTool: stubCanUseTool, query: fn })
    await session.start(undefined, process.cwd())
    await session.run('keep me') // dies, re-queues, reopens (resume), dies again, gives up
    expect(seen.filter((t) => t === 'keep me')).toHaveLength(2) // driven twice (original + 1 retry), not lost, not infinite
    expect(events.filter((t) => t === 'error')).toHaveLength(2) // an error per death; no loop
    expect(openCount).toBe(2) // exactly one reopen
  })
})

describe('ClaudeSession — runtime controls', () => {
  // Corrected for Task 1's re-drive contract: open #0 SUCCEEDS on its first prompt
  // (captures sess-1), then DIES on its second prompt — i.e. AFTER the control has
  // been applied — so the self-heal reopen (#1) rebuilds options from the updated
  // config and carries the chosen model/mode + resume. (The plan's original fake
  // died on the first prompt, which Task 1 now auto-recovers before setModel runs.)
  function controlFake() {
    const log: Array<{ m?: string; mode?: string; resume?: string }> = []
    let n = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string; model?: string; permissionMode?: string } }) => {
      log.push({ resume: args.options?.resume, m: args.options?.model, mode: args.options?.permissionMode })
      const which = n++
      let p = 0
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          const turn = p++
          if (which === 0 && turn === 0) {
            // open #0, first prompt: capture the id and succeed -> a live session
            yield { type: 'system', subtype: 'init', session_id: 'sess-1' }
            yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
          } else if (which === 0 && turn === 1) {
            // open #0, second prompt: die AFTER the control was applied -> self-heal reopen
            throw new Error('die')
          } else {
            // reopen (#1+): succeed, carrying the chosen model/mode + resume
            yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
          }
        }
      })()
      const q = gen as unknown as QueryLike & { setModel?: (m?: string) => Promise<void>; setPermissionMode?: (mode: string) => Promise<void> }
      q.interrupt = async () => {}
      q.setModel = async (m) => { log.push({ m }) }
      q.setPermissionMode = async (mode) => { log.push({ mode }) }
      return q
    }) as unknown as QueryFn
    return { fn, log }
  }

  it('setModel calls the live Query and updates config (so a reopen preserves it)', async () => {
    const { fn, log } = controlFake()
    const session = new ClaudeSession({ config: makeConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn })
    await session.start(undefined, process.cwd())
    await session.run('open it')              // open #0 captures sess-1, succeeds; q stays live
    await session.setModel('claude-sonnet-4-6') // live call + config update
    expect(log.some((e) => e.m === 'claude-sonnet-4-6')).toBe(true) // live call recorded
    await session.run('reopen')               // open #0's 2nd prompt dies -> reopen #1 carries the choice
    const reopen = log.find((e) => e.resume === 'sess-1')
    expect(reopen?.m).toBe('claude-sonnet-4-6') // GATE: self-heal preserved the chosen model
  })

  it('setPermissionMode updates config and survives a reopen', async () => {
    const { fn, log } = controlFake()
    const session = new ClaudeSession({ config: makeConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn })
    await session.start(undefined, process.cwd())
    await session.run('open it')
    await session.setPermissionMode('plan')
    await session.run('reopen')
    expect(log.find((e) => e.resume === 'sess-1')?.mode).toBe('plan')
  })

  it('a rejecting control never throws', async () => {
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage> }) => {
      const gen = (async function* () { for await (const _ of args.prompt) yield { type: 'result', subtype: 'success', session_id: 's', result: '', usage: {} } })()
      const q = gen as unknown as QueryLike & { setModel?: (m?: string) => Promise<void> }
      q.interrupt = async () => {}
      q.setModel = async () => { throw new Error('nope') }
      return q
    }) as unknown as QueryFn
    const session = new ClaudeSession({ config: makeConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn })
    await session.start(undefined, process.cwd())
    await session.run('go')
    await expect(session.setModel('x')).resolves.toBeUndefined() // no throw
  })
})
