/**
 * The Even-app-compatible HTTP surface (Task 2.2).
 *
 * This is the routing + auth layer that sits ABOVE the Session Core and the SSE
 * transport (2.1). It wires every endpoint of the reverse-engineered protocol
 * contract to the injected `manager` / `sseHub` / `store`, and nothing here
 * touches the SDK or the filesystem directly — those are reached only through
 * the injected facades, so the whole surface is supertest-drivable with fakes.
 *
 * Three Phase-1-review integration contracts are honoured at THIS layer (never
 * by editing core):
 *
 *   1. The Even app POSTs /api/permission-response (and /api/question-response)
 *      with {sessionId, decision} and NO toolUseId. We forward the body's
 *      toolUseId when present (the desk client sends the explicit id it is
 *      answering) or '' otherwise. The Core broker settles the OLDEST pending
 *      request for that session on an empty id (FIFO, mirroring native
 *      even-terminal's shift()), which is what lets CONCURRENT permission
 *      requests — e.g. the model firing several parallel tool calls — be answered
 *      in order rather than all-but-one stranding to a 60s timeout. (We do NOT
 *      track pending ids at this layer: a single "latest" slot cannot represent
 *      concurrent requests, and a Hub-side queue desyncs when an explicit id
 *      resolves out of order. The broker owns its pending set, so it is the one
 *      correct place to do the FIFO resolve.)
 *   2. Wire decision values are allow|allowAlways|deny, forwarded verbatim.
 *      The broker owns `allowAlways` (D-033): it allows AND returns the
 *      request's SDK suggestions as `updatedPermissions` so the choice
 *      persists. (Before D-033 the Hub flattened it to plain 'allow'.)
 *   4. The auth middleware and handlers never depend on the SSE fan-out not
 *      throwing — that safety lives in the hub. Here, handlers are plain request
 *      /response and Express owns error handling.
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import type { CoLiveEvent } from '../core/events'
import type { PermissionDecision } from '../core/permissions'
import type { SessionManager } from '../core/sessionManager'
import type { NormalizedSession, TranscriptEntry } from '../core/store'
import type { SseHub } from './sse'

/** Default cap for /api/history (Even app compat: last 10 turns). */
export const DEFAULT_HISTORY_LIMIT = 10

/** The server version reported by /api/info (kept in lockstep with package.json). */
export const SERVER_VERSION = '0.1.0'

/**
 * The read-only store facade the routes need. A structural subset of
 * `../core/store` so tests inject a fake that never hits the SDK / filesystem.
 */
export interface StoreFacade {
  listSessions(
    opts?: { dir?: string; limit?: number },
  ): Promise<NormalizedSession[]>
  getTranscript(id: string, opts?: { dir?: string }): Promise<TranscriptEntry[]>
}

/**
 * The SessionManager surface the routes drive. A structural subset of the real
 * class so a fake satisfies it (the real class is assignable to it).
 */
export interface ManagerFacade {
  prompt(id: string | undefined, text: string, cwd?: string): Promise<string | undefined>
  respondPermission(sessionId: string, toolUseId: string, decision: PermissionDecision): void
  respondQuestion(sessionId: string, toolUseId: string, answer: string): void
  interrupt(sessionId: string): void
  control(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>
  getStatus(sessionId: string): 'busy' | 'idle' | 'unknown'
  subscribe(cb: (tagged: { sessionId: string; event: CoLiveEvent }) => void): () => void
}

/** The config slice the routes read (token for auth, model + projectDir for info/sessions). */
export interface RoutesConfig {
  token: string
  model: string
  projectDir: string
}

/** Everything mountRoutes / createApp needs, all injected for testability. */
export interface RouteDeps {
  manager: ManagerFacade
  sseHub: SseHub
  store: StoreFacade
  config: RoutesConfig
}

/** Pull the bearer token from the Authorization header or the ?token query param. */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (header !== undefined && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length)
  }
  const q = req.query.token
  if (typeof q === 'string') return q
  return undefined
}

