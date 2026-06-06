# Co-Live Terminal M3.3b — Runtime controls (`/model` + mode toggle) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/model` (curated picker) and a `/mode` toggle (Default/Accept-edits/Plan) as runtime controls on the M3.3a persistent `Query`, via a new additive desk→Hub→Core `/api/control` path — and close the M3.3a queued-prompt-loss edge first.

**Architecture:** A new `POST /api/control` route → `SessionManager.control` → `ClaudeSession.setModel/setPermissionMode`, which call the live `Query` method **and** update `this.config` so a self-heal reopen preserves the choice. The desk reuses the M3.2 `CompletionMenu` as a two-level picker (command → value list) and shows the active model/mode in the status line. The Even-app/glasses path stays byte-compatible (additive route only).

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, Express, React/ink, vitest. Commands run from `colive-terminal/`.

**Spec:** `docs/superpowers/specs/2026-06-04-colive-terminal-m3.3b-runtime-controls-design.md`

---

## File structure

| File | New? | Responsibility |
|---|---|---|
| `src/core/session.ts` | modify | task-1 re-queue (with single-retry guard); `setModel`/`setPermissionMode` (call `Query` + update `config`); `config` made mutable; `QueryLike` gains optional control methods. |
| `src/core/sessionManager.ts` | modify | `control(sessionId, action, value)` delegating to the session. |
| `src/hub/routes.ts` | modify | additive `POST /api/control`. |
| `src/desk/client.ts` | modify | `setControl(...)` + `getInfo()` on `HubClient`. |
| `src/desk/controls.ts` | **new** | pure: `MODEL_CHOICES`, `MODE_CHOICES`, `menuForCommand(text)` (value list for a picker command, else null). |
| `src/desk/app.tsx` | modify | two-level picker wiring (value menu + accept→`setControl`+note); status line shows model/mode; seed model from `getInfo`. |
| `test/...` mirrors | — | one test file per modified/created source file. |
| `test/preview/m33b.preview.test.tsx` | **new** | picker + status-line frames. |
| `scripts/screenshots.sh` | modify | M3.3b frame→PNG entries. |
| `projects/colive-terminal/m3.3b-uat-runbook.md` | **new** | E1–E5 with copy-paste commands. |

**Boundary:** `src/core/events.ts`, the SSE transport, and every existing Hub route stay byte-identical (additive `/control` only) → glasses unaffected.

---

### Task 1: Close the M3.3a edge — re-queue the in-flight prompt (with single-retry guard)

**Files:**
- Modify: `src/core/session.ts`
- Test: `test/core/session.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/core/session.test.ts`:

```ts
describe('ClaudeSession — task 1: in-flight prompt survives a fatal query error', () => {
  it('re-drives the in-flight prompt once on reopen (not dropped), then gives up on a second death', async () => {
    let openCount = 0
    const seen: string[] = []
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string } }) => {
      const which = openCount++
      const gen = (async function* () {
        for await (const msg of args.prompt) {
          seen.push((msg as any).message.content)
          if (which === 0) {
            yield { type: 'system', subtype: 'init', session_id: 'sess-1' }
            throw new Error('die-1') // first open: die mid-turn
          }
          if (which === 1) throw new Error('die-2') // reopen: die again -> must NOT loop forever
          yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
        }
      })()
      const q = gen as unknown as QueryLike
      ;(q as { interrupt: () => Promise<void> }).interrupt = async () => {}
      return q
    }) as unknown as QueryFn

    const events: string[] = []
    const session = new ClaudeSession({ config: baseConfig(), emit: (e) => events.push(e.type), canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('keep me') // dies, re-queues, reopens (resume), dies again, gives up
    expect(seen.filter((t) => t === 'keep me')).toHaveLength(2) // driven twice (original + 1 retry), not lost, not infinite
    expect(events.filter((t) => t === 'error')).toHaveLength(2) // an error per death; no loop
    expect(openCount).toBe(2) // exactly one reopen
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/session.test.ts`
Expected: FAIL — the in-flight prompt is driven once then dropped (or loops).

- [ ] **Step 3: Implement** — in `src/core/session.ts`:

(a) Extend the queue entry + add in-flight tracking. Change the `queue` field type and add two fields near `currentTurnResolve`:

```ts
  private readonly queue: { text: string; resolve: () => void; retried?: boolean }[] = []
  private currentTurnText: string | undefined
  private currentTurnRetried = false
```

(b) In `run()` and `beginTurn`, thread the text + retried flag. Change `beginTurn`'s signature and the two call sites:

