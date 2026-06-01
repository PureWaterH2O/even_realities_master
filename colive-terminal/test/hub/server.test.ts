import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildQrPayload, startServer, type RunningServer } from '../../src/hub/server'
import type { ResolvedConfig } from '../../src/core/config'

describe('buildQrPayload (🧪 verified Even-app connect URL)', () => {
  it('emits the exact even-terminal connect URL: http://host:port?token=…&defaultProvider=claude', () => {
    const payload = buildQrPayload({ host: '127.0.0.1', port: 4321, token: 'abc' })
    expect(payload).toBe('http://127.0.0.1:4321?token=abc&defaultProvider=claude')
  })

  it('uses advertiseHost instead of host when provided', () => {
    const payload = buildQrPayload({
      host: '0.0.0.0',
      port: 3456,
      token: 'tok',
      advertiseHost: 'my-mac.tailnet.ts.net',
    })
    expect(payload).toBe('http://my-mac.tailnet.ts.net:3456?token=tok&defaultProvider=claude')
  })

  it('uses host when advertiseHost is not provided', () => {
    const payload = buildQrPayload({ host: '192.168.1.5', port: 3456, token: 'tok' })
    expect(payload).toBe('http://192.168.1.5:3456?token=tok&defaultProvider=claude')
  })
})

describe('startServer (real http, bounded)', () => {
  let running: RunningServer | undefined
  // Silence the banner/QR so test output stays clean.
  vi.spyOn(console, 'log').mockImplementation(() => {})

  afterEach(async () => {
    if (running) {
      await running.close()
      running = undefined
    }
  })

  it(
    'binds, serves an authed /api/info over a real socket, then closes',
    async () => {
      const config: ResolvedConfig = {
        model: 'claude-opus-4-8',
        permissionMode: 'default',
        settingSources: [],
        host: '127.0.0.1',
        port: 0, // ephemeral
        token: 'tok-int',
        projectDir: realpathSync(tmpdir()),
      }
      running = await startServer(config)
      expect(running.port).toBeGreaterThan(0)

      const body = await getJson(running.port, '/api/info', 'tok-int')
      expect(body.provider).toBe('claude')
      expect(body.model).toBe('claude-opus-4-8')

      const status = await getStatus(running.port, '/api/info') // no token
      expect(status).toBe(401)
    },
    8000,
  )
})

/** GET JSON from the loopback server with a bearer token; reject on non-2xx. */
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
      res.resume() // drain
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
  })
}
