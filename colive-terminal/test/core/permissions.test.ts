import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isSlashPrompt,
  rejectIfSlash,
  PermissionBroker,
  PERMISSION_TIMEOUT_MS,
  QUESTION_TIMEOUT_MS,
} from '../../src/core/permissions'
import type { CoLiveEvent } from '../../src/core/events'

/** Collect emitted events into an array for assertions. */
function makeEmit(): { emit: (e: CoLiveEvent) => void; events: CoLiveEvent[] } {
  const events: CoLiveEvent[] = []
  return { emit: (e) => events.push(e), events }
}

/** Minimal CanUseTool opts (only the fields the broker reads). */
function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    toolUseID: 'tool-1',
    ...overrides,
  } as Parameters<PermissionBroker['canUseTool']>[2]
}

describe('isSlashPrompt', () => {
  it('is true when the first non-space char is "/"', () => {
    expect(isSlashPrompt('/context')).toBe(true)
    expect(isSlashPrompt('   /help')).toBe(true)
    expect(isSlashPrompt('\t/clear')).toBe(true)
  })

  it('is false for normal prompts (and empty / whitespace)', () => {
    expect(isSlashPrompt('hello world')).toBe(false)
    expect(isSlashPrompt('what is 2/3?')).toBe(false)
    expect(isSlashPrompt('')).toBe(false)
    expect(isSlashPrompt('   ')).toBe(false)
    expect(isSlashPrompt('a/b')).toBe(false)
  })
})

describe('rejectIfSlash (the pre-query guard)', () => {
  it('rejects a slash prompt with the slash error and returns true', () => {
    const { emit, events } = makeEmit()
    const rejected = rejectIfSlash('/context', emit)
    expect(rejected).toBe(true)
    expect(events).toEqual([
      { type: 'error', message: 'slash commands are client-side' },
    ])
  })

  it('passes a normal prompt: returns false, emits nothing', () => {
    const { emit, events } = makeEmit()
    const rejected = rejectIfSlash('summarize this', emit)
    expect(rejected).toBe(false)
    expect(events).toEqual([])
  })
})

describe('PermissionBroker.canUseTool — normal tool', () => {
  it('emits permission_request, stays pending, and resolves allow', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })

    const opts = makeOpts({ toolUseID: 'tu-9', title: 'Claude wants to read foo.txt' })
    const decision = broker.canUseTool('Read', { file_path: 'foo.txt' }, opts)

    // A permission_request is emitted immediately.
    expect(events).toHaveLength(1)
    const req = events[0]
    expect(req.type).toBe('permission_request')
    if (req.type === 'permission_request') {
      expect(req.toolName).toBe('Read')
      expect(req.toolUseId).toBe('tu-9')
      expect(req.description).toBe('Claude wants to read foo.txt')
      expect(req.detail).toEqual({ file_path: 'foo.txt' })
      expect(Array.isArray(req.options)).toBe(true)
      expect(Array.isArray(req.suggestions)).toBe(true)
    }

    // Still pending: not yet settled.
    let settled = false
    void decision.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    // Client allows.
    broker.resolvePermission('tu-9', 'allow')
    await expect(decision).resolves.toEqual({ behavior: 'allow' })
  })

  it('emits a permission_result naming the tool and decision on resolve', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Read', { file_path: 'foo' }, makeOpts({ toolUseID: 'tu-r' }))
    broker.resolvePermission('tu-r', 'allow')
    await decision
    const resultEvent = events.find((e) => e.type === 'permission_result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'permission_result') {
      expect(resultEvent.toolName).toBe('Read')
      expect(resultEvent.decision).toBe('allow')
      expect(resultEvent.summary).toContain('Read')
    }
  })

  it('is a no-op when resolvePermission is called for an unknown toolUseId', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    // Should not throw and should emit nothing.
    expect(() => broker.resolvePermission('does-not-exist', 'allow')).not.toThrow()
    expect(events).toEqual([])
  })

  it('resolves deny with a message when the client denies', async () => {
    const { emit } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Bash', { command: 'rm -rf /' }, makeOpts({ toolUseID: 'tu-7' }))

    broker.resolvePermission('tu-7', 'deny')
    const result = await decision
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it('falls back to a synthesized description when no title is given', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Write', { file_path: 'a.txt' }, makeOpts({ toolUseID: 'tu-d' }))
    const req = events[0]
    expect(req.type).toBe('permission_request')
    if (req.type === 'permission_request') {
      expect(req.description).toContain('Write')
    }
    broker.resolvePermission('tu-d', 'allow')
    await decision
  })
})

