import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { CoLiveEvent } from '../../src/core/events'
import type { TaggedEvent } from '../../src/core/sessionManager'
import type { NormalizedSession, TranscriptEntry } from '../../src/core/store'
import type { SseHub } from '../../src/hub/sse'
import { createApp, type AppDeps } from '../../src/hub/server'

const TOKEN = 'secret-token'

/** A fake SessionManager exposing only the surface the routes touch. */
function makeFakeManager() {
  const subscribers = new Set<(t: TaggedEvent) => void>()
  return {
    prompt: vi.fn(async (_id?: string, _text?: string, _cwd?: string) => 'resolved-session'),
    respondPermission: vi.fn(),
    respondQuestion: vi.fn(),
    interrupt: vi.fn(),
    getStatus: vi.fn(() => 'idle' as const),
    subscribe(cb: (t: TaggedEvent) => void): () => void {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    /** Test helper: push a tagged event through the fan-out. */
    emit(sessionId: string, event: CoLiveEvent): void {
      for (const cb of [...subscribers]) cb({ sessionId, event })
    },
  }
}

/** A fake SseHub: records subscribe calls; broadcast is a no-op for route tests. */
function makeFakeSseHub(): SseHub & { subscribeCalls: Array<{ sessionId: string; needReplay: boolean }> } {
  const subscribeCalls: Array<{ sessionId: string; needReplay: boolean }> = []
  return {
    subscribeCalls,
    subscribe(sessionId, res, opts) {
      subscribeCalls.push({ sessionId, needReplay: opts.needReplay })
      // Route tests must never hang on an open SSE stream: end the response now
      // (the REAL hub would keep it open; that behaviour is covered in 2.1).
      res.end()
    },
    broadcast() {},
    close() {},
  }
}

interface FakeStore {
  listSessions: ReturnType<typeof vi.fn>
  getTranscript: ReturnType<typeof vi.fn>
  realpathCwd: (cwd: string) => string
}

function makeFakeStore(opts?: {
  sessions?: NormalizedSession[]
  transcript?: TranscriptEntry[]
}): FakeStore {
  return {
    listSessions: vi.fn(async () => opts?.sessions ?? []),
    getTranscript: vi.fn(async () => opts?.transcript ?? []),
    realpathCwd: (cwd: string) => cwd,
  }
}

function makeApp(overrides?: Partial<AppDeps>): {
  app: Express
  manager: ReturnType<typeof makeFakeManager>
  sseHub: ReturnType<typeof makeFakeSseHub>
  store: FakeStore
} {
  const manager = makeFakeManager()
  const sseHub = makeFakeSseHub()
  const store = makeFakeStore()
  const config = {
    model: 'claude-opus-4-8',
    permissionMode: 'default' as const,
    settingSources: [],
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    projectDir: '/tmp/project',
  }
  const deps: AppDeps = {
    manager: manager as unknown as AppDeps['manager'],
    sseHub,
    store: store as unknown as AppDeps['store'],
    config,
    ...overrides,
  }
  const app = createApp(deps)
  // Return the EFFECTIVE deps (so an override store/manager is the one asserted on).
  return {
    app,
    manager: deps.manager as unknown as ReturnType<typeof makeFakeManager>,
    sseHub: deps.sseHub as ReturnType<typeof makeFakeSseHub>,
    store: deps.store as unknown as FakeStore,
  }
}

describe('routes — auth', () => {
  it('401 with no token', async () => {
    const { app } = makeApp()
    await request(app).get('/api/info').expect(401)
  })

  it('401 with a wrong token', async () => {
    const { app } = makeApp()
    await request(app).get('/api/info').set('Authorization', 'Bearer nope').expect(401)
  })

  it('200 with a correct bearer header', async () => {
    const { app } = makeApp()
    await request(app).get('/api/info').set('Authorization', `Bearer ${TOKEN}`).expect(200)
  })

  it('200 with a correct ?token query param', async () => {
    const { app } = makeApp()
    await request(app).get(`/api/info?token=${TOKEN}`).expect(200)
  })
})

describe('GET /api/info', () => {
  it('returns {account, model, version, provider}', async () => {
    const { app } = makeApp()
    const res = await request(app)
      .get('/api/info')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.model).toBe('claude-opus-4-8')
    expect(res.body.provider).toBe('claude')
    expect(res.body.version).toBe('0.1.0')
    expect(res.body.account).toBeDefined()
    expect(typeof res.body.account.email).toBe('string')
    expect('organization' in res.body.account).toBe(true)
    expect('subscriptionType' in res.body.account).toBe(true)
  })
})

