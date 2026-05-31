/**
 * Task 3.3 — the ink TUI root for the thin desk client.
 *
 * This is JUST ANOTHER CLIENT of the already-built Hub: it renders the live
 * session and forwards user actions through an INJECTED {@link HubClient}. It
 * never uses the SDK and never runs a model. Dependency injection is mandatory
 * so ink-testing-library can drive the whole UI with a fake client (no real
 * server/socket/model).
 *
 * Responsibilities:
 *  - Seed scrollback from client.fetchTranscript(sessionId), THEN open
 *    client.subscribe(sessionId, onEvent) for live frames; close the stream on
 *    unmount (the effect's cleanup return).
 *  - Reduce the {@link CoLiveEvent} stream into transcript turns (user_prompt;
 *    text_delta accumulated into the in-flight assistant turn; tool_start /
 *    tool_end summaries) + a status line (status / running_stats) + inline
 *    permission_request / user_question prompts.
 *  - A hand-rolled controlled input (via useInput — NO new dependency). On
 *    Enter the line runs through interpretInput (3.2): a PROMPT is POSTed via
 *    client.sendPrompt (capturing the Hub-resolved sessionId for a new session);
 *    /clear starts a new session + clears scrollback; every other command is
 *    handled locally and is NEVER posted.
 *  - Inline permission/question prompts: number keys select an option;
 *    selection calls client.respondPermission(sessionId, option.key, toolUseId)
 *    / client.respondQuestion(sessionId, answer, toolUseId). Esc interrupts.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type {
  HubClient,
  SubscriptionHandle,
  TranscriptEntry,
} from './client'
import type {
  CoLiveEvent,
  PermissionRequestEvent,
  StatusState,
  UserQuestionEvent,
} from '../core/events'
import { interpretInput } from './slash'

/** Optional construction config for the app. */
export interface AppConfig {
  /** Working directory to start a NEW session in (passed to sendPrompt). */
  cwd?: string
  /** Replay buffered frames on subscribe (default true so late joiners catch up). */
  needReplay?: boolean
}

/** Props for the root {@link App}. The HubClient is injected for testability. */
export interface AppProps {
  client: HubClient
  /** Target session; omit to start a new session on the first prompt. */
  sessionId?: string
  config?: AppConfig
}

/* ------------------------------------------------------------------ */
/* Transcript model                                                    */
/* ------------------------------------------------------------------ */

/** One rendered line in the scrollback. */
type Line =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; summary?: string }
  | { kind: 'note'; text: string }

interface TranscriptState {
  lines: Line[]
  /** Index of the open assistant turn that text_delta appends to, or -1. */
  openAssistant: number
}

type TranscriptAction =
  | { type: 'reset'; lines: Line[] }
  | { type: 'clear' }
  | { type: 'event'; event: CoLiveEvent }
  | { type: 'note'; text: string }
  | { type: 'localUser'; text: string }

/** Map a seeded transcript entry to a rendered line. */
function entryToLine(entry: TranscriptEntry): Line {
  if (entry.role === 'assistant') return { kind: 'assistant', text: entry.text }
  if (entry.role === 'user') return { kind: 'user', text: entry.text }
  return { kind: 'note', text: `${entry.role}: ${entry.text}` }
}

function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case 'reset':
      return { lines: action.lines, openAssistant: -1 }
    case 'clear':
      return { lines: [], openAssistant: -1 }
    case 'note':
      return { lines: [...state.lines, { kind: 'note', text: action.text }], openAssistant: -1 }
    case 'localUser':
      return {
        lines: [...state.lines, { kind: 'user', text: action.text }],
        openAssistant: -1,
      }
    case 'event':
      return applyEvent(state, action.event)
    default:
      return state
  }
}

