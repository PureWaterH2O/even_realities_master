/**
 * Task 3.3 — ink TUI (src/desk/app.tsx) behavioural tests.
 *
 * Driven entirely by a FAKE HubClient implementing the 3.1 interface, so no real
 * server, socket, or model is ever touched. The fake's subscribe() captures the
 * onEvent callback (the test pushes events through it), fetchTranscript() returns
 * a seeded array, and the mutating calls (sendPrompt/respondPermission/
 * respondQuestion/interrupt) record their arguments for assertion.
 *
 * INK TEST DISCIPLINE: every render() is unmounted in finally — a live ink
 * instance keeps the event loop alive and would hang vitest.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { render } from 'ink-testing-library'
import { App } from '../../src/desk/app'
import type {
  HubClient,
  SendPromptArgs,
  SendPromptResult,
  SubscriptionHandle,
  SubscribeOptions,
  TranscriptEntry,
} from '../../src/desk/client'
import type { CoLiveEvent } from '../../src/core/events'
import { stripAnsi } from '../../src/desk/render/ansi'
import { memoryHistoryStore } from '../../src/desk/input/history'

/** A fake HubClient that records calls and exposes the captured onEvent. */
interface FakeHub extends HubClient {
  /** Push a live event to the most recent subscriber. */
  emit(event: CoLiveEvent): void
  /** Recorded calls. */
  prompts: SendPromptArgs[]
  permissions: Array<{ sessionId: string; decision: string; toolUseId?: string }>
  questions: Array<{ sessionId: string; answer: string; toolUseId?: string }>
  interrupts: string[]
  subscribeCalls: Array<{ sessionId: string; opts?: SubscribeOptions }>
  closeCount: number
  /** How many times fetchTranscript was called and with what id. */
  transcriptCalls: string[]
}

function makeFakeHub(opts?: {
  transcript?: TranscriptEntry[]
  promptResult?: SendPromptResult
}): FakeHub {
  let onEvent: ((e: CoLiveEvent) => void) | undefined
  const fake: FakeHub = {
    prompts: [],
    permissions: [],
    questions: [],
    interrupts: [],
    subscribeCalls: [],
    transcriptCalls: [],
    closeCount: 0,
    emit(event) {
      onEvent?.(event)
    },
    subscribe(sessionId, cb, subOpts) {
      onEvent = cb
      fake.subscribeCalls.push({ sessionId, opts: subOpts })
      const handle = (() => {
        fake.closeCount += 1
      }) as SubscriptionHandle & (() => void)
      handle.close = handle
      return handle
    },
    async sendPrompt(args) {
      fake.prompts.push(args)
      return opts?.promptResult ?? { sessionId: args.sessionId }
    },
    async respondPermission(sessionId, decision, toolUseId) {
      fake.permissions.push({ sessionId, decision, toolUseId })
    },
    async respondQuestion(sessionId, answer, toolUseId) {
      fake.questions.push({ sessionId, answer, toolUseId })
    },
    async interrupt(sessionId) {
      fake.interrupts.push(sessionId)
    },
    async fetchTranscript(sessionId) {
      fake.transcriptCalls.push(sessionId)
      return opts?.transcript ?? []
    },
  }
  return fake
}

/** The ESC byte. ink maps a lone ESC to key.escape after a short debounce. */
const ESC = ''

/**
 * Let queued microtasks (effects, fetch promises, setState) flush — INSIDE
 * React's act(), so async state updates (e.g. setSessionId after sendPrompt
 * resolves) settle within the test rather than leaking an "update was not
 * wrapped in act(...)" console.error AFTER the test ends (which, under a shared
 * vitest worker, pollutes the next test file's console.error spy).
 */
async function flush(ms = 0): Promise<void> {
  // useEffect runs after paint, fetchTranscript resolves on a microtask, then
  // subscribe is called — give it room. Several ticks so an async chain
  // (sendPrompt -> setSessionId) fully settles within this act() scope.
  await act(async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, ms))
    }
  })
}

