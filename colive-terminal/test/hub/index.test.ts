/**
 * CLI entry (Task 2.3) tests.
 *
 * Two layers:
 *  (a) parseServeArgs — a PURE arg parser. We assert it maps the public flags
 *      (--model / --permission-mode / --host / --port / --project-dir) into a
 *      ConfigArgs the way resolveConfig expects (port coerced to a number).
 *  (b) a real boot test: runServe() on an ephemeral port (port 0), then GET
 *      /api/info over a real socket WITH the token and assert 200 + shape, then
 *      close. No model call (no /api/prompt).
 *
 * The module must be importable WITHOUT side effects (no server started just by
 * importing it), so these imports themselves prove the entrypoint guard works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  parseServeArgs,
  runServe,
  parseDeskArgs,
  buildDeskClient,
  runDesk,
  type RenderFn,
} from '../../src/index'
import type { RunningServer } from '../../src/hub/server'

describe('parseServeArgs (pure)', () => {
  it('returns an empty ConfigArgs when no flags are given', () => {
    expect(parseServeArgs([])).toEqual({})
  })

  it('maps --model into ConfigArgs.model', () => {
    expect(parseServeArgs(['--model', 'claude-x']).model).toBe('claude-x')
  })

  it('maps --permission-mode into ConfigArgs.permissionMode', () => {
    expect(parseServeArgs(['--permission-mode', 'acceptEdits']).permissionMode).toBe('acceptEdits')
  })

  it('maps --host into ConfigArgs.host', () => {
    expect(parseServeArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0')
  })

  it('maps --port into ConfigArgs.port as a NUMBER', () => {
    const args = parseServeArgs(['--port', '4567'])
    expect(args.port).toBe(4567)
    expect(typeof args.port).toBe('number')
  })

  it('maps --project-dir into ConfigArgs.projectDir', () => {
    expect(parseServeArgs(['--project-dir', '/tmp/foo']).projectDir).toBe('/tmp/foo')
  })

  it('maps all flags together, leaving unset keys undefined', () => {
    const args = parseServeArgs([
      '--model', 'm',
      '--permission-mode', 'plan',
      '--host', 'h',
      '--port', '10',
      '--project-dir', '/d',
    ])
    expect(args).toEqual({
      model: 'm',
      permissionMode: 'plan',
      host: 'h',
      port: 10,
      projectDir: '/d',
    })
  })

  it('supports --flag=value form', () => {
    expect(parseServeArgs(['--port=8080']).port).toBe(8080)
  })

  it('throws on a non-numeric --port', () => {
    expect(() => parseServeArgs(['--port', 'abc'])).toThrow()
  })
})

describe('runServe (real http boot, bounded)', () => {
  let running: RunningServer | undefined
  // Silence the startup banner/QR so test output stays clean.
  vi.spyOn(console, 'log').mockImplementation(() => {})

  afterEach(async () => {
    if (running) {
      await running.close()
      running = undefined
    }
  })

  it(
    'boots on an ephemeral port and serves an authed /api/info, then closes',
    async () => {
      running = await runServe(
        ['--port', '0', '--project-dir', realpathSync(tmpdir())],
        // Inject a deterministic token via env so the test does not depend on
        // (or leak) a randomly generated one.
        { BRIDGE_TOKEN: 'tok-cli' },
      )
      expect(running.port).toBeGreaterThan(0)

      const body = await getJson(running.port, '/api/info', 'tok-cli')
      expect(body.provider).toBe('claude')
      expect(typeof body.model).toBe('string')
      expect(body.version).toBe('0.1.0')

      const status = await getStatus(running.port, '/api/info') // no token
      expect(status).toBe(401)
    },
    8000,
  )
})

/** GET JSON from the loopback server with a bearer token. */
function getJson(port: number, path: string, token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (buf += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
  })
}

/** GET only the status code (used for the no-token 401 check). */
function getStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
  })
}

describe('parseDeskArgs (pure)', () => {
  it('maps every desk flag, coercing --port to a number', () => {
    const args = parseDeskArgs([
      '--host', '10.0.0.5',
      '--port', '9000',
      '--token', 'abc123',
      '--session', 's-7',
    ])
    expect(args).toEqual({ host: '10.0.0.5', port: 9000, token: 'abc123', session: 's-7' })
    expect(typeof args.port).toBe('number')
  })

  it('leaves unset flags undefined so env/defaults can apply', () => {
    expect(parseDeskArgs([])).toEqual({})
  })

  it('throws on a non-numeric --port', () => {
    expect(() => parseDeskArgs(['--port', 'nope'])).toThrow(/Invalid --port/)
  })
})

describe('buildDeskClient (args > env > defaults)', () => {
  it('resolves baseUrl + token + session from args over env', () => {
    const conn = buildDeskClient(
      { host: '1.2.3.4', port: 8080, token: 'argtok', session: 'sid-1' },
      { HOST: '9.9.9.9', PORT: '1111', BRIDGE_TOKEN: 'envtok' },
    )
    expect(conn).toEqual({ baseUrl: 'http://1.2.3.4:8080', token: 'argtok', sessionId: 'sid-1' })
  })

  it('falls back to env, then to the M0 host/port defaults', () => {
    const conn = buildDeskClient({}, { BRIDGE_TOKEN: 'envtok' })
    expect(conn.baseUrl).toBe('http://127.0.0.1:3456')
    expect(conn.token).toBe('envtok')
    expect(conn.sessionId).toBeUndefined()
  })

  it('throws a clear error when no token is supplied (desk must present the Hub token)', () => {
    expect(() => buildDeskClient({}, {})).toThrow(/token/i)
  })
})

describe('runDesk (injected renderer — no real TTY)', () => {
  it('builds a client and renders <App> with the resolved client + sessionId', () => {
    const rendered: Array<{ clientPresent: boolean; sessionId: unknown }> = []
    const fakeRender: RenderFn = (element) => {
      const props = (element as { props: { client?: unknown; sessionId?: unknown } }).props
      rendered.push({ clientPresent: props.client !== undefined, sessionId: props.sessionId })
      return { unmount() {}, waitUntilExit: () => Promise.resolve() }
    }
    runDesk(['--session', 's-42'], { BRIDGE_TOKEN: 'tok' }, fakeRender)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]?.clientPresent).toBe(true)
    expect(rendered[0]?.sessionId).toBe('s-42')
  })

  it('throws (no silent no-op) when no token is available', () => {
    const fakeRender: RenderFn = () => ({ unmount() {}, waitUntilExit: () => Promise.resolve() })
    expect(() => runDesk([], {}, fakeRender)).toThrow(/token/i)
  })
})
