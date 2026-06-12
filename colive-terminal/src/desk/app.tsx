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
  QuestionSpec,
} from '../core/events'
import { interpretInput } from './slash'
import type { MouseMode } from './slash'
import { filterSlash, atContext } from './input/menu'
import { fuzzyFilter, defaultListFiles } from './input/files'
import { slashMenuItems } from './slash'
import { menuForCommand, actionForCommand, modelDisplayName } from './controls'
import type { ControlChoice } from './controls'
import { blue, bold as ansiBold, dim as ansiDim, cyan as ansiCyan, orange as ansiOrange } from './render/ansi'
import { wrapAnsi } from './render/wrap'
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
  /** Injected project file lister for @-autocomplete (defaults to git-backed defaultListFiles). */
  listFiles?: (cwd: string) => string[]
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

// PLAIN-arrow burst threshold. A real arrow keypress delivers 1 arrow per stdin tick; the A4
// "coalesced batched nav" case delivers 2–3 in one tick (must still nav). VS Code's integrated
// terminal emits DENSE BURSTS of 8–31 arrow-key sequences in ~3ms for certain scroll gestures
// (trackpad / diagonal / Option+double-click) — byte-identical to real presses. A batch of >= 4
// arrows in one synchronous tick is therefore a scroll-gesture artifact, not keystrokes.
const ARROW_BURST_THRESHOLD = 4

/** Max completion-menu rows shown (slash + @-file). */
const MENU_LIMIT = 10

const STATUS_LABEL: Record<StatusState, string> = {
  busy: 'busy',
  think_start: 'thinking',
  think_end: 'idle',
  text_start: 'responding',
  text_end: 'idle',
  idle: 'idle',
}