/** Fold a single live event into the transcript model. */
function applyEvent(state: TranscriptState, event: CoLiveEvent): TranscriptState {
  switch (event.type) {
    case 'user_prompt': {
      return {
        lines: [...state.lines, { kind: 'user', text: event.text }],
        openAssistant: -1,
      }
    }
    case 'text_delta': {
      const lines = state.lines.slice()
      if (state.openAssistant >= 0 && lines[state.openAssistant]?.kind === 'assistant') {
        const open = lines[state.openAssistant] as { kind: 'assistant'; text: string }
        lines[state.openAssistant] = { kind: 'assistant', text: open.text + event.text }
        return { lines, openAssistant: state.openAssistant }
      }
      lines.push({ kind: 'assistant', text: event.text })
      return { lines, openAssistant: lines.length - 1 }
    }
    case 'tool_start': {
      return {
        lines: [...state.lines, { kind: 'tool', name: event.name }],
        openAssistant: -1,
      }
    }
    case 'tool_end': {
      return {
        lines: [...state.lines, { kind: 'tool', name: event.name, summary: event.summary }],
        openAssistant: -1,
      }
    }
    case 'result': {
      // The final assistant text is already streamed via text_delta; close the
      // open assistant turn so the next reply starts fresh.
      return { lines: state.lines, openAssistant: -1 }
    }
    case 'notification': {
      return {
        lines: [...state.lines, { kind: 'note', text: `${event.title}: ${event.message}` }],
        openAssistant: -1,
      }
    }
    case 'error': {
      return {
        lines: [...state.lines, { kind: 'note', text: `error: ${event.message}` }],
        openAssistant: -1,
      }
    }
    default:
      // status / running_stats / permission_request / user_question /
      // permission_result / task_progress are handled outside the transcript.
      return state
  }
}

/* ------------------------------------------------------------------ */
/* Status model                                                        */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<StatusState, string> = {
  busy: 'busy',
  think_start: 'thinking',
  think_end: 'idle',
  text_start: 'responding',
  text_end: 'idle',
  idle: 'idle',
}

interface StatusInfo {
  state: StatusState
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
}

/* ------------------------------------------------------------------ */
/* Pending interactive prompt (permission / question)                  */
/* ------------------------------------------------------------------ */

type Pending =
  | { kind: 'permission'; event: PermissionRequestEvent }
  | { kind: 'question'; event: UserQuestionEvent }

/* ------------------------------------------------------------------ */
/* The root component                                                  */
/* ------------------------------------------------------------------ */

