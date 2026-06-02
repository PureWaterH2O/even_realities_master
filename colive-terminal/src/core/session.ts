/**
 * ClaudeSession — one live `query()` wrapped as a single-owner turn driver that
 * normalizes the SDK message stream into our {@link CoLiveEvent} vocabulary.
 *
 * Responsibilities (Task 1.3 only):
 *   - start(sessionId?, cwd): set up the session — resume `sessionId` if given,
 *     else fresh — and realpath the cwd (M0 🧪: `/tmp` -> `/private/tmp` symlink
 *     gotcha) so SDK session-store lookups stay stable.
 *   - run(text): drive one turn via `query()` with our OWNED config
 *     (model / permissionMode / settingSources from config, includePartialMessages,
 *     canUseTool, abortController) and map each SDK message to normalized events
 *     (status / tool_start / tool_end / text_delta / running_stats / result). A
 *     `tool_start` (from a streaming or final tool_use) is paired with a `tool_end`
 *     when the SDK delivers the result as a `type:'user'` / `tool_result` message;
 *     a periodic `running_stats` heartbeat fires every 10s while the turn runs.
 *     A `busy` flag + FIFO queue: a run() issued mid-turn is enqueued and runs
 *     after the current turn drains.
 *   - interrupt(): abort the current turn via its AbortController. v1 uses string
 *     prompts, so `Query.interrupt()` is unavailable (streaming-input only) — the
 *     abort path is the supported stop (see docs/sdk-reference.md).
 *
 * Decoupling: `canUseTool` (permissions — Task 1.4), `emit` (the Hub fan-out —
 * Task 1.5/2.x), and `query` (the SDK driver) are all INJECTED. This class does
 * NO permission logic and makes NO network/model calls of its own; tests pass a
 * fake `query` and a stub `canUseTool`.
 *
 * Thinking text is emitted as a desk-only 'thinking_delta' event (the closed Even
 * app ignores it); think_start/think_end status still bracket it.
 */
import { realpathSync } from 'node:fs'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, PermissionMode, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { CoLiveEvent } from './events'

/** Emit callback: the single sink for all normalized events of this session. */
export type Emit = (event: CoLiveEvent) => void

/**
 * The injectable `query` driver. We type it structurally (an async-iterable of
 * SDK messages) rather than against the heavyweight SDK Beta types: at runtime
 * we only read string discriminator fields off each message. The default is the
 * real SDK `query`; tests substitute a fake.
 */
export type QueryFn = (args: {
  prompt: string
  options?: QueryOptions
}) => AsyncIterable<unknown>

/** The subset of SDK `Options` we set per turn. */
export interface QueryOptions {
  model: string
  permissionMode: PermissionMode
  settingSources: readonly SettingSource[]
  cwd: string
  resume?: string
  includePartialMessages: boolean
  canUseTool: CanUseTool
  abortController: AbortController
  maxTurns?: number
}

/** The owned config slice a session needs (from config.ts). */
export interface SessionConfig {
  model: string
  permissionMode: PermissionMode
  settingSources: readonly SettingSource[]
  maxTurns?: number
}

/**
 * A timer scheduler — just the two clock primitives we use for the periodic
 * `running_stats` heartbeat. Injectable so tests drive it with fake timers
 * (or a stub) instead of waiting wall-clock seconds. Defaults to globals.
 */
export interface Clock {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  now: () => number
}

/** How often (ms) we emit `running_stats` while a turn is in flight. */
export const RUNNING_STATS_INTERVAL_MS = 10_000

/** Constructor dependencies — everything that keeps this class decoupled. */
export interface ClaudeSessionDeps {
  config: SessionConfig
  emit: Emit
  canUseTool: CanUseTool
  /** Defaults to the real SDK `query`; tests inject a fake. */
  query?: QueryFn
  /** Defaults to the global timer/Date primitives; tests inject a fake. */
  clock?: Clock
}

/**
 * One owner-side live session. Single-threaded by construction: at most one turn
 * runs at a time; concurrent run() calls queue.
 */
export class ClaudeSession {
  private readonly config: SessionConfig
  private readonly emit: Emit
  private readonly canUseTool: CanUseTool
  private readonly query: QueryFn
  private readonly clock: Clock

  /** Resolved (realpath'd) working directory; set by start(). */
  private cwd: string | undefined

  /** The current/last session id — captured from the init message, or a resume id. */
  private _sessionId: string | undefined

