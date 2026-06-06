/**
 * ClaudeSession — one live `query()` wrapped as a single-owner turn driver that
 * normalizes the SDK message stream into our {@link CoLiveEvent} vocabulary.
 *
 * Responsibilities:
 *   - start(sessionId?, cwd): set up the session — resume `sessionId` if given,
 *     else fresh — and realpath the cwd (M0 🧪: `/tmp` -> `/private/tmp` symlink
 *     gotcha) so SDK session-store lookups stay stable.
 *   - run(text): drive a turn via ONE persistent streaming `query()` per session
 *     (fed by a {@link PromptInbox}) with our OWNED config (model / permissionMode
 *     / settingSources from config, includePartialMessages, canUseTool). A single
 *     long-lived consumer loop maps each SDK message to normalized events (status
 *     / tool_start / tool_end / text_delta / running_stats / result); each turn
 *     ends on its `result` message (the streaming-input turn-end signal). A
 *     `tool_start` (from a streaming or final tool_use) is paired with a `tool_end`
 *     when the SDK delivers the result as a `type:'user'` / `tool_result` message;
 *     a periodic `running_stats` heartbeat fires every 10s while the turn runs.
 *     A `busy` flag + FIFO queue: a run() issued mid-turn is enqueued and runs
 *     after the current turn drains.
 *   - interrupt(): interrupt the in-flight turn via `Query.interrupt()` (the
 *     streaming-input stop path — see docs/sdk-reference.md).
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
import type {
  CanUseTool,
  PermissionMode,
  SettingSource,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { CoLiveEvent } from './events'
import { PromptInbox, textUserMessage } from './promptInbox'

/** Emit callback: the single sink for all normalized events of this session. */
export type Emit = (event: CoLiveEvent) => void

/**
 * The streaming Query: the async-iterable of SDK messages + the control methods
 * we use. We type it structurally (an async-iterable of SDK messages) rather
 * than against the heavyweight SDK Beta types: at runtime we only read string
 * discriminator fields off each message.
 */
export interface QueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<void>
}

/**
 * The injectable streaming-input `query` driver. The `prompt` is the persistent
 * inbox (one per query OPEN), not a per-turn string. The default is the real SDK
 * `query`; tests substitute a fake.
 */
export type QueryFn = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}) => QueryLike

