/**
 * The desk-side client of the Hub (Task 3.1).
 *
 * The desk client is JUST ANOTHER CLIENT of the already-built Client Hub
 * (Phase 2): it speaks the Hub's HTTP + SSE protocol and nothing else. It does
 * NOT use the SDK and does NOT run a model. This module is deliberately
 * transport-only — no UI, no business logic — so the ink TUI (3.3) depends on
 * the {@link HubClient} interface and a fake can implement it in tests.
 *
 * Wire contract (canonical source: src/hub/routes.ts + src/hub/sse.ts):
 *   - Auth: `Authorization: Bearer <token>` on every POST/GET, and `?token=<t>`
 *     on the streaming SSE GET (the streaming fetch path the Hub verifies).
 *   - GET  /api/events?sessionId=&token=&needReplay= -> SSE. Preamble ":ok\n\n",
 *     each frame "id: N\ndata: <json>\n\n", heartbeat ":heartbeat\n\n" (comment
 *     lines are ignored by eventsource-parser).
 *   - POST /api/prompt {text, sessionId?, cwd?} -> 202 {ok, sessionId, provider}.
 *   - POST /api/permission-response {sessionId, decision, toolUseId?} -> {ok}.
 *   - POST /api/question-response {sessionId, answer, toolUseId?} -> {ok}.
 *   - POST /api/interrupt {sessionId} -> {ok}.
 *   - GET  /api/sessions/:id/transcript -> {transcript: [{role, text}]}.
 */
import { createParser } from 'eventsource-parser'
import type { CoLiveEvent } from '../core/events'

/** A transcript entry as returned by GET /api/sessions/:id/transcript. */
export interface TranscriptEntry {
  role: string
  text: string
}

/** Arguments for {@link HubClient.sendPrompt}. */
export interface SendPromptArgs {
  text: string
  /** Omit for a NEW session — the Hub resolves and returns the id. */
  sessionId?: string
  /** Working directory for a new session. */
  cwd?: string
}

/** What {@link HubClient.sendPrompt} resolves to (the Hub-resolved session id). */
export interface SendPromptResult {
  /** The session id the Hub resolved this prompt to (read from the 202 body). */
  sessionId: string | undefined
}

/** Options for {@link HubClient.subscribe}. */
export interface SubscribeOptions {
  /** Replay the Hub's buffered frames before live frames. */
  needReplay?: boolean
}

/** A handle returned by subscribe(): call it (or `.close()`) to end the stream. */
export interface SubscriptionHandle {
  /** Abort the request and stop the read loop cleanly (idempotent). */
  close(): void
}

/**
 * The public surface of the desk Hub client. The ink TUI (3.3) and the Phase-4
 * e2e test depend on THIS interface so a fake can drive event streams and record
 * posted decisions without any real server or model.
 */
export interface HubClient {
  /**
   * Open GET /api/events as a streaming fetch, parse the SSE stream, JSON.parse
   * each data frame into a {@link CoLiveEvent}, and call `onEvent` per event.
   * The read loop runs in the background; the returned handle aborts it cleanly
   * (aborting never throws out of the loop). `close()` is also callable as a
   * bare function for convenience.
   */
  subscribe(
    sessionId: string,
    onEvent: (event: CoLiveEvent) => void,
    opts?: SubscribeOptions,
  ): SubscriptionHandle & (() => void)

  /** POST /api/prompt; resolves with the Hub-resolved sessionId. */
  sendPrompt(args: SendPromptArgs): Promise<SendPromptResult>

  /** POST /api/permission-response {sessionId, decision, toolUseId?}. */
  respondPermission(sessionId: string, decision: string, toolUseId?: string): Promise<void>

  /** POST /api/question-response {sessionId, answer, toolUseId?}. */
  respondQuestion(sessionId: string, answer: string, toolUseId?: string): Promise<void>

  /** POST /api/interrupt {sessionId}. */
  interrupt(sessionId: string): Promise<void>

  /** POST /api/control {sessionId, action, value}. */
  setControl(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>

  /** GET /api/info -> { model, version, provider, ... }; resolves with at least the model. */
  getInfo(): Promise<{ model: string }>

  /** GET /api/sessions/:id/transcript; resolves with the transcript array. */
  fetchTranscript(sessionId: string): Promise<TranscriptEntry[]>
}

/** Construction options. `fetch` is injectable for testing (defaults to global). */
export interface HubClientOptions {
  /** Hub base URL, e.g. "http://127.0.0.1:8787" (no trailing slash needed). */
  baseUrl: string
  /** Bearer token sent on every request. */
  token: string
  /** Injectable fetch (defaults to the global fetch) — tests pass a fake. */
  fetch?: typeof fetch
}

/** Create a {@link HubClient}. */
export function createHubClient(options: HubClientOptions): HubClient {
  const { token } = options
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetch ?? fetch

  function url(path: string): string {
    return `${baseUrl}${path}`
  }

  /** Auth + JSON headers for POST/GET requests. */
  function jsonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  }