/** Constant-time string compare (equal length required for timingSafeEqual). */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Bearer-auth middleware: 401 unless a valid token is present (header or query). */
export function makeAuthMiddleware(token: string) {
  return function auth(req: Request, res: Response, next: NextFunction): void {
    const provided = extractToken(req)
    if (provided === undefined || !constantTimeEqual(provided, token)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }
}

/** Map a wire decision to the broker's allow|allowAlways|deny (note 2). */
export function normalizeDecision(decision: unknown): PermissionDecision {
  if (decision === 'allow') return 'allow'
  if (decision === 'allowAlways') return 'allowAlways'
  // Anything that isn't an explicit allow becomes deny.
  return 'deny'
}

/** Read a positive-integer query param, or undefined if absent / invalid. */
function intQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/**
 * Map an internal NormalizedSession to the Even-app wire shape. 🧪 The app's
 * Dart deserializer requires `timestamp` as an ISO-8601 STRING — native
 * even-terminal emits e.g. "2026-05-31T16:10:41.102Z". We store it as epoch ms
 * internally; an integer on the wire makes the app reject the host outright
 * ("failed to probe and save"). All other fields pass through unchanged.
 */
function toWireSession(s: NormalizedSession): Omit<NormalizedSession, 'timestamp'> & { timestamp: string } {
  return { ...s, timestamp: new Date(s.timestamp).toISOString() }
}

/**
 * Build the authenticated /api Router wiring every protocol endpoint to the
 * injected Core / SSE / store. No hidden state: permission/question responses
 * forward the body's toolUseId (or '') straight to the broker, which owns the
 * FIFO resolution (see integration note 1).
 */
export function mountRoutes(deps: RouteDeps): Router {
  const { manager, sseHub, store, config } = deps
  const router = Router()

  router.use(makeAuthMiddleware(config.token))

  // GET /api/info
  router.get('/info', (_req, res) => {
    res.json({
      account: {
        email: process.env.COLIVE_ACCOUNT_EMAIL ?? 'owner@colive.local',
        organization: process.env.COLIVE_ACCOUNT_ORG ?? '',
        subscriptionType: process.env.COLIVE_ACCOUNT_PLAN ?? 'pro',
      },
      model: config.model,
      version: SERVER_VERSION,
      provider: 'claude',
    })
  })

  // GET /api/sessions?cwd=&limit=
  router.get('/sessions', async (req, res, next) => {
    try {
      // No cwd => span ALL projects (the Even app polls /api/sessions with no
      // cwd; native even-terminal lists every project, not just one).
      const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : undefined
      const limit = intQuery(req.query.limit)
      const sessions = await store.listSessions({ dir: cwd, limit })
      res.json({ sessions: sessions.map(toWireSession) })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/sessions/:id/history?limit=  -> last N (default 10) for app compat.
  router.get('/sessions/:id/history', async (req, res, next) => {
    try {
      const limit = intQuery(req.query.limit) ?? DEFAULT_HISTORY_LIMIT
      const full = await store.getTranscript(req.params.id, { dir: config.projectDir })
      const history = limit > 0 ? full.slice(-limit) : []
      res.json({ history })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/sessions/:id/transcript -> FULL, uncapped (desk scrollback).
  router.get('/sessions/:id/transcript', async (req, res, next) => {
    try {
      const transcript = await store.getTranscript(req.params.id, { dir: config.projectDir })
      res.json({ transcript })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/events?sessionId=&needReplay=  -> hand off to the SSE hub.
  router.get('/events', (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
    const needReplay = isTruthy(req.query.needReplay)
    sseHub.subscribe(sessionId, res, { needReplay })
  })

  // POST /api/prompt {text, sessionId?, provider?, cwd?} -> 202.
  router.post('/prompt', async (req, res, next) => {
    try {
      const body = req.body as { text?: unknown; sessionId?: unknown; cwd?: unknown }
      if (typeof body.text !== 'string' || body.text.length === 0) {
        res.status(400).json({ error: 'text is required' })
        return
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      const cwd = typeof body.cwd === 'string' ? body.cwd : undefined
      const resolved = await manager.prompt(sessionId, body.text, cwd)
      res.status(202).json({ ok: true, sessionId: resolved, provider: 'claude' })
    } catch (err) {
      next(err)
    }
  })

  // POST /api/permission-response {sessionId, decision, toolUseId?}
  // Forward the explicit toolUseId (desk client) or '' (Even app's sessionId-only
  // path → broker settles the oldest pending request, FIFO). See note 1.
  router.post('/permission-response', (req, res) => {
    const body = req.body as { sessionId?: unknown; decision?: unknown; toolUseId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const decision = normalizeDecision(body.decision)
    const toolUseId = typeof body.toolUseId === 'string' ? body.toolUseId : ''
    manager.respondPermission(sessionId, toolUseId, decision)
    res.json({ ok: true })
  })

  // POST /api/question-response {sessionId, answer, toolUseId?}  (same FIFO rule)
  router.post('/question-response', (req, res) => {
    const body = req.body as { sessionId?: unknown; answer?: unknown; toolUseId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const answer = typeof body.answer === 'string' ? body.answer : ''
    const toolUseId = typeof body.toolUseId === 'string' ? body.toolUseId : ''
    manager.respondQuestion(sessionId, toolUseId, answer)
    res.json({ ok: true })
  })

  // POST /api/interrupt {sessionId}
  router.post('/interrupt', (req, res) => {
    const body = req.body as { sessionId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    manager.interrupt(sessionId)
    res.json({ ok: true })
  })

  // POST /api/control {sessionId, action: 'setModel'|'setMode', value} -> 202
  router.post('/control', (req, res, next) => {
    const body = req.body as { sessionId?: unknown; action?: unknown; value?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const action = body.action === 'setModel' || body.action === 'setMode' ? body.action : undefined
    const value = typeof body.value === 'string' ? body.value : undefined
    if (sessionId === '' || action === undefined || value === undefined) {
      res.status(400).json({ error: 'control requires {sessionId, action: setModel|setMode, value}' })
      return
    }
    manager.control(sessionId, action, value).then(() => res.status(202).json({ ok: true })).catch(next)
  })

  // GET /api/status?sessionId=
  router.get('/status', (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
    res.json({ status: manager.getStatus(sessionId) })
  })

  // GET /api/messages?sessionId=&after=  -> transcript entries after an index.
  router.get('/messages', async (req, res, next) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
      const after = intQuery(req.query.after) ?? -1
      const full = await store.getTranscript(sessionId, { dir: config.projectDir })
      const messages = full.slice(after + 1)
      res.json({ messages })
    } catch (err) {
      next(err)
    }
  })

  // GET /api/update-check -> stub.
  router.get('/update-check', (_req, res) => {
    res.json({ updateAvailable: false })
  })

  return router
}

/** Truthy test for SSE replay flags: "true"/"1"/"yes" (case-insensitive) or present. */
function isTruthy(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}