/**
 * The subset of SDK `Options` we set at query-open. (No abortController —
 * interrupt is Query.interrupt() in streaming-input mode.)
 */
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
  private readonly queue: { text: string; resolve: () => void; retried?: boolean }[] = []

  /** The held streaming Query + its inbox (one per open). Undefined until first run / after death. */
  private q: QueryLike | undefined
  private inbox: PromptInbox | undefined
  /** True once a fatal consumer error killed the query; next run() reopens with resume. */
  private dead = false
  /**
   * True between a deliberate interrupt() and the turn-end it triggers. The real
   * SDK ends an interrupted turn by flushing a NON-SUCCESS `result` (not a throw);
   * this flag tells the consumer loop to frame a clean idle for that result and
   * surface NO error/failed-result — pressing Esc is not an error. Reset on every
   * turn-end so it can never leak into a later turn.
   */
  private interrupting = false
  /** Resolver for the in-flight turn's run() promise (settled on its `result`). */
  private currentTurnResolve: (() => void) | undefined
  /** The in-flight turn's prompt text (Task 1: re-queued to the FRONT on a fatal error). */
  private currentTurnText: string | undefined
  /** True when the in-flight turn is a single-retry of a re-queued prompt (Task 1 guard). */
  private currentTurnRetried = false

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
      return new Promise<void>((resolve) => this.queue.push({ text, resolve }))
    }
    return new Promise<void>((resolve) => this.beginTurn(text, resolve, false))
  }

  /**
   * Interrupt the in-flight turn via Query.interrupt(). No-op when idle (so it
   * never marks `interrupting` without a turn to end). Records the intent so the
   * consumer loop suppresses the SDK's flushed non-success interrupt-result (a
   * clean idle, no error). Stays `void` so SessionManager is unchanged.
   * (Streaming-input stop path — docs/sdk-reference.md.)
   */
  interrupt(): void {
    if (!this._busy) return
    this.interrupting = true
    void this.q?.interrupt().catch(() => {})
  }

  /** Begin a turn: per-turn resets, ensure the query is open, push the prompt. */
  private beginTurn(text: string, resolve: () => void, retried: boolean): void {
    this._busy = true
    this.currentTurnResolve = resolve
    this.currentTurnText = text
    this.currentTurnRetried = retried
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
          if (isRecord(message) && message.type === 'result') {
            // Turn-end. A deliberate Query.interrupt() ends the turn by flushing a
            // NON-SUCCESS `result`; suppress it (frame a clean idle, surface NO
            // error/failed-result) — pressing Esc is not an error, matching the old
            // abort path. A `success` result while interrupting means the turn
            // naturally completed in a race with the interrupt, so let it through
            // (handleResult emits it) rather than swallowing real work.
            if (this.interrupting && message.subtype !== 'success') {
              this.onTurnEnd()
              continue
            }
            this.handleMessage(message)
            this.onTurnEnd()
            continue
          }
          this.handleMessage(message)
        }
      } catch (err) {
        this.onConsumerError(err)
      }
    })()
  }

  /** Turn-end (on `result`): close out the turn, resolve run(), drain the FIFO. */
  private onTurnEnd(): void {
    this.settleTurnAndDrain()
  }

  /**
   * Fatal consumer error: surface an `error` event, mark the query dead and drop
   * the handles, then settle the turn. The next `run()` reopens with `resume`
   * (lazy self-heal — spec §2 Option 1).
   */
  private onConsumerError(err: unknown): void {
    this.dead = true
    this.q = undefined
    this.inbox = undefined
    this.emit({ type: 'error', message: errorMessage(err) })
    // Task 1: don't drop the in-flight prompt on a fatal error. Re-queue it to the FRONT so the
    // lazy reopen-with-resume re-drives it. Guard with `retried` so a deterministically-crashing
    // prompt can't loop forever — a second death gives up (the error is already surfaced).
    if (this.currentTurnText !== undefined && this.currentTurnResolve !== undefined && !this.currentTurnRetried) {
      this.queue.unshift({ text: this.currentTurnText, resolve: this.currentTurnResolve, retried: true })
      this.currentTurnResolve = undefined // detach so settleTurnAndDrain won't resolve it early
      this.currentTurnText = undefined
    }
    this.settleTurnAndDrain()
  }

  /**
   * Shared turn-close, used by both the normal `result` turn-end and the
   * fatal-error path: stop the stats heartbeat, settle whenIdentified(), emit the
   * terminal idle, resolve this prompt's run(), then drain the FIFO (begin the
   * next queued turn). Keeping this single-sourced means the two exit paths can
   * never drift in ordering. (The error path runs its `emit(error)` prefix first.)
   */
  private settleTurnAndDrain(): void {
    // Clear the interrupt intent on EVERY turn-end path (normal result, the
    // suppressed interrupt-result, or a fatal error) so it can never leak into a
    // later turn and silence a legitimate non-success result.
    this.interrupting = false
    this.stopStatsTimer()
    // If the turn ended without ever surfacing an id, release whenIdentified()
    // so the manager does not wait forever. No-op once already settled by init.
    this.settleIdentified()
    // Reliable turn-over signal. In string-prompt mode the SDK does NOT send a
    // session_state_changed:idle — so emit the terminal `status: idle` the Even
    // app needs to clear "thinking…" (deduped against a session_state_changed
    // :idle that may already have emitted it).
    this.emitIdle()
    this._busy = false
    const resolve = this.currentTurnResolve
    this.currentTurnResolve = undefined
    this.currentTurnText = undefined
    resolve?.()
    const next = this.queue.shift()
    if (next !== undefined) this.beginTurn(next.text, next.resolve, next.retried === true)
  }

  /**
   * Close the persistent query (session teardown / new-session reset). Ends the
   * consumer loop gracefully via `inbox.close()` (done:true), so it never trips
   * `onConsumerError`. Intentionally caller-less in M3.3a: per the plan boundary
   * a session's query lives until process exit (no per-session GC) — session
   * eviction / a `/clear` reset that calls this is M3.4's concern.
   */
  close(): void {
    this.inbox?.close()
    this.q = undefined
    this.inbox = undefined
    this.dead = false
    this.stopStatsTimer()
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
   * `event.type`, reading only string fields. Thinking content is bracketed by
   * think_start/think_end status, and its text is emitted as a desk-only
   * 'thinking_delta' event (the closed Even app ignores unknown event types).
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
        // tool_end. 🧪 OVERWRITE unconditionally: a streaming content_block_start
        // stored an EMPTY {} input (the real args stream via input_json_delta,
        // which we don't reassemble); this final assistant message carries the
        // COMPLETE input, so it must replace the placeholder — otherwise
        // tool_end.detail.input stays {} and the desk's diff + Ctrl-O verbose are
        // blank. (The tool_start dedup below is independent of this.)
        this.openTools.set(toolId, { name, input: block.input })
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
