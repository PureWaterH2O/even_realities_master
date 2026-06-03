/**
 * Task 3.2 — client-side slash-command interceptor.
 *
 * Pure and I/O-free: no HubClient, no fetch, no ink. The desk app (3.3) calls
 * `interpretInput(raw)` on every submit and acts on the discriminated result —
 * a PROMPT is POSTed to the Hub; everything else is handled locally and is
 * NEVER posted.
 *
 * The load-bearing invariant: any input whose first non-whitespace word begins
 * with "/" is a command/hint and is NEVER returned as a PROMPT. Slash commands
 * hang the SDK (the Core guards against them server-side); the client must not
 * send them at all. The lone exception is a bare "/" with nothing after it,
 * which is treated as empty input (a no-op prompt the app can ignore).
 */

/** A local view the app can render from state it already holds. */
export type SlashView = 'context' | 'usage'

/**
 * Mouse-reporting mode (UAT A6). `scroll` = SGR mouse ON (wheel scrolls the
 * transcript; the default, matching the alt-screen enter sequence). `select` =
 * mouse OFF, so native click-drag text selection / copy works in any terminal.
 */
export type MouseMode = 'scroll' | 'select'

/**
 * A recognized slash command, handled entirely client-side. Discriminated by
 * `command`:
 * - `new_session` (/clear): drop the current sessionId and clear the transcript.
 * - `note` (/compact): surface `message` (an M3 not-implemented notice); post nothing.
 * - `view` (/context, /usage): render the `view` from local state.
 * - `mouse_mode` (/select, /scroll): toggle SGR mouse reporting at runtime.
 * - `help` (/help): surface `message` listing the available commands.
 */
export type CommandResult =
  | { kind: 'command'; command: 'new_session' }
  | { kind: 'command'; command: 'note'; message: string }
  | { kind: 'command'; command: 'view'; view: SlashView }
  | { kind: 'command'; command: 'mouse_mode'; mode: MouseMode }
  | { kind: 'command'; command: 'help'; message: string }

/** A leading-slash token that matches no known command. Show, don't post. */
export interface HintResult {
  kind: 'hint'
  message: string
}

/** Ordinary text to send to the Hub as a prompt. */
export interface PromptResult {
  kind: 'prompt'
  text: string
}

/** The full result union returned by `interpretInput`. */
export type InterpretedInput = CommandResult | HintResult | PromptResult

/** The slash commands the desk client understands (sans leading "/"). */
export const SLASH_COMMANDS = [
  'clear',
  'compact',
  'context',
  'usage',
  'select',
  'scroll',
  'help',
] as const

/** Human-facing one-line summaries, used to build the /help listing. */
const COMMAND_HELP: ReadonlyArray<readonly [string, string]> = [
  ['/clear', 'start a new session (clear the transcript)'],
  ['/compact', 'compact the conversation (M3 — not yet implemented)'],
  ['/context', 'show context info for the current session'],
  ['/usage', 'show token usage and cost for the current session'],
  ['/select', 'Disable mouse reporting so you can select/copy text (wheel scroll off)'],
  ['/scroll', 'Re-enable mouse-wheel scrolling (default)'],
  ['/help', 'list the available slash commands'],
]

/** Menu source for the M3.2A slash-command completion popup, derived from COMMAND_HELP. */
export function slashMenuItems(): { name: string; desc: string }[] {
  return COMMAND_HELP.map(([name, desc]) => ({ name: name.replace(/^\//, ''), desc }))
}

/** The /help body, listing every supported command. */
function helpMessage(): string {
  return [
    'Available commands:',
    ...COMMAND_HELP.map(([name, desc]) => `  ${name} — ${desc}`),
  ].join('\n')
}

/**
 * Interpret a raw input line into an actionable result.
 *
 * Whitespace-tolerant: leading/trailing whitespace is trimmed and the command
 * token is the first whitespace-delimited word (lower-cased for matching).
 * Trailing args after a command token are ignored (recognition is by first
 * token only).
 */
export function interpretInput(raw: string): InterpretedInput {
  const trimmed = raw.trim()

  // No leading slash (or empty) -> ordinary prompt carrying the trimmed text.
  if (!trimmed.startsWith('/')) {
    return { kind: 'prompt', text: trimmed }
  }

  // First whitespace-delimited word, sans the leading "/", case-folded.
  const firstWord = trimmed.split(/\s+/, 1)[0] ?? ''
  const token = firstWord.slice(1).toLowerCase()

  // A lone "/" (nothing after it) is not a command — treat as empty input.
  if (token === '') {
    return { kind: 'prompt', text: '' }
  }

  switch (token) {
    case 'clear':
      return { kind: 'command', command: 'new_session' }
    case 'compact':
      return {
        kind: 'command',
        command: 'note',
        message: 'compaction is an M3 feature — not yet implemented',
      }
    case 'context':
      return { kind: 'command', command: 'view', view: 'context' }
    case 'usage':
      return { kind: 'command', command: 'view', view: 'usage' }
    case 'select':
      return { kind: 'command', command: 'mouse_mode', mode: 'select' }
    case 'scroll':
      return { kind: 'command', command: 'mouse_mode', mode: 'scroll' }
    case 'help':
      return { kind: 'command', command: 'help', message: helpMessage() }
    default:
      return {
        kind: 'hint',
        message: `Unknown command: /${token}. Type /help to see available commands.`,
      }
  }
}