```ts
  async run(text: string): Promise<void> {
    if (this._busy) {
      return new Promise<void>((resolve) => this.queue.push({ text, resolve }))
    }
    return new Promise<void>((resolve) => this.beginTurn(text, resolve, false))
  }

  private beginTurn(text: string, resolve: () => void, retried: boolean): void {
    this._busy = true
    this.currentTurnResolve = resolve
    this.currentTurnText = text
    this.currentTurnRetried = retried
    // ... (rest of beginTurn UNCHANGED) ...
```

(In `settleTurnAndDrain`, the existing drain `this.beginTurn(next.text, next.resolve)` becomes `this.beginTurn(next.text, next.resolve, next.retried === true)`.)

(c) In `settleTurnAndDrain`, clear the in-flight text alongside the resolver (find `this.currentTurnResolve = undefined` and add):

```ts
    this.currentTurnText = undefined
```

(d) Rewrite `onConsumerError` to re-queue the in-flight prompt to the FRONT, once:

```ts
  private onConsumerError(err: unknown): void {
    this.dead = true
    this.q = undefined
    this.inbox = undefined
    this.emit({ type: 'error', message: errorMessage(err) })
    // Task 1: don't drop the in-flight prompt on a fatal error. Re-queue it to the FRONT so the
    // lazy reopen-with-resume re-drives it. Guard with `retried` so a deterministically-crashing
    // prompt can't loop forever — a second death gives up (the error is already surfaced).
    if (this.currentTurnText !== undefined && this.currentTurnResolve !== undefined && !this.currentTurnRetried) {
      this.queue.unshift({ text: this.currentTurnText, resolve: this.currentTurnResolve, retried: true })
      this.currentTurnResolve = undefined // detach so settleTurnAndDrain won't resolve it early
      this.currentTurnText = undefined
    }
    this.settleTurnAndDrain()
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/core/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts test/core/session.test.ts
git commit -m "fix(m3.3b): re-drive the in-flight prompt on a fatal query error (single-retry guard)"
```

---

### Task 2: `ClaudeSession.setModel` / `setPermissionMode`

**Files:**
- Modify: `src/core/session.ts`
- Test: `test/core/session.test.ts`

- [ ] **Step 1: Write the failing tests** — append:

```ts
describe('ClaudeSession — runtime controls', () => {
  function controlFake() {
    const log: Array<{ m?: string; mode?: string; resume?: string }> = []
    let n = 0
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage>; options?: { resume?: string; model?: string; permissionMode?: string } }) => {
      log.push({ resume: args.options?.resume, m: args.options?.model, mode: args.options?.permissionMode })
      const which = n++
      const gen = (async function* () {
        for await (const _msg of args.prompt) {
          if (which === 0) { yield { type: 'system', subtype: 'init', session_id: 'sess-1' }; throw new Error('die') }
          yield { type: 'result', subtype: 'success', session_id: 'sess-1', result: '', usage: {} }
        }
      })()
      const q = gen as unknown as QueryLike & { setModel?: (m?: string) => Promise<void>; setPermissionMode?: (mode: string) => Promise<void> }
      q.interrupt = async () => {}
      q.setModel = async (m) => log.push({ m })
      q.setPermissionMode = async (mode) => log.push({ mode })
      return q
    }) as unknown as QueryFn
    return { fn, log }
  }

  it('setModel calls the live Query and updates config (so a reopen preserves it)', async () => {
    const { fn, log } = controlFake()
    const session = new ClaudeSession({ config: baseConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('open it')              // open #0 captures sess-1, dies -> dead
    await session.setModel('claude-sonnet-4-6')
    expect(log.some((e) => e.m === 'claude-sonnet-4-6')).toBe(true) // live call recorded (no live q here -> config only is also OK)
    await session.run('reopen')               // open #1 must carry the chosen model + resume
    const reopen = log.find((e) => e.resume === 'sess-1')
    expect(reopen?.m).toBe('claude-sonnet-4-6')
  })

  it('setPermissionMode updates config and survives a reopen', async () => {
    const { fn, log } = controlFake()
    const session = new ClaudeSession({ config: baseConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('open it')
    await session.setPermissionMode('plan')
    await session.run('reopen')
    expect(log.find((e) => e.resume === 'sess-1')?.mode).toBe('plan')
  })

  it('a rejecting control never throws', async () => {
    const fn = ((args: { prompt: AsyncIterable<SDKUserMessage> }) => {
      const gen = (async function* () { for await (const _ of args.prompt) yield { type: 'result', subtype: 'success', session_id: 's', result: '', usage: {} } })()
      const q = gen as unknown as QueryLike & { setModel?: (m?: string) => Promise<void> }
      q.interrupt = async () => {}
      q.setModel = async () => { throw new Error('nope') }
      return q
    }) as unknown as QueryFn
    const session = new ClaudeSession({ config: baseConfig(), emit: () => {}, canUseTool: stubCanUseTool, query: fn, clock: stubClock() })
    await session.start(undefined, process.cwd())
    await session.run('go')
    await expect(session.setModel('x')).resolves.toBeUndefined() // no throw
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/session.test.ts`
Expected: FAIL — `setModel`/`setPermissionMode` not functions; `config` readonly.

