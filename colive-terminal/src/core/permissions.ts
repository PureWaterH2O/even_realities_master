/**
 * Permission broker + slash guard (Task 1.4).
 *
 * The broker provides the `canUseTool` callback the SDK's `query()` invokes for
 * every tool call. For a normal tool it turns the call into a
 * `permission_request` event, AWAITS the client's decision (routed back in via
 * {@link PermissionBroker.resolvePermission}), and resolves the SDK's
 * `PermissionResult` allow/deny. `AskUserQuestion` becomes a `user_question`
 * event awaiting {@link PermissionBroker.resolveQuestion}.
 *
 * Lifecycle: the broker is the single owner of each prompt's lifecycle, so
 * EVERY settle path emits exactly one terminal `permission_result` (decision
 * `allow`/`deny`/`answered`/`timeout`/`aborted`/`skipped`) — clients use it to
 * dismiss the rendered HUD prompt. (The pre-aborted early returns never emit a
 * request/question in the first place, so they correctly stay silent.)
 *
 * Defaults & ground truth (M0):
 *   - Timeout: a permission with no response in 60s defaults to DENY; an
 *     unanswered question in 120s defaults to SKIP (deny).
 *   - permissionMode is honored: `acceptEdits` auto-allows edit tools without
 *     prompting; `bypassPermissions` / `dontAsk` / `auto` auto-allow everything;
 *     `default` / `plan` prompt.
 *   - `opts.title` (the bridge's pre-rendered prompt sentence) is preferred for
 *     the HUD description.
 *
 * Slash guard: a prompt whose first non-space char is `/` hangs `query()` (M0
 * 🧪 0-token stall) — {@link rejectIfSlash} rejects it BEFORE the model is ever
 * called, emitting `error{message:"slash commands are client-side"}`.
 *
 * Decoupling: `emit` (the session/Hub event sink) is injected; the broker makes
 * no network or model calls. The manager (1.5) creates one broker per session,
 * wires its `canUseTool` into the session, and routes
 * `/api/permission-response` / `/api/question-response` decisions into
 * `resolvePermission` / `resolveQuestion`.
 */
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { CoLiveEvent, PermissionOption } from './events'

/** Event sink — the single callback the broker emits through. */
export type Emit = (event: CoLiveEvent) => void

/** A permission decision from a client (the strings clients send). */
export type PermissionDecision = 'allow' | 'deny'

/** Default-deny timeout for an unanswered permission request (60s). */
export const PERMISSION_TIMEOUT_MS = 60_000

/** Default-skip timeout for an unanswered AskUserQuestion (120s). */
export const QUESTION_TIMEOUT_MS = 120_000

/** The toolName the SDK uses for the interactive ask-the-user tool. */
export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

/** Tools that count as "edits" and are auto-allowed in `acceptEdits` mode. */
const EDIT_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

/**
 * The decision buttons surfaced to clients for a normal permission request.
 * 🧪 Shape matters: the Even app renders its tappable ring prompt from these
 * `{text, key}` objects (label + the `decision` it POSTs back). Bare strings
 * render nothing — the request silently times out. Matches native
 * even-terminal's `buildClaudePermissionOptions` minimal (no-suggestion) case;
 * `text` is the HUD label, `key` is the wire decision. (`allowAlways` parity —
 * an extra button derived from `opts.suggestions` — is a tracked follow-up.)
 */
const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  { text: 'Yes', key: 'allow' },
  { text: 'No', key: 'deny' },
]

/** Tool-input keys (in priority order) whose value summarizes a permission. */
const DETAIL_KEYS = ['command', 'file_path', 'url', 'prompt', 'query', 'content'] as const

/**
 * Derive the short `detail` string for a permission_request from the tool input.
 * 🧪 The Even app expects a string here (file path / command / url), not the raw
 * input object — mirrors native even-terminal's cascade (command → file_path →
 * url → prompt → query → content), truncated. Empty string if nothing matches.
 */
function detailFromInput(input: Record<string, unknown>): string {
  for (const key of DETAIL_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value.slice(0, 200)
  }
  return ''
}

/** Broker construction dependencies. */
export interface PermissionBrokerDeps {
  /** Event sink (the session/Hub fan-out). */
  emit: Emit
  /** The configured permission mode (governs auto-allow vs prompt). */
  permissionMode: PermissionMode
}

/** A pending await keyed by toolUseId, with its timeout handle for cleanup. */
interface Pending<T> {
  /** The tool this await is for (so a permission_result can name it). */
  toolName: string
  /**
   * The original tool input, echoed back as `updatedInput` when the client
   * allows. The SDK requires a record there at runtime (see toDecisionResult).
   * Only set for permission awaits; questions resolve their own updatedInput.
   */
  input?: Record<string, unknown>
  resolve: (value: T) => void
  timer: ReturnType<typeof setTimeout>
  /** Detach the abort listener (if any) when settled. */
  cleanup: () => void
}

