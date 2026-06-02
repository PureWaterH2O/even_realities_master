/**
 * The Co-Live SSE event vocabulary — the single source of truth for the events
 * the Session Core emits and the Hub / clients consume.
 *
 * This is a discriminated union on the `type` field. session.ts (1.3) produces
 * these, the Hub (2.x) fans them out over SSE, and the desk client (3.x) renders
 * them. Field names match the M1 vocabulary spec exactly.
 */

/** Provider is always "claude" for M1. */
export type Provider = 'claude'

/** HUD status states surfaced to clients during a turn. */
export type StatusState =
  | 'busy'
  | 'think_start'
  | 'think_end'
  | 'text_start'
  | 'text_end'
  | 'idle'

/** A prompt submitted by some client (echoed to all co-live clients). */
export interface UserPromptEvent {
  type: 'user_prompt'
  text: string
}

/** Coarse turn/HUD status transition. */
export interface StatusEvent {
  type: 'status'
  state: StatusState
}

/** A tool invocation has begun. */
export interface ToolStartEvent {
  type: 'tool_start'
  name: string
  toolId: string
}

/** A tool invocation has completed, with a human summary and raw detail. */
export interface ToolEndEvent {
  type: 'tool_end'
  name: string
  toolId: string
  summary: string
  detail: {
    input: unknown
    output: unknown
  }
}

/** A streamed chunk of assistant output text. */
export interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

/**
 * A streamed chunk of assistant *thinking* text. Desk-only by convention: the
 * closed Even app ignores unknown event types, so the glasses never render it.
 * 🧪 Sourced from the SDK's `content_block_delta` `delta.thinking` (NOT `text`).
 */
export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  text: string
}

/** Periodic in-turn stats (emitted roughly every 10s during a turn). */
export interface RunningStatsEvent {
  type: 'running_stats'
  durationMs: number
  inputTokens: number
  outputTokens: number
}

/** Terminal result of a turn. */
export interface ResultEvent {
  type: 'result'
  success: boolean
  text: string
  sessionId: string
  costUsd: number
  provider: Provider
  turns: number
  durationMs: number
  inputTokens: number
  outputTokens: number
}

/**
 * A selectable permission button. 🧪 The Even app renders its tappable
 * permission UI from these objects: `text` is the button label shown on the
 * HUD, `key` is the decision value the app POSTs back to
 * `/api/permission-response`. (Verified against native even-terminal 0.7.9
 * `buildClaudePermissionOptions` — bare string options render nothing, so the
 * ring prompt never appears and the request silently times out.)
 */
export interface PermissionOption {
  /** Button label shown on the HUD (e.g. "Yes" / "No"). */
  text: string
  /** Decision posted back on tap (`allow` | `allowAlways` | `deny`). */
  key: string
}

/** A tool wants permission to run; clients respond with a decision. */
export interface PermissionRequestEvent {
  type: 'permission_request'
  toolName: string
  description: string
  /** 🧪 A short string (the file path / command / url), not the raw input object. */
  detail: string
  toolUseId: string
  /** 🧪 Objects, not strings — the app keys its tappable buttons on these. */
  options: PermissionOption[]
  suggestions: unknown[]
}

/** Resolution of a prior permission_request. */
export interface PermissionResultEvent {
  type: 'permission_result'
  toolName: string
  summary: string
  decision: string
}

/** AskUserQuestion surfaced to clients. */
export interface UserQuestionEvent {
  type: 'user_question'
  question: string
  toolUseId: string
  options: string[]
}

/** A passive notification (no response required). */
export interface NotificationEvent {
  type: 'notification'
  title: string
  message: string
}

/** Progress through a multi-step task/plan. */
export interface TaskProgressEvent {
  type: 'task_progress'
  completed: number
  total: number
  current: string
}

/** A turn-level error. */
export interface ErrorEvent {
  type: 'error'
  message: string
}

/** The full Co-Live event union. Exhaustive over the M1 SSE vocabulary. */
export type CoLiveEvent =
  | UserPromptEvent
  | StatusEvent
  | ToolStartEvent
  | ToolEndEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | RunningStatsEvent
  | ResultEvent
  | PermissionRequestEvent
  | PermissionResultEvent
  | UserQuestionEvent
  | NotificationEvent
  | TaskProgressEvent
  | ErrorEvent

/** The set of all event discriminators (the `type` field). */
export type CoLiveEventType = CoLiveEvent['type']
