import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Response } from 'express'
import type { CoLiveEvent } from '../../src/core/events'
import { createSseHub, formatFrame, type Clock } from '../../src/hub/sse'

/**
 * A minimal stub of the Express Response surface the SseHub touches. It records
 * every chunk written so tests can assert the exact bytes on the wire, and lets
 * tests simulate a write that throws (a dead client) and a "close" event.
 */
interface FakeRes {
  res: Response
  writes: string[]
  headers: Record<string, string>
  statusCode: number
  fail: boolean
  emitClose: () => void
}

function makeFakeRes(): FakeRes {
  const writes: string[] = []
  const headers: Record<string, string> = {}
  let closeHandler: (() => void) | undefined
  const state = { fail: false, statusCode: 0 }
  const res = {
    write(chunk: string): boolean {
      if (state.fail) throw new Error('dead client')
      writes.push(chunk)
      return true
    },
    setHeader(name: string, value: string): void {
      headers[name.toLowerCase()] = value
    },
    flushHeaders(): void {},
    writeHead(code: number): unknown {
      state.statusCode = code
      return res
    },
    on(event: string, handler: () => void): unknown {
      if (event === 'close') closeHandler = handler
      return res
    },
    end(): void {},
  } as unknown as Response
  return {
    res,
    writes,
    headers,
    get statusCode() {
      return state.statusCode
    },
    set fail(v: boolean) {
      state.fail = v
    },
    get fail() {
      return state.fail
    },
    emitClose() {
      closeHandler?.()
    },
  }
}

/** A controllable clock: tests fire the heartbeat by hand, no wall-clock wait. */
function makeFakeClock(): Clock & { tick: () => void; pending: number } {
  const fns = new Set<() => void>()
  return {
    setInterval(fn: () => void): unknown {
      fns.add(fn)
      return fn
    },
    clearInterval(handle: unknown): void {
      fns.delete(handle as () => void)
    },
    tick() {
      for (const fn of [...fns]) fn()
    },
    get pending() {
      return fns.size
    },
  }
}

const ev = (text: string): CoLiveEvent => ({ type: 'text_delta', text })

describe('formatFrame (pure)', () => {
  it('formats an SSE frame as "id: N\\ndata: <json>\\n\\n"', () => {
    const frame = formatFrame(7, ev('hi'))
    expect(frame).toBe('id: 7\ndata: {"type":"text_delta","text":"hi"}\n\n')
  })
})

describe('SseHub ring buffer + ids', () => {
  it('assigns a per-session monotonic id starting at 1', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    const c = makeFakeRes()
    hub.subscribe('s1', c.res, { needReplay: false })
    c.writes.length = 0 // drop the ":ok" preamble
    hub.broadcast('s1', ev('a'))
    hub.broadcast('s1', ev('b'))
    expect(c.writes[0]).toBe('id: 1\ndata: {"type":"text_delta","text":"a"}\n\n')
    expect(c.writes[1]).toBe('id: 2\ndata: {"type":"text_delta","text":"b"}\n\n')
  })

  it('keeps ids independent per session', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    const a = makeFakeRes()
    const b = makeFakeRes()
    hub.subscribe('s1', a.res, { needReplay: false })
    hub.subscribe('s2', b.res, { needReplay: false })
    a.writes.length = 0
    b.writes.length = 0
    hub.broadcast('s1', ev('x'))
    hub.broadcast('s2', ev('y'))
    expect(a.writes[0]).toContain('id: 1\n')
    expect(b.writes[0]).toContain('id: 1\n')
  })

  it('caps the ring buffer at 500 and replays only the last 500', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    for (let i = 0; i < 600; i++) hub.broadcast('s1', ev(`n${i}`))
    const late = makeFakeRes()
    hub.subscribe('s1', late.res, { needReplay: true })
    const frames = late.writes.filter((w) => w.startsWith('id:'))
    expect(frames.length).toBe(500)
    // First replayed frame should be id 101 (frames 1..100 evicted).
    expect(frames[0]).toBe('id: 101\ndata: {"type":"text_delta","text":"n100"}\n\n')
    expect(frames[499]).toBe('id: 600\ndata: {"type":"text_delta","text":"n599"}\n\n')
  })

  it('replays buffered frames when needReplay is true, none when false', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    hub.broadcast('s1', ev('buffered'))
    const noReplay = makeFakeRes()
    hub.subscribe('s1', noReplay.res, { needReplay: false })
    expect(noReplay.writes.filter((w) => w.startsWith('id:')).length).toBe(0)
    const withReplay = makeFakeRes()
    hub.subscribe('s1', withReplay.res, { needReplay: true })
    expect(withReplay.writes.filter((w) => w.startsWith('id:'))).toEqual([
      'id: 1\ndata: {"type":"text_delta","text":"buffered"}\n\n',
    ])
  })
})

