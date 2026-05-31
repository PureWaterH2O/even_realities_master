/**
 * The Client Hub server assembly (Task 2.2).
 *
 * Two entry points:
 *
 *   - {@link createApp}: builds the configured Express app from INJECTED deps
 *     (manager, sseHub, store, config) and returns it WITHOUT listening, so
 *     supertest can drive it against fakes — no real model, server, or socket.
 *     It also subscribes the {@link PendingTracker} to the manager fan-out (the
 *     same fan-out the SSE hub consumes) so a sessionId-only permission/question
 *     response can be mapped to the latest pending toolUseId (integration note 1).
 *
 *   - {@link startServer}: the production wiring — builds a real SessionManager +
 *     SseHub + store facade, bridges `manager.subscribe -> sseHub.broadcast`,
 *     listens on config.host:config.port, and prints a startup banner + a
 *     connection QR (plus the raw host/port/token as a manual-entry fallback).
 *
 * The QR payload format is UNVERIFIED (hardware acceptance will confirm) and is
 * isolated in {@link buildQrPayload} so it's a one-line change once the real
 * format is known.
 */
import express, { type Express } from 'express'
import qrcode from 'qrcode-terminal'
import type { ResolvedConfig } from '../core/config'
import { SessionManager } from '../core/sessionManager'
import { listSessions, getTranscript } from '../core/store'
import { createSseHub, type SseHub } from './sse'
import { mountRoutes, type ManagerFacade, type StoreFacade, type RoutesConfig } from './routes'

/** Everything {@link createApp} needs — all injected so tests pass fakes. */
export interface AppDeps {
  manager: ManagerFacade
  sseHub: SseHub
  store: StoreFacade
  config: RoutesConfig
}

/**
 * Build the configured Express app: JSON body parsing, the authenticated /api
 * router, and the manager-fanout -> PendingTracker subscription. Does NOT call
 * listen — the caller (startServer / a test) owns the lifecycle.
 */
export function createApp(deps: AppDeps): Express {
  const app = express()
  app.use(express.json())

  const { router, pending } = mountRoutes(deps)

  // Feed the toolUseId tracker from the SAME fan-out the SSE hub consumes. This
  // must never throw (the manager fan-out has no per-subscriber try/catch), and
  // it tolerates the empty session key a slash-rejected prompt produces.
  deps.manager.subscribe(({ sessionId, event }) => {
    try {
      pending.observe(sessionId, event)
    } catch {
      // A tracking failure must never break the fan-out for the SSE hub.
    }
  })

  app.use('/api', router)
  return app
}

/**
 * The connection QR payload. 🧪 VERIFIED format — the Even app expects the exact
 * connect URL the stock `even-terminal` bridge emits (its `common.js` builds it
 * with `URLSearchParams({ token, defaultProvider })`; our 2026-05-30 live probe
 * confirmed `http://<host>:<port>?token=<token>&defaultProvider=claude`). Kept
 * here, alone, so the one app-facing format lives in one place.
 */
export function buildQrPayload(config: { host: string; port: number; token: string }): string {
  return `http://${config.host}:${config.port}?token=${config.token}&defaultProvider=claude`
}

/** Print the startup banner, the QR, and the manual-entry fallback. */
function printStartupBanner(config: ResolvedConfig, boundPort: number): void {
  const payload = buildQrPayload({ host: config.host, port: boundPort, token: config.token })
  // eslint-disable-next-line no-console
  console.log('\nCo-Live Terminal — Client Hub')
  console.log(`  listening   http://${config.host}:${boundPort}`)
  console.log(`  model       ${config.model}`)
  console.log('\nScan to connect:')
  qrcode.generate(payload, { small: true }, (qr) => console.log(qr))
  console.log('Or enter manually:')
  console.log(`  host   ${config.host}`)
  console.log(`  port   ${boundPort}`)
  console.log(`  token  ${config.token}\n`)
}

/** A running server handle (so callers/tests can shut it down). */
export interface RunningServer {
  /** The actually-bound port (resolves an ephemeral `port: 0` to the real one). */
  port: number
  close(): Promise<void>
}

/**
 * Production entry point: build the real Core + Hub, wire the fan-out into the
 * SSE hub, listen, and print the banner. Returns a handle that closes both the
 * HTTP server and the SSE hub's heartbeat timer.
 */
export function startServer(config: ResolvedConfig): Promise<RunningServer> {
  const manager = new SessionManager({
    config: {
      model: config.model,
      permissionMode: config.permissionMode,
      settingSources: config.settingSources,
      projectDir: config.projectDir,
    },
  })
  const sseHub = createSseHub()

  // The store facade adapts the module-level core functions to the injected shape.
  const store: StoreFacade = {
    listSessions: (opts) => listSessions(opts),
    getTranscript: (id, opts) => getTranscript(id, opts),
  }

  const routesConfig: RoutesConfig = {
    token: config.token,
    model: config.model,
    projectDir: config.projectDir,
  }

  const app = createApp({ manager, sseHub, store, config: routesConfig })

  // Bridge the Core fan-out into the SSE transport. The hub's broadcast never
  // throws and tolerates the empty session key, so this subscriber is safe.
  manager.subscribe(({ sessionId, event }) => sseHub.broadcast(sessionId, event))

  return new Promise<RunningServer>((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      const address = server.address()
      const boundPort =
        address !== null && typeof address === 'object' ? address.port : config.port
      printStartupBanner(config, boundPort)
      resolve({
        port: boundPort,
        close: () =>
          new Promise<void>((res) => {
            sseHub.close()
            server.close(() => res())
          }),
      })
    })
  })
}