  /** True while a turn is being driven. */
  private _busy = false
  /** Guards against emitting more than one terminal `status: idle` per turn. */
  private idleEmitted = false

  /**
   * Pending prompts queued while busy (FIFO). Each carries its own `resolve` so
   * the corresponding run() promise settles when *that* prompt's turn completes
   * — robust even when two queued prompts share the same text.
   */
  private readonly queue: { text: string; resolve: () => void }[] = []

  /** AbortController for the in-flight turn (so interrupt() can abort it). */
  private currentAbort: AbortController | undefined

  /**
   * Kind of each currently-open streaming content block, keyed by its `index`,
   * so a `content_block_stop` emits the matching `text_end` / `think_end`
   * (rather than guessing). Cleared per turn.
   */
  private openBlocks: Map<number, 'text' | 'thinking'> = new Map()

  /**
   * Tool ids already announced via a streaming `content_block_start` this turn.
   * With includePartialMessages:true a tool_use appears BOTH as a streaming
   * start AND in the final assistant message, so handleAssistant() consults this
   * Set to avoid double-emitting `tool_start` for the same toolId. Cleared per
   * turn.
   */
  private announcedToolIds: Set<string> = new Set()

  /**
   * Open tools by `toolId` → the `{name, input}` we saw at `tool_start`, so when
   * the matching `tool_result` arrives (as a `type:'user'` message) we can emit a
   * fully-populated `tool_end{name, toolId, detail:{input, output}}`. Cleared per
   * turn. An entry is removed once its tool_end fires (so a tool_end is emitted at
   * most once per tool).
   */
  private openTools: Map<string, { name: string; input: unknown }> = new Map()

  /** Turn start time (clock.now()) for the `running_stats.durationMs`. */
  private turnStartedAt = 0

  /**
   * Resolves the moment this session's real id is known — captured from the
   * `init` message — or, failing that, when the in-flight turn ends without one
   * (e.g. an immediate stream error). This is the REAL signal the manager awaits
   * to learn the sessionId; the `init` message emits no event of its own and the
   * SDK's first turn can lag by many seconds, so a microtask spin cannot surface
   * it. Created lazily by {@link whenIdentified}; settled at most once.
   */
  private identifiedSignal: Promise<void> | undefined
  private resolveIdentified: (() => void) | undefined

  /** Best-known token totals this turn, fed from any usage we observe. */
  private inputTokens = 0
  private outputTokens = 0

  /** Handle for the periodic `running_stats` timer (cleared per turn). */
  private statsTimer: unknown

  constructor(deps: ClaudeSessionDeps) {
    this.config = deps.config
    this.emit = deps.emit
    this.canUseTool = deps.canUseTool
    this.query = deps.query ?? (sdkQuery as unknown as QueryFn)
    this.clock = deps.clock ?? {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      now: () => Date.now(),
    }
  }

  /** The captured session id (for resume / subscribe). Undefined before first start. */
  get sessionId(): string | undefined {
    return this._sessionId
  }

  /** True while a turn is in flight. */
  get busy(): boolean {
    return this._busy
  }

  /**
   * A promise that resolves when this session's real id is known (captured from
   * the `init` message) OR the in-flight turn has ended without ever surfacing
   * one. This is the signal the manager awaits to learn the sessionId of a fresh
   * session: it is driven by real stream progress, not a busy-spin, so it spans
   * the SDK's real (possibly multi-second) first-turn latency. Resolves
   * immediately if the id is already known.
   */
  whenIdentified(): Promise<void> {
    if (this._sessionId !== undefined) return Promise.resolve()
    if (this.identifiedSignal === undefined) {
      this.identifiedSignal = new Promise<void>((resolve) => {
        this.resolveIdentified = resolve
      })
    }
    return this.identifiedSignal
  }

  /** Settle the {@link whenIdentified} signal (id captured, or turn ended). Idempotent. */
  private settleIdentified(): void {
    if (this.resolveIdentified !== undefined) {
      this.resolveIdentified()
      this.resolveIdentified = undefined
    }
    // Pre-resolve any future whenIdentified() call for a turn that ended without
    // an id: a resolved promise is cheap and matches "the wait is over".
    if (this.identifiedSignal === undefined) {
      this.identifiedSignal = Promise.resolve()
    }
  }

