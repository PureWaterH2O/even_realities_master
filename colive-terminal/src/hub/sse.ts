/**
 * The per-session Server-Sent-Events transport (Task 2.1).
 *
 * This is the layer the SessionManager fan-out feeds: in server.ts (2.2),
 * `manager.subscribe(({ sessionId, event }) => sseHub.broadcast(sessionId, event))`.
 * It is deliberately transport-only — no business logic, no SDK, no auth (those
 * live in the routes above it). Its job is the wire format and client bookkeeping:
 *
 *   - per sessionId: the set of connected Express `Response`s + a ring buffer of
 *     the last {@link RING_CAPACITY} emitted frames (for needReplay resume),
 *   - a per-session monotonic frame id (`id: N`) used by clients to resume,
 *   - a periodic `:heartbeat` to every client to keep proxies from idling out.
 *
 * Two safety contracts from the Phase 1 reviews are baked in here:
 *   3. a broadcast to an unknown or "" sessionId is a safe no-op (a slash-rejected
 *      prompt fans an event tagged sessionId:'' — that must never crash the layer).
 *   4. broadcast NEVER throws: every `res.write` is guarded, and a client whose
 *      write throws is dropped, so one dead SSE client can't break fan-out to the
 *      rest (SessionManager.fanOut has no per-subscriber try/catch).
 */
import type { Response } from 'express'
import type { CoLiveEvent } from '../core/events'

/**
 * The timer primitives the heartbeat needs. A structural subset of the core
 * {@link import('../core/session').Clock} so tests can inject a fake timer and
 * fire heartbeats by hand instead of waiting wall-clock seconds.
 */
export interface Clock {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/** Heartbeat cadence (ms): a `:heartbeat` comment to every client this often. */
export const HEARTBEAT_INTERVAL_MS = 15_000

/** Ring-buffer depth: the last N frames per session retained for replay. */
export const RING_CAPACITY = 500

/** A single buffered frame: its monotonic id and the already-formatted SSE text. */
interface BufferedFrame {
  id: number
  frame: string
}

/** Everything the hub tracks for one sessionId. */
interface SessionEntry {
  clients: Set<Response>
  buffer: BufferedFrame[]
  nextId: number
}

/** Construction deps — only the heartbeat timer is injectable. */
export interface SseHubDeps {
  /** Defaults to the global timer primitives; tests inject a fake. */
  clock?: Clock
  /** Heartbeat cadence override (ms). Defaults to {@link HEARTBEAT_INTERVAL_MS}. */
  heartbeatMs?: number
}

/** Options for a new subscriber. */
export interface SubscribeOptions {
  /** Replay the buffered frames to this client before going live. */
  needReplay: boolean
}

/**
 * Format one SSE frame: `id: N\ndata: <json>\n\n`. Pure — the wire format in one
 * place so it can be unit-tested and reused by both live writes and replay.
 */
export function formatFrame(id: number, event: CoLiveEvent): string {
  return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`
}

/** The SSE transport surface server.ts wires the manager fan-out into. */
export interface SseHub {
  subscribe(sessionId: string, res: Response, opts: SubscribeOptions): void
  broadcast(sessionId: string, event: CoLiveEvent): void
  /** Stop the heartbeat and release timers. Does not close client sockets. */
  close(): void
}

/**
 * Create an {@link SseHub}. The heartbeat starts lazily on the first subscribe
 * and is torn down by {@link SseHub.close}.
 */
export function createSseHub(deps: SseHubDeps = {}): SseHub {
  const clock: Clock = deps.clock ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  }
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_INTERVAL_MS
  const sessions = new Map<string, SessionEntry>()
  let heartbeatTimer: unknown

  function entryFor(sessionId: string): SessionEntry {
    let entry = sessions.get(sessionId)
    if (entry === undefined) {
      entry = { clients: new Set(), buffer: [], nextId: 1 }
      sessions.set(sessionId, entry)
    }
    return entry
  }

  /** Write to a client, dropping it (from `clients`) if the write throws. */
  function safeWrite(entry: SessionEntry, res: Response, chunk: string): void {
    try {
      res.write(chunk)
    } catch {
      entry.clients.delete(res)
    }
  }

  function ensureHeartbeat(): void {
    if (heartbeatTimer !== undefined) return
    heartbeatTimer = clock.setInterval(() => {
      for (const entry of sessions.values()) {
        // Snapshot: safeWrite may mutate the set on a dead client.
        for (const res of [...entry.clients]) safeWrite(entry, res, ':heartbeat\n\n')
      }
    }, heartbeatMs)
  }

  function subscribe(sessionId: string, res: Response, opts: SubscribeOptions): void {
    const entry = entryFor(sessionId)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    // Flush headers so the client's connection opens before the first event.
    if (typeof res.flushHeaders === 'function') res.flushHeaders()

    // Preamble: a comment line that opens the stream immediately.
    safeWrite(entry, res, ':ok\n\n')

    if (opts.needReplay) {
      for (const { frame } of entry.buffer) safeWrite(entry, res, frame)
    }

    entry.clients.add(res)
    res.on('close', () => {
      entry.clients.delete(res)
    })

    ensureHeartbeat()
  }

  function broadcast(sessionId: string, event: CoLiveEvent): void {
    // Note 3: the empty session key (a slash-rejected, session-less prompt fans
    // sessionId:'') is a safe no-op — nothing is ever subscribed to it.
    if (sessionId === '') return
    // A real session buffers its frames even before any client attaches, so a
    // late subscriber with needReplay can resume from the ring buffer.
    const entry = entryFor(sessionId)

    const id = entry.nextId++
    const frame = formatFrame(id, event)

    entry.buffer.push({ id, frame })
    if (entry.buffer.length > RING_CAPACITY) entry.buffer.shift()

    // Snapshot the clients: safeWrite may delete from the set mid-iteration.
    for (const res of [...entry.clients]) safeWrite(entry, res, frame)
  }

  function close(): void {
    if (heartbeatTimer !== undefined) {
      clock.clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  return { subscribe, broadcast, close }
}