/**
 * Is `text` a slash command (first non-space char is `/`)? Such a prompt must
 * never be forwarded to `query()` — it hangs the turn (M0 🧪).
 */
export function isSlashPrompt(text: string): boolean {
  return text.trimStart().startsWith('/')
}

/**
 * Pre-`query()` guard. If `text` is a slash command, emit the slash error and
 * return `true` (the caller must NOT forward it). Otherwise return `false`.
 * Callable before any session/query work, so a slash prompt never reaches the
 * model.
 */
export function rejectIfSlash(text: string, emit: Emit): boolean {
  if (!isSlashPrompt(text)) return false
  emit({ type: 'error', message: 'slash commands are client-side' })
  return true
}

/**
 * One broker per live session. Holds the pending permission/question awaits and
 * settles them when a client responds (or on timeout / abort).
 */
export class PermissionBroker {
  private readonly emit: Emit
  private readonly permissionMode: PermissionMode

  /** Pending permission awaits, keyed by toolUseId. */
  private readonly pendingPermissions = new Map<string, Pending<PermissionResult>>()

  /** Pending question awaits, keyed by toolUseId. */
  private readonly pendingQuestions = new Map<string, Pending<PermissionResult>>()

  constructor(deps: PermissionBrokerDeps) {
    this.emit = deps.emit
    this.permissionMode = deps.permissionMode
  }

  /**
   * The SDK `CanUseTool` callback. Routes to the question flow for
   * `AskUserQuestion`, the auto-allow rule for the configured mode, or the
   * prompt-and-await flow for everything else.
   */
  canUseTool: CanUseTool = (toolName, input, opts) => {
    if (toolName === ASK_USER_QUESTION_TOOL) {
      return this.askQuestion(input, opts)
    }
    if (this.shouldAutoAllow(toolName)) {
      // 🧪 updatedInput is REQUIRED for an allow at runtime (the SDK validates
      // the PermissionResult with Zod), even though the TS type marks it
      // optional. Omit it and the SDK rejects the result with a ZodError and the
      // tool fails. Echo the input through unchanged, mirroring native.
      return Promise.resolve<PermissionResult>({ behavior: 'allow', updatedInput: input })
    }
    return this.requestPermission(toolName, input, opts)
  }

  /**
   * Settle a pending permission. Called by the manager when a client posts
   * `/api/permission-response`. Allow resolves `{behavior:'allow'}`; anything
   * else resolves `{behavior:'deny'}`. No-op if unknown/already settled.
   */
  resolvePermission(toolUseId: string, decision: PermissionDecision): void {
    const pending = this.pendingPermissions.get(toolUseId)
    if (pending === undefined) return
    this.pendingPermissions.delete(toolUseId)
    pending.cleanup()
    clearTimeout(pending.timer)
    const result = toDecisionResult(decision, 'denied by client', pending.input ?? {})
    this.emitResult(pending.toolName, decision === 'allow' ? 'allow' : 'deny')
    pending.resolve(result)
  }

  /**
   * Settle a pending AskUserQuestion with the client's answer. Called by the
   * manager on `/api/question-response`. No-op if unknown/already settled.
   */
  resolveQuestion(toolUseId: string, answer: string): void {
    const pending = this.pendingQuestions.get(toolUseId)
    if (pending === undefined) return
    this.pendingQuestions.delete(toolUseId)
    pending.cleanup()
    clearTimeout(pending.timer)
    this.emitResult(pending.toolName, 'answered')
    // An answered question feeds the chosen option back to the model as the
    // tool result; the SDK consumes it via updatedInput.
    pending.resolve({ behavior: 'allow', updatedInput: { answer } })
  }

  /**
   * Emit the single terminal `permission_result` that lets co-live clients
   * dismiss a rendered permission/question prompt. The broker owns the whole
   * lifecycle, so EVERY settle path (client resolve, timeout, abort) emits
   * exactly one of these — otherwise a timed-out / aborted prompt would strand
   * forever on the HUD with no event to clear it.
   */
  private emitResult(toolName: string, decision: string): void {
    this.emit({
      type: 'permission_result',
      toolName,
      summary: `${toolName} ${decision}`,
      decision,
    })
  }

  /** True if the configured mode auto-allows `toolName` (no prompt). */
  private shouldAutoAllow(toolName: string): boolean {
    switch (this.permissionMode) {
      case 'bypassPermissions':
      case 'dontAsk':
      case 'auto':
        return true
      case 'acceptEdits':
        return EDIT_TOOLS.has(toolName)
      case 'default':
      case 'plan':
      default:
        return false
    }
  }

