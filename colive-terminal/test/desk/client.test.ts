/**
 * Desk Hub client (Task 3.1) tests.
 *
 * The desk client is JUST ANOTHER CLIENT of the already-built Hub: it speaks the
 * HTTP + SSE protocol and nothing else (no SDK, no model). These tests drive it
 * two ways:
 *
 *  (a) a tiny REAL node http server on port 0 (stub Hub) for the streaming SSE
 *      path — we write the ":ok" preamble + real `id: N\ndata: <json>\n\n`
 *      frames and assert subscribe() parses them into CoLiveEvents; we also split
 *      one frame across two socket writes to prove partial-frame buffering. Every
 *      such test ALWAYS closes the subscription AND the server (afterEach) with an
 *      explicit short timeout — an open SSE connection hangs vitest forever.
 *
 *  (b) an INJECTED fake fetch for the request/response POST+GET endpoints — we
 *      record the URL, method, headers and body and assert the exact wire shape
 *      (auth header, paths, bodies incl. toolUseId) and that sendPrompt reads the
 *      202 body's sessionId and fetchTranscript returns the transcript array.
 */
import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import type { CoLiveEvent } from '../../src/core/events'
import { createHubClient, type HubClient } from '../../src/desk/client'

const TOKEN = 'desk-token'

/** A recorded fetch call (for the injected-fake assertions). */
interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/**
 * Build an injected fetch that records each call and returns a canned response.
 * `responder` maps a parsed URL path to the JSON body + status to return.
 */
function makeFakeFetch(
  responder: (path: string, call: RecordedCall) => { status: number; json: unknown },
) {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const headers: Record<string, string> = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v
      }
    }
    const rawBody = init?.body
    const body =
      typeof rawBody === 'string' && rawBody.length > 0 ? JSON.parse(rawBody) : undefined
    const call: RecordedCall = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body,
    }
    calls.push(call)
    const path = new URL(url).pathname
    const { status, json } = responder(path, call)
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('createHubClient — request/response endpoints (injected fetch)', () => {
  it('sendPrompt POSTs {text} with bearer auth and returns the resolved sessionId', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({
      status: 202,
      json: { ok: true, sessionId: 'new-session-id', provider: 'claude' },
    }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    const result = await client.sendPrompt({ text: 'hello' })

    expect(result).toEqual({ sessionId: 'new-session-id' })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(new URL(calls[0].url).pathname).toBe('/api/prompt')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].headers['content-type']).toContain('application/json')
    expect(calls[0].body).toEqual({ text: 'hello' })
  })

  it('sendPrompt forwards sessionId and cwd when provided', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({
      status: 202,
      json: { ok: true, sessionId: 'existing', provider: 'claude' },
    }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    await client.sendPrompt({ text: 'again', sessionId: 'existing', cwd: '/work' })

    expect(calls[0].body).toEqual({ text: 'again', sessionId: 'existing', cwd: '/work' })
  })

  it('respondPermission POSTs {sessionId, decision, toolUseId}', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { ok: true } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    await client.respondPermission('sess-1', 'allow', 'tool-use-1')

    expect(calls[0].method).toBe('POST')
    expect(new URL(calls[0].url).pathname).toBe('/api/permission-response')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].body).toEqual({
      sessionId: 'sess-1',
      decision: 'allow',
      toolUseId: 'tool-use-1',
    })
  })

  it('respondQuestion POSTs {sessionId, answer, toolUseId}', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { ok: true } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    await client.respondQuestion('sess-2', 'Option A', 'tool-use-2')

    expect(calls[0].method).toBe('POST')
    expect(new URL(calls[0].url).pathname).toBe('/api/question-response')
    expect(calls[0].body).toEqual({
      sessionId: 'sess-2',
      answer: 'Option A',
      toolUseId: 'tool-use-2',
    })
  })

  it('interrupt POSTs {sessionId}', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { ok: true } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    await client.interrupt('sess-3')

    expect(calls[0].method).toBe('POST')
    expect(new URL(calls[0].url).pathname).toBe('/api/interrupt')
    expect(calls[0].body).toEqual({ sessionId: 'sess-3' })
  })

  it('fetchTranscript GETs /api/sessions/:id/transcript and returns the array', async () => {
    const transcript = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello there' },
    ]
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { transcript } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    const result = await client.fetchTranscript('sess-4')

    expect(result).toEqual(transcript)
    expect(calls[0].method).toBe('GET')
    expect(new URL(calls[0].url).pathname).toBe('/api/sessions/sess-4/transcript')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('throws on a non-2xx response (with status in the message)', async () => {
    const { fetchImpl } = makeFakeFetch(() => ({ status: 401, json: { error: 'unauthorized' } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })

    await expect(client.interrupt('sess-x')).rejects.toThrow(/401/)
  })
})

