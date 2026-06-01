/**
 * The Client Hub server assembly (Task 2.2).
 *
 * Two entry points:
 *
 *   - {@link createApp}: builds the configured Express app from INJECTED deps
 *     (manager, sseHub, store, config) and returns it WITHOUT listening, so
 *     supertest can drive it against fakes — no real model, server, or socket.
 *     Permission/question responses forward the body toolUseId (or '') to the
 *     broker, which owns the FIFO resolution of concurrent requests — so there is
 *     no Hub-side pending-id tracking to wire up (integration note 1 in routes).
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
import express, { type Express, type Request, type Response, type NextFunction } from 'express'
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
 * Build the configured Express app: JSON body parsing, CORS/preflight, optional
 * request logging, and the authenticated /api router. Does NOT call listen — the
 * caller (startServer / a test) owns the lifecycle.
 */
export function createApp(deps: AppDeps): Express {
  const app = express()

  // Optional wire-level request logging for diagnosing real-client (Even app)
  // connects. Off by default; enable with COLIVE_LOG_REQUESTS=1. Mirrors the
  // stock even-terminal bridge, which logs every request URL. Logged BEFORE auth
  // so we see even rejected/unmatched requests (the auth header is redacted).
  if (process.env.COLIVE_LOG_REQUESTS) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const started = Date.now()
      const ua = req.get('user-agent') ?? '-'
      const auth = req.get('authorization') ? 'Bearer …' : (req.query['token'] ? '?token=…' : 'none')
      res.on('finish', () => {
        // eslint-disable-next-line no-console
        console.log(
          `[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} ` +
            `(${Date.now() - started}ms) auth=${auth} ua=${ua}`,
        )
      })
      next()
    })
  }

  // Permissive CORS, matching the stock even-terminal bridge (🧪 M0: "CORS fully
  // open"). The Even app's connect probe is a cross-origin request (the G2 app
  // stack uses WebViews), so without these headers + an OPTIONS-preflight answer
  // the probe fails even though a top-level browser GET succeeds. Answered BEFORE
  // auth so the unauthenticated preflight is not rejected.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.use(express.json())

  const router = mountRoutes(deps)

  app.use('/api', router)

  // Surface any handler error so a real-client request that breaks a route is
  // visible (with COLIVE_LOG_REQUESTS) instead of express's silent default 500.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (process.env.COLIVE_LOG_REQUESTS) {
      // eslint-disable-next-line no-console
      console.error(`[err] ${req.method} ${req.originalUrl}:`, err)
    }
    if (!res.headersSent) res.status(500).json({ error: 'internal error' })
  })

  return app
}

/**
 * The connection QR payload. 🧪 VERIFIED format — the Even app expects the exact
 * connect URL the stock `even-terminal` bridge emits (its `common.js` builds it
 * with `URLSearchParams({ token, defaultProvider })`; our 2026-05-30 live probe
 * confirmed `http://<host>:<port>?token=<token>&defaultProvider=claude`). Kept
 * here, alone, so the one app-facing format lives in one place.
 */
export function buildQrPayload(config: {
  host: string
  port: number
  token: string
  advertiseHost?: string
}): string {
  const host = config.advertiseHost ?? config.host
  return `http://${host}:${config.port}?token=${config.token}&defaultProvider=claude`
}

/** Print the startup banner, the QR, and the manual-entry fallback. */
function printStartupBanner(config: ResolvedConfig, boundPort: number): void {
  const payload = buildQrPayload({
    host: config.host,
    port: boundPort,
    token: config.token,
    advertiseHost: config.advertiseHost,
  })
  // eslint-disable-next-line no-console
  console.log('\nCo-Live Terminal — Client Hub')
  if (config.advertiseHost) {
    console.log(`  listening   http://0.0.0.0:${boundPort}`)
    console.log(`  glasses     http://${config.advertiseHost}:${boundPort} (via Tailscale)`)
    console.log(`  desk        http://localhost:${boundPort}`)
  } else {
    console.log(`  listening   http://${config.host}:${boundPort}`)
  }
  console.log(`  model       ${config.model}`)
  console.log('\nScan to connect:')
  qrcode.generate(payload, { small: true }, (qr) => console.log(qr))
  console.log('Or enter manually:')
  console.log(`  host   ${config.advertiseHost ?? config.host}`)
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
