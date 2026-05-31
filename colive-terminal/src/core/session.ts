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
 *     canUseTool, abortController) and map each SDK message to normalized events.
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
 * Thinking text is NEVER broadcast (M0 🧪): `thinking_delta` produces no event,
 * and thinking content blocks surface only as `think_start`/`think_end` status.
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

/** Constructor dependencies — everything that keeps this class decoupled. */
export interface ClaudeSessionDeps {
  config: SessionConfig
  emit: Emit
  canUseTool: CanUseTool
  /** Defaults to the real SDK `query`; tests inject a fake. */
  query?: QueryFn
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

  /** Resolved (realpath'd) working directory; set by start(). */
  private cwd: string | undefined

  /** The current/last session id — captured from the init message, or a resume id. */
  private _sessionId: string | undefined

  /** True while a turn is being driven. */
  private _busy = false

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

  constructor(deps: ClaudeSessionDeps) {
    this.config = deps.config
    this.emit = deps.emit
    this.canUseTool = deps.canUseTool
    this.query = deps.query ?? (sdkQuery as unknown as QueryFn)
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

    const abortController = new AbortController()
    this.currentAbort = abortController
    this.openBlocks.clear()

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
      this.currentAbort = undefined
      this._busy = false
    }
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
      if (typeof id === 'string') this._sessionId = id
      return
    }
    if (subtype === 'session_state_changed') {
      if (message.state === 'idle') {
        this.emit({ type: 'status', state: 'idle' })
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
          this.emit({
            type: 'tool_start',
            name: asString(block.name),
            toolId: asString(block.id),
          })
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
        }
        // thinking_delta and input_json_delta: NO event (never leak thinking).
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
      default:
        // message_start / message_stop / others: turn framing handled elsewhere.
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
        this.emit({
          type: 'tool_start',
          name: asString(block.name),
          toolId: asString(block.id),
        })
      }
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

/** Extract a human message from an error-subtype result. */
function resultErrorMessage(message: Record<string, unknown>): string {
  const errors = message.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors
      .map((e) => (isRecord(e) && typeof e.message === 'string' ? e.message : ''))
      .filter((s) => s.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  // Fall back to the subtype itself (e.g. "error_max_turns").
  return asString(message.subtype) || 'unknown error'
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
