/**
 * Phase 4.1 — the M1 end-to-end co-live loop, automated and in-process.
 *
 * The automated mirror of the M0 harness, now driven against our REAL Core + Hub
 * over REAL HTTP + SSE. The ONLY thing faked is the SDK boundary (`query`,
 * injected into the real SessionManager) and the on-disk store (a fake facade) —
 * so no model is ever called and no jsonl is read, but every other layer is the
 * production code path:
 *   - the real Express app + bearer auth + routes (createApp),
 *   - the real SseHub (per-session ring buffer + replay + live fan-out),
 *   - the real SessionManager (id resolution, serialization, broker, fan-out),
 *   - the real desk HubClient (createHubClient) opening real streaming fetches.
 *
 * Two clients — "desk" and "glasses" — are both createHubClient instances pointed
 * at the same in-process Hub, attached to the SAME session. The tests prove the
 * M1 definition of done: kick off at the desk, respond from the glasses, both
 * clients see every event of one continuous session; and a desk-initiated tool
 * permission is approved from the glasses.
 *
 * This composes the same pieces startServer wires, but injects the fake query +
 * store so the test is hermetic and does NOT modify the validated hub/server.ts.
 *
 * SSE discipline: every subscription handle, every socket, the SseHub and the
 * server are closed in afterEach; each wait has a short timeout. An un-closed SSE
 * stream hangs vitest.
 */
import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { createApp } from '../src/hub/server'
import { SessionManager } from '../src/core/sessionManager'
import { createSseHub, type SseHub } from '../src/hub/sse'
import { resolveConfig } from '../src/core/config'
import { createHubClient, type HubClient } from '../src/desk/client'
import type { CoLiveEvent } from '../src/core/events'
import type { QueryFn } from '../src/core/session'

/** The fixed id our fake SDK assigns, so every turn maps to ONE continuous session. */
const SESSION_ID = 'e2e-co-live-1'

/** A scripted async-iterable of SDK messages (the subset session.ts maps to events). */
function turn(messages: unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    for (const m of messages) yield m
  })()
}

/** The proven happy-turn message shape (mirrors test/core/sessionManager happyTurn). */
function happyMessages(text: string): unknown[] {
  return [
    { type: 'system', subtype: 'init', session_id: SESSION_ID },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } },
    { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
    {
      type: 'result',
      subtype: 'success',
      session_id: SESSION_ID,
      result: text,
      total_cost_usd: 0,
      num_turns: 1,
      duration_ms: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  ]
}

/** A fake query: any prompt -> init -> assistant text ("reply to: <prompt>") -> result. */
function makePromptQuery(): QueryFn {
  return (({ prompt }: { prompt: string }) =>
    turn(happyMessages(`reply to: ${prompt}`))) as unknown as QueryFn
}

/**
 * A fake query that exercises a TOOL PERMISSION mid-turn: after init it invokes
 * the SDK-supplied canUseTool (our broker), awaits the client decision, then
 * streams the outcome. Drives the desk->glasses permission loop through the real
 * broker + SSE.
 */
function makePermissionQuery(): QueryFn {
  return ((args: {
    prompt: string
    options?: {
      canUseTool?: (t: string, i: Record<string, unknown>, o: unknown) => Promise<{ behavior: string }>
      abortController?: AbortController
    }
  }) => {
    const canUseTool = args.options?.canUseTool
    const signal = args.options?.abortController?.signal ?? new AbortController().signal
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: SESSION_ID }
      let outcome = 'no-gate'
      if (canUseTool) {
        const res = await canUseTool(
          'Write',
          { file_path: '/tmp/e2e-co-live.txt', content: 'hi' },
          { signal, toolUseID: 'tu-e2e-1', suggestions: [] },
        )
        outcome = res.behavior
      }
      const text = `tool decision: ${outcome}`
      yield { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } }
      yield { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } }
      yield { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }
      yield {
        type: 'result',
        subtype: 'success',
        session_id: SESSION_ID,
        result: text,
        total_cost_usd: 0,
        num_turns: 1,
        duration_ms: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
      }
    })()
  }) as unknown as QueryFn
}

