/**
 * SessionManager — the Core facade that owns every live session (Task 1.5).
 *
 * It composes Tasks 1.1-1.4 into the single object the Client Hub (Phase 2)
 * drives:
 *   - a map of sessionId -> live {@link ClaudeSession} + its {@link PermissionBroker},
 *   - {@link SessionManager.prompt} to create / resume / serialize turns,
 *   - {@link SessionManager.respondPermission} / {@link SessionManager.respondQuestion}
 *     to route a client's decision into the owning session's broker,
 *   - {@link SessionManager.interrupt} / {@link SessionManager.getStatus},
 *   - {@link SessionManager.subscribe}: a single fan-out — every event from every
 *     session is tagged with its sessionId and delivered to all subscribers. This
 *     is exactly the fan-out the SSE layer bridges to clients.
 *
 * Transport (HTTP/SSE) lives ABOVE this module: this is pure orchestration and
 * makes no network calls of its own. The SDK `query` (and an optional `clock`)
 * are injected so tests drive it with a fake stream — no real model calls.
 *
 * M0 ground truth baked in:
 *   - The slash guard runs at THIS boundary (before any session work): a prompt
 *     whose first non-space char is `/` is rejected (it hangs `query()`), never
 *     forwarded — {@link prompt} returns `undefined`.
 *   - Same-session serialization (the co-live finding): a prompt issued while a
 *     session is busy is enqueued onto that session and runs after the in-flight
 *     turn — concurrent prompts never collide on one transcript.
 *   - The real sessionId is learned from the stream (the `init` message). A fresh
 *     session is keyed by a temporary local id until the real id surfaces, at
 *     which point the map is re-keyed and {@link prompt} resolves with the real id.
 */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { PermissionMode, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { CoLiveEvent } from './events'
import { ClaudeSession } from './session'
import type { Clock, QueryFn } from './session'
import { PermissionBroker, rejectIfSlash } from './permissions'
import type { PermissionDecision } from './permissions'

/** An event tagged with the id of the session that produced it (the fan-out unit). */
export interface TaggedEvent {
  sessionId: string
  event: CoLiveEvent
}

/** A fan-out subscriber: receives every tagged event from every session. */
export type Subscriber = (tagged: TaggedEvent) => void

/** Coarse status of a session for the Hub's status endpoint. */
export type SessionStatus = 'busy' | 'idle' | 'unknown'

/** The config slice the manager needs to build sessions + brokers. */
export interface ManagerConfig {
  model: string
  permissionMode: PermissionMode
  settingSources: readonly SettingSource[]
  /** The default (realpath'd) working directory for a session with no cwd given. */
  projectDir: string
  maxTurns?: number
}

/** Manager construction dependencies. */
export interface SessionManagerDeps {
  config: ManagerConfig
  /** Defaults to the real SDK `query`; tests inject a fake. */
  query?: QueryFn
  /** Defaults to the global timer/Date primitives; tests inject a fake. */
  clock?: Clock
}

/**
 * One live session's bookkeeping. `currentId` is the id events are tagged with:
 * a temporary local id for a fresh session until the real id surfaces from the
 * stream, then the real id (the map is re-keyed to match).
 */
interface SessionEntry {
  session: ClaudeSession
  broker: PermissionBroker
  /** The id this entry is currently keyed by (and tags its events with). */
  currentId: string
  /** True once the real (stream-derived) id is known and the map is re-keyed. */
  idResolved: boolean
  /**
   * Events emitted before the real id was known, held back so EVERY event a
   * subscriber sees for this session carries the same (real) id. The `init`
   * message surfaces the id within the first stream messages, so this buffer is
   * tiny (typically just the prompt-echo + busy status) and is flushed at once.
   */
  buffered: CoLiveEvent[]
}

/**
 * The Core facade over all live sessions. Single-owner: at most one turn per
 * session runs at a time (the session itself serializes; the manager just routes).
 */
export class SessionManager {
  private readonly config: ManagerConfig
  private readonly query: QueryFn | undefined
  private readonly clock: Clock | undefined

  /** id -> live session entry. Re-keyed when a fresh session learns its real id. */
  private readonly sessions = new Map<string, SessionEntry>()

  /** Fan-out subscribers; every session event reaches all of them, tagged. */
  private readonly subscribers = new Set<Subscriber>()

  constructor(deps: SessionManagerDeps) {
    this.config = deps.config
    this.query = deps.query
    this.clock = deps.clock
  }

  /**
   * Register a fan-out subscriber. Returns an unsubscribe function. Every event
   * emitted by any session is delivered here, tagged with that session's id.
   */
  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  /**
   * Submit a prompt.
   *
   *  - Slash guard FIRST: a slash prompt is rejected (the slash error is emitted)
   *    and `undefined` is returned — it never reaches `query()`.
   *  - Known live `id`: resume+run on that existing in-memory session. If it is
   *    busy the text is serialized (enqueued) and runs after the in-flight turn
   *    (the M0 co-live finding). Resolves with `id`.
   *  - `id` given but NOT live in-memory (a cold / on-disk session — the normal
   *    "list sessions → pick an old one → prompt it" flow): adopt that id and
   *    resume the existing transcript via `start(id, cwd)`, so the SDK appends to
   *    it (single transcript, no fork) rather than minting a new sessionId.
   *    Resolves with that same `id`.
   *  - No `id`: create a fresh session, start it, and drive the turn. Resolves
   *    with the real sessionId as soon as the stream surfaces it.
   *
   * The turn itself runs to completion in the background; this resolves as soon
   * as the owning session's id is known (mirroring the Hub's 202-with-id flow).
   */
  async prompt(
    id: string | undefined,
    text: string,
    cwd?: string,
  ): Promise<string | undefined> {
    // The slash guard is independent of any session: reject before doing any work.
    if (rejectIfSlash(text, (event) => this.fanOut(id ?? '', event))) {
      return undefined
    }

    const existing = id !== undefined ? this.sessions.get(id) : undefined
    if (existing !== undefined) {
      // Resume: drive the turn (the session enqueues it if a turn is in flight).
      // run() resolves only when THIS text's turn completes, so we do not await it
      // here — the id is already known and returned immediately.
      void existing.session.run(text)
      return existing.currentId
    }

    // An id was given but no live session owns it: this is a cold/on-disk session
    // (e.g. picked from GET /api/sessions). Adopt the id and resume its transcript.
    if (id !== undefined) {
      return this.startSession(text, cwd, id)
    }

    return this.startSession(text, cwd, undefined)
  }

  /**
   * Route a client's permission decision into the owning session's broker. No-op
   * for an unknown session (or an unknown/already-settled toolUseId).
   */
  respondPermission(
    sessionId: string,
    toolUseId: string,
    decision: PermissionDecision,
  ): void {
    this.sessions.get(sessionId)?.broker.resolvePermission(toolUseId, decision)
  }

  /**
   * Route a client's AskUserQuestion answer into the owning session's broker.
   * No-op for an unknown session (or an unknown/already-settled toolUseId).
   */
  respondQuestion(sessionId: string, toolUseId: string, answer: string): void {
    this.sessions.get(sessionId)?.broker.resolveQuestion(toolUseId, answer)
  }

  /** Interrupt the in-flight turn of `sessionId`. No-op for an unknown/idle session. */
  interrupt(sessionId: string): void {
    this.sessions.get(sessionId)?.session.interrupt()
  }

  /** Coarse status of `sessionId`: 'busy' while a turn runs, else 'idle'; 'unknown' if absent. */
  getStatus(sessionId: string): SessionStatus {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return 'unknown'
    return entry.session.busy ? 'busy' : 'idle'
  }

  /**
   * Create a session, start it, and drive the first turn.
   *
   *  - `resumeId === undefined` (fresh session): key by a temporary local id until
   *    the stream's `init` message surfaces the REAL id, then re-key the map and
   *    resolve with it. Falls back to the local id if the turn ends without one.
   *  - `resumeId` given (cold / on-disk resume): the id is known up front, so key
   *    the entry by it immediately and `start(resumeId, cwd)` so the next turn
   *    resumes that transcript (single transcript, no fork). The id resolves
   *    synchronously — no re-keying, no buffering window — and we return it.
   */
  private async startSession(
    text: string,
    cwd: string | undefined,
    resumeId: string | undefined,
  ): Promise<string> {
    // For a resume the id is known now, so key by it directly; otherwise use a
    // temporary local key so the entry is addressable (and events taggable)
    // before the real id surfaces from the stream.
    const initialId = resumeId ?? `local:${randomUUID()}`
    const entry: SessionEntry = {
      session: undefined as unknown as ClaudeSession,
      broker: undefined as unknown as PermissionBroker,
      currentId: initialId,
      // A resumed session's id is already final — mark it resolved so its events
      // fan out live (correctly tagged) with no pre-init buffering window.
      idResolved: resumeId !== undefined,
      buffered: [],
    }

    const broker = new PermissionBroker({
      emit: (event) => this.onSessionEvent(entry, event),
      permissionMode: this.config.permissionMode,
    })
    const session = new ClaudeSession({
      config: {
        model: this.config.model,
        permissionMode: this.config.permissionMode,
        settingSources: this.config.settingSources,
        ...(this.config.maxTurns !== undefined ? { maxTurns: this.config.maxTurns } : {}),
      },
      emit: (event) => this.onSessionEvent(entry, event),
      canUseTool: broker.canUseTool,
      ...(this.query !== undefined ? { query: this.query } : {}),
      ...(this.clock !== undefined ? { clock: this.clock } : {}),
    })
    entry.session = session
    entry.broker = broker
    this.sessions.set(initialId, entry)

    const resolvedCwd = realpathSync(cwd ?? this.config.projectDir)
    // start(resumeId, cwd): for a resume this sets the session's id so the turn's
    // options.resume points at the existing transcript; for a fresh session it is
    // undefined and the id is learned from the stream.
    await session.start(resumeId, resolvedCwd)

    // A resumed session already knows its id (start set it): return it immediately,
    // skipping the learn-from-stream wait the fresh path needs.
    if (resumeId !== undefined) {
      void session.run(text)
      return entry.currentId
    }

    // Drive the turn in the background; do not await full completion here.
    void session.run(text)

    // Resolve with the real id as soon as the session learns it (from `init`).
    // whenIdentified() is a REAL signal driven by stream progress — it resolves
    // when the `init` message captures the id (which emits no event, so it is the
    // only way to surface it), or when the turn ends without one. It therefore
    // spans the SDK's real (possibly multi-second) first-turn latency; a
    // microtask spin would exit long before a delayed `init` lands and fabricate
    // a local: id. Re-key eagerly here so getStatus/resume/interrupt find the
    // session by its real id before any further event arrives.
    await session.whenIdentified()
    this.reconcileId(entry)
    // If the turn ended without ever surfacing an id (e.g. an immediate stream
    // error), flush whatever buffered under the local id so nothing is lost.
    if (!entry.idResolved) this.flushUnderLocalId(entry)
    return entry.currentId
  }

  /**
   * Handle one event from a session (or its broker). Until the real id is known
   * the event is buffered (so no event ever escapes tagged with the placeholder
   * local id); once the `init`-derived id surfaces we re-key, flush the buffer,
   * and fan out live thereafter — every event for the session carries one id.
   */
  private onSessionEvent(entry: SessionEntry, event: CoLiveEvent): void {
    this.reconcileId(entry)
    if (!entry.idResolved) {
      entry.buffered.push(event)
      return
    }
    this.fanOut(entry.currentId, event)
  }

  /**
   * If the session has learned its real id and the entry is still keyed by its
   * temporary local id, re-key the map (so future lookups — resume / interrupt /
   * respond — find it by the real id) and flush any events buffered before the
   * id was known. Idempotent: a no-op once already resolved.
   */
  private reconcileId(entry: SessionEntry): void {
    if (entry.idResolved) return
    const realId = entry.session.sessionId
    if (realId === undefined) return
    // Re-key: drop the temporary local key, install the real one.
    this.sessions.delete(entry.currentId)
    entry.currentId = realId
    this.sessions.set(realId, entry)
    entry.idResolved = true
    // Flush events that arrived before the id was known, now tagged with it.
    const pending = entry.buffered
    entry.buffered = []
    for (const event of pending) this.fanOut(realId, event)
  }

  /**
   * Last-resort flush: a fresh session ended without ever surfacing a real id
   * (e.g. an immediate stream error). Mark it resolved under the local id and
   * flush the buffer so the error/events still reach subscribers (rather than
   * being lost) — and any further events fan out live under that id.
   */
  private flushUnderLocalId(entry: SessionEntry): void {
    if (entry.idResolved) return
    entry.idResolved = true
    const pending = entry.buffered
    entry.buffered = []
    for (const event of pending) this.fanOut(entry.currentId, event)
  }

  /** Tag an event with a sessionId and deliver it to every subscriber. */
  private fanOut(sessionId: string, event: CoLiveEvent): void {
    const tagged: TaggedEvent = { sessionId, event }
    for (const sub of this.subscribers) sub(tagged)
  }
}