- [ ] **Step 3: Implement** — in `src/core/session.ts`:

(a) Make `config` mutable — change the field declaration:

```ts
  private config: SessionConfig
```

(b) Extend `QueryLike` with the optional control methods:

```ts
export interface QueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<void>
  setModel?(model?: string): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
}
```

(c) Add the two control methods (near `interrupt()`):

```ts
  /**
   * Switch the model at runtime: call the live Query's setModel (subsequent turns) AND update
   * config so a self-heal reopen (ensureQueryOpen builds options from config) keeps the choice.
   * No-throw — a control must never crash a session. With no live query, updates config only.
   */
  async setModel(model: string): Promise<void> {
    this.config = { ...this.config, model }
    try { await this.q?.setModel?.(model) } catch { /* control is best-effort */ }
  }

  /** Switch the permission mode at runtime (same contract as setModel). */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.config = { ...this.config, permissionMode: mode }
    try { await this.q?.setPermissionMode?.(mode) } catch { /* best-effort */ }
  }
```

> Confirm `PermissionMode` is already imported at the top of `session.ts` (it is — M3.3a imports it for `QueryOptions`). If the fake's `options` doesn't currently expose `model`/`permissionMode`, note `ensureQueryOpen` already sets them from `config` (M3.3a) — the test's `controlFake` reads `args.options?.model`/`permissionMode`, which `ensureQueryOpen` populates.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/core/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts test/core/session.test.ts
git commit -m "feat(m3.3b): ClaudeSession.setModel/setPermissionMode (live Query + config persist)"
```

---

### Task 3: `SessionManager.control`

**Files:**
- Modify: `src/core/sessionManager.ts`
- Test: `test/core/sessionManager.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/core/sessionManager.test.ts` (mirror the existing manager-test setup that drives a session to a known id):

```ts
describe('SessionManager.control', () => {
  it('routes setModel / setMode to the session; unknown session/action is a no-op', async () => {
    const calls: Array<{ kind: string; value: string }> = []
    // Build a manager whose session records control calls. Reuse the file's existing harness that
    // yields a known session id (e.g. drive a prompt to learn the id), then:
    const mgr = makeManager() // file's existing factory
    const id = await drivePromptToLearnId(mgr) // file's existing helper pattern
    // monkeypatch the live session's control methods via the manager's session map is not exposed;
    // instead assert delegation through observable behavior: setMode('plan') then a new turn's
    // options carry permissionMode 'plan'. (Use the same fake-query options capture the file uses.)
    await mgr.control(id, 'setMode', 'plan')
    await mgr.control('no-such-id', 'setModel', 'x') // no throw
    await mgr.control(id, 'bogus' as 'setModel', 'x') // no throw
    expect(() => calls).not.toThrow()
  })
})
```

> The exact assertion style must match `sessionManager.test.ts`'s existing fake-query options-capture (the M3.3a tests already capture `args.options` per open). Assert that after `control(id,'setMode','plan')`, the next turn's captured options carry `permissionMode: 'plan'`. Keep it observable; do not reach into private maps.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/core/sessionManager.test.ts`
Expected: FAIL — `mgr.control` is not a function.

- [ ] **Step 3: Implement** — add to `SessionManager` (near `interrupt`):

```ts
  /**
   * Apply a runtime control to a session's live Query. Desk-only (the Even app never calls it).
   * Unknown session or action is a silent no-op — a control must never throw across the Hub boundary.
   */
  async control(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (entry === undefined) return
    if (action === 'setModel') await entry.session.setModel(value)
    else if (action === 'setMode') await entry.session.setPermissionMode(value as PermissionMode)
  }
```