describe('POST /api/prompt', () => {
  it('returns 202 {ok, sessionId, provider} and calls manager.prompt', async () => {
    const { app, manager } = makeApp()
    const res = await request(app)
      .post('/api/prompt')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ text: 'hello', sessionId: 's-in', cwd: '/tmp/x' })
      .expect(202)
    expect(res.body).toEqual({ ok: true, sessionId: 'resolved-session', provider: 'claude' })
    expect(manager.prompt).toHaveBeenCalledWith('s-in', 'hello', '/tmp/x')
  })

  it('passes undefined sessionId/cwd when omitted', async () => {
    const { app, manager } = makeApp()
    await request(app)
      .post('/api/prompt')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ text: 'hi' })
      .expect(202)
    expect(manager.prompt).toHaveBeenCalledWith(undefined, 'hi', undefined)
  })

  it('400 when text is missing', async () => {
    const { app } = makeApp()
    await request(app)
      .post('/api/prompt')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 's' })
      .expect(400)
  })
})

describe('GET /api/sessions', () => {
  it('returns {sessions:[...]} from store.listSessions', async () => {
    const sessions: NormalizedSession[] = [
      { id: 'a', title: 'A', timestamp: 1, cwd: '/tmp', provider: 'claude', status: 'idle' },
    ]
    const { app, store } = makeApp({ store: makeFakeStore({ sessions }) as unknown as AppDeps['store'] })
    const res = await request(app)
      .get('/api/sessions?cwd=/tmp&limit=5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.sessions).toEqual(sessions)
    expect(store.listSessions).toHaveBeenCalled()
    const arg = store.listSessions.mock.calls[0][0]
    expect(arg.limit).toBe(5)
  })
})

describe('GET /api/sessions/:id/transcript and /history', () => {
  const transcript: TranscriptEntry[] = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `m${i}`,
  }))

  it('/transcript returns the FULL transcript (uncapped)', async () => {
    const { app } = makeApp({ store: makeFakeStore({ transcript }) as unknown as AppDeps['store'] })
    const res = await request(app)
      .get('/api/sessions/sid/transcript')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.transcript).toHaveLength(25)
    expect(res.body.transcript).toEqual(transcript)
  })

  it('/history caps at the last 10 by default', async () => {
    const { app } = makeApp({ store: makeFakeStore({ transcript }) as unknown as AppDeps['store'] })
    const res = await request(app)
      .get('/api/sessions/sid/history')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.history).toHaveLength(10)
    expect(res.body.history).toEqual(transcript.slice(-10))
  })

  it('/history honors an explicit limit', async () => {
    const { app } = makeApp({ store: makeFakeStore({ transcript }) as unknown as AppDeps['store'] })
    const res = await request(app)
      .get('/api/sessions/sid/history?limit=3')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.history).toEqual(transcript.slice(-3))
  })
})

describe('POST /api/permission-response', () => {
  it('maps a sessionId-only body to the tracked pending toolUseId', async () => {
    const { app, manager } = makeApp()
    // The hub learns the pending toolUseId from a broadcast permission_request.
    manager.emit('sess1', {
      type: 'permission_request',
      toolName: 'Bash',
      description: 'run',
      detail: {},
      toolUseId: 'tu-42',
      options: [],
      suggestions: [],
    })
    await request(app)
      .post('/api/permission-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', decision: 'allow' })
      .expect(200)
    expect(manager.respondPermission).toHaveBeenCalledWith('sess1', 'tu-42', 'allow')
  })

  it('maps allowAlways -> allow', async () => {
    const { app, manager } = makeApp()
    manager.emit('sess1', {
      type: 'permission_request',
      toolName: 'Bash',
      description: 'run',
      detail: {},
      toolUseId: 'tu-99',
      options: [],
      suggestions: [],
    })
    await request(app)
      .post('/api/permission-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', decision: 'allowAlways' })
      .expect(200)
    expect(manager.respondPermission).toHaveBeenCalledWith('sess1', 'tu-99', 'allow')
  })

  it('prefers an explicit toolUseId from the body when present', async () => {
    const { app, manager } = makeApp()
    manager.emit('sess1', {
      type: 'permission_request',
      toolName: 'Bash',
      description: 'run',
      detail: {},
      toolUseId: 'tracked',
      options: [],
      suggestions: [],
    })
    await request(app)
      .post('/api/permission-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', decision: 'deny', toolUseId: 'explicit' })
      .expect(200)
    expect(manager.respondPermission).toHaveBeenCalledWith('sess1', 'explicit', 'deny')
  })

  it('clears the pending toolUseId on permission_result', async () => {
    const { app, manager } = makeApp()
    manager.emit('sess1', {
      type: 'permission_request',
      toolName: 'Bash',
      description: 'run',
      detail: {},
      toolUseId: 'tu-1',
      options: [],
      suggestions: [],
    })
    manager.emit('sess1', {
      type: 'permission_result',
      toolName: 'Bash',
      summary: 'ran',
      decision: 'allow',
    })
    // No pending id now: a sessionId-only response has nothing to map to and
    // calls respondPermission with an empty toolUseId (a harmless no-op in core).
    await request(app)
      .post('/api/permission-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', decision: 'allow' })
      .expect(200)
    expect(manager.respondPermission).toHaveBeenCalledWith('sess1', '', 'allow')
  })
})