  /**
   * Set up the session. If `sessionId` is given, the next run() resumes+appends
   * to that transcript (single transcript, no fork). The cwd is realpath'd so
   * the SDK's dir->projects-store encoding is stable.
   */
  async start(sessionId: string | undefined, cwd: string): Promise<void> {
    this.cwd = realpathSync(cwd)
    if (sessionId !== undefined) {
      this._sessionId = sessionId
    }
  }

  /**
   * Run one turn with `text`. If a turn is already in flight, `text` is queued
   * and runs after the current turn (and any earlier-queued turns) complete.
   * Resolves once `text`'s own turn has been driven to completion.
   */
  async run(text: string): Promise<void> {
    if (this._busy) {
      // Queue and wait until this specific prompt's turn has been driven.
      return this.enqueue(text)
    }
    await this.driveTurn(text)
    await this.drainQueue()
  }

  /**
   * Interrupt the in-flight turn by aborting its AbortController. No-op when idle.
   * (v1 string-prompt mode: Query.interrupt() is streaming-input only; abort is
   * the supported stop path — docs/sdk-reference.md.)
   */
  interrupt(): void {
    this.currentAbort?.abort()
  }

  /** Queue a prompt and resolve when its own turn has been driven. */
  private enqueue(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ text, resolve })
    })
  }

  /** Drain the FIFO queue, driving each queued prompt's turn in order. */
  private async drainQueue(): Promise<void> {
    let next = this.queue.shift()
    while (next !== undefined) {
      await this.driveTurn(next.text)
      next.resolve()
      next = this.queue.shift()
    }
  }

  /**
   * Drive exactly one turn: emit the prompt echo, build per-turn options, then
   * iterate the SDK stream, mapping each message to normalized events.
   */
  private async driveTurn(text: string): Promise<void> {
    this._busy = true
    this.emit({ type: 'user_prompt', text })
    this.emit({ type: 'status', state: 'busy' })
    this.idleEmitted = false

    const abortController = new AbortController()
    this.currentAbort = abortController
    this.openBlocks.clear()
    this.announcedToolIds.clear()
    this.openTools.clear()
    this.inputTokens = 0
    this.outputTokens = 0
    this.turnStartedAt = this.clock.now()
    this.startStatsTimer()

    const options: QueryOptions = {
      model: this.config.model,
      permissionMode: this.config.permissionMode,
      settingSources: this.config.settingSources,
      cwd: this.cwd ?? realpathSync(process.cwd()),
      includePartialMessages: true,
      canUseTool: this.canUseTool,
      abortController,
      ...(this._sessionId !== undefined ? { resume: this._sessionId } : {}),
      ...(this.config.maxTurns !== undefined ? { maxTurns: this.config.maxTurns } : {}),
    }

    try {
      const stream = this.query({ prompt: text, options })
      for await (const message of stream) {
        this.handleMessage(message)
      }
    } catch (err) {
      // An aborted turn throws here; that is a normal interrupt, not an error to
      // surface. Anything else becomes an error event.
      if (!abortController.signal.aborted) {
        this.emit({ type: 'error', message: errorMessage(err) })
      }
    } finally {
      this.stopStatsTimer()
      this.currentAbort = undefined
      this._busy = false
      // If the turn ended without ever surfacing an id (e.g. an immediate stream
      // error or interrupt before init), release whenIdentified() so the manager
      // does not wait forever. No-op once already settled by the init message.
      this.settleIdentified()
      // Reliable turn-over signal. In string-prompt mode the SDK does NOT send a
      // session_state_changed:idle — the stream just ends here — so emit the
      // terminal `status: idle` the Even app needs to clear "thinking…" (deduped
      // against a session_state_changed:idle that may already have emitted it).
      this.emitIdle()
    }
  }

  /** Emit the terminal `status: idle` at most once per turn. */
  private emitIdle(): void {
    if (this.idleEmitted) return
    this.idleEmitted = true
    this.emit({ type: 'status', state: 'idle' })
  }

  /** Start the periodic `running_stats` heartbeat for the in-flight turn. */
  private startStatsTimer(): void {
    this.stopStatsTimer()
    this.statsTimer = this.clock.setInterval(() => {
      this.emit({
        type: 'running_stats',
        durationMs: this.clock.now() - this.turnStartedAt,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
      })
    }, RUNNING_STATS_INTERVAL_MS)
  }

  /** Stop the `running_stats` heartbeat (idempotent). */
  private stopStatsTimer(): void {
    if (this.statsTimer !== undefined) {
      this.clock.clearInterval(this.statsTimer)
      this.statsTimer = undefined
    }
  }

  /** Fold any token usage we observe (stream or result) into the turn totals. */
  private absorbUsage(usage: unknown): void {
    if (!isRecord(usage)) return
    const input = asNumber(usage.input_tokens)
    const output = asNumber(usage.output_tokens)
    if (input > 0) this.inputTokens = input
    if (output > 0) this.outputTokens = output
  }

  /** Map one SDK message to zero-or-more normalized events. */
  private handleMessage(message: unknown): void {
    if (!isRecord(message)) return
    const type = message.type
    if (type === 'system') {
      this.handleSystem(message)
      return
    }
    if (type === 'stream_event') {
      this.handleStreamEvent(message.event)
      return
    }
    if (type === 'assistant') {
      this.handleAssistant(message)
      return
    }
    if (type === 'user') {
      this.handleUser(message)
      return
    }
    if (type === 'result') {
      this.handleResult(message)
      return
    }
    // tool_progress / other message types: no event in v1.
  }

  /** Handle `type:'system'` messages (init / state / progress / notification). */
  private handleSystem(message: Record<string, unknown>): void {
    const subtype = message.subtype
    if (subtype === 'init') {
      const id = message.session_id
      if (typeof id === 'string') {
        this._sessionId = id
        // The id is now known — wake any manager awaiting whenIdentified().
        this.settleIdentified()
      }
      return
    }
    if (subtype === 'session_state_changed') {
      if (message.state === 'idle') {
        this.emitIdle()
      }
      return
    }
    if (subtype === 'task_progress') {
      this.emit(this.toTaskProgress(message))
      return
    }
    if (subtype === 'notification') {
      this.emit({
        type: 'notification',
        title: asString(message.key) || 'Notification',
        message: asString(message.text),
      })
      return
    }
    // thinking_tokens and other system subtypes: never emit thinking text.
  }

  /** Build a task_progress event from a system/task_progress message. */
  private toTaskProgress(message: Record<string, unknown>): CoLiveEvent {
    const usage = isRecord(message.usage) ? message.usage : {}
    const toolUses = asNumber(usage.tool_uses)
    return {
      type: 'task_progress',
      completed: toolUses,
      total: toolUses,
      current: asString(message.description),
    }
  }

  /**
   * Handle one streaming delta (`SDKPartialAssistantMessage.event`). We map by
   * `event.type`, reading only string fields. Thinking content is surfaced as
   * status only; its text is NEVER emitted.
   */
  private handleStreamEvent(event: unknown): void {
    if (!isRecord(event)) return
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (!isRecord(block)) return
        const index = asNumber(event.index)
        if (block.type === 'tool_use') {
          const toolId = asString(block.id)
          const name = asString(block.name)
          this.announcedToolIds.add(toolId)
          this.openTools.set(toolId, { name, input: block.input })
          this.emit({ type: 'tool_start', name, toolId })
        } else if (block.type === 'text') {
          this.openBlocks.set(index, 'text')
          this.emit({ type: 'status', state: 'text_start' })
        } else if (block.type === 'thinking') {
          this.openBlocks.set(index, 'thinking')
          this.emit({ type: 'status', state: 'think_start' })
        }
        return
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (!isRecord(delta)) return
        if (delta.type === 'text_delta') {
          this.emit({ type: 'text_delta', text: asString(delta.text) })
        } else if (delta.type === 'thinking_delta') {
          // 🧪 thinking text lives in delta.thinking (not delta.text). Emitted for
          // DESK-ONLY render; the closed Even app ignores unknown event types.
          this.emit({ type: 'thinking_delta', text: asString(delta.thinking) })
        }
        // input_json_delta: still NO event.
        return
      }
      case 'content_block_stop': {
        // Close the matching block kind by index so the *_end status is precise.
        const index = asNumber(event.index)
        const kind = this.openBlocks.get(index)
        this.openBlocks.delete(index)
        if (kind === 'text') {
          this.emit({ type: 'status', state: 'text_end' })
        } else if (kind === 'thinking') {
          this.emit({ type: 'status', state: 'think_end' })
        }
        // tool_use / unknown blocks: no *_end status.
        return
      }
      case 'message_start': {
        // Carries initial usage (input tokens); fold it into running_stats totals.
        const inner = event.message
        if (isRecord(inner)) this.absorbUsage(inner.usage)
        return
      }
      case 'message_delta': {
        // Carries cumulative output-token usage as the message streams.
        this.absorbUsage(event.usage)
        return
      }
      default:
        // message_stop / others: turn framing handled elsewhere.
        return
    }
  }

  /**
   * Final assistant message: any tool_use blocks that were not already announced
   * via a streaming content_block_start get a tool_start here. Final text was
   * already streamed as text_delta, so it is not re-emitted.
   */
  private handleAssistant(message: Record<string, unknown>): void {
    const inner = message.message
    if (!isRecord(inner)) return
    const content = inner.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (isRecord(block) && block.type === 'tool_use') {
        const toolId = asString(block.id)
        const name = asString(block.name)
        // Record the {name, input} so the matching tool_result can pair into a
        // tool_end even when this tool was only surfaced in the final message.
        if (!this.openTools.has(toolId)) {
          this.openTools.set(toolId, { name, input: block.input })
        }
        // Skip any tool already announced via a streaming content_block_start
        // this turn (includePartialMessages double-surfaces the same tool_use).
        if (this.announcedToolIds.has(toolId)) continue
        this.announcedToolIds.add(toolId)
        this.emit({ type: 'tool_start', name, toolId })
      }
    }
  }

  /**
   * `type:'user'` message — the SDK surfaces tool results here. Its
   * `message.content` carries `tool_result` blocks ({tool_use_id, content,
   * is_error}); each pairs with an open tool_start to produce a `tool_end`. The
   * top-level `tool_use_result` (when present) is the richer raw detail, but it is
   * a single field for the whole message — so we only attribute it when this
   * message carries exactly one tool_result block; otherwise each block's own
   * `content` is the authoritative output (no cross-block mis-attribution). We
   * only emit a tool_end for a tool we previously announced (so unrelated user
   * input never spuriously fires one).
   */
  private handleUser(message: Record<string, unknown>): void {
    const inner = message.message
    if (!isRecord(inner)) return
    const content = inner.content
    if (!Array.isArray(content)) return
    const toolResults = content.filter(
      (b): b is Record<string, unknown> => isRecord(b) && b.type === 'tool_result',
    )
    const singleResult = toolResults.length === 1
    for (const block of toolResults) {
      const toolId = asString(block.tool_use_id)
      const open = this.openTools.get(toolId)
      if (open === undefined) continue // not one of ours, or already ended
      this.openTools.delete(toolId)
      // Prefer the richer top-level tool_use_result only when it unambiguously
      // belongs to this single result; otherwise use the block's own content.
      const output =
        singleResult && message.tool_use_result !== undefined
          ? message.tool_use_result
          : block.content
      this.emit({
        type: 'tool_end',
        name: open.name,
        toolId,
        summary: toolEndSummary(open.name, block.is_error === true),
        detail: { input: open.input, output },
      })
    }
  }

  /** Terminal result: emit `result` (and `error` on an error subtype). */
  private handleResult(message: Record<string, unknown>): void {
    const subtype = message.subtype
    const success = subtype === 'success'

    if (!success) {
      this.emit({ type: 'error', message: resultErrorMessage(message) })
    }

    const usage = isRecord(message.usage) ? message.usage : {}
    this.absorbUsage(usage)
    const sessionId =
      typeof message.session_id === 'string'
        ? message.session_id
        : this._sessionId ?? ''

    this.emit({
      type: 'result',
      success,
      text: asString(message.result),
      sessionId,
      costUsd: asNumber(message.total_cost_usd),
      provider: 'claude',
      turns: asNumber(message.num_turns),
      durationMs: asNumber(message.duration_ms),
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
    })
  }
}

/**
 * Extract a human message from an error-subtype result. Per the SDK contract,
 * `SDKResultError.errors` is `string[]` (sdk.d.ts). We also defensively accept
 * object elements with a `.message` field in case a future shape carries them.
 */
function resultErrorMessage(message: Record<string, unknown>): string {
  const errors = message.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors
      .map((e) => {
        if (typeof e === 'string') return e
        if (isRecord(e) && typeof e.message === 'string') return e.message
        return ''
      })
      .filter((s) => s.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  // Fall back to the subtype itself (e.g. "error_max_turns").
  return asString(message.subtype) || 'unknown error'
}

/** A short human summary line for a completed tool. */
function toolEndSummary(name: string, isError: boolean): string {
  const tool = name || 'tool'
  return isError ? `${tool} failed` : `${tool} completed`
}

/** Stringify a thrown value for an error event. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