describe('PermissionBroker.canUseTool — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to DENY after 60s with no response', async () => {
    const { emit } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Read', { file_path: 'x' }, makeOpts({ toolUseID: 'tu-timeout' }))

    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS)

    const result = await decision
    expect(result.behavior).toBe('deny')
  })

  it('emits a terminal permission_result (decision "timeout") so clients can dismiss the HUD', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Read', { file_path: 'x' }, makeOpts({ toolUseID: 'tu-timeout-evt' }))

    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS)
    await decision

    const resultEvent = events.find((e) => e.type === 'permission_result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'permission_result') {
      expect(resultEvent.toolName).toBe('Read')
      expect(resultEvent.decision).toBe('timeout')
      expect(resultEvent.summary).toContain('Read')
    }
  })

  it('does NOT time out if resolved before 60s', async () => {
    const { emit } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool('Read', { file_path: 'x' }, makeOpts({ toolUseID: 'tu-fast' }))

    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS - 1000)
    broker.resolvePermission('tu-fast', 'allow')
    await expect(decision).resolves.toEqual({ behavior: 'allow' })
  })
})

describe('PermissionBroker.canUseTool — acceptEdits mode', () => {
  it('auto-allows an Edit without emitting a permission_request', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'acceptEdits' })
    const result = await broker.canUseTool('Edit', { file_path: 'a.ts' }, makeOpts())
    expect(result).toEqual({ behavior: 'allow' })
    expect(events).toEqual([])
  })

  it('auto-allows a Write without emitting a permission_request', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'acceptEdits' })
    const result = await broker.canUseTool('Write', { file_path: 'a.ts' }, makeOpts())
    expect(result).toEqual({ behavior: 'allow' })
    expect(events).toEqual([])
  })

  it('still prompts for a non-edit tool in acceptEdits mode', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'acceptEdits' })
    const decision = broker.canUseTool('Bash', { command: 'ls' }, makeOpts({ toolUseID: 'tu-bash' }))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('permission_request')
    broker.resolvePermission('tu-bash', 'allow')
    await decision
  })
})

describe('PermissionBroker — bypass / auto modes auto-allow everything', () => {
  it('bypassPermissions auto-allows any tool with no event', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'bypassPermissions' })
    const result = await broker.canUseTool('Bash', { command: 'rm x' }, makeOpts())
    expect(result).toEqual({ behavior: 'allow' })
    expect(events).toEqual([])
  })
})