> Add `import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'` to `sessionManager.ts` if not already present. `this.sessions` is the existing session map (its value has `.session`).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/core/sessionManager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/sessionManager.ts test/core/sessionManager.test.ts
git commit -m "feat(m3.3b): SessionManager.control delegates setModel/setMode to the session"
```

---

### Task 4: Hub `POST /api/control`

**Files:**
- Modify: `src/hub/routes.ts`
- Test: `test/hub/routes.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/hub/routes.test.ts` (mirror the existing `/interrupt` test: a fake manager records the call; assert `202` + delegation + auth):

```ts
it('POST /api/control delegates to manager.control and returns 202', async () => {
  const controls: Array<{ sessionId: string; action: string; value: string }> = []
  const manager = makeFakeManager({ control: async (sessionId, action, value) => { controls.push({ sessionId, action, value }) } })
  const app = createApp({ manager, sseHub: makeFakeSse(), store: makeFakeStore(), config: routesConfig() })
  const res = await request(app).post('/api/control').set('authorization', `Bearer ${TOKEN}`).send({ sessionId: 's1', action: 'setModel', value: 'claude-sonnet-4-6' })
  expect(res.status).toBe(202)
  expect(controls).toEqual([{ sessionId: 's1', action: 'setModel', value: 'claude-sonnet-4-6' }])
})

it('POST /api/control rejects a bad body with 400 and missing auth with 401', async () => {
  const app = createApp({ manager: makeFakeManager({ control: async () => {} }), sseHub: makeFakeSse(), store: makeFakeStore(), config: routesConfig() })
  expect((await request(app).post('/api/control').set('authorization', `Bearer ${TOKEN}`).send({ sessionId: 's1' })).status).toBe(400)
  expect((await request(app).post('/api/control').send({ sessionId: 's1', action: 'setModel', value: 'x' })).status).toBe(401)
})
```

> Match the file's actual helpers (`makeFakeManager`, `request`, `TOKEN`, `routesConfig`, `createApp`). If the fake manager type lacks `control`, add it to the test's manager shape.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/hub/routes.test.ts`
Expected: FAIL — `/api/control` 404s; `manager.control` undefined.

- [ ] **Step 3: Implement** — in `src/hub/routes.ts`, add after the `/interrupt` route, and extend the `RoutesManager` type the file uses to include `control`:

```ts
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
```

> Add `control(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>` to the `RoutesManager`/manager interface this file imports (the same shape `prompt`/`interrupt` live on).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/hub/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hub/routes.ts test/hub/routes.test.ts
git commit -m "feat(m3.3b): additive POST /api/control route -> manager.control"
```

---

### Task 5: Desk `client.setControl` + `getInfo`

**Files:**
- Modify: `src/desk/client.ts`
- Test: `test/desk/client.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/desk/client.test.ts` (mirror the existing `interrupt`/`sendPrompt` fetch-mock tests):

```ts
it('setControl POSTs /api/control with the action + value', async () => {
  const { client, calls } = makeClientWithFetch({ ok: true })
  await client.setControl('s1', 'setMode', 'plan')
  expect(calls.at(-1)).toMatchObject({ path: '/api/control', body: { sessionId: 's1', action: 'setMode', value: 'plan' } })
})

it('getInfo GETs /api/info and returns the model', async () => {
  const { client } = makeClientWithFetch({ ok: true, json: { model: 'claude-opus-4-8', version: '1', provider: 'claude' } })
  expect((await client.getInfo()).model).toBe('claude-opus-4-8')
})
```

> Use the file's existing fetch-mock helper shape (`makeClientWithFetch` or equivalent). Match how `interrupt`'s test asserts the POST path/body.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/client.test.ts`
Expected: FAIL — `setControl`/`getInfo` not on the client.

- [ ] **Step 3: Implement** — in `src/desk/client.ts`:

(a) Extend the `HubClient` interface:

```ts
  /** POST /api/control {sessionId, action, value}. */
  setControl(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>
  /** GET /api/info -> { model, version, provider, ... }. */
  getInfo(): Promise<{ model: string }>
```

(b) Implement near `interrupt`:

```ts
  async function setControl(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void> {
    await postJson('/api/control', { sessionId, action, value })
  }

  async function getInfo(): Promise<{ model: string }> {
    const info = (await getJson('/api/info')) as { model?: unknown }
    return { model: typeof info.model === 'string' ? info.model : '' }
  }
```

(c) Add `setControl` and `getInfo` to the returned object literal (alongside `subscribe`, `sendPrompt`, `interrupt`, …).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/client.ts test/desk/client.test.ts
git commit -m "feat(m3.3b): HubClient.setControl + getInfo"
```

---

### Task 6: `controls.ts` — picker value lists + `menuForCommand`

**Files:**
- Create: `src/desk/controls.ts`
- Test: `test/desk/controls.test.ts`

- [ ] **Step 1: Write the failing tests** — `test/desk/controls.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MODEL_CHOICES, MODE_CHOICES, menuForCommand } from '../../src/desk/controls'