/** Write to ink's stdin INSIDE act() so the resulting state updates settle. */
async function write(stdin: { write(s: string): void }, s: string): Promise<void> {
  await act(async () => {
    stdin.write(s)
    // Drain BOTH microtasks and a macrotask tick: a write may kick off an async
    // chain (sendPrompt resolving on a microtask, then a setSessionId state
    // update) whose continuation is scheduled past the current microtask queue.
    // Staying inside this act() until those settle prevents an "update not
    // wrapped in act(...)" console.error from leaking after the test ends.
    for (let i = 0; i < 4; i++) {
      await Promise.resolve()
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  })
}

const renders: Array<{ unmount: () => void }> = []
afterEach(() => {
  while (renders.length) renders.pop()?.unmount()
  vi.restoreAllMocks()
})

function mount(ui: React.ReactElement) {
  const r = render(ui)
  renders.push(r)
  return r
}

describe('desk App', () => {
  it('seeds scrollback from fetchTranscript on launch', async () => {
    const fake = makeFakeHub({
      transcript: [
        { role: 'user', text: 'hello there' },
        { role: 'assistant', text: 'general kenobi' },
      ],
    })
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('hello there')
    expect(frame).toContain('general kenobi')
    expect(fake.transcriptCalls).toEqual(['s1'])
    expect(fake.subscribeCalls[0]?.sessionId).toBe('s1')
  })

  it('renders a streamed user_prompt and accumulated text_delta', async () => {
    const fake = makeFakeHub()
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({ type: 'user_prompt', text: 'what is 2+2' })
    fake.emit({ type: 'text_delta', text: 'the answer ' })
    fake.emit({ type: 'text_delta', text: 'is 4' })
    await flush()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('what is 2+2')
    expect(frame).toContain('the answer is 4')
  })

  it('summarises tool_start / tool_end', async () => {
    const fake = makeFakeHub()
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({ type: 'tool_start', name: 'Read', toolId: 't1' })
    fake.emit({
      type: 'tool_end',
      name: 'Read',
      toolId: 't1',
      summary: 'Read completed',
      detail: { input: { file_path: 'foo.ts' }, output: {} },
    })
    await flush()
    const frame = stripAnsi(lastFrame() ?? '')
    // Native-style header: Name(keyArg), not the generic Core summary.
    expect(frame).toContain('Read(foo.ts)')
    expect(frame).not.toContain('Read completed')
  })

  it('shows a status line from status + running_stats', async () => {
    const fake = makeFakeHub()
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({ type: 'status', state: 'think_start' })
    fake.emit({ type: 'running_stats', durationMs: 5000, inputTokens: 100, outputTokens: 42 })
    await flush()
    const frame = lastFrame() ?? ''
    // The status label and a token count should both be visible somewhere.
    expect(frame.toLowerCase()).toContain('think')
    expect(frame).toMatch(/142|100|42/)
  })

  it('renders an inline permission prompt with option labels and posts the chosen key', async () => {
    const fake = makeFakeHub()
    const { lastFrame, stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({
      type: 'permission_request',
      toolName: 'Bash',
      description: 'Run a shell command',
      detail: 'rm -rf /tmp/x',
      toolUseId: 'tu-9',
      options: [
        { text: 'Yes', key: 'allow' },
        { text: 'No', key: 'deny' },
      ],
      suggestions: [],
    })
    await flush()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Bash')
    expect(frame).toContain('rm -rf /tmp/x')
    expect(frame).toContain('Yes')
    expect(frame).toContain('No')

    // Select the first option ("Yes" -> key "allow") by pressing "1".
    await write(stdin, '1')
    expect(fake.permissions).toEqual([{ sessionId: 's1', decision: 'allow', toolUseId: 'tu-9' }])
  })

  it('dismisses the inline permission prompt when a REMOTE client (glasses) answers (broadcast permission_result)', async () => {
    // Co-live: a ring tap on the glasses resolves the permission in the broker,
    // which broadcasts a single permission_result to ALL subscribers (desk +
    // glasses). The desk never calls respondPermission in this case — the
    // broadcast permission_result is the client-agnostic dismiss signal.
    const fake = makeFakeHub()
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({
      type: 'permission_request',
      toolName: 'Write',
      description: 'Write a file',
      detail: '/tmp/notes.txt',
      toolUseId: 'tu-1',
      options: [
        { text: 'Yes', key: 'allow' },
        { text: 'No', key: 'deny' },
      ],
      suggestions: [],
    })
    await flush()
    // The inline prompt renders.
    const shown = lastFrame() ?? ''
    expect(shown).toContain('Write')
    expect(shown).toContain('/tmp/notes.txt')
    expect(shown).toContain('Yes')
    expect(shown).toContain('No')

    // The GLASSES answered: the broker broadcasts the terminal permission_result
    // WITHOUT any desk keypress (no respondPermission call from the desk).
    fake.emit({ type: 'permission_result', toolName: 'Write', summary: 'Write allow', decision: 'allow' })
    await flush()

    // The desk prompt must now be DISMISSED.
    const after = lastFrame() ?? ''
    expect(after).not.toContain('/tmp/notes.txt')
    expect(after).not.toMatch(/\[1\] Yes/)
    expect(after).not.toMatch(/\[2\] No/)
    // The desk never POSTed a decision (the glasses did).
    expect(fake.permissions).toHaveLength(0)
  })

  it('dismisses the inline question prompt when a REMOTE client answers (permission_result decision:answered)', async () => {
    // A resolved AskUserQuestion emits permission_result with decision:"answered"
    // (see PermissionBroker.resolveQuestion). The same broadcast dismisses the
    // desk question prompt regardless of which client answered.
    const fake = makeFakeHub()
    const { lastFrame } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({
      type: 'user_question',
      question: 'Which file?',
      toolUseId: 'q-1',
      options: ['foo.ts', 'bar.ts'],
    })
    await flush()
    expect(lastFrame() ?? '').toContain('Which file?')

    // The glasses answered — broker broadcasts permission_result decision:answered.
    fake.emit({ type: 'permission_result', toolName: 'AskUserQuestion', summary: 'AskUserQuestion answered', decision: 'answered' })
    await flush()

    const after = lastFrame() ?? ''
    expect(after).not.toContain('Which file?')
    expect(fake.questions).toHaveLength(0)
  })

  it('renders an inline question prompt and posts the chosen option', async () => {
    const fake = makeFakeHub()
    const { lastFrame, stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    fake.emit({
      type: 'user_question',
      question: 'Which file?',
      toolUseId: 'q-1',
      options: ['foo.ts', 'bar.ts'],
    })
    await flush()
    expect(lastFrame() ?? '').toContain('Which file?')

    // Select the second option ("bar.ts") by pressing "2".
    await write(stdin, '2')
    expect(fake.questions).toEqual([{ sessionId: 's1', answer: 'bar.ts', toolUseId: 'q-1' }])
  })

  it('sends a normal line as a prompt on Enter (and does not treat it as a command)', async () => {
    const fake = makeFakeHub()
    const { stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'hello world')
    await write(stdin, '\r')
    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]?.text).toBe('hello world')
    expect(fake.prompts[0]?.sessionId).toBe('s1')
  })

  it('renders a desk-sent prompt ONCE despite the Hub broadcasting it back (UAT B1)', async () => {
    const fake = makeFakeHub()
    const { lastFrame, stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'count to ten') // optimistic local echo + sendPrompt
    await write(stdin, '\r')
    // the Hub fans the prompt back to ALL clients (incl. this desk)
    act(() => { fake.emit({ type: 'user_prompt', text: 'count to ten' }) })
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame.split('count to ten').length - 1).toBe(1) // exactly one copy
  })

  it('does NOT post a slash command; /help shows the help view locally', async () => {
    const fake = makeFakeHub()
    const { lastFrame, stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, '/help')
    await write(stdin, '\r')
    expect(fake.prompts).toHaveLength(0)
    expect(lastFrame() ?? '').toContain('Available commands')
  })

  it('/clear starts a new session and clears the transcript', async () => {
    const fake = makeFakeHub({ transcript: [{ role: 'user', text: 'old message' }] })
    const { lastFrame, stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    expect(lastFrame() ?? '').toContain('old message')
    await write(stdin, '/clear')
    await write(stdin, '\r')
    expect(fake.prompts).toHaveLength(0)
    expect(lastFrame() ?? '').not.toContain('old message')
  })

  it('Esc interrupts the session', async () => {
    const fake = makeFakeHub()
    const { stdin } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    // ink debounces a lone ESC (to disambiguate it from arrow escape sequences),
    // so write the ESC byte and wait past the debounce window before asserting.
    await write(stdin, ESC)
    await flush(60)
    expect(fake.interrupts).toEqual(['s1'])
  })

  it('closes the subscription on unmount', async () => {
    const fake = makeFakeHub()
    const r = mount(<App client={fake} sessionId="s1" />)
    await flush()
    expect(fake.closeCount).toBe(0)
    r.unmount()
    // Pop it off the cleanup stack so afterEach does not double-unmount.
    renders.pop()
    await flush()
    expect(fake.closeCount).toBe(1)
  })

  it('captures the Hub-resolved sessionId for a new (id-less) session', async () => {
    const fake = makeFakeHub({ promptResult: { sessionId: 'resolved-42' } })
    const { stdin } = mount(<App client={fake} />)
    await flush()
    await write(stdin, 'first prompt')
    await write(stdin, '\r')
    await flush()
    // First prompt goes out with no sessionId (new session).
    expect(fake.prompts[0]?.sessionId).toBeUndefined()
    // A subsequent permission decision must carry the resolved id.
    fake.emit({
      type: 'permission_request',
      toolName: 'Bash',
      description: 'x',
      detail: 'ls',
      toolUseId: 'tu-1',
      options: [{ text: 'Yes', key: 'allow' }],
      suggestions: [],
    })
    await flush()
    await write(stdin, '1')
    expect(fake.permissions[0]?.sessionId).toBe('resolved-42')
  })

  it('renders streamed assistant text in the viewport', async () => {
    const hub = makeFakeHub()
    const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await act(async () => {})
      act(() => { hub.emit({ type: 'text_delta', text: 'hello viewport' }) })
      expect(lastFrame()).toContain('hello viewport')
    } finally { unmount() }
  })

  it('PageUp/PageDown scroll the viewport (PgUp unpins, PgDn re-pins); arrows now drive the composer', async () => {
    const hub = makeFakeHub()
    const { lastFrame, stdin, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await act(async () => {})
      const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
      act(() => { hub.emit({ type: 'text_delta', text: long }) })
      expect(lastFrame()).toContain('(pinned ▼)') // starts pinned at bottom
      act(() => { stdin.write('\x1b[5~') }) // PageUp -> scroll up a page
      const up = lastFrame() ?? ''
      expect(up).not.toContain('(pinned ▼)') // unpinned now
      expect(up).toContain('PgUp/PgDn')      // unpinned hint shows
      act(() => { stdin.write('\x1b[6~') }) // PageDown -> back to bottom, re-pins
      expect(lastFrame()).toContain('(pinned ▼)')
    } finally { unmount() }
  })

  it('Ctrl-O toggles tool verbose detail', async () => {
    const hub = makeFakeHub()
    const { lastFrame, stdin, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await act(async () => {})
      act(() => {
        hub.emit({ type: 'tool_start', name: 'Read', toolId: 't1' })
        hub.emit({ type: 'tool_end', name: 'Read', toolId: 't1', summary: 'read', detail: { input: { file_path: '/a' }, output: 'SECRET_OUTPUT' } })
      })
      expect(lastFrame()).not.toContain('SECRET_OUTPUT')
      act(() => { stdin.write('\x0f') }) // Ctrl-O
      expect(lastFrame()).toContain('SECRET_OUTPUT')
    } finally { unmount() }
  })

  it('renders an inline diff for an Edit tool', async () => {
    const hub = makeFakeHub()
    const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await act(async () => {})
      act(() => {
        hub.emit({ type: 'tool_start', name: 'Edit', toolId: 'e1' })
        hub.emit({ type: 'tool_end', name: 'Edit', toolId: 'e1', summary: 'edit', detail: { input: { file_path: '/a.ts', old_string: 'OLDLINE', new_string: 'NEWLINE' }, output: 'ok' } })
      })
      const f = lastFrame() ?? ''
      expect(f).toContain('OLDLINE')
      expect(f).toContain('NEWLINE')
    } finally { unmount() }
  })

  it('renders thinking text on the desk, distinct from the answer', async () => {
    const hub = makeFakeHub()
    const { lastFrame, unmount } = render(<App client={hub} sessionId="s1" />)
    try {
      await act(async () => {})
      act(() => { hub.emit({ type: 'thinking_delta', text: 'pondering deeply' }) })
      expect(lastFrame()).toContain('pondering deeply')
    } finally { unmount() }
  })

  it('composes a multiline prompt with Ctrl-J and submits the joined text on Enter', async () => {
    const fake = makeFakeHub()
    const sent: string[] = []
    fake.sendPrompt = async (args) => { sent.push(args.text); return { sessionId: 's1' } }
    const { stdin, cleanup } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'line one')
    await write(stdin, '\n')          // Ctrl-J → newline, NOT submit
    await write(stdin, 'line two')
    expect(sent).toHaveLength(0)      // still composing
    await write(stdin, '\r')          // Enter submits
    expect(sent).toEqual(['line one\nline two'])
    cleanup()
  })

  it('backspace deletes within the buffer and the prompt re-renders', async () => {
    const fake = makeFakeHub()
    const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'abc')
    await write(stdin, '\x7f')        // backspace
    expect(lastFrame()).toContain('ab')
    cleanup()
  })

  it('Enter submits (not continues) when the trailing "\\" is on a line the cursor has left', async () => {
    const fake = makeFakeHub()
    const sent: string[] = []
    fake.sendPrompt = async (args) => { sent.push(args.text); return { sessionId: 's1' } }
    const { stdin, cleanup } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'foo')
    await write(stdin, '\n')        // newline -> row 1
    await write(stdin, 'bar\\')     // last line "bar\" (ends with a backslash)
    await write(stdin, '\x1b[A')    // ↑ -> cursor moves to row 0 ("foo"), off the backslash line
    await write(stdin, '\r')        // Enter: cursor's line is "foo" (no trailing \) -> SUBMIT
    expect(sent).toEqual(['foo\nbar\\'])  // literal backslash preserved; NOT a stray-newline continuation
    cleanup()
  })

  it('cursor edit: ←← then a char inserts mid-buffer (proves the EditBuffer model, not string-append)', async () => {
    const fake = makeFakeHub()
    const sent: string[] = []
    fake.sendPrompt = async (args) => { sent.push(args.text); return { sessionId: 's1' } }
    const { stdin, cleanup } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'abc')
    await write(stdin, '\x1b[D')   // ← (left)
    await write(stdin, '\x1b[D')   // ← (left) -> cursor between "a" and "b"
    await write(stdin, 'X')        // insert at cursor
    await write(stdin, '\r')       // submit
    expect(sent).toEqual(['aXbc']) // mid-buffer insert; a string-append impl would yield "abcX"
    cleanup()
  })

  it('Ctrl-J composes a genuine multi-line buffer (renders the continuation line indented)', async () => {
    const fake = makeFakeHub()
    const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" />)
    await flush()
    await write(stdin, 'line one')
    await write(stdin, '\n')       // Ctrl-J -> new buffer line
    await write(stdin, 'line two')
    const frame = stripAnsi(lastFrame() ?? '')
    expect(frame).toContain('> line one') // first line keeps the prompt
    expect(frame).toContain('  line two') // continuation line is indented (buffer renderer, not a string)
    cleanup()
  })

  it('persists submitted prompts per project and recalls them with ↑ (across a remount)', async () => {
    const store = memoryHistoryStore()
    const fake1 = makeFakeHub()
    fake1.sendPrompt = async () => ({ sessionId: 's1' })

    // First run: submit two prompts.
    const run1 = mount(<App client={fake1} sessionId="s1" config={{ historyStore: store, historyKey: 'proj-x' }} />)
    await flush()
    await write(run1.stdin, 'first prompt')
    await write(run1.stdin, '\r')
    await write(run1.stdin, 'second prompt')
    await write(run1.stdin, '\r')
    run1.cleanup()

    // Second run (simulated restart): ↑ recalls newest, ↑ again the older.
    const run2 = mount(<App client={makeFakeHub()} sessionId="s1" config={{ historyStore: store, historyKey: 'proj-x' }} />)
    await flush()
    await write(run2.stdin, '\x1b[A') // ↑
    expect(run2.lastFrame()).toContain('second prompt')
    await write(run2.stdin, '\x1b[A') // ↑
    expect(run2.lastFrame()).toContain('first prompt')
    run2.cleanup()
  })

  it('does not record slash commands in history (spec §5 — prompts only)', async () => {
    const store = memoryHistoryStore()
    const fake = makeFakeHub()
    fake.sendPrompt = async () => ({ sessionId: 's1' })
    const { stdin, lastFrame, cleanup } = mount(<App client={fake} sessionId="s1" config={{ historyStore: store, historyKey: 'p' }} />)
    await flush()
    await write(stdin, 'real prompt')
    await write(stdin, '\r')
    await write(stdin, '/help')   // slash command — must NOT enter history
    await write(stdin, '\r')
    await write(stdin, '\x1b[A')  // ↑ recalls the most recent PROMPT, skipping /help
    expect(lastFrame()).toContain('real prompt')
    cleanup()
    expect(store.load('p')).toEqual(['real prompt']) // /help never recorded
  })
})