describe('POST /api/question-response', () => {
  it('maps a sessionId-only body to the tracked pending question toolUseId', async () => {
    const { app, manager } = makeApp()
    manager.emit('sess1', {
      type: 'user_question',
      question: 'pick one',
      toolUseId: 'q-7',
      options: ['a', 'b'],
    })
    await request(app)
      .post('/api/question-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', answer: 'a' })
      .expect(200)
    expect(manager.respondQuestion).toHaveBeenCalledWith('sess1', 'q-7', 'a')
  })

  it('prefers an explicit toolUseId from the body when present', async () => {
    const { app, manager } = makeApp()
    manager.emit('sess1', {
      type: 'user_question',
      question: 'pick one',
      toolUseId: 'tracked',
      options: [],
    })
    await request(app)
      .post('/api/question-response')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 'sess1', answer: 'b', toolUseId: 'explicit' })
      .expect(200)
    expect(manager.respondQuestion).toHaveBeenCalledWith('sess1', 'explicit', 'b')
  })
})

describe('POST /api/interrupt', () => {
  it('routes to manager.interrupt', async () => {
    const { app, manager } = makeApp()
    await request(app)
      .post('/api/interrupt')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ sessionId: 's9' })
      .expect(200)
    expect(manager.interrupt).toHaveBeenCalledWith('s9')
    expect((await request(app).post('/api/interrupt').set('Authorization', `Bearer ${TOKEN}`).send({ sessionId: 's9' })).body).toEqual({ ok: true })
  })
})

describe('GET /api/status', () => {
  it('returns {status} from manager.getStatus', async () => {
    const { app, manager } = makeApp()
    manager.getStatus.mockReturnValue('busy' as never)
    const res = await request(app)
      .get('/api/status?sessionId=s1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body).toEqual({ status: 'busy' })
    expect(manager.getStatus).toHaveBeenCalledWith('s1')
  })
})

describe('GET /api/messages', () => {
  it('returns transcript entries after the given index', async () => {
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: 'm0' },
      { role: 'assistant', text: 'm1' },
      { role: 'user', text: 'm2' },
    ]
    const { app } = makeApp({ store: makeFakeStore({ transcript }) as unknown as AppDeps['store'] })
    const res = await request(app)
      .get('/api/messages?sessionId=s1&after=1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body.messages).toEqual([{ role: 'user', text: 'm2' }])
  })
})

describe('GET /api/update-check', () => {
  it('returns {updateAvailable:false}', async () => {
    const { app } = makeApp()
    const res = await request(app)
      .get('/api/update-check')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200)
    expect(res.body).toEqual({ updateAvailable: false })
  })
})

describe('GET /api/events wiring', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requires auth (401 without token)', async () => {
    const { app } = makeApp()
    await request(app).get('/api/events?sessionId=s1').expect(401)
  })

  it('subscribes to the SseHub with the requested session and needReplay', async () => {
    const { app, sseHub } = makeApp()
    // The route hands the raw res to the hub; our fake hub does NOT keep it open,
    // so the request resolves immediately. We only assert the subscribe call.
    await request(app)
      .get(`/api/events?sessionId=s1&needReplay=true&token=${TOKEN}`)
      .expect(200)
    expect(sseHub.subscribeCalls).toEqual([{ sessionId: 's1', needReplay: true }])
  })
})