export function App({ client, sessionId: initialSessionId, config }: AppProps): React.ReactElement {
  const { exit } = useApp()

  const [transcript, dispatch] = useReducer(transcriptReducer, {
    lines: [],
    openAssistant: -1,
  })
  const [status, setStatus] = useState<StatusInfo>({ state: 'idle' })
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const [input, setInput] = useState('')

  // The session id can change at runtime (resolved by the Hub on a new session,
  // or reset by /clear). A ref keeps the latest value available to async
  // callbacks (sendPrompt resolution, key handlers) without stale closures.
  const sessionIdRef = useRef<string | undefined>(initialSessionId)
  const [, forceSessionRender] = useState(0)
  const setSessionId = useCallback((id: string | undefined) => {
    sessionIdRef.current = id
    forceSessionRender((n) => n + 1)
  }, [])

  // Subscribe state lives in a ref so the effect can re-open the stream when the
  // session id changes (e.g. after /clear or a new-session resolution).
  const onEventRef = useRef<(e: CoLiveEvent) => void>(() => {})
  onEventRef.current = (event: CoLiveEvent) => {
    if (event.type === 'status') {
      setStatus((prev) => ({ ...prev, state: event.state }))
      return
    }
    if (event.type === 'running_stats') {
      setStatus((prev) => ({
        ...prev,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        durationMs: event.durationMs,
      }))
      return
    }
    if (event.type === 'permission_request') {
      setPending({ kind: 'permission', event })
      return
    }
    if (event.type === 'user_question') {
      setPending({ kind: 'question', event })
      return
    }
    if (event.type === 'permission_result') {
      dispatch({ type: 'note', text: `permission ${event.decision}: ${event.summary}` })
      return
    }
    dispatch({ type: 'event', event })
  }

  // Seed scrollback, then open the live stream. Re-runs when the session id
  // changes; always closes the previous subscription first (cleanup return).
  const subSessionId = sessionIdRef.current
  useEffect(() => {
    let cancelled = false
    let handle: (SubscriptionHandle & (() => void)) | undefined

    if (subSessionId === undefined) return

    void (async () => {
      try {
        const seeded = await client.fetchTranscript(subSessionId)
        if (cancelled) return
        dispatch({ type: 'reset', lines: seeded.map(entryToLine) })
      } catch {
        // A failed seed must not crash the UI — just start with an empty scroll.
        if (!cancelled) dispatch({ type: 'reset', lines: [] })
      }
      if (cancelled) return
      handle = client.subscribe(
        subSessionId,
        (e) => onEventRef.current(e),
        { needReplay: config?.needReplay ?? true },
      )
    })()

    return () => {
      cancelled = true
      handle?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, subSessionId])

  /* ------------------------- actions ------------------------- */

  const submitLine = useCallback(
    (raw: string) => {
      const result = interpretInput(raw)
      if (result.kind === 'prompt') {
        if (result.text === '') return
        const current = sessionIdRef.current
        dispatch({ type: 'localUser', text: result.text })
        void (async () => {
          try {
            const args = current !== undefined ? { text: result.text, sessionId: current } : { text: result.text, cwd: config?.cwd }
            const res = await client.sendPrompt(args)
            if (res.sessionId && res.sessionId !== sessionIdRef.current) {
              setSessionId(res.sessionId)
            }
          } catch (err) {
            dispatch({ type: 'note', text: `prompt failed: ${err instanceof Error ? err.message : String(err)}` })
          }
        })()
        return
      }
      if (result.kind === 'hint') {
        dispatch({ type: 'note', text: result.message })
        return
      }
      // result.kind === 'command'
      switch (result.command) {
        case 'new_session':
          setSessionId(undefined)
          dispatch({ type: 'clear' })
          setStatus({ state: 'idle' })
          setPending(undefined)
          return
        case 'note':
          dispatch({ type: 'note', text: result.message })
          return
        case 'help':
          dispatch({ type: 'note', text: result.message })
          return
        case 'view':
          dispatch({ type: 'note', text: renderView(result.view, status) })
          return
        default:
          return
      }
    },
    [client, config?.cwd, setSessionId, status],
  )

  const resolvePending = useCallback(
    (choiceIndex: number) => {
      const p = pending
      if (!p) return
      const sid = sessionIdRef.current
      if (sid === undefined) return
      if (p.kind === 'permission') {
        const opt = p.event.options[choiceIndex]
        if (!opt) return
        setPending(undefined)
        void client.respondPermission(sid, opt.key, p.event.toolUseId).catch(() => {})
      } else {
        const answer = p.event.options[choiceIndex]
        if (answer === undefined) return
        setPending(undefined)
        void client.respondQuestion(sid, answer, p.event.toolUseId).catch(() => {})
      }
    },
    [client, pending],
  )

  const submitQuestionText = useCallback(
    (text: string) => {
      const p = pending
      if (!p || p.kind !== 'question') return
      const sid = sessionIdRef.current
      if (sid === undefined || text === '') return
      setPending(undefined)
      void client.respondQuestion(sid, text, p.event.toolUseId).catch(() => {})
    },
    [client, pending],
  )

  /* ------------------------- input ------------------------- */

  useInput((ch, key) => {
    if (key.escape) {
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }

    // When a permission/question prompt is open, number keys pick an option.
    if (pending) {
      if (/^[1-9]$/.test(ch)) {
        resolvePending(Number.parseInt(ch, 10) - 1)
        return
      }
      // A question also accepts a typed free-text answer (Enter submits it).
      if (pending.kind === 'question') {
        if (key.return) {
          submitQuestionText(input)
          setInput('')
          return
        }
        if (key.backspace || key.delete) {
          setInput((s) => s.slice(0, -1))
          return
        }
        if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch)
      }
      return
    }

    if (key.return) {
      const line = input
      setInput('')
      submitLine(line)
      return
    }
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1))
      return
    }
    if (key.ctrl && (ch === 'c' || ch === 'C')) {
      exit()
      return
    }
    // Printable characters (ignore control combos) extend the input buffer.
    if (ch && !key.ctrl && !key.meta) {
      setInput((s) => s + ch)
    }
  })

  /* ------------------------- render ------------------------- */

  const statusLabel = STATUS_LABEL[status.state]
  const tokenStr =
    status.inputTokens !== undefined || status.outputTokens !== undefined
      ? ` · ${(status.inputTokens ?? 0) + (status.outputTokens ?? 0)} tokens (${status.inputTokens ?? 0} in / ${status.outputTokens ?? 0} out)`
      : ''
  const sid = sessionIdRef.current

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {transcript.lines.map((line, i) => (
          <TranscriptLine key={i} line={line} />
        ))}
      </Box>

      {pending ? <PendingPrompt pending={pending} input={input} /> : null}

      <Box>
        <Text dimColor>
          [{statusLabel}{tokenStr}] {sid ? `session ${sid}` : 'new session'}
        </Text>
      </Box>

      {pending && pending.kind === 'question' ? null : (
        <Box>
          <Text>{'> '}</Text>
          <Text>{input}</Text>
        </Box>
      )}
    </Box>
  )
}