/** A per-client event collector. */
function collector() {
  const events: CoLiveEvent[] = []
  return { events, onEvent: (e: CoLiveEvent) => void events.push(e) }
}

/** Poll `pred` until true or reject after `ms`. */
function waitUntil(pred: () => boolean, ms = 4000, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (pred()) return resolve()
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${label}`))
      setTimeout(tick, 10)
    }
    tick()
  })
}

const countType = (events: CoLiveEvent[], t: CoLiveEvent['type']): number =>
  events.filter((e) => e.type === t).length

describe('Phase 4.1 — e2e co-live loop (desk + glasses on one session)', () => {
  let server: http.Server | undefined
  let sseHub: SseHub | undefined
  const sockets = new Set<Socket>()
  const handles: Array<{ close(): void }> = []

  afterEach(async () => {
    for (const h of handles) h.close()
    handles.length = 0
    for (const s of sockets) s.destroy()
    sockets.clear()
    sseHub?.close()
    sseHub = undefined
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  /** Boot the real Core+Hub in-process with an injected fake query + fake store. */
  async function boot(query: QueryFn): Promise<{ baseUrl: string; token: string }> {
    const token = 'e2e-token'
    const config = resolveConfig({}, { port: 0, host: '127.0.0.1', token, projectDir: '/tmp' })
    const manager = new SessionManager({
      config: {
        model: config.model,
        permissionMode: config.permissionMode,
        settingSources: config.settingSources,
        projectDir: config.projectDir,
      },
      query,
    })
    sseHub = createSseHub()
    // Fake store: the desk's fetchTranscript hits this; no disk, no jsonl.
    const store = { listSessions: () => [], getTranscript: () => [] }
    const app = createApp({
      manager,
      sseHub,
      store: store as never,
      config: { token, model: config.model, projectDir: config.projectDir },
    })
    manager.subscribe(({ sessionId, event }) => sseHub!.broadcast(sessionId, event))
    server = http.createServer(app)
    server.on('connection', (s) => sockets.add(s))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return { baseUrl: `http://127.0.0.1:${port}`, token }
  }

  it(
    'desk kicks off, glasses responds free-form, BOTH see the identical event stream of ONE session',
    async () => {
      const { baseUrl, token } = await boot(makePromptQuery())
      const desk: HubClient = createHubClient({ baseUrl, token })
      const glasses: HubClient = createHubClient({ baseUrl, token })

      // 1) Desk kicks off a NEW session (no id); the Hub resolves the real id.
      const created = await desk.sendPrompt({ text: 'kick off at desk', cwd: '/tmp' })
      expect(created.sessionId).toBe(SESSION_ID)
      const sid = created.sessionId!

      // 2) BOTH clients attach to the same id with replay (so each sees turn 1).
      const A = collector()
      const B = collector()
      handles.push(desk.subscribe(sid, A.onEvent, { needReplay: true }))
      handles.push(glasses.subscribe(sid, B.onEvent, { needReplay: true }))
      await waitUntil(() => countType(A.events, 'result') >= 1, 4000, 'A sees turn 1')
      await waitUntil(() => countType(B.events, 'result') >= 1, 4000, 'B sees turn 1')

      // 3) Glasses dictates a free-form follow-up INTO THE SAME session.
      const resumed = await glasses.sendPrompt({ text: 'free-form from the glasses', sessionId: sid })
      expect(resumed.sessionId).toBe(SESSION_ID)

      // 4) Both clients converge on the SAME total stream (turn 1 + turn 2).
      await waitUntil(() => countType(A.events, 'result') >= 2, 4000, 'A sees turn 2')
      await waitUntil(() => countType(B.events, 'result') >= 2, 4000, 'B sees turn 2')
      await waitUntil(() => A.events.length === B.events.length, 4000, 'streams converge')

      // The glasses' free-form prompt is echoed to BOTH (co-live).
      const sawGlassesPrompt = (es: CoLiveEvent[]) =>
        es.some((e) => e.type === 'user_prompt' && e.text.includes('free-form from the glasses'))
      expect(sawGlassesPrompt(A.events)).toBe(true)
      expect(sawGlassesPrompt(B.events)).toBe(true)

      // The assistant reply to the glasses turn is visible to BOTH.
      const sawReply = (es: CoLiveEvent[]) =>
        es.some((e) => e.type === 'text_delta' && e.text.includes('free-form from the glasses'))
      expect(sawReply(A.events)).toBe(true)
      expect(sawReply(B.events)).toBe(true)

      // LIVE (not replay): turn 1 reached A/B via replay at subscribe time, but
      // turn 2 was initiated only AFTER both confirmed turn 1 (the >=1 waits), and
      // there is NO reconnect / second-replay path — so turn 2's frames reach A/B
      // ONLY via the live broadcast safeWrite. (If live fan-out were broken the
      // >=2 result waits above would have TIMED OUT.) Make it explicit via order:
      // turn 2's prompt is appended to the single ordered stream AFTER turn 1's
      // result — i.e. it arrived live, after the replayed prefix.
      const firstResultIdx = A.events.findIndex((e) => e.type === 'result')
      const glassesPromptIdx = A.events.findIndex(
        (e) => e.type === 'user_prompt' && e.text.includes('free-form from the glasses'),
      )
      expect(firstResultIdx).toBeGreaterThanOrEqual(0)
      expect(glassesPromptIdx).toBeGreaterThan(firstResultIdx)

      // Non-empty guard so the identical-stream assertion below cannot pass on two
      // empty arrays ([] === []).
      expect(A.events.length).toBeGreaterThan(0)

      // Strongest co-live proof: two independent clients receive byte-identical streams.
      expect(B.events).toEqual(A.events)

      // EXACTLY ONE session id across every result both clients saw.
      const ids = new Set(
        [...A.events, ...B.events]
          .filter((e): e is Extract<CoLiveEvent, { type: 'result' }> => e.type === 'result')
          .map((e) => e.sessionId),
      )
      expect([...ids]).toEqual([SESSION_ID])

      // Both clients agree on the single session's transcript endpoint.
      const tDesk = await desk.fetchTranscript(sid)
      const tGlasses = await glasses.fetchTranscript(sid)
      expect(tGlasses).toEqual(tDesk)
    },
    15000,
  )

  it(
    'desk-initiated tool permission is approved from the glasses; both see request + outcome',
    async () => {
      const { baseUrl, token } = await boot(makePermissionQuery())
      const desk: HubClient = createHubClient({ baseUrl, token })
      const glasses: HubClient = createHubClient({ baseUrl, token })

      // Desk kicks off; the turn blocks awaiting a tool permission (canUseTool).
      const created = await desk.sendPrompt({ text: 'do a thing that needs a tool', cwd: '/tmp' })
      expect(created.sessionId).toBe(SESSION_ID)
      const sid = created.sessionId!

      const A = collector()
      const B = collector()
      handles.push(desk.subscribe(sid, A.onEvent, { needReplay: true }))
      handles.push(glasses.subscribe(sid, B.onEvent, { needReplay: true }))

      // BOTH clients see the permission_request (the ring would render on the HUD).
      const permOf = (es: CoLiveEvent[]) =>
        es.find((e): e is Extract<CoLiveEvent, { type: 'permission_request' }> => e.type === 'permission_request')
      await waitUntil(() => permOf(A.events) !== undefined, 4000, 'A sees permission_request')
      await waitUntil(() => permOf(B.events) !== undefined, 4000, 'B sees permission_request')

      const reqA = permOf(A.events)!
      const reqB = permOf(B.events)!
      expect(reqA.toolName).toBe('Write')
      expect(reqA.toolUseId).toBeTruthy()
      // The broker propagated the SDK's EXACT toolUseID into the event (not a
      // freshly-minted id) — this is the id the client must echo back.
      expect(reqA.toolUseId).toBe('tu-e2e-1')
      // Both clients see the SAME pending tool-use id (the broker keys on it).
      expect(reqB.toolUseId).toBe(reqA.toolUseId)
      // The options are the {text,key} objects the Even app renders its ring from.
      expect(reqA.options).toEqual([
        { text: 'Yes', key: 'allow' },
        { text: 'No', key: 'deny' },
      ])

      // The GLASSES approves it, sending the explicit toolUseId from the event.
      await glasses.respondPermission(sid, 'allow', reqA.toolUseId)

      // The approval unblocks the turn; BOTH clients see the allow outcome + result.
      const sawAllowOutcome = (es: CoLiveEvent[]) =>
        es.some((e) => e.type === 'text_delta' && e.text.includes('tool decision: allow'))
      await waitUntil(() => sawAllowOutcome(A.events), 4000, 'A sees allow outcome')
      await waitUntil(() => sawAllowOutcome(B.events), 4000, 'B sees allow outcome')
      await waitUntil(() => countType(A.events, 'result') >= 1, 4000, 'A sees result')
      await waitUntil(() => countType(B.events, 'result') >= 1, 4000, 'B sees result')

      // Converge: both independent clients end with the identical stream.
      await waitUntil(() => A.events.length === B.events.length, 4000, 'streams converge')
      expect(B.events).toEqual(A.events)
    },
    15000,
  )

  it(
    'a DENY from the glasses propagates as deny (proves the decision CONTENT drives the outcome, not just its arrival)',
    async () => {
      // The mirror of the allow test: the SAME fake query streams "tool decision:
      // <behavior>", so a 'deny' outcome can ONLY appear if the broker resolved the
      // pending permission with the client's deny — not via auto-allow (Write is not
      // auto-allowed in 'default' mode) and not via the 60s timeout (which we never
      // wait for). This rules out "the broker always allows / the decision value is
      // ignored" — the allow-only test alone could not.
      const { baseUrl, token } = await boot(makePermissionQuery())
      const desk: HubClient = createHubClient({ baseUrl, token })
      const glasses: HubClient = createHubClient({ baseUrl, token })

      const created = await desk.sendPrompt({ text: 'do a thing that needs a tool', cwd: '/tmp' })
      const sid = created.sessionId!

      const A = collector()
      const B = collector()
      handles.push(desk.subscribe(sid, A.onEvent, { needReplay: true }))
      handles.push(glasses.subscribe(sid, B.onEvent, { needReplay: true }))

      const permOf = (es: CoLiveEvent[]) =>
        es.find((e): e is Extract<CoLiveEvent, { type: 'permission_request' }> => e.type === 'permission_request')
      await waitUntil(() => permOf(A.events) !== undefined, 4000, 'A sees permission_request')
      const reqA = permOf(A.events)!

      // The GLASSES DENIES (sending the explicit toolUseId from the event).
      await glasses.respondPermission(sid, 'deny', reqA.toolUseId)

      // BOTH clients see the DENY outcome (not allow) — the decision content flowed.
      const sawDenyOutcome = (es: CoLiveEvent[]) =>
        es.some((e) => e.type === 'text_delta' && e.text.includes('tool decision: deny'))
      await waitUntil(() => sawDenyOutcome(A.events), 4000, 'A sees deny outcome')
      await waitUntil(() => sawDenyOutcome(B.events), 4000, 'B sees deny outcome')
      // And NEITHER client ever saw an allow outcome for this turn.
      const sawAllow = (es: CoLiveEvent[]) =>
        es.some((e) => e.type === 'text_delta' && e.text.includes('tool decision: allow'))
      expect(sawAllow(A.events)).toBe(false)
      expect(sawAllow(B.events)).toBe(false)

      await waitUntil(() => countType(A.events, 'result') >= 1, 4000, 'A sees result')
      await waitUntil(() => A.events.length === B.events.length, 4000, 'streams converge')
      expect(A.events.length).toBeGreaterThan(0)
      expect(B.events).toEqual(A.events)
    },
    15000,
  )
})