  /** POST a JSON body to `path`, throwing on a non-2xx response. */
  async function postJson(path: string, body: unknown): Promise<unknown> {
    const res = await doFetch(url(path), {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    })
    return readOk(res, path)
  }

  /** GET `path`, throwing on a non-2xx response. */
  async function getJson(path: string): Promise<unknown> {
    const res = await doFetch(url(path), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    return readOk(res, path)
  }

  /** Parse a 2xx JSON body or throw a descriptive error including the status. */
  async function readOk(res: Response, path: string): Promise<unknown> {
    if (!res.ok) {
      let detail = ''
      try {
        detail = await res.text()
      } catch {
        // ignore — body may be unreadable
      }
      throw new Error(`Hub request to ${path} failed: ${res.status} ${res.statusText} ${detail}`.trim())
    }
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }

  function subscribe(
    sessionId: string,
    onEvent: (event: CoLiveEvent) => void,
    opts: SubscribeOptions = {},
  ): SubscriptionHandle & (() => void) {
    const controller = new AbortController()
    let closed = false

    const params = new URLSearchParams({ sessionId, token })
    if (opts.needReplay) params.set('needReplay', 'true')
    const eventsUrl = url(`/api/events?${params.toString()}`)

    const parser = createParser({
      onEvent: (event) => {
        // Comment lines (":ok", ":heartbeat") are not delivered here — the parser
        // only emits complete `data:` frames. Each data string is one CoLiveEvent.
        //
        // Gate delivery on `closed` so close() is self-sufficient: an in-flight
        // chunk already read before the abort propagates must NOT fire onEvent
        // after the caller has torn down (e.g. the TUI unmounting / re-subscribing
        // on a session change in Phase 4). Without this, delivery relies solely on
        // the transport honoring controller.abort().
        if (closed) return
        try {
          onEvent(JSON.parse(event.data) as CoLiveEvent)
        } catch {
          // A malformed frame must not kill the stream — skip it.
        }
      },
    })

    // The read loop runs in the BACKGROUND (not awaited): aborting must not throw
    // out of it, so we swallow the AbortError (and any post-close error).
    void (async () => {
      try {
        const res = await doFetch(eventsUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        const body = res.body
        if (!body) return
        const reader = body.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done || closed) break
            parser.feed(decoder.decode(value, { stream: true }))
          }
        } finally {
          reader.cancel().catch(() => {})
        }
      } catch {
        // AbortError on close, or a transport error — swallow; the read loop ends.
      }
    })()

    function close(): void {
      if (closed) return
      closed = true
      controller.abort()
    }

    // Return a callable handle: usable as `handle()` or `handle.close()`.
    const handle = close as SubscriptionHandle & (() => void)
    handle.close = close
    return handle
  }

  async function sendPrompt(args: SendPromptArgs): Promise<SendPromptResult> {
    const body: { text: string; sessionId?: string; cwd?: string } = { text: args.text }
    if (args.sessionId !== undefined) body.sessionId = args.sessionId
    if (args.cwd !== undefined) body.cwd = args.cwd
    const json = (await postJson('/api/prompt', body)) as { sessionId?: unknown } | undefined
    const sessionId = typeof json?.sessionId === 'string' ? json.sessionId : undefined
    return { sessionId }
  }

  async function respondPermission(
    sessionId: string,
    decision: string,
    toolUseId?: string,
  ): Promise<void> {
    await postJson('/api/permission-response', { sessionId, decision, toolUseId: toolUseId ?? '' })
  }

  async function respondQuestion(
    sessionId: string,
    answer: string,
    toolUseId?: string,
  ): Promise<void> {
    await postJson('/api/question-response', { sessionId, answer, toolUseId: toolUseId ?? '' })
  }

  async function interrupt(sessionId: string): Promise<void> {
    await postJson('/api/interrupt', { sessionId })
  }

  async function setControl(
    sessionId: string,
    action: 'setModel' | 'setMode',
    value: string,
  ): Promise<void> {
    await postJson('/api/control', { sessionId, action, value })
  }

  async function getInfo(): Promise<{ model: string }> {
    const info = (await getJson('/api/info')) as { model?: unknown } | undefined
    return { model: typeof info?.model === 'string' ? info.model : '' }
  }

  async function fetchTranscript(sessionId: string): Promise<TranscriptEntry[]> {
    const json = (await getJson(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`)) as
      | { transcript?: unknown }
      | undefined
    const transcript = json?.transcript
    return Array.isArray(transcript) ? (transcript as TranscriptEntry[]) : []
  }

  return {
    subscribe,
    sendPrompt,
    respondPermission,
    respondQuestion,
    interrupt,
    setControl,
    getInfo,
    fetchTranscript,
  }
}
