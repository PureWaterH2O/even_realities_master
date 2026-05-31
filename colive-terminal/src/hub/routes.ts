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
 *      with {sessionId, decision} and NO toolUseId, but the Core broker needs a
 *      toolUseId. The {@link PendingTracker} watches the same fan-out the SSE hub
 *      consumes and records the latest pending toolUseId per session from
 *      permission_request / user_question events, clearing it on the matching
 *      permission_result / answer. A sessionId-only response maps to that pending
 *      id; an explicit body toolUseId (our desk client sends one) wins.
 *   2. Wire decision values are allow|allowAlways|deny. `allowAlways` is a
 *      client-side "remember + allow"; the broker only knows allow/deny, so it is
 *      normalized to 'allow' before respondPermission.
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

/**
 * Tracks the latest unresolved permission / question toolUseId per session, fed
 * by the manager fan-out. A sessionId-only client response maps to the recorded
 * id (integration note 1). Permission and question ids are tracked separately so
 * a pending permission and a pending question on the same session don't clobber
 * each other.
 */
export class PendingTracker {
  private readonly permission = new Map<string, string>()
  private readonly question = new Map<string, string>()

  /** Update tracking from one fan-out event. Tolerant of an empty sessionId. */
  observe(sessionId: string, event: CoLiveEvent): void {
    switch (event.type) {
      case 'permission_request':
        this.permission.set(sessionId, event.toolUseId)
        break
      case 'user_question':
        this.question.set(sessionId, event.toolUseId)
        break
      case 'permission_result':
        // The turn's permission settled; drop the pending id for this session.
        this.permission.delete(sessionId)
        break
      default:
        break
    }
  }

  /** The latest pending permission toolUseId for a session, or undefined. */
  pendingPermission(sessionId: string): string | undefined {
    return this.permission.get(sessionId)
  }

  /** The latest pending question toolUseId for a session, or undefined. */
  pendingQuestion(sessionId: string): string | undefined {
    return this.question.get(sessionId)
  }

  /** Forget a session's pending question (called once it's answered). */
  clearQuestion(sessionId: string): void {
    this.question.delete(sessionId)
  }
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

/** Map a wire decision (allow|allowAlways|deny) to the broker's allow|deny. */
export function normalizeDecision(decision: unknown): PermissionDecision {
  // allowAlways is a client-side "remember + allow"; the broker only knows
  // allow/deny (note 2). Anything that isn't an explicit allow becomes deny.
  if (decision === 'allow' || decision === 'allowAlways') return 'allow'
  return 'deny'
}

/** Read a positive-integer query param, or undefined if absent / invalid. */
function intQuery(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const n = Number.parseInt(value, 10)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/**
 * Build the authenticated /api Router and the {@link PendingTracker} that feeds
 * its toolUseId mapping. The caller is responsible for subscribing the tracker
 * to the manager fan-out (createApp does this), so the tracker is returned here
 * rather than wired internally — keeping this function free of side effects.
 */
export function mountRoutes(deps: RouteDeps): { router: Router; pending: PendingTracker } {
  const { manager, sseHub, store, config } = deps
  const pending = new PendingTracker()
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
      const cwd = typeof req.query.cwd === 'string' ? req.query.cwd : config.projectDir
      const limit = intQuery(req.query.limit)
      const sessions = await store.listSessions({ dir: cwd, limit })
      res.json({ sessions })
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
  router.post('/permission-response', (req, res) => {
    const body = req.body as { sessionId?: unknown; decision?: unknown; toolUseId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const decision = normalizeDecision(body.decision)
    // Prefer an explicit body toolUseId (our desk client sends it); else map the
    // sessionId to the tracked pending id (the Even-app path).
    const toolUseId =
      typeof body.toolUseId === 'string' && body.toolUseId.length > 0
        ? body.toolUseId
        : (pending.pendingPermission(sessionId) ?? '')
    manager.respondPermission(sessionId, toolUseId, decision)
    res.json({ ok: true })
  })

  // POST /api/question-response {sessionId, answer, toolUseId?}
  router.post('/question-response', (req, res) => {
    const body = req.body as { sessionId?: unknown; answer?: unknown; toolUseId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const answer = typeof body.answer === 'string' ? body.answer : ''
    const toolUseId =
      typeof body.toolUseId === 'string' && body.toolUseId.length > 0
        ? body.toolUseId
        : (pending.pendingQuestion(sessionId) ?? '')
    manager.respondQuestion(sessionId, toolUseId, answer)
    pending.clearQuestion(sessionId)
    res.json({ ok: true })
  })

  // POST /api/interrupt {sessionId}
  router.post('/interrupt', (req, res) => {
    const body = req.body as { sessionId?: unknown }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    manager.interrupt(sessionId)
    res.json({ ok: true })
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

  return { router, pending }
}

/** Truthy test for SSE replay flags: "true"/"1"/"yes" (case-insensitive) or present. */
function isTruthy(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}