describe('controls', () => {
  it('MODEL_CHOICES carry friendly labels + real ids', () => {
    expect(MODEL_CHOICES.map((c) => c.value)).toContain('claude-opus-4-8')
    expect(MODEL_CHOICES.map((c) => c.value)).toContain('claude-sonnet-4-6')
    expect(MODEL_CHOICES.find((c) => c.value === 'claude-opus-4-8')?.name).toMatch(/opus/i)
  })
  it('MODE_CHOICES are exactly default/acceptEdits/plan', () => {
    expect(MODE_CHOICES.map((c) => c.value)).toEqual(['default', 'acceptEdits', 'plan'])
  })
  it('menuForCommand returns the value list for an exact picker command, else null', () => {
    expect(menuForCommand('/model')).toBe(MODEL_CHOICES)
    expect(menuForCommand('/mode')).toBe(MODE_CHOICES)
    expect(menuForCommand('/mod')).toBeNull()    // incomplete -> slash menu still filters
    expect(menuForCommand('/help')).toBeNull()
    expect(menuForCommand('hello')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/desk/controls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/desk/controls.ts`:

```ts
/**
 * Desk-side definitions for the M3.3b runtime-control pickers. Pure: no ink, no client.
 * A "picker command" (/model, /mode) opens a second-level menu of these choices; selecting
 * one POSTs /api/control. The model list is curated (the SDK has no "list models" call).
 */

/** A picker choice: the menu label (`name`) + the value sent to /api/control. `desc` is the hint. */
export interface ControlChoice {
  name: string
  desc: string
  value: string
}

export const MODEL_CHOICES: ControlChoice[] = [
  { name: 'Opus 4.8', desc: 'most capable', value: 'claude-opus-4-8' },
  { name: 'Sonnet 4.6', desc: 'balanced', value: 'claude-sonnet-4-6' },
  { name: 'Haiku 4.5', desc: 'fastest', value: 'claude-haiku-4-5-20251001' },
]

export const MODE_CHOICES: ControlChoice[] = [
  { name: 'Default', desc: 'ask before edits/commands', value: 'default' },
  { name: 'Accept-edits', desc: 'auto-accept file edits', value: 'acceptEdits' },
  { name: 'Plan', desc: 'plan only — no edits/commands', value: 'plan' },
]

/** Which control a picker command drives. */
export function actionForCommand(text: string): 'setModel' | 'setMode' | null {
  if (text === '/model') return 'setModel'
  if (text === '/mode') return 'setMode'
  return null
}

/** The value list for an EXACT picker command (`/model` / `/mode`), else null. */
export function menuForCommand(text: string): ControlChoice[] | null {
  if (text === '/model') return MODEL_CHOICES
  if (text === '/mode') return MODE_CHOICES
  return null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/desk/controls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/desk/controls.ts test/desk/controls.test.ts
git commit -m "feat(m3.3b): control picker definitions + menuForCommand (pure)"
```

---

### Task 7: `app.tsx` — two-level picker + status line

**Files:**
- Modify: `src/desk/app.tsx`, `src/desk/slash.ts` (add `/model`,`/mode` to the command list)
- Test: `test/desk/app.test.tsx`

Read the M3.2B menu wiring in `app.tsx` first (`slashMenu`/`atMenu`/`clampedMenuIndex`, the menu-nav block, the menu render, and the status line ~line 649).

- [ ] **Step 1: Add `/model` + `/mode` to the slash command list** — in `src/desk/slash.ts`, add to `COMMAND_HELP` (so they appear in the slash menu and `/help`):

```ts
  ['/model', 'switch the model (Opus / Sonnet / Haiku)'],
  ['/mode', 'switch permission mode (default / accept-edits / plan)'],
```

> Do NOT add them to `interpretInput`'s switch — pickers resolve in `app.tsx` before submit (like the slash menu), never as a posted prompt. (If a bare `/model` is somehow submitted, `interpretInput` returns a `hint` — acceptable.)

- [ ] **Step 2: Write the failing tests** — append to `test/desk/app.test.tsx`:

```ts
describe('runtime control pickers', () => {
  it('/model opens the model picker; picking sends setControl + shows a note', async () => {
    const hub = makeFakeHub()
    const { lastFrame, stdin, unmount } = render(<App client={hub} sessionId="s1" config={{ listFiles: () => [] }} />)
    try {
      await write(stdin, '/model')
      expect(lastFrame()).toContain('Opus 4.8')         // value picker open
      expect(lastFrame()).toContain('Sonnet 4.6')
      await write(stdin, '\x1b[B')                       // ↓ -> Sonnet
      await write(stdin, '\t')                           // accept
      expect(hub.controls.at(-1)).toMatchObject({ action: 'setModel', value: 'claude-sonnet-4-6' })
      expect(stripAnsi(lastFrame()!)).toContain('model → Sonnet 4.6')
    } finally { unmount() }
  })

  it('/mode opens the mode picker; picking Plan sends setMode plan', async () => {
    const hub = makeFakeHub()
    const { lastFrame, stdin, unmount } = render(<App client={hub} sessionId="s1" config={{ listFiles: () => [] }} />)
    try {
      await write(stdin, '/mode')
      expect(lastFrame()).toContain('Plan')
      await write(stdin, '\x1b[B'); await write(stdin, '\x1b[B') // ↓↓ -> Plan
      await write(stdin, '\r')                                   // Enter accept
      expect(hub.controls.at(-1)).toMatchObject({ action: 'setMode', value: 'plan' })
    } finally { unmount() }
  })
})
```

> Extend the test's `makeFakeHub` to record `controls: Array<{action,value}>` and implement `setControl`/`getInfo` (return `{model:'claude-opus-4-8'}`).

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: FAIL — picker doesn't open; `setControl` never called.

- [ ] **Step 4: Implement** — in `src/desk/app.tsx`:

(a) Import the controls + a `currentModel`/`currentMode` state and seed model from `getInfo`:

```ts
import { menuForCommand, actionForCommand, type ControlChoice } from './controls'
```

```ts
  const [currentModel, setCurrentModel] = useState<string>('')
  const [currentMode, setCurrentMode] = useState<string>('default')
  useEffect(() => { void client.getInfo().then((i) => setCurrentModel(i.model)).catch(() => {}) }, [client])
```

(b) Derive the picker menu (takes precedence over the slash menu, mutually exclusive with `@`). Near the existing `slashMenu`/`atCtx` derivation:

```ts
  const pickerChoices = menuForCommand(B.toText(buf).trim()) // ControlChoice[] | null
  const slashMenu = pickerChoices === null ? filterSlash(B.toText(buf), menuItems) : null
  // atCtx stays as-is but also gate it off when a picker is open:
  const atCtx = pickerChoices === null && slashMenu === null && !menuDismissed ? atContext(buf.lines[buf.row]!, buf.col) : null
```

Update `menuOpen`/`menuLength`/`clampedMenuIndex` to account for `pickerChoices`:

```ts
  const menuOpen = pickerChoices !== null || slashMenu !== null || atMenu !== null
  const menuLength = pickerChoices ? pickerChoices.length : slashMenu ? slashMenu.length : atMenu ? atMenu.length : 0
```

(c) In the menu-nav block, handle accept for the picker (Tab AND Enter accept; send control + note + clear buffer):

```ts
    if (menuOpen && !pending) {
      if (key.upArrow)   { setMenuIndex((i) => Math.max(0, Math.min(i, menuLength - 1) - 1)); return }
      if (key.downArrow) { setMenuIndex((i) => Math.min(menuLength - 1, i + 1)); return }
      if (pickerChoices && (key.tab || key.return)) {
        const choice = pickerChoices[clampedMenuIndex]!
        const action = actionForCommand(B.toText(buf).trim())!
        const sid = sessionIdRef.current
        if (sid !== undefined) void client.setControl(sid, action, choice.value).catch(() => {})
        if (action === 'setModel') setCurrentModel(choice.value)
        else setCurrentMode(choice.value)
        dispatch({ type: 'note', text: `✓ ${action === 'setModel' ? 'model' : 'mode'} → ${choice.name}${sid === undefined ? ' (applies once a session starts)' : ''}` })
        setBuf(B.empty()); setMenuIndex(0); return
      }
      // ... existing slashMenu Tab + atMenu Tab/Enter handling UNCHANGED ...
    }
```

(d) In the menu render block, render the picker choices when `pickerChoices`:

```tsx
      {menuOpen ? (
        <Box flexDirection="column">
          {pickerChoices
            ? pickerChoices.map((c, i) => (
                <Text key={c.value} inverse={i === clampedMenuIndex}>{`${c.name}  `}<Text dimColor>{c.desc}</Text></Text>
              ))
            : slashMenu
            ? slashMenu.map((item, i) => ( /* ...existing... */ ))
            : atMenu!.map((path, i) => ( /* ...existing... */ ))}
        </Box>
      ) : null}
```

(e) Status line — show model + mode. Update the status `<Text>` (~line 649):

```tsx
          [{statusLabel}{tokenStr}]{currentModel ? ` · ${shortModel(currentModel)}` : ''}{` · ${currentMode}`} {sid ? `session ${sid}` : 'new session'}
```

Add a tiny helper near the other module helpers:

```ts
const shortModel = (id: string): string =>
  id.replace(/^claude-/, '').replace(/-\d{8}$/, '') // claude-opus-4-8 -> opus-4-8
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/desk/app.test.tsx`
Expected: PASS (including the pre-existing slash/@ menu tests — picker derivation is mutually exclusive).

- [ ] **Step 6: Commit**

```bash
git add src/desk/app.tsx src/desk/slash.ts test/desk/app.test.tsx
git commit -m "feat(m3.3b): /model + /mode two-level pickers + model/mode in the status line"
```

---

### Task 8: Self-test (preview frames + LIVE run)

**Files:**
- Create: `test/preview/m33b.preview.test.tsx`
- Modify: `scripts/screenshots.sh`

- [ ] **Step 1: Create the preview test** — `test/preview/m33b.preview.test.tsx` (mirror `m33a`/`m32b`; the `App` config injects a `getInfo`/`setControl` via the replay client — extend `makeReplayClient` in `replay.tsx` to stub `getInfo` returning `{model:'claude-opus-4-8'}` and a no-op `setControl`):

```tsx
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { capture, snap, key, type Frame } from './replay'

const WRITE = process.env.PREVIEW === '1'
const OUT = resolve(__dirname, '../../preview-out')
function dump(frames: Frame[]): void {
  if (!WRITE) return
  mkdirSync(OUT, { recursive: true })
  for (const f of frames) { writeFileSync(resolve(OUT, `${f.label}.txt`), `${f.plain}\n`); writeFileSync(resolve(OUT, `${f.label}.ansi`), `${f.ansi}\n`) }
}
afterAll(() => {})

describe('M3.3b control pickers preview', () => {
  it('/model picker', async () => {
    const frames = await capture([key('/model'), snap('m33b-model-picker')])
    dump(frames)
    expect(frames[0]!.plain).toContain('Opus 4.8')
  })
  it('/mode picker', async () => {
    const frames = await capture([key('/mode'), snap('m33b-mode-picker')])
    dump(frames)
    expect(frames[0]!.plain).toContain('Plan')
  })
})
```

> If `capture()`'s replay client lacks `getInfo`/`setControl`, add them to `makeReplayClient` in `test/preview/replay.tsx` (stub: `getInfo: async () => ({ model: 'claude-opus-4-8' })`, `setControl: async () => {}`).

- [ ] **Step 2: Run the smoke assertions**

Run: `npx vitest run test/preview/m33b.preview.test.tsx`
Expected: PASS.

- [ ] **Step 3: Add the screenshot entries** — append to `scripts/screenshots.sh`'s `FRAMES=( … )`:

```bash
  # M3.3b control pickers
  "m33b-model-picker:shot-m33b-model-picker"
  "m33b-mode-picker:shot-m33b-mode-picker"
```

- [ ] **Step 4: Dump frames + screenshot + eyeball**

Run: `PREVIEW=1 npx vitest run test/preview/m33b.preview.test.tsx`
Run: `./scripts/screenshots.sh m33b-model-picker m33b-mode-picker` (skip if no `vhs`)
Confirm both pickers render cleanly and the status line shows `· opus-4-8 · default`.

- [ ] **Step 5: LIVE local run (real Core, real SDK auth — run on the user's machine)**

Pane A: `npx tsx src/index.ts serve --host 127.0.0.1 --project-dir "$(pwd)"`
Pane B: `npx tsx src/index.ts desk --host 127.0.0.1 --port <PORT> --token <TOKEN>`
- `/model` → Sonnet 4.6 → send `what model are you?` → confirm the status line shows `sonnet-4-6` and behaviour changes.
- `/mode` → Plan → ask for an edit → confirm Claude **plans, does not edit**.
- `/mode` → Accept-edits → ask for a small edit → confirm it applies with **no permission prompt**.
Screenshot the desk after each. Fix + re-run if anything misbehaves. **Gate before handback.**

- [ ] **Step 6: Commit**

```bash
git add test/preview/m33b.preview.test.tsx test/preview/replay.tsx scripts/screenshots.sh
git commit -m "test(m3.3b): control-picker preview frames + live self-test"
```

---

### Task 9: Final verification + invariant + UAT runbook

**Files:**
- Create: `projects/colive-terminal/m3.3b-uat-runbook.md`

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test` → PASS (no `.skip`/`.only`, no deleted tests)
Run: `npm run typecheck` → exit 0

- [ ] **Step 2: Prove the additive invariant (existing routes + Even path unchanged)**

Run: `git diff main -- src/hub/routes.ts | grep -E "^-\s*router\.(get|post)\(" || echo "[no existing route removed/changed ✓]"`
Expected: `[no existing route removed/changed ✓]` (only an added `/control` route).
Run: `git diff main --name-only -- src/core/events.ts src/hub/sse.ts || true; echo "events/sse changed: $(git diff main --name-only -- src/core/events.ts src/hub/sse.ts | wc -l | tr -d ' ')"`
Expected: `events/sse changed: 0` (event vocabulary + transport untouched → glasses byte-compat).

- [ ] **Step 3: No test gaming**

Run: `git diff main -- test | grep -E "^-\s*(it|test|describe)\(" || echo "[none removed ✓]"`
Expected: `[none removed ✓]`.

- [ ] **Step 4: Write the UAT runbook** — `projects/colive-terminal/m3.3b-uat-runbook.md`:

````markdown
# M3.3b UAT — runtime controls (/model + /mode) — hardware G2 + R1

## Setup (copy-paste)

```bash
# Pane A — Hub + Core (note the TOKEN + PORT it prints)
cd ~/Documents/random_claude_stuff/even_realities/colive-terminal
npx tsx src/index.ts serve --host 127.0.0.1 --project-dir "$(pwd)"
```

```bash
# Pane B — desk (fill TOKEN + PORT from Pane A)
cd ~/Documents/random_claude_stuff/even_realities/colive-terminal
npx tsx src/index.ts desk --host 127.0.0.1 --port <PORT> --token <TOKEN>
```

For E5 (glasses): start the Hub with Tailscale (`npx tsx src/index.ts serve`, no `--host`) and connect the Even app per the M2 runbook.

## Walk

| # | Do this (copy-paste / keystroke) | Pass = |
|---|---|---|
| E1 | Type `/model`, ↓ to **Sonnet 4.6**, Enter; then send `which model are you?` | Status line shows `· sonnet-4-6`; reply consistent with Sonnet |
| E2 | Type `/mode`, pick **Plan**; send `add a comment to package.json` | Claude **plans only — does NOT edit**; status shows `· plan` |
| E3 | Type `/mode`, pick **Accept-edits**; send `add a blank line to README.md` | Edit applies with **no permission prompt** |
| E4 | After E1's `/model` switch, toggle Wi-Fi off ~5s then on, send `still sonnet?` | Session resumes **on Sonnet** (status still `· sonnet-4-6`) — self-heal kept the choice |
| E5 | From the **glasses**, send a prompt during the above | Glasses send/receive unchanged |

Sign-off: ___  Date: ___
````

- [ ] **Step 5: Commit**

```bash
git add projects/colive-terminal/m3.3b-uat-runbook.md
git commit -m "docs(m3.3b): UAT runbook (E1-E5) with copy-paste setup + commands"
```

- [ ] **Step 6: Hand back to the planning/validation chat** — do NOT merge. Report: test-count delta, the additive-invariant outputs (no route removed; events/sse changed: 0), the no-gaming output, and the Task 8 live self-test result + screenshots, for planner validation before merge + hardware UAT.

---

## Self-Review

**1. Spec coverage:**
- §1 task-1 edge fix → Task 1 (with single-retry guard). ✓
- §2 SDK primitives (setModel/setPermissionMode, curated models, modes default/acceptEdits/plan) → Task 2 + Task 6. ✓
- §3 control path (session methods, manager.control, /api/control, client.setControl) → Tasks 2–5. ✓
- §4 two-level picker UX (menuForCommand, accept→setControl+note) → Tasks 6–7. ✓
- §5 status line model+mode → Task 7 (seed via getInfo). ✓
- §6 self-heal preserves choice (config write) → Task 2 (test) + §7 covered. ✓
- §7 pre-session handling → Task 7 note ("applies once a session starts"). ✓
- §8 invariants (additive route, events/sse unchanged, no-throw control) → Task 9 Steps 2–3 + Task 2 no-throw test. ✓
- §9 testing + self-test → Tasks 1–8. §10 UAT E1–E5 → Task 9. ✓

**2. Placeholder scan:** No TBD/TODO. Tasks 3/4/5 reference the test files' *existing* helpers (`makeManager`/`makeFakeManager`/`makeClientWithFetch`) rather than inventing names — the implementer matches the real helper; the assertion intent + the production code are fully specified. `<PORT>`/`<TOKEN>` are runtime values from the banner (intended).

**3. Type consistency:** `setControl(sessionId, action: 'setModel'|'setMode', value)` is identical across client (Task 5), route (Task 4), manager (Task 3). `ControlChoice {name,desc,value}` (Task 6) used by the picker render (Task 7). `setModel(model)`/`setPermissionMode(mode: PermissionMode)` (Task 2) called by `manager.control` (Task 3). `menuForCommand`/`actionForCommand` (Task 6) used in Task 7. `config` made mutable (Task 2) is what Task 1's drain + `ensureQueryOpen` read.

No gaps found.
