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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import type {
  HubClient,
  SubscriptionHandle,
} from './client'
import type {
  CoLiveEvent,
  PermissionRequestEvent,
  StatusState,
  UserQuestionEvent,
} from '../core/events'
import { interpretInput } from './slash'
import { reduceBlocks, initialBlockState } from './render/blocks'
import { flattenRows } from './render/rows'
import { computeWindow, scrollPage, scrollLine, pinBottom, afterContentChange, initialViewport } from './render/window'
import type { ViewportState } from './render/window'
import * as B from './input/buffer'
import type { EditBuffer } from './input/buffer'
import { renderInputRows } from './input/input-rows'
import { initNav, prev as histPrev, next as histNext, memoryHistoryStore } from './input/history'
import type { HistoryStore, HistoryNav } from './input/history'

/** Optional construction config for the app. */
export interface AppConfig {
  /** Working directory to start a NEW session in (passed to sendPrompt). */
  cwd?: string
  /** Replay buffered frames on subscribe (default true so late joiners catch up). */
  needReplay?: boolean
  /** Injected history persistence (defaults to an in-memory store if absent). */
  historyStore?: HistoryStore
  /** Project key for per-project history (the Hub base URL or cwd). */
  historyKey?: string
}

/** Props for the root {@link App}. The HubClient is injected for testability. */
export interface AppProps {
  client: HubClient
  /** Target session; omit to start a new session on the first prompt. */
  sessionId?: string
  config?: AppConfig
}

/* ------------------------------------------------------------------ */
/* Status model                                                        */
/* ------------------------------------------------------------------ */