  /** Emit a permission_request and await the client decision (60s → deny). */
  private requestPermission(
    toolName: string,
    input: Record<string, unknown>,
    opts: CanUseToolOptions,
  ): Promise<PermissionResult> {
    const toolUseId = opts.toolUseID
    // The turn is already dead: deny immediately, never emit a stale request.
    if (opts.signal.aborted) {
      return Promise.resolve<PermissionResult>({ behavior: 'deny', message: 'turn aborted' })
    }
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pendingPermissions.delete(toolUseId)) return
        cleanup()
        this.emitResult(toolName, 'timeout')
        resolve({ behavior: 'deny', message: 'permission request timed out' })
      }, PERMISSION_TIMEOUT_MS)

      const onAbort = () => {
        if (!this.pendingPermissions.delete(toolUseId)) return
        clearTimeout(timer)
        cleanup()
        this.emitResult(toolName, 'aborted')
        resolve({ behavior: 'deny', message: 'turn aborted' })
      }
      const cleanup = () => opts.signal.removeEventListener('abort', onAbort)
      opts.signal.addEventListener('abort', onAbort, { once: true })

      this.pendingPermissions.set(toolUseId, { toolName, input, resolve, timer, cleanup })
      this.emit({
        type: 'permission_request',
        toolName,
        description: describePermission(toolName, opts),
        detail: detailFromInput(input),
        toolUseId,
        options: [...PERMISSION_OPTIONS],
        suggestions: opts.suggestions ?? [],
      })
    })
  }

  /** Emit a user_question and await the answer (120s → skip/deny). */
  private askQuestion(
    input: Record<string, unknown>,
    opts: CanUseToolOptions,
  ): Promise<PermissionResult> {
    const toolUseId = opts.toolUseID
    // The turn is already dead: skip immediately, never emit a stale question.
    if (opts.signal.aborted) {
      return Promise.resolve<PermissionResult>({ behavior: 'deny', message: 'turn aborted' })
    }
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pendingQuestions.delete(toolUseId)) return
        cleanup()
        this.emitResult(ASK_USER_QUESTION_TOOL, 'skipped')
        resolve({ behavior: 'deny', message: 'question skipped (timed out)' })
      }, QUESTION_TIMEOUT_MS)

      const onAbort = () => {
        if (!this.pendingQuestions.delete(toolUseId)) return
        clearTimeout(timer)
        cleanup()
        this.emitResult(ASK_USER_QUESTION_TOOL, 'aborted')
        resolve({ behavior: 'deny', message: 'turn aborted' })
      }
      const cleanup = () => opts.signal.removeEventListener('abort', onAbort)
      opts.signal.addEventListener('abort', onAbort, { once: true })

      this.pendingQuestions.set(toolUseId, {
        toolName: ASK_USER_QUESTION_TOOL,
        resolve,
        timer,
        cleanup,
      })
      const { question, options } = parseQuestion(input)
      this.emit({ type: 'user_question', question, toolUseId, options })
    })
  }
}

/**
 * Map a client decision string to an SDK PermissionResult.
 *
 * 🧪 An allow MUST carry `updatedInput` (a record): the SDK validates the
 * result with Zod at runtime and rejects an allow without it
 * (`ZodError … path:["updatedInput"], expected:"record"`), failing the tool —
 * even though the TS type marks `updatedInput` optional. We echo the original
 * tool input back unchanged, mirroring native even-terminal.
 */
function toDecisionResult(
  decision: PermissionDecision,
  denyMessage: string,
  updatedInput: Record<string, unknown>,
): PermissionResult {
  return decision === 'allow'
    ? { behavior: 'allow', updatedInput }
    : { behavior: 'deny', message: denyMessage }
}

/**
 * Description for a permission_request. Prefer the bridge's pre-rendered
 * `title` sentence; otherwise synthesize a plain one from the tool name.
 */
function describePermission(toolName: string, opts: CanUseToolOptions): string {
  if (typeof opts.title === 'string' && opts.title.length > 0) return opts.title
  if (typeof opts.description === 'string' && opts.description.length > 0) {
    return opts.description
  }
  return `Claude wants to use ${toolName || 'a tool'}`
}

/**
 * Pull a human question + flat option labels out of an AskUserQuestion input.
 * The SDK shape is `{ questions: [{ question, options: [{label}|string] }] }`;
 * we flatten the first question's options to label strings for the HUD.
 */
function parseQuestion(input: Record<string, unknown>): {
  question: string
  options: string[]
} {
  const questions = Array.isArray(input.questions) ? input.questions : []
  const first = questions.length > 0 && isRecord(questions[0]) ? questions[0] : undefined
  const question =
    first !== undefined && typeof first.question === 'string'
      ? first.question
      : asString(input.question)
  const rawOptions =
    first !== undefined && Array.isArray(first.options)
      ? first.options
      : Array.isArray(input.options)
        ? input.options
        : []
  const options = rawOptions
    .map((o) => (isRecord(o) ? asString(o.label) : asString(o)))
    .filter((s) => s.length > 0)
  return { question, options }
}

/** The structural shape of the SDK CanUseTool options arg (fields we read). */
type CanUseToolOptions = Parameters<CanUseTool>[2]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