describe('SseHub subscribe', () => {
  it('writes the ":ok" preamble and SSE headers', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    const c = makeFakeRes()
    hub.subscribe('s1', c.res, { needReplay: false })
    expect(c.writes[0]).toBe(':ok\n\n')
    expect(c.headers['content-type']).toBe('text/event-stream')
    expect(c.headers['cache-control']).toContain('no-cache')
    expect(c.headers['connection']).toBe('keep-alive')
  })
})

describe('SseHub broadcast safety', () => {
  it('is a no-op for an unknown session id', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    expect(() => hub.broadcast('nobody', ev('x'))).not.toThrow()
  })

  it('is a no-op (no throw) for an empty session id', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    expect(() => hub.broadcast('', ev('x'))).not.toThrow()
  })

  it('drops a client whose write throws and keeps delivering to others', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    const good = makeFakeRes()
    const bad = makeFakeRes()
    hub.subscribe('s1', good.res, { needReplay: false })
    hub.subscribe('s1', bad.res, { needReplay: false })
    good.writes.length = 0
    bad.writes.length = 0
    bad.fail = true
    expect(() => hub.broadcast('s1', ev('a'))).not.toThrow()
    expect(good.writes.length).toBe(1)
    // bad got dropped; a second broadcast must not even attempt it.
    bad.fail = false
    hub.broadcast('s1', ev('b'))
    expect(bad.writes.length).toBe(0)
    expect(good.writes.length).toBe(2)
  })

  it('removes a client on its res "close" event', () => {
    const hub = createSseHub({ clock: makeFakeClock() })
    const c = makeFakeRes()
    hub.subscribe('s1', c.res, { needReplay: false })
    c.writes.length = 0
    c.emitClose()
    hub.broadcast('s1', ev('a'))
    expect(c.writes.length).toBe(0)
  })
})

describe('SseHub heartbeat', () => {
  it('writes ":heartbeat" to each client when the clock fires', () => {
    const clock = makeFakeClock()
    const hub = createSseHub({ clock })
    const c = makeFakeRes()
    hub.subscribe('s1', c.res, { needReplay: false })
    c.writes.length = 0
    clock.tick()
    expect(c.writes).toContain(':heartbeat\n\n')
  })

  it('stops the heartbeat timer when the hub closes', () => {
    const clock = makeFakeClock()
    const hub = createSseHub({ clock })
    hub.subscribe('s1', makeFakeRes().res, { needReplay: false })
    expect(clock.pending).toBeGreaterThan(0)
    hub.close()
    expect(clock.pending).toBe(0)
  })
})

describe('SseHub integration (real http server)', () => {
  let server: http.Server | undefined
  const sockets = new Set<import('node:net').Socket>()

  afterEach(async () => {
    for (const s of sockets) s.destroy()
    sockets.clear()
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()))
      server = undefined
    }
  })

  it(
    'delivers :ok then a live frame, and replays buffered frames on reconnect',
    async () => {
      const hub = createSseHub({ clock: makeFakeClock() })
      server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const needReplay = url.searchParams.get('needReplay') === 'true'
        hub.subscribe('sX', res as unknown as Response, { needReplay })
      })
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port

      // First client: read :ok + one live frame, then close.
      const first = await new Promise<{ text: string; close: () => void }>(
        (resolve, reject) => {
          const req = http.get(
            { host: '127.0.0.1', port, path: '/api/events?sessionId=sX' },
            (res) => {
              res.setEncoding('utf8')
              let buf = ''
              res.on('data', (chunk: string) => {
                buf += chunk
                // Once we have the preamble, push a live frame from the hub.
                if (buf.includes(':ok') && !buf.includes('id: 1')) {
                  hub.broadcast('sX', ev('live'))
                }
                if (buf.includes('id: 1')) {
                  resolve({
                    text: buf,
                    close: () => {
                      req.destroy()
                      res.destroy()
                    },
                  })
                }
              })
              res.on('error', () => {})
            },
          )
          req.on('socket', (s) => sockets.add(s))
          req.on('error', reject)
        },
      )
      expect(first.text).toContain(':ok')
      expect(first.text).toContain('id: 1\ndata: {"type":"text_delta","text":"live"}\n\n')
      first.close()

      // Second client with needReplay=true: must replay the buffered frame.
      const second = await new Promise<{ text: string; close: () => void }>(
        (resolve, reject) => {
          const req = http.get(
            { host: '127.0.0.1', port, path: '/api/events?sessionId=sX&needReplay=true' },
            (res) => {
              res.setEncoding('utf8')
              let buf = ''
              res.on('data', (chunk: string) => {
                buf += chunk
                if (buf.includes('id: 1')) {
                  resolve({
                    text: buf,
                    close: () => {
                      req.destroy()
                      res.destroy()
                    },
                  })
                }
              })
              res.on('error', () => {})
            },
          )
          req.on('socket', (s) => sockets.add(s))
          req.on('error', reject)
        },
      )
      expect(second.text).toContain(':ok')
      expect(second.text).toContain('id: 1\ndata: {"type":"text_delta","text":"live"}\n\n')
      second.close()
      hub.close()
    },
    5000,
  )
})
