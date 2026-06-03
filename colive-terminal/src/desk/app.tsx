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
import { Box, Text, useApp, useInput, usePaste, useStdin, useStdout } from 'ink'
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
import type { MouseMode } from './slash'
import { filterSlash } from './input/menu'
import { slashMenuItems } from './slash'
import { MOUSE_ON, MOUSE_OFF } from './mouse-mode'
import { reduceBlocks, initialBlockState } from './render/blocks'
import { flattenRows } from './render/rows'
import { computeWindow, scrollPage, scrollLine, pinBottom, afterContentChange, initialViewport } from './render/window'
import type { ViewportState } from './render/window'
import * as B from './input/buffer'
import type { EditBuffer } from './input/buffer'
import { renderInputRows } from './input/input-rows'
import { parseSgrMouse, isMouseReport } from './input/mouse'
import { initNav, prev as histPrev, next as histNext, memoryHistoryStore } from './input/history'
import type { HistoryStore } from './input/history'
import { appendFileSync } from 'node:fs'

// A4 diagnostic logger: opt-in via COLIVE_A4_LOG=<path>; a no-op otherwise. Lets us CONFIRM
// arrow-key batching on real hardware (multiple ↑/↓ arriving in one stdin tick) without
// changing normal behaviour. (Date.now() is fine in production — only the sandbox forbids it.)
const A4_LOG = process.env.COLIVE_A4_LOG
const a4log = (line: string): void => {
  if (A4_LOG) {
    try {
      appendFileSync(A4_LOG, line + '\n')
    } catch {
      /* best-effort — never crash the composer on a diagnostic write */
    }
  }
}

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
  const [status, setStatus] = useState<StatusInfo>({ state: 'idle' })
  const [pending, setPending] = useState<Pending | undefined>(undefined)
  const [buf, setBuf] = useState<EditBuffer>(B.empty)
  // UAT A6 — runtime mouse-reporting mode. Defaults to 'scroll' (mouse ON, wheel
  // scrolls the transcript) to match the alt-screen enter sequence in src/index.ts.
  // /select flips to 'select' (mouse OFF) so native click-drag copy works.
  const [mouseMode, setMouseMode] = useState<MouseMode>('scroll')

  // Bracketed paste rides ink's separate channel (never reaches useInput), so multi-line
  // pasted text lands in the buffer and can never trigger per-char or submit logic.
  usePaste((text) => { setBuf((b) => B.insertText(b, text)) })

  const historyStore = useMemo<HistoryStore>(() => config?.historyStore ?? memoryHistoryStore(), [config?.historyStore])
  const historyKey = config?.historyKey ?? 'default'
  // History navigation cursor. A REF (not state) on purpose: it is NEVER read in render
  // (the composer re-render is driven entirely by setBuf), and the ↑/↓ edge branch advances
  // it from INSIDE a functional setBuf updater — reading state there would be stale under
  // input batching (the A4 bug). A ref always exposes the freshest value to the next batched
  // event. (initNav once; reset on every submit below.)
  const navRef = useRef(initNav(historyStore.load(historyKey)))

  // Slash-command completion menu. It is open exactly when the composer holds a single
  // leading-"/" token that matches at least one command (filterSlash returns the items,
  // else null). app.tsx owns the highlight index; the items list is memoized once.
  const [menuIndex, setMenuIndex] = useState(0)
  const menuItems = useMemo(() => slashMenuItems(), [])
  const menu = filterSlash(B.toText(buf), menuItems) // null when the menu is closed
  const menuOpen = menu !== null
  const clampedMenuIndex = menu ? Math.min(menuIndex, menu.length - 1) : 0
  // Reset the menu highlight to the top whenever the composer text changes (a re-filter).
  // ↑/↓ move the highlight without changing the text, so they are unaffected.
  useEffect(() => { setMenuIndex(0) }, [B.toText(buf)])

  // Reserve lines for the chrome (scroll indicator + status line + 1 line of headroom)
  // PLUS the composer's own rows, which grow as the buffer gains lines. The headroom is
  // load-bearing: ink redraws by moving the cursor up N lines and overwriting in place; if
  // total output exactly fills the terminal, the trailing newline scrolls the host and ink's
  // cursor math drifts (leaking lines into scrollback). Keeping output strictly shorter than
  // the terminal keeps the viewport a clean fixed region (UAT A1).
  const menuRowCount = menuOpen ? menu!.length : 0
  const inputRowCount = pending && pending.kind === 'question' ? 0 : renderInputRows(buf, { width }).length
  const reserved = 3 + inputRowCount + menuRowCount // 3 = indicator + status + headroom
  const height = Math.max(4, (stdout?.rows ?? 24) - reserved)

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
        case 'mouse_mode':
          // Emit the DECSET toggle at runtime. These set terminal MODES (not screen
          // content), so the write does not corrupt ink's frame — ink only diffs its
          // own frame string. Reuses the same literals src/index.ts writes on
          // enter/exit (via ./mouse-mode), so on-exit cleanup always matches.
          stdout?.write(result.mode === 'select' ? MOUSE_OFF : MOUSE_ON)
          setMouseMode(result.mode)
          return
        default:
          return
      }
    },
    [client, config?.cwd, setSessionId, status, stdout],
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

  // Mouse wheel scrolls the transcript. ink re-emits every non-paste byte verbatim on its
  // internal 'input' channel, so we tap that and parse the raw SGR mouse report ourselves.
  // We read the mouse-wheel off ink's undocumented internal 'input' emitter (an ink 7
  // internal). Mechanism + the SGR/ESC details: knowledge/terminal-mode/ink7-input-internals.md.
  const { internal_eventEmitter } = useStdin() as unknown as {
    internal_eventEmitter?: { on(e: string, l: (s: string) => void): void; removeListener(e: string, l: (s: string) => void): void }
  }
  useEffect(() => {
    const em = internal_eventEmitter
    if (!em) return
    const onInput = (raw: string): void => {
      // DIAGNOSTIC (opt-in via COLIVE_A4_LOG): record EVERY raw sequence on ink's 'input'
      // channel — this is where mouse reports (and their bursts) arrive verbatim. Pairing this
      // with the per-useInput log below lets us reconstruct exactly what an Option+double-click
      // emits and why it reaches the ↑/↓ branch. No-op unless the env var is set.
      if (A4_LOG) a4log(JSON.stringify({ t: Date.now(), src: 'input-channel', bytes: [...raw].map((c) => c.charCodeAt(0)), str: raw }))
      // The emitter delivers the raw SGR mouse report WITH a leading ESC; parseSgrMouse is
      // anchored on "[<", so strip the ESC first. Non-wheel / non-mouse input → null → ignored.
      const seq = raw.startsWith('\x1b') ? raw.slice(1) : raw
      const dir = parseSgrMouse(seq)
      if (dir !== null) setViewport((vp) => scrollLine(vp, rows.length, height, dir, WHEEL_STEP))
    }
    em.on('input', onInput)
    return () => em.removeListener('input', onInput)
  }, [internal_eventEmitter, rows.length, height])

  /* ------------------------- input ------------------------- */

  useInput((ch, key) => {
    // DIAGNOSTIC (opt-in via COLIVE_A4_LOG): log EVERY useInput event BEFORE the mouse gate, with
    // all the key flags + whether isMouseReport would drop it. This captures the events a mouse
    // double-click produces (incl. any phantom ↑/↓ whose ch is empty) so we can see exactly what
    // fires the history/nav branch. No-op unless the env var is set.
    if (A4_LOG) {
      a4log(JSON.stringify({ t: Date.now(), src: 'useInput', bytes: [...ch].map((c) => c.charCodeAt(0)), str: ch, up: !!key.upArrow, down: !!key.downArrow, left: !!key.leftArrow, right: !!key.rightArrow, meta: !!key.meta, ctrl: !!key.ctrl, ret: !!key.return, esc: !!key.escape, mouseReport: isMouseReport(ch), row: buf.row, lines: buf.lines.length, col: buf.col }))
    }

    // Mouse reports can arrive through useInput on some terminals — drop ALL of them before any
    // key handling (logger, escape, history, typing). The wheel is handled separately via the
    // internal 'input' channel; this gate stops every other report form (Option+click etc.) from
    // firing a key binding or leaking into the composer as garbage text. isMouseReport tolerates
    // the leading ESC / split forms the old `ch.startsWith('[<')` guard missed.
    if (isMouseReport(ch)) return

    // A4 diagnostic (opt-in, no-op unless COLIVE_A4_LOG is set): log every ↑/↓ as it arrives
    // so coalesced bytes / auto-repeat (multiple events in one stdin tick) are visible on real
    // hardware. Logs the raw bytes + the buffer position at the moment of the event.
    if (A4_LOG && (key.upArrow || key.downArrow)) {
      a4log(JSON.stringify({ t: Date.now(), dir: key.upArrow ? 'UP' : 'DOWN', bytes: [...ch].map((c) => c.charCodeAt(0)), upArrow: key.upArrow, downArrow: key.downArrow, meta: key.meta, row: buf.row, lines: buf.lines.length, col: buf.col }))
    }

    if (key.escape) {
      if (menuOpen) { setBuf(B.empty()); return }       // close the menu, clear the token
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      return
    }

    // Slash-menu navigation, captured ONLY while the menu is open. ↑/↓ move the
    // highlight; Tab completes. Enter and printable chars deliberately fall through:
    // Enter submits via the normal path (slash commands route locally, never POSTed)
    // and a printable char extends the buffer, which re-filters the menu.
    if (menuOpen && !pending) {
      if (key.upArrow)   { setMenuIndex((i) => Math.max(0, Math.min(i, menu!.length - 1) - 1)); return }
      if (key.downArrow) { setMenuIndex((i) => Math.min(menu!.length - 1, i + 1)); return }
      if (key.tab) { setBuf(B.fromText('/' + menu![clampedMenuIndex]!.name)); setMenuIndex(0); return }
    }

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
      }
      // Reset navigation to the (possibly updated) tail after EVERY submit, so a later
      // ↑ starts from the most-recent entry even when this submit was a slash command.
      navRef.current = initNav(historyStore.load(historyKey))
      submitLine(text)
      return
    }
    if (ch === '\n' || (key.ctrl && (ch === 'j' || ch === 'J'))) { setBuf(B.insertNewline); return }

    // Editing keys.
    if (key.meta && (key.backspace || key.delete)) { setBuf(B.deleteWordBackward); return } // Option+Backspace (must precede plain backspace)
    if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
    if (key.ctrl && (ch === 'w' || ch === 'W')) { setBuf(B.deleteWordBackward); return }
    if (key.leftArrow && key.meta)  { setBuf(B.moveWordLeft); return }
    if (key.rightArrow && key.meta) { setBuf(B.moveWordRight); return }
    if (key.meta && (ch === 'b' || ch === 'B')) { setBuf(B.moveWordLeft); return }   // readline ESC-b (Option+Left)
    if (key.meta && (ch === 'f' || ch === 'F')) { setBuf(B.moveWordRight); return }  // readline ESC-f (Option+Right)
    if (key.leftArrow)  { setBuf(B.moveLeft); return }
    if (key.rightArrow) { setBuf(B.moveRight); return }
    // ↑/↓ use FUNCTIONAL setBuf updaters (like ← / →) so each event in a batched stdin tick
    // sees the freshest QUEUED buffer, not a stale closure capture (the A4 bug). The edge
    // branch has a history side-effect, so it reads/advances navRef.current — a ref is also
    // immune to the stale-closure problem and always exposes the latest nav to the next event.
    if (key.upArrow) {
      setBuf((b) => {
        const m = B.moveUp(b)
        if (!m.atEdge) return m.buffer
        const r = histPrev(navRef.current, B.toText(b))
        navRef.current = r.nav
        return B.fromText(r.text)
      })
      return
    }
    if (key.downArrow) {
      setBuf((b) => {
        const m = B.moveDown(b)
        if (!m.atEdge) return m.buffer
        const r = histNext(navRef.current, B.toText(b))
        navRef.current = r.nav
        return B.fromText(r.text)
      })
      return
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
          {mouseMode === 'select' ? ' · select-mode (wheel off · ⇧/⌥-drag to copy)' : ''}
        </Text>
      </Box>

      {menuOpen ? (
        <Box flexDirection="column">
          {menu!.map((item, i) => (
            <Text key={item.name} inverse={i === clampedMenuIndex}>
              {`/${item.name}  `}<Text dimColor>{item.desc}</Text>
            </Text>
          ))}
        </Box>
      ) : null}

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