/** Present-continuous verbs for the in-turn activity spinner (`✱ Working…`, D-008). */
const SPINNER_VERBS = ['Working', 'Brewing', 'Crunching', 'Baking', 'Churning', 'Cogitating'] as const

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
  // D-032: which option is highlighted in the inline permission/question prompt.
  // ↑/↓ move it, Enter confirms it, digit keys bypass it. Reset to the first
  // option whenever a new prompt appears (effect below).
  const [permissionIndex, setPermissionIndex] = useState(0)
  // Multi-question AskUserQuestion: which question of the event's `questions`
  // list is active, and the answers collected so far (question text → answer).
  // One POST with the full map happens when the LAST question is answered.
  const [qIndex, setQIndex] = useState(0)
  const qAnswersRef = useRef<Record<string, string>>({})
  const [buf, setBuf] = useState<EditBuffer>(B.empty)
  // UAT A6 — runtime mouse-reporting mode. Defaults to 'scroll' (mouse ON, wheel
  // scrolls the transcript) to match the alt-screen enter sequence in src/index.ts.
  // /select flips to 'select' (mouse OFF) so native click-drag copy works.
  const [mouseMode, setMouseMode] = useState<MouseMode>('scroll')

  // M3.3b: the active model/mode shown in the status line. currentModel is seeded from the Hub's
  // /api/info (the serve default) and updated optimistically when a /model or /mode pick lands.
  const [currentModel, setCurrentModel] = useState<string>('')
  const [currentMode, setCurrentMode] = useState<string>('default')
  useEffect(() => { void client.getInfo().then((i) => setCurrentModel((cur) => cur || i.model)).catch(() => {}) }, [client])

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
  // Collects PLAIN (non-meta) arrows arriving in one synchronous stdin tick so a microtask can
  // see the WHOLE batch and decide real-keypress vs scroll-gesture burst. See ARROW_BURST_THRESHOLD.
  const arrowBatchRef = useRef<{ keys: Array<'up' | 'down' | 'left' | 'right'>; scheduled: boolean }>({ keys: [], scheduled: false })

  // @-file source + a lazy cache. The file list is enumerated once on first "@" use (git
  // ls-files / bounded walk), then reused — declared ABOVE the menu-derivation block because
  // atMatches calls ensureFiles(). Injectable via config.listFiles for tests.
  const listFiles = config?.listFiles ?? defaultListFiles
  const fileCwd = config?.cwd ?? process.cwd()
  const filesRef = useRef<string[] | null>(null)
  const ensureFiles = useCallback((): string[] => {
    if (filesRef.current === null) {
      try {
        filesRef.current = listFiles(fileCwd)
      } catch {
        filesRef.current = []
      }
    }
    return filesRef.current
  }, [listFiles, fileCwd])

  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const menuItems = useMemo(() => slashMenuItems(), [])

  // Two mutually-exclusive completion menus. The slash menu owns the WHOLE buffer (a single
  // leading-"/" token); the "@" menu owns a mid-line token under the cursor. Compute slash
  // first; only look for an "@" context when the slash menu is closed — they can never both open.
  // M3.3b: an EXACT picker command (/model, /mode) opens a second-level value menu that takes
  // precedence over — and is mutually exclusive with — the slash and @ menus.
  // Dynamic /model list (UAT 2026-06-12: the curated list was stale — no Fable 5).
  // When the /model picker opens, fetch the LIVE list from GET /api/models (the
  // SDK's Query.supportedModels) once per open; a non-empty result replaces the
  // curated fallback so new models appear without a desk release.
  const [liveModels, setLiveModels] = useState<ControlChoice[] | null>(null)
  const modelsFetchedRef = useRef(false)
  const staticPicker = menuForCommand(B.toText(buf).trim())
  const bufActionCmd = actionForCommand(B.toText(buf).trim())
  const pickerChoices =
    bufActionCmd === 'setModel' && liveModels !== null && liveModels.length > 0
      ? liveModels
      : staticPicker
  useEffect(() => {
    if (bufActionCmd !== 'setModel') {
      modelsFetchedRef.current = false
      return
    }
    if (modelsFetchedRef.current) return
    modelsFetchedRef.current = true
    const sid = sessionIdRef.current
    if (sid === undefined) return
    void client
      .fetchModels(sid)
      .then((models) => {
        if (models.length > 0) {
          setLiveModels(models.map((m) => ({ name: m.displayName, desc: m.description, value: m.value })))
        }
      })
      .catch(() => {})
  }, [bufActionCmd, client])
  const slashMenu = pickerChoices === null ? filterSlash(B.toText(buf), menuItems) : null
  const atCtx = pickerChoices === null && slashMenu === null && !menuDismissed ? atContext(buf.lines[buf.row]!, buf.col) : null
  const atMatches = atCtx ? fuzzyFilter(ensureFiles(), atCtx.query, MENU_LIMIT) : []
  const atMenu = atCtx && atMatches.length > 0 ? atMatches : null

  const menuOpen = pickerChoices !== null || slashMenu !== null || atMenu !== null
  const menuLength = pickerChoices ? pickerChoices.length : slashMenu ? slashMenu.length : atMenu ? atMenu.length : 0
  const clampedMenuIndex = menuOpen ? Math.min(menuIndex, menuLength - 1) : 0
  // Reset the highlight + un-dismiss whenever the composer text changes (a re-filter).
  useEffect(() => { setMenuIndex(0); setMenuDismissed(false) }, [B.toText(buf)])
  // D-032: reset the permission/question highlight to the first option whenever the
  // pending prompt changes (a new prompt, or it clears). Multi-question state
  // (step index + collected answers) resets with it.
  useEffect(() => {
    setPermissionIndex(0)
    setQIndex(0)
    qAnswersRef.current = {}
  }, [pending])

  // Reserve lines for the chrome (scroll indicator + status line + 1 line of headroom)
  // PLUS the composer's own rows, which grow as the buffer gains lines. The headroom is
  // load-bearing: ink redraws by moving the cursor up N lines and overwriting in place; if
  // total output exactly fills the terminal, the trailing newline scrolls the host and ink's
  // cursor math drifts (leaking lines into scrollback). Keeping output strictly shorter than
  // the terminal keeps the viewport a clean fixed region (UAT A1).
  // Pickers (/model, /mode) render a full native-style panel (title/blurb/rows/
  // footer), not just a value list — build it once so we both render it and
  // reserve its exact height. The slash/@ menus stay a simple `menuLength` list.
  const pickerAction = pickerChoices ? actionForCommand(B.toText(buf).trim()) : null
  const pickerPanel = pickerChoices && pickerAction
    ? buildPickerPanel(pickerChoices, pickerAction, pickerAction === 'setModel' ? currentModel : currentMode, clampedMenuIndex, width)
    : null
  const menuRowCount = pickerPanel ? pickerPanel.length : menuOpen ? menuLength : 0
  const inputRowCount = pending && pending.kind === 'question' ? 0 : renderInputRows(buf, { width }).length
  // D-008: an in-turn activity line (`✱ Working… (Ns · ↑ N tokens)`) shows while a
  // turn is active; reserve a row for it so it never pushes output past the viewport.
  const busyActive = STATUS_LABEL[status.state] !== 'idle' && !pending
  // D-029: the layout is now a fixed-height outer Box (= terminal rows) split into a
  // flexGrow top section (transcript + scroll + pending + spinner) and a bottom-pinned
  // chrome section (separator + status + hint + menu + input). The transcript window
  // must still be clipped to fit the top region, so reserve every NON-transcript row.
  // pendingRows is reserved too — a tall permission prompt lives in the top section and
  // would otherwise push the pinned input off a fixed-height screen.
  const termRows = stdout?.rows ?? 24
  const pendingRows = pending ? pendingRowCount(pending, B.toText(buf), width, qIndex) : 0
  // D-035: the todos/tasks panel is PINNED — it renders as a fixed section just
  // above the bottom chrome, OUTSIDE the scrollable transcript, so it stays
  // visible while tool output scrolls past (native keeps it as a persistent
  // widget). There is at most one todos block (the reducer's setTodos keeps a
  // single one), so pull it out here, render it separately below, and EXCLUDE it
  // from the transcript rows (or it would render twice). Its height is reserved
  // like the other non-transcript chrome so it never pushes the input off-screen.
  const todosBlock = transcript.blocks.find((b) => b.kind === 'todos')
  const todosRows = useMemo(
    () => (todosBlock ? flattenRows([todosBlock], { width, verbose }) : []),
    [todosBlock, width, verbose],
  )
  // 5 = separator (D-029) + scroll indicator + status line + "← for agents" hint (D-009) + headroom.
  const reserved = 5 + inputRowCount + menuRowCount + (busyActive ? 1 : 0) + pendingRows + todosRows.length
  const height = Math.max(4, termRows - reserved)

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
      if (result.kind === 'bash') {
        const current = sessionIdRef.current
        dispatch({ type: 'localUser', text: `! ${result.command}` })
        void (async () => {
          try {
            const args = current !== undefined
              ? { text: result.text, sessionId: current }
              : { text: result.text, cwd: config?.cwd }
            const res = await client.sendPrompt(args)
            if (res.sessionId && res.sessionId !== sessionIdRef.current) setSessionId(res.sessionId)
          } catch (err) {
            dispatch({ type: 'note', text: `bash failed: ${err instanceof Error ? err.message : String(err)}` })
          }
        })()
        return
      }
      // result.kind === 'command'
      switch (result.command) {
        case 'new_session':
          setSessionId(undefined)
          dispatch({ type: 'clear' })
          setStatus({ state: 'idle' })
          setPending(undefined)
          setCurrentMode('default')
          void client.getInfo().then((i) => setCurrentModel(i.model)).catch(() => {})
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

  // Answer the ACTIVE question of a pending user_question with `answerText`
  // (an option label or typed free text). Intermediate questions advance the
  // step; the LAST one posts the response — with the full answers map when
  // there was more than one question (the broker maps a bare answer onto the
  // first question only).
  const answerQuestion = useCallback(
    (answerText: string) => {
      const p = pending
      if (!p || p.kind !== 'question' || answerText === '') return
      const sid = sessionIdRef.current
      if (sid === undefined) return
      const specs = questionSpecs(p.event)
      const active = specs[Math.min(qIndex, specs.length - 1)]!
      const collected = { ...qAnswersRef.current, [active.question]: answerText }
      if (qIndex + 1 < specs.length) {
        qAnswersRef.current = collected
        setQIndex(qIndex + 1)
        setPermissionIndex(0)
        setBuf(B.empty())
        return
      }
      setPending(undefined)
      void client
        .respondQuestion(
          sid,
          answerText,
          p.event.toolUseId,
          specs.length > 1 ? collected : undefined,
        )
        .catch(() => {})
    },
    [client, pending, qIndex],
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
        const specs = questionSpecs(p.event)
        const active = specs[Math.min(qIndex, specs.length - 1)]!
        const opt = active.options[choiceIndex]
        if (opt === undefined) return
        answerQuestion(opt.label)
      }
    },
    [answerQuestion, client, pending, qIndex],
  )

  const submitQuestionText = useCallback(
    (text: string) => {
      if (text === '') return
      answerQuestion(text)
    },
    [answerQuestion],
  )

  // Apply ONE plain-arrow nav (used by the deferred batch flush below). Mirrors the old inline
  // ↑/↓/←/→ handlers exactly: ←/→ step a column; ↑/↓ step a row, recalling history at the top/
  // bottom edge. Uses FUNCTIONAL setBuf + the navRef so each arrow in a batch sees the freshest
  // queued buffer (no stale closure) — that's why this needs no buf/rows/height deps.
  const applyArrow = useCallback((dir: 'up' | 'down' | 'left' | 'right'): void => {
    if (dir === 'left') { setBuf(B.moveLeft); return }
    if (dir === 'right') { setBuf(B.moveRight); return }
    if (dir === 'up') {
      setBuf((b) => {
        const m = B.moveUp(b)
        if (!m.atEdge) return m.buffer
        const r = histPrev(navRef.current, B.toText(b))
        navRef.current = r.nav
        return B.fromText(r.text)
      })
      return
    }
    setBuf((b) => {
      const m = B.moveDown(b)
      if (!m.atEdge) return m.buffer
      const r = histNext(navRef.current, B.toText(b))
      navRef.current = r.nav
      return B.fromText(r.text)
    })
  }, [])
  // Flush the collected plain-arrow batch on a microtask: a dense burst (>= threshold) is a
  // terminal scroll-gesture artifact and is dropped wholesale; a small batch (1 real keypress,
  // or the A4 coalesced 2–3) applies each arrow's nav in order.
  const flushArrowBatch = useCallback((): void => {
    const { keys } = arrowBatchRef.current
    arrowBatchRef.current = { keys: [], scheduled: false }
    if (keys.length >= ARROW_BURST_THRESHOLD) return // dense burst = terminal scroll-gesture artifact, not keystrokes
    for (const dir of keys) applyArrow(dir)
  }, [applyArrow])

  /* ------------------------- rows + window ------------------------- */

  // MEMOIZE the flatten so marked + cli-highlight don't re-run over every block
  // on each keystroke / 10s running_stats tick. transcript.blocks only changes
  // on a transcript event (not on input edits), so the memo skips the expensive
  // work while typing.
  // D-035: the todos block is rendered as a PINNED panel below (see todosRows),
  // so exclude it here — otherwise it would scroll with the transcript AND
  // double-render in the pinned panel.
  const rows = useMemo(
    () => flattenRows(transcript.blocks.filter((b) => b.kind !== 'todos'), { width, verbose }),
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
      if (pickerChoices) { setBuf(B.empty()); return }  // picker: Esc clears the token (closes it), never interrupts
      if (atMenu) { setMenuDismissed(true); return }   // @ menu: hide, keep the typed line
      if (slashMenu) { setBuf(B.empty()); return }      // slash menu: clear the lone "/" token (unchanged)
      const sid = sessionIdRef.current
      if (sid !== undefined) void client.interrupt(sid).catch(() => {})
      // D-028: if a turn is actually in flight, mark the answer interrupted (adds
      // the native "└ Interrupted …" sub-line) and stop the activity spinner.
      if (sid !== undefined && STATUS_LABEL[status.state] !== 'idle') {
        dispatch({ type: 'interrupt' })
        setStatus((s) => ({ ...s, state: 'idle' }))
      }
      return
    }

    // Slash-menu navigation, captured ONLY while the menu is open. ↑/↓ move the
    // highlight; Tab completes. Enter and printable chars deliberately fall through:
    // Enter submits via the normal path (slash commands route locally, never POSTed)
    // and a printable char extends the buffer, which re-filters the menu.
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
      if (key.tab) {
        if (slashMenu) { setBuf(B.fromText('/' + slashMenu[clampedMenuIndex]!.name)); setMenuIndex(0); return }
        if (atMenu && atCtx) {
          const chosen = '@' + atMenu[clampedMenuIndex]! + ' ' // trailing space ends the token -> closes the menu
          setBuf((b) => B.replaceRange(b, atCtx.start, atCtx.end, chosen))
          setMenuIndex(0)
          return
        }
      }
      // The "@" menu also accepts on Enter; the slash menu deliberately does NOT (Enter submits it).
      if (atMenu && atCtx && key.return) {
        const chosen = '@' + atMenu[clampedMenuIndex]! + ' '
        setBuf((b) => B.replaceRange(b, atCtx.start, atCtx.end, chosen))
        setMenuIndex(0)
        return
      }
    }

    if (pending) {
      // D-032: ↑/↓ move the highlight; digit keys still select an option
      // directly, bypassing the highlight. For questions the navigable range
      // extends past the options onto "Type something" and "Chat about this"
      // (UAT 2026-06-12: those two rows were rendered but unreachable).
      const realOptions =
        pending.kind === 'question'
          ? questionSpecs(pending.event)[Math.min(qIndex, questionSpecs(pending.event).length - 1)]!.options.length
          : pending.event.options.length
      const navCount = pending.kind === 'question' ? realOptions + 2 : realOptions
      if (key.upArrow)   { setPermissionIndex((i) => Math.max(0, i - 1)); return }
      if (key.downArrow) { setPermissionIndex((i) => Math.min(navCount - 1, i + 1)); return }
      if (/^[1-9]$/.test(ch)) {
        const idx = Number.parseInt(ch, 10) - 1
        if (pending.kind === 'question' && idx >= realOptions && idx < navCount) {
          // Digit on "Type something" / "Chat about this": focus it (the user
          // types next), never a dead key and never a literal digit insert.
          setPermissionIndex(idx)
          return
        }
        resolvePending(idx)
        return
      }
      if (pending.kind === 'question') {
        // Enter submits typed free text when present (the "Type something" /
        // "Chat about this" path); with no typed text it confirms the
        // highlighted option (no-op on the two free-text rows — type first).
        if (key.return) {
          const typed = B.toText(buf)
          if (typed !== '') { submitQuestionText(typed); setBuf(B.empty()); return }
          if (permissionIndex < realOptions) resolvePending(permissionIndex)
          return
        }
        if (key.backspace || key.delete) { setBuf(B.deleteBackward); return }
        if (ch && !key.ctrl && !key.meta) setBuf((b) => B.insertText(b, ch))
        return
      }
      // permission: Enter confirms the highlighted option.
      if (key.return) { resolvePending(permissionIndex); return }
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
      } else if (interpreted.kind === 'bash') {
        historyStore.append(historyKey, text.trim())
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
    // Plain arrows are collected into a microtask batch so we can tell a real keypress (1/tick,
    // or the A4 coalesced 2–3) from a terminal SCROLL-GESTURE BURST (VS Code emits 8–31 arrow
    // keys in ~3ms for trackpad/diagonal scroll). A dense burst is ignored (it must not drive the
    // composer); small batches apply normally. See ARROW_BURST_THRESHOLD.
    // NOTE: this MUST stay AFTER the meta word-nav branches above (so Option+arrow word-nav stays
    // synchronous) and AFTER the menuOpen/pending blocks (their ↑/↓ stays synchronous).
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      const dir = key.upArrow ? 'up' : key.downArrow ? 'down' : key.leftArrow ? 'left' : 'right'
      const batch = arrowBatchRef.current
      batch.keys.push(dir)
      if (!batch.scheduled) { batch.scheduled = true; queueMicrotask(flushArrowBatch) }
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

  // D-009: native pipe-separated status line — "Opus 4.8 (1M context) | tokens: N".
  // We lack native's ctx%/5h/7d rate-limit data, so we show what we have (model +
  // total tokens). The permission mode is surfaced only when it's NOT the default
  // (plan / accept-edits matter and the banner — which shows mode — scrolls away
  // after the first turn). The select-mode affordance is preserved as a suffix.
  const statusSegments = [currentModel ? modelDisplayName(currentModel) : 'Claude']
  if (currentMode !== 'default') statusSegments.push(currentMode)
  statusSegments.push(`tokens: ${(status.inputTokens ?? 0) + (status.outputTokens ?? 0)}`)
  let statusLine = statusSegments.join(' | ')
  if (mouseMode === 'select') statusLine += ' · select-mode (wheel off · ⇧/⌥-drag to copy)'

  // D-008: in-turn activity line — "✱ <verb>… (Ns · ↑ N tokens)". Seconds + input
  // tokens come from running_stats; the verb is deterministic in the elapsed time.
  const spinnerSeconds = status.durationMs !== undefined ? Math.max(1, Math.round(status.durationMs / 1000)) : undefined
  const spinnerVerb = SPINNER_VERBS[(spinnerSeconds ?? 0) % SPINNER_VERBS.length]
  const spinnerMeta: string[] = []
  if (spinnerSeconds !== undefined) spinnerMeta.push(`${spinnerSeconds}s`)
  if (status.inputTokens !== undefined) spinnerMeta.push(`↑ ${status.inputTokens} tokens`)
  const spinnerText = `${spinnerVerb}…${spinnerMeta.length ? ` (${spinnerMeta.join(' · ')})` : ''}`

  // D-029/D-031 + wasted-space fix: a fixed-height outer Box (= terminal rows)
  // stacks the transcript, the pinned todos panel, the input chrome, then a
  // flexGrow SPACER. The spacer absorbs all slack at the BOTTOM, so content +
  // input sit together at the TOP and the empty space falls below the input —
  // matching native's inline rendering (the input follows the content; short
  // content leaves the gap at the foot of the screen, not in the middle). When
  // content overflows, the transcript window clips to `height`, the spacer
  // collapses to ~0, and the input ends up at the bottom as before.
  return (
    <Box flexDirection="column" height={termRows}>
      <Box flexDirection="column" flexShrink={0}>
        {transcript.blocks.length === 0 && !pending && !menuOpen ? (
          <Banner model={currentModel} mode={currentMode} cwd={fileCwd} />
        ) : null}
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

        {pending ? (
          <PendingPrompt
            pending={pending}
            input={B.toText(buf)}
            width={width}
            selectedIndex={Math.min(
              permissionIndex,
              pending.kind === 'question'
                ? questionSpecs(pending.event)[Math.min(qIndex, questionSpecs(pending.event).length - 1)]!.options.length + 1
                : pending.event.options.length - 1,
            )}
            questionIndex={qIndex}
          />
        ) : null}

        {busyActive ? (
          <Box>
            <Text color="yellow">✱ </Text>
            <Text dimColor>{spinnerText}</Text>
          </Box>
        ) : null}
      </Box>

      {/* D-035: pinned todos/tasks panel — a fixed widget between the scrollable
          transcript (above) and the bottom chrome (below). Always visible; the
          flex slack collects in the bottom spacer, below the input chrome. */}
      {todosRows.length > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {todosRows.map((r, i) => (
            <Text key={`todo-${i}`} wrap="truncate-end">{r}</Text>
          ))}
        </Box>
      ) : null}

      <Box flexDirection="column" flexShrink={0}>
        {/* D-029: dim full-width rule separating the transcript from the input chrome. */}
        <Text dimColor>{'─'.repeat(Math.max(1, width))}</Text>
        <Text dimColor>{statusLine}</Text>
        <Text dimColor>← for agents</Text>

        {menuOpen ? (
          <Box flexDirection="column">
            {pickerPanel
              ? pickerPanel.map((r, i) => <Text key={`pk-${i}`}>{r}</Text>)
              : slashMenu
              ? slashMenu.map((item, i) => (
                  <Text key={item.name} inverse={i === clampedMenuIndex}>
                    {`/${item.name}  `}<Text dimColor>{item.desc}</Text>
                  </Text>
                ))
              : atMenu!.map((path, i) => (
                  <Text key={path} inverse={i === clampedMenuIndex}>{`@${path}`}</Text>
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

      {/* Wasted-space fix: a flexGrow spacer that pushes everything above it to
          the TOP. When content is short, this absorbs the slack at the bottom
          (below the input), matching native; when content overflows it collapses. */}
      <Box flexGrow={1} flexShrink={1} />
    </Box>
  )
}

/**
 * Build the model/mode picker panel as native does (D-020): a leading blue rule,
 * a bold title + dim blurb, numbered rows (current value ✓, nav-selected row in
 * cyan with a "›" marker + the per-row description), the effort sub-line (model
 * only), and a key-hint footer. Returned as ANSI rows so the App can both render
 * them and reserve the exact viewport height. Blank rows are a single space so
 * ink gives them a line.
 */
function buildPickerPanel(
  choices: ControlChoice[],
  action: 'setModel' | 'setMode',
  currentValue: string,
  selected: number,
  width: number,
): string[] {
  const isModel = action === 'setModel'
  const out: string[] = [blue('─'.repeat(Math.max(1, width))), ansiBold(isModel ? 'Select model' : 'Select mode')]
  const blurb = isModel
    ? 'Switch between Claude models. Your pick becomes the default for new sessions.'
    : 'Switch the permission mode for this session.'
  for (const l of wrapAnsi(blurb, width)) out.push(ansiDim(l))
  out.push(' ')
  choices.forEach((c, i) => {
    const left = `${i + 1}. ${c.name}${c.value === currentValue ? ' ✓' : ''}`.padEnd(26)
    const head = i === selected ? ansiCyan(`› ${left}`) : `  ${left}`
    out.push(`${head}${ansiDim(c.desc)}`)
  })
  out.push(' ')
  if (isModel) {
    out.push(`${ansiOrange('●')} High effort (default) ${ansiDim('←/→ to adjust')}`)
    out.push(' ')
  }
  out.push(ansiDim(isModel
    ? 'Enter to set as default · s to use this session only · Esc to cancel'
    : 'Enter to select · Esc to cancel'))
  return out
}

/**
 * The full question list for a user_question event. Falls back to a single
 * spec built from the flattened first-question fields (events from an older
 * Core, or Even-app-shaped fixtures, carry no `questions`).
 */
function questionSpecs(e: UserQuestionEvent): QuestionSpec[] {
  if (e.questions !== undefined && e.questions.length > 0) return e.questions
  return [
    {
      question: e.question,
      header: '',
      options: e.options.map((label) => ({ label })),
      multiSelect: false,
    },
  ]
}

/**
 * D-029: count the rows {@link PendingPrompt} will occupy at `width`, mirroring its
 * structure so the layout can RESERVE that height in the top section (the pending
 * prompt would otherwise push the bottom-pinned input off a fixed-height screen).
 * Over-counting is safe — it only trims the transcript window a little further.
 */
function pendingRowCount(pending: Pending, input: string, width: number, qIdx: number): number {
  const wrapped = (s: string): number => Math.max(1, wrapAnsi(s, width).length)
  if (pending.kind === 'permission') {
    const e = pending.event
    // rule + header + blank + [detail] + [description] + blank + "proceed?" + options + blank + footer
    let n = 1 + wrapped(permissionHeader(e.toolName)) + 1
    if (e.detail) n += wrapped(`  ${e.detail}`)
    if (e.description) n += wrapped(`  ${e.description}`)
    n += 1 + 1 + e.options.length + 1 + 1
    return n
  }
  const e = pending.event
  const specs = questionSpecs(e)
  const active = specs[Math.min(qIdx, specs.length - 1)]!
  // rule + badge + blank + question + options + [desc line] + "Type something" + rule + "Chat about this" + [input echo] + footer
  let n = 1 + 1 + 1 + wrapped(active.question) + active.options.length + 1 + 1 + 1 + 1
  if (active.options.some((o) => o.description !== undefined)) n += 1
  if (input) n += 1
  return n
}

/**
 * D-034: native frames the permission header per tool ("Bash command",
 * "Read file", "Edit file", …), not a generic "<Tool> command". Unknown tools
 * keep the generic framing.
 */
function permissionHeader(toolName: string): string {
  switch (toolName) {
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'Bash command'
    case 'Read':
      return 'Read file'
    case 'Write':
      return 'Create file'
    case 'Edit':
    case 'MultiEdit':
      return 'Edit file'
    case 'NotebookEdit':
      return 'Edit notebook'
    case 'WebFetch':
      return 'Fetch'
    case 'WebSearch':
      return 'Web search'
    default:
      return `${toolName} command`
  }
}

/**
 * Render the inline permission / question prompt, native Claude style (D-017,
 * D-018): no rounded box, a leading rule, a header, the body, numbered options
 * (the highlighted option marked with "›"), and a key-hint footer.
 */
function PendingPrompt({ pending, input, width, selectedIndex, questionIndex }: { pending: Pending; input: string; width: number; selectedIndex: number; questionIndex: number }): React.ReactElement {
  const rule = '─'.repeat(Math.max(1, width))
  if (pending.kind === 'permission') {
    const e = pending.event
    return (
      <Box flexDirection="column">
        <Text color="blue" dimColor>{rule}</Text>
        <Text color="blue" bold>{permissionHeader(e.toolName)}</Text>
        <Text> </Text>
        {e.detail ? <Text>{`  ${e.detail}`}</Text> : null}
        {e.description ? <Text dimColor>{`  ${e.description}`}</Text> : null}
        <Text> </Text>
        <Text>Do you want to proceed?</Text>
        {e.options.map((opt, i) => (
          <Text key={opt.key + String(i)}>
            {i === selectedIndex ? <Text color="blue">{'› '}</Text> : '  '}
            {`${i + 1}. `}
            {i === selectedIndex ? <Text color="blue">{opt.text}</Text> : opt.text}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>Enter to confirm · ↑/↓ to navigate · Esc to cancel · Tab to amend</Text>
      </Box>
    )
  }
  const e = pending.event
  const specs = questionSpecs(e)
  const active = specs[Math.min(questionIndex, specs.length - 1)]!
  const total = specs.length
  const extras = active.options.length
  return (
    <Box flexDirection="column">
      <Text dimColor>{rule}</Text>
      <Text>
        <Text backgroundColor="#c4b5fd" color="black">{` □ ${active.header || 'Question'} `}</Text>
        {total > 1 ? <Text dimColor>{`  ${questionIndex + 1}/${total}`}</Text> : null}
      </Text>
      <Text> </Text>
      <Text bold>{active.question}</Text>
      {active.options.map((opt, i) => (
        <Box key={opt.label + String(i)} flexDirection="column">
          <Text>
            {i === selectedIndex ? <Text color="#a78bfa">{'› '}</Text> : '  '}
            {`${i + 1}. `}
            {i === selectedIndex ? <Text color="#a78bfa">{opt.label}</Text> : opt.label}
          </Text>
          {i === selectedIndex && opt.description !== undefined ? (
            <Text dimColor>{`     ${opt.description}`}</Text>
          ) : null}
        </Box>
      ))}
      <Text>
        {selectedIndex === extras ? <Text color="#a78bfa">{'› '}</Text> : '  '}
        {`${extras + 1}. `}
        {selectedIndex === extras ? <Text color="#a78bfa">Type something</Text> : 'Type something'}
      </Text>
      <Text dimColor>{rule}</Text>
      <Text>
        {selectedIndex === extras + 1 ? <Text color="#a78bfa">{'› '}</Text> : '  '}
        {`${extras + 2}. `}
        {selectedIndex === extras + 1 ? <Text color="#a78bfa">Chat about this</Text> : 'Chat about this'}
      </Text>
      {input ? <Text dimColor>{`  › ${input}`}</Text> : null}
      <Text dimColor>Enter to select · ↑/↓ to navigate · Esc to cancel</Text>
    </Box>
  )
}

/** Desk version shown in the startup banner (kept in lockstep with package.json, like hub SERVER_VERSION). */
const CLIENT_VERSION = '0.1.0'

/** Collapse the home-dir prefix to "~" the way native Claude shows the cwd. */
function shortCwd(p: string): string {
  const home = process.env.HOME
  return home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p
}

/**
 * Startup banner (D-001) — rendered while the transcript is empty so the idle
 * screen reads like native Claude Code: a small robot, the product line + version,
 * the active model + permission mode, the working directory, and a feature tip.
 */
function Banner({ model, mode, cwd }: { model: string; mode: string; cwd: string }): React.ReactElement {
  const robot = ['▛▀▀▜', '▌●●▐', '▙▄▄▟']
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={2}>
          {robot.map((r, i) => (
            <Text key={`bot-${i}`} color="#d7875f">{r}</Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text><Text bold>Claude Code</Text>{` v${CLIENT_VERSION}`}</Text>
          <Text dimColor>{model ? `${modelDisplayName(model)} · ${mode} mode` : `${mode} mode`}</Text>
          <Text dimColor>{shortCwd(cwd)}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text>
        {'Feature of the week: '}
        <Text color="cyan">/loop</Text>
        {' — run a prompt or slash command on a recurring interval'}
      </Text>
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