describe('PermissionBroker.canUseTool — AskUserQuestion', () => {
  it('emits user_question, stays pending, and resolves with the answer', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })

    const input = {
      questions: [
        { question: 'Which framework?', options: [{ label: 'React' }, { label: 'Vue' }] },
      ],
    }
    const decision = broker.canUseTool('AskUserQuestion', input, makeOpts({ toolUseID: 'q-1' }))

    expect(events).toHaveLength(1)
    const ev = events[0]
    expect(ev.type).toBe('user_question')
    if (ev.type === 'user_question') {
      expect(ev.toolUseId).toBe('q-1')
      expect(ev.question).toContain('Which framework?')
      expect(ev.options).toEqual(['React', 'Vue'])
    }

    broker.resolveQuestion('q-1', 'React')
    const result = await decision
    expect(result.behavior).toBe('allow')
  })

  it('emits a terminal permission_result (decision "answered") on resolveQuestion', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const decision = broker.canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'pick one', options: [{ label: 'A' }] }] },
      makeOpts({ toolUseID: 'q-answered' }),
    )
    broker.resolveQuestion('q-answered', 'A')
    await decision
    const resultEvent = events.find((e) => e.type === 'permission_result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'permission_result') {
      expect(resultEvent.toolName).toBe('AskUserQuestion')
      expect(resultEvent.decision).toBe('answered')
    }
  })

  it('is a no-op when resolveQuestion is called for an unknown toolUseId', () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    expect(() => broker.resolveQuestion('nope', 'x')).not.toThrow()
    expect(events).toEqual([])
  })

  it('defaults to SKIP (deny) after 120s with no answer', async () => {
    vi.useFakeTimers()
    try {
      const { emit } = makeEmit()
      const broker = new PermissionBroker({ emit, permissionMode: 'default' })
      const decision = broker.canUseTool(
        'AskUserQuestion',
        { questions: [{ question: 'pick one', options: [] }] },
        makeOpts({ toolUseID: 'q-timeout' }),
      )
      await vi.advanceTimersByTimeAsync(QUESTION_TIMEOUT_MS)
      const result = await decision
      expect(result.behavior).toBe('deny')
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits a terminal permission_result (decision "skipped") on 120s timeout', async () => {
    vi.useFakeTimers()
    try {
      const { emit, events } = makeEmit()
      const broker = new PermissionBroker({ emit, permissionMode: 'default' })
      const decision = broker.canUseTool(
        'AskUserQuestion',
        { questions: [{ question: 'pick one', options: [] }] },
        makeOpts({ toolUseID: 'q-skip-evt' }),
      )
      await vi.advanceTimersByTimeAsync(QUESTION_TIMEOUT_MS)
      await decision
      const resultEvent = events.find((e) => e.type === 'permission_result')
      expect(resultEvent).toBeDefined()
      if (resultEvent?.type === 'permission_result') {
        expect(resultEvent.toolName).toBe('AskUserQuestion')
        expect(resultEvent.decision).toBe('skipped')
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PermissionBroker — abort signal', () => {
  it('denies a pending permission when the turn is aborted', async () => {
    const { emit } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const ac = new AbortController()
    const decision = broker.canUseTool('Read', { file_path: 'x' }, makeOpts({ signal: ac.signal, toolUseID: 'tu-abort' }))
    ac.abort()
    const result = await decision
    expect(result.behavior).toBe('deny')
  })

  it('emits a terminal permission_result (decision "aborted") when a pending permission is aborted', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const ac = new AbortController()
    const decision = broker.canUseTool('Read', { file_path: 'x' }, makeOpts({ signal: ac.signal, toolUseID: 'tu-abort-evt' }))
    ac.abort()
    await decision
    const resultEvent = events.find((e) => e.type === 'permission_result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'permission_result') {
      expect(resultEvent.toolName).toBe('Read')
      expect(resultEvent.decision).toBe('aborted')
    }
  })

  it('emits a terminal permission_result (decision "aborted") when a pending question is aborted', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const ac = new AbortController()
    const decision = broker.canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'pick one', options: [] }] },
      makeOpts({ signal: ac.signal, toolUseID: 'q-abort-evt' }),
    )
    ac.abort()
    await decision
    const resultEvent = events.find((e) => e.type === 'permission_result')
    expect(resultEvent).toBeDefined()
    if (resultEvent?.type === 'permission_result') {
      expect(resultEvent.toolName).toBe('AskUserQuestion')
      expect(resultEvent.decision).toBe('aborted')
    }
  })

  it('denies immediately (no event) when the signal is already aborted', async () => {
    const { emit, events } = makeEmit()
    const broker = new PermissionBroker({ emit, permissionMode: 'default' })
    const ac = new AbortController()
    ac.abort()
    const result = await broker.canUseTool(
      'Read',
      { file_path: 'x' },
      makeOpts({ signal: ac.signal, toolUseID: 'tu-pre' }),
    )
    expect(result.behavior).toBe('deny')
    // No permission_request should have been emitted for an already-dead turn.
    expect(events).toEqual([])
  })
})