/** Render one scrollback line. */
function TranscriptLine({ line }: { line: Line }): React.ReactElement {
  switch (line.kind) {
    case 'user':
      return (
        <Text>
          <Text color="cyan">you</Text> {line.text}
        </Text>
      )
    case 'assistant':
      return (
        <Text>
          <Text color="green">claude</Text> {line.text}
        </Text>
      )
    case 'tool':
      return (
        <Text dimColor>
          ⚙ {line.name}
          {line.summary ? ` — ${line.summary}` : ''}
        </Text>
      )
    case 'note':
    default:
      return <Text dimColor>{line.text}</Text>
  }
}

/** Render the inline permission / question prompt. */
function PendingPrompt({ pending, input }: { pending: Pending; input: string }): React.ReactElement {
  if (pending.kind === 'permission') {
    const e = pending.event
    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text>
          <Text color="yellow">permission</Text> {e.toolName}
          {e.detail ? `: ${e.detail}` : ''}
        </Text>
        {e.description ? <Text dimColor>{e.description}</Text> : null}
        {e.options.map((opt, i) => (
          <Text key={opt.key + String(i)}>
            {`  [${i + 1}] ${opt.text}`}
          </Text>
        ))}
      </Box>
    )
  }
  const e = pending.event
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text>
        <Text color="yellow">question</Text> {e.question}
      </Text>
      {e.options.map((opt, i) => (
        <Text key={opt + String(i)}>{`  [${i + 1}] ${opt}`}</Text>
      ))}
      <Box>
        <Text>{'answer> '}</Text>
        <Text>{input}</Text>
      </Box>
    </Box>
  )
}

/** Build a local view string for /context and /usage from current state. */
function renderView(view: 'context' | 'usage', status: StatusInfo): string {
  if (view === 'usage') {
    return [
      'Usage:',
      `  input tokens:  ${status.inputTokens ?? 0}`,
      `  output tokens: ${status.outputTokens ?? 0}`,
      `  last turn:     ${status.durationMs ?? 0} ms`,
    ].join('\n')
  }
  return [
    'Context:',
    `  status: ${STATUS_LABEL[status.state]}`,
  ].join('\n')
}