describe('createHubClient — setControl + getInfo (injected fetch)', () => {
  it('setControl POSTs /api/control with the action + value (bearer auth)', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 202, json: { ok: true } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })
    await client.setControl('s1', 'setMode', 'plan')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(new URL(calls[0].url).pathname).toBe('/api/control')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].body).toEqual({ sessionId: 's1', action: 'setMode', value: 'plan' })
  })

  it('getInfo GETs /api/info and returns the model', async () => {
    const { fetchImpl, calls } = makeFakeFetch(() => ({ status: 200, json: { model: 'claude-opus-4-8', version: '1', provider: 'claude' } }))
    const client = createHubClient({ baseUrl: 'http://hub.local', token: TOKEN, fetch: fetchImpl })
    const info = await client.getInfo()
    expect(info.model).toBe('claude-opus-4-8')
    expect(calls[0].method).toBe('GET')
    expect(new URL(calls[0].url).pathname).toBe('/api/info')
    expect(calls[0].headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })
})

describe('createHubClient — subscribe (real stub Hub on port 0)', () => {
  let server: http.Server | undefined
  let close: (() => void) | undefined
  const sockets = new Set<Socket>()

  afterEach(async () => {
    close?.()
    close = undefined
    for (const s of sockets) s.destroy()
    sockets.clear()
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  /** Stand up a stub Hub whose /api/events handler is driven by `onConnect`. */
  async function startStubHub(
    onConnect: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): Promise<string> {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.write(':ok\n\n')
      onConnect(req, res)
    })
    server.on('connection', (s) => sockets.add(s))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return `http://127.0.0.1:${port}`
  }

  function frame(id: number, event: CoLiveEvent): string {
    return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`
  }

  it(
    'parses each SSE data frame into a CoLiveEvent and passes the URL ?token & ?sessionId',
    async () => {
      let capturedUrl = ''
      const baseUrl = await startStubHub((req, res) => {
        capturedUrl = req.url ?? ''
        res.write(frame(1, { type: 'status', state: 'busy' }))
        res.write(frame(2, { type: 'text_delta', text: 'hi there' }))
      })
      const client = createHubClient({ baseUrl, token: TOKEN })

      const received: CoLiveEvent[] = []
      const handle = await new Promise<ReturnType<HubClient['subscribe']>>((resolve) => {
        const h = client.subscribe('sess-A', (ev) => {
          received.push(ev)
          if (received.length === 2) resolve(h)
        })
      })
      close = () => handle.close()

      expect(received).toEqual([
        { type: 'status', state: 'busy' },
        { type: 'text_delta', text: 'hi there' },
      ])
      const u = new URL(capturedUrl, baseUrl)
      expect(u.pathname).toBe('/api/events')
      expect(u.searchParams.get('sessionId')).toBe('sess-A')
      expect(u.searchParams.get('token')).toBe(TOKEN)
    },
    5000,
  )

  it(
    'reassembles a frame split across two socket writes (partial-frame buffering)',
    async () => {
      const full = frame(1, { type: 'text_delta', text: 'split across writes' })
      const cut = Math.floor(full.length / 2)
      const baseUrl = await startStubHub((_req, res) => {
        res.write(full.slice(0, cut))
        // Second half arrives later so it is a separate read chunk.
        setTimeout(() => res.write(full.slice(cut)), 10)
      })
      const client = createHubClient({ baseUrl, token: TOKEN })

      const received: CoLiveEvent[] = []
      const handle = await new Promise<ReturnType<HubClient['subscribe']>>((resolve) => {
        const h = client.subscribe('sess-B', (ev) => {
          received.push(ev)
          resolve(h)
        })
      })
      close = () => handle.close()

      expect(received).toEqual([{ type: 'text_delta', text: 'split across writes' }])
    },
    5000,
  )

  it(
    'sends ?needReplay=true when opts.needReplay is set',
    async () => {
      let capturedUrl = ''
      const baseUrl = await startStubHub((req, res) => {
        capturedUrl = req.url ?? ''
        res.write(frame(1, { type: 'status', state: 'idle' }))
      })
      const client = createHubClient({ baseUrl, token: TOKEN })

      const handle = await new Promise<ReturnType<HubClient['subscribe']>>((resolve) => {
        const h = client.subscribe('sess-C', () => resolve(h), { needReplay: true })
      })
      close = () => handle.close()

      const u = new URL(capturedUrl, baseUrl)
      expect(u.searchParams.get('needReplay')).toBe('true')
    },
    5000,
  )

  it(
    'close() aborts the stream without throwing out of the read loop',
    async () => {
      const baseUrl = await startStubHub((_req, res) => {
        res.write(frame(1, { type: 'status', state: 'busy' }))
        // keep the connection open (no end) so only an abort closes it
      })
      const client = createHubClient({ baseUrl, token: TOKEN })

      const handle = await new Promise<ReturnType<HubClient['subscribe']>>((resolve) => {
        const h = client.subscribe('sess-D', () => resolve(h))
      })
      // The handle is callable AND exposes .close(); both must abort cleanly.
      expect(() => handle()).not.toThrow()
      // close() is idempotent — a second call (and the .close() form) is safe too.
      expect(() => handle.close()).not.toThrow()
      // No close handle to run in afterEach (already closed).
    },
    5000,
  )

  it(
    'delivers no events after close() even if the transport ignores abort',
    async () => {
      // Reviewer-found invariant (3.1 quality): close() must be self-sufficient —
      // an event arriving after close() must NOT reach onEvent, even when the
      // transport does not honour AbortController. Guards the Phase-4 case where
      // the TUI tears down / re-subscribes on a session change and a late in-flight
      // chunk must not fire onEvent after the UI state is gone.
      const enc = new TextEncoder()
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
      })
      // A fake fetch that IGNORES the abort signal and streams what we drive.
      const ignoreAbortFetch = (async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })) as unknown as typeof fetch

      const client = createHubClient({
        baseUrl: 'http://hub.test',
        token: TOKEN,
        fetch: ignoreAbortFetch,
      })
      const seen: CoLiveEvent[] = []
      const handle = await new Promise<ReturnType<HubClient['subscribe']>>((resolve) => {
        const h = client.subscribe('s-late', (ev) => {
          seen.push(ev)
          resolve(h)
        })
        controller.enqueue(
          enc.encode(`id: 1\ndata: ${JSON.stringify({ type: 'status', state: 'busy' })}\n\n`),
        )
      })

      handle.close()
      // Pushed strictly AFTER close(): must be dropped, not delivered.
      controller.enqueue(
        enc.encode(`id: 2\ndata: ${JSON.stringify({ type: 'text_delta', text: 'late' })}\n\n`),
      )
      await new Promise((r) => setTimeout(r, 30))

      expect(seen).toEqual([{ type: 'status', state: 'busy' }])
      try {
        controller.close()
      } catch {
        // stream may already be cancelled by the read loop — ignore
      }
    },
    5000,
  )
})