/** Rows moved per mouse-wheel notch (1 felt sluggish for trackpads; reused by the Task 9 wheel handler). */
const WHEEL_STEP = 3

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

  const [transcript, dispatch] = useReducer(reduceBlocks, undefined, initialBlockState)
  const [verbose, setVerbose] = useState(false)
  const [viewport, setViewport] = useState<ViewportState>(initialViewport)
  const { stdout } = useStdout()
  const width = (stdout?.columns ?? 80)
  // Reserve lines for the chrome (scroll indicator + status + input) PLUS one
  // line of headroom. The headroom is load-bearing: ink redraws by moving the
  // cursor up N lines and overwriting in place; if our total output exactly
  // fills the terminal, the final newline scrolls the terminal up by one, ink's
  // cursor math drifts, and every streamed frame leaks a (raw) line into the
  // host scrollback. Keeping output strictly shorter than the terminal keeps the
  // viewport a clean fixed region (no scrollback fighting — UAT A1).
  const reserved = 4 // indicator + status + input + 1 line headroom
  const height = Math.max(4, (stdout?.rows ?? 24) - reserved)
  const [status, setStatus] = useState<StatusInfo>({ state: 'idle' })
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const [buf, setBuf] = useState<EditBuffer>(B.empty)

  const historyStore = useMemo<HistoryStore>(() => config?.historyStore ?? memoryHistoryStore(), [config?.historyStore])
  const historyKey = config?.historyKey ?? 'default'
  const [nav, setNav] = useState<HistoryNav>(() => initNav(historyStore.load(historyKey)))

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
      // The broker broadcasts exactly ONE terminal permission_result to ALL
      // co-live clients (desk + glasses) whenever ANY client answers a pending
      // permission/question — its documented purpose is to let clients dismiss
      // the rendered prompt. So this is the CLIENT-AGNOSTIC dismiss signal:
      // clear the pending UI here regardless of who answered. This is what makes
      // a REMOTE (glasses) answer dismiss the desk prompt — the desk never calls
      // respondPermission in that case, so the local-path clear never fires.
      // (A resolved question settles via permission_result decision:"answered",
      // per PermissionBroker.resolveQuestion, so this covers questions too.)
      // The local-answer path still works: it clears optimistically AND this
      // confirms it; clearing an already-undefined pending is a harmless no-op.
      setPending(undefined)
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
        dispatch({ type: 'reset', entries: seeded })
      } catch {
        // A failed seed must not crash the UI — just start with an empty scroll.
        if (!cancelled) dispatch({ type: 'reset', entries: [] })
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

  /* ------------------------- rows + window ------------------------- */

  // MEMOIZE the flatten so marked + cli-highlight don't re-run over every block
  // on each keystroke / 10s running_stats tick. transcript.blocks only changes
  // on a transcript event (not on input edits), so the memo skips the expensive
  // work while typing.
  const rows = useMemo(
    () => flattenRows(transcript.blocks, { width, verbose }),
    [transcript.blocks, width, verbose],
  )
  // follow bottom while streaming; hold position when scrolled up
  useEffect(() => { setViewport((vp) => afterContentChange(vp, rows.length, height)) }, [rows.length, height])
  const win = computeWindow(rows, height, viewport)

  /* ------------------------- input ------------------------- */

  useInput((ch, key) => {
    if (key.escape) {
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }

    // Mouse reports can arrive through useInput on some terminals — never let one
    // fire a key binding (wheel is handled separately via the 'input' channel).
    if (ch.startsWith('[<')) return

    if (pending) {
      if (/^[1-9]$/.test(ch)) { resolvePending(Number.parseInt(ch, 10) - 1); return }
      if (pending.kind === 'question') {
        if (key.return) { submitQuestionText(B.toText(buf)); setBuf(B.empty()); return }
        if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
        if (ch && !key.ctrl && !key.meta) setBuf((b) => B.insertText(b, ch))
      }
      return
    }

    // Ctrl-C quits; Ctrl-O toggles verbose (unchanged).
    if (key.ctrl && (ch === 'c' || ch === 'C')) { exit(); return }
    if (key.ctrl && (ch === 'o' || ch === 'O')) { setVerbose((v) => !v); return }

    // Enter submits; Ctrl-J (\n) and "\\"+Enter insert a newline.
    if (key.return) {
      const text = B.toText(buf)
      // Backslash-continuation: if the line the cursor is on ends in a single "\",
      // Enter inserts a newline (keep editing) instead of submitting. Anchored on the
      // CURSOR's line so it stays consistent with trimTrailingBackslash (which strips
      // from buf.row) now that ↑/↓ can move the cursor off the last line.
      if (buf.lines[buf.row]!.endsWith('\\')) {
        setBuf((b) => B.insertNewline(trimTrailingBackslash(b)))
        return
      }
      setBuf(B.empty())
      // Spec §5: record submitted PROMPTS only — never slash commands (they route
      // locally and are noise in recall). interpretInput is the single source of truth.
      const interpreted = interpretInput(text)
      if (interpreted.kind === 'prompt' && interpreted.text !== '') {
        historyStore.append(historyKey, interpreted.text)
        setNav(initNav(historyStore.load(historyKey)))
      }
      submitLine(text)
      return
    }
    if (ch === '\n' || (key.ctrl && (ch === 'j' || ch === 'J'))) { setBuf(B.insertNewline); return }

    // Editing keys.
    if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
    if (key.ctrl && (ch === 'w' || ch === 'W')) { setBuf(B.deleteWordBackward); return }
    if (key.leftArrow && key.meta)  { setBuf(B.moveWordLeft); return }
    if (key.rightArrow && key.meta) { setBuf(B.moveWordRight); return }
    if (key.leftArrow)  { setBuf(B.moveLeft); return }
    if (key.rightArrow) { setBuf(B.moveRight); return }
    if (key.upArrow) {
      const m = B.moveUp(buf)
      if (!m.atEdge) { setBuf(m.buffer); return }
      const r = histPrev(nav, B.toText(buf))
      setNav(r.nav); setBuf(B.fromText(r.text)); return
    }
    if (key.downArrow) {
      const m = B.moveDown(buf)
      if (!m.atEdge) { setBuf(m.buffer); return }
      const r = histNext(nav, B.toText(buf))
      setNav(r.nav); setBuf(B.fromText(r.text)); return
    }

    if (key.pageUp)   { setViewport((vp) => scrollPage(vp, rows.length, height, -1)); return }
    if (key.pageDown) { setViewport((vp) => scrollPage(vp, rows.length, height, 1)); return }
    if (key.end) {
      if (B.isBlank(buf)) { setViewport(pinBottom(rows.length, height)); return }
      setBuf(B.moveLineEnd); return
    }
    // ink reports Home inconsistently; Ctrl-A / Ctrl-E are the reliable line-start/end.
    if (key.ctrl && (ch === 'a' || ch === 'A')) { setBuf(B.moveLineStart); return }
    if (key.ctrl && (ch === 'e' || ch === 'E')) { setBuf(B.moveLineEnd); return }

    // Printable characters extend the buffer at the cursor.
    if (ch && !key.ctrl && !key.meta) setBuf((b) => B.insertText(b, ch))
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
        {win.visible.map((row, i) => (
          <Text key={win.offset + i} wrap="truncate-end">{row}</Text>
        ))}
      </Box>
      {rows.length > height ? (
        <Box>
          <Text dimColor>
            rows {win.offset + 1}–{Math.min(win.offset + height, win.total)} of {win.total} {win.pinned ? '(pinned ▼)' : '▲▼ PgUp/PgDn · End'}
          </Text>
        </Box>
      ) : null}

      {pending ? <PendingPrompt pending={pending} input={B.toText(buf)} /> : null}

      <Box>
        <Text dimColor>
          [{statusLabel}{tokenStr}] {sid ? `session ${sid}` : 'new session'}
        </Text>
      </Box>

      {pending && pending.kind === 'question' ? null : (
        <Box flexDirection="column">
          {renderInputRows(buf, { width }).map((r, i) => (
            <Text key={`in-${i}`}>{r}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
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

/** Drop a single trailing "\" from the buffer's current line (backslash-continuation). */
function trimTrailingBackslash(b: EditBuffer): EditBuffer {
  const line = b.lines[b.row]!
  if (!line.endsWith('\\')) return b
  const lines = b.lines.slice()
  lines[b.row] = line.slice(0, -1)
  return { ...b, lines, col: Math.min(b.col, lines[b.row]!.length) }
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
