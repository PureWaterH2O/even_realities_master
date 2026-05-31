/**
 * Session store reader — the read-only view over the shared
 * `~/.claude/projects/<encoded>/*.jsonl` transcripts that both the live SDK
 * session AND the desk client need (scrollback + session list + busy/idle).
 *
 * Wraps the SDK's `listSessions` / `getSessionMessages`, normalizing to our own
 * shapes, and classifies a session's busy/idle status by inspecting the LAST
 * meaningful jsonl line (M0 ground truth).
 *
 * Two M0 gotchas are baked in here:
 *   - realpath the cwd before every lookup (`/tmp` -> `/private/tmp`), so the
 *     SDK's dir->encoded-projects mapping is stable.
 *   - getTranscript imposes NO message cap (this is the desk-scrollback source).
 *
 * The SDK calls are injectable (deps args) so the classifier and normalizers
 * are unit-testable without a live session or the real filesystem.
 */
import { realpathSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  listSessions as sdkListSessions,
  getSessionMessages as sdkGetSessionMessages,
} from '@anthropic-ai/claude-agent-sdk'
import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Provider } from './events'

/** Busy/idle classification of a stored session. */
export type SessionStatus = 'idle' | 'busy'

/** A normalized session list entry (provider always "claude" for M1). */
export interface NormalizedSession {
  id: string
  title: string
  timestamp: number
  cwd: string | undefined
  provider: Provider
  status: SessionStatus
}

/** A normalized transcript turn. */
export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system'
  text: string
}

/**
 * A session is "busy" only if its transcript is mid-turn AND recently touched.
 * Anything older than this (in ms) is treated as a stale/abandoned session => idle.
 */
const BUSY_STALENESS_MS = 120_000

/**
 * Terminal `type` markers: a session whose LAST meaningful jsonl line has one of
 * these types is idle (the turn is over). `stop_hook_summary` is special: it is
 * `type:"system"` with this subtype (handled separately below).
 *
 * 🧪 `ai-title` is metadata the SDK writes at a turn boundary (the auto-title,
 * right after `last-prompt`) — it trails a finished turn, so a transcript ending
 * in it is idle. Omitting it made a just-finished session read as `busy` for
 * 120s (last line `ai-title`, recent mtime), so `/api/sessions` showed it
 * "thinking" and the app blocked new input. (`summary` is intentionally NOT
 * terminal — it can lead a resumed/compacted session, so it stays mtime-driven.)
 */
const TERMINAL_TYPES = new Set([
  'last-prompt',
  'permission-mode',
  'result',
  'interrupt',
  'ai-title',
])

/**
 * Resolve a cwd through symlinks so session-store lookups are stable.
 * (M0 🧪: `/tmp` -> `/private/tmp` on macOS — the SDK encodes the dir into a
 * projects path, so an unresolved symlink points at the wrong/empty bucket.)
 */
export function realpathCwd(cwd: string): string {
  return realpathSync(cwd)
}

/**
 * Encode an absolute project dir to its `~/.claude/projects/<name>` folder name,
 * matching Claude Code's session-store encoding: every non-alphanumeric char
 * becomes "-".
 * (🧪 M0: `/private/tmp/colive-spike` -> `-private-tmp-colive-spike`;
 *  `/Users/x/Documents/random_claude_stuff/even_realities`
 *   -> `-Users-x-Documents-random-claude-stuff-even-realities`.)
 * Pass a realpath'd dir for a stable result.
 */
export function encodeProjectDir(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Absolute path to a session's jsonl transcript under `~/.claude/projects`.
 * The dir is realpath-resolved (symlink gotcha) then encoded.
 */
export function sessionJsonlPath(id: string, dir: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectDir(realpathCwd(dir)), `${id}.jsonl`)
}

/**
 * Default per-session status resolver: read the session's on-disk jsonl and
 * classify it. Used by {@link listSessions} when no `statusOf` is injected, so
 * the session list reports real busy/idle even for sessions the Core is not
 * itself driving (M0: observed desk sessions need file-based status). Any error
 * (missing cwd/dir/file) degrades to "idle".
 */
function defaultStatusOf(id: string, cwd: string | undefined): SessionStatus {
  if (cwd === undefined) return 'idle'
  try {
    return sessionStatusFromJsonl(sessionJsonlPath(id, cwd))
  } catch {
    return 'idle'
  }
}

/**
 * Pure classifier: given the raw jsonl text of a session and the file's mtime
 * (epoch ms), return "idle" or "busy". Testable from a string with no fs.
 *
 * Rules (M0):
 *   1. Find the LAST non-empty line and JSON.parse it.
 *   2. It is an idle marker if `type` is in
 *      {last-prompt, permission-mode, result, interrupt}
 *      OR (`type` === "system" && `subtype` === "stop_hook_summary").
 *      => idle (turn is over).
 *   3. Otherwise (mid-turn / non-terminal / unparseable / empty):
 *      busy iff (now - mtimeMs) < 120s, else idle (stale).
 *   An empty transcript is idle.
 */
export function sessionStatusFromJsonlString(
  jsonl: string,
  mtimeMs: number,
  now: number = Date.now(),
): SessionStatus {
  const lastLine = lastNonEmptyLine(jsonl)
  if (lastLine === undefined) {
    // No content at all — nothing is running.
    return 'idle'
  }

  if (isTerminalMarker(lastLine)) {
    return 'idle'
  }

  // Mid-turn (or unrecognized) last line: recent => busy, stale => idle.
  return now - mtimeMs < BUSY_STALENESS_MS ? 'busy' : 'idle'
}

/**
 * File-path variant: read a session jsonl file and classify it, using the
 * file's real mtime. A missing/unreadable file is treated as idle.
 */
export function sessionStatusFromJsonl(
  filePath: string,
  now: number = Date.now(),
): SessionStatus {
  let jsonl: string
  let mtimeMs: number
  try {
    jsonl = readFileSync(filePath, 'utf8')
    mtimeMs = statSync(filePath).mtimeMs
  } catch {
    return 'idle'
  }
  return sessionStatusFromJsonlString(jsonl, mtimeMs, now)
}

/** Return the last non-empty (trimmed) line of `text`, or undefined if none. */
function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

/** True iff a parsed jsonl line is a terminal/idle marker. */
function isTerminalMarker(line: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const obj = parsed as { type?: unknown; subtype?: unknown }
  if (typeof obj.type !== 'string') return false
  if (TERMINAL_TYPES.has(obj.type)) return true
  if (obj.type === 'system' && obj.subtype === 'stop_hook_summary') return true
  return false
}

/** Injectable deps for listSessions (SDK call + per-session status resolver). */
export interface ListSessionsDeps {
  sdkListSessions?: (opts?: {
    dir?: string
    limit?: number
  }) => Promise<SDKSessionInfo[]>
  /** Resolve busy/idle for a session id. Defaults to the on-disk classifier. */
  statusOf?: (id: string, dir: string | undefined) => SessionStatus | Promise<SessionStatus>
}

/**
 * List sessions for a project dir, normalized. `dir` is realpath-resolved first.
 * `status` comes from the per-session classifier: by default it reads each
 * session's on-disk jsonl ({@link defaultStatusOf} via {@link sessionJsonlPath}),
 * so observed (non-Core-driven) sessions still report real busy/idle. The live
 * SessionManager may inject an authoritative `statusOf` for sessions it drives;
 * tests inject one to avoid touching the filesystem.
 */
export async function listSessions(
  opts: { dir?: string; limit?: number } = {},
  deps: ListSessionsDeps = {},
): Promise<NormalizedSession[]> {
  const list = deps.sdkListSessions ?? sdkListSessions
  const dir = opts.dir !== undefined ? realpathCwd(opts.dir) : undefined

  const sessions = await list({ dir, limit: opts.limit })

  const out: NormalizedSession[] = []
  for (const s of sessions) {
    const status = deps.statusOf
      ? await deps.statusOf(s.sessionId, s.cwd)
      : defaultStatusOf(s.sessionId, s.cwd)
    out.push({
      id: s.sessionId,
      title: s.customTitle ?? s.summary,
      timestamp: s.lastModified,
      cwd: s.cwd,
      provider: 'claude',
      status,
    })
  }
  return out
}

/** Injectable deps for getTranscript. */
export interface GetTranscriptDeps {
  sdkGetSessionMessages?: (
    id: string,
    opts?: { dir?: string; limit?: number; offset?: number },
  ) => Promise<SessionMessage[]>
}

/**
 * Full normalized transcript for a session: [{ role, text }].
 * This is the desk-scrollback endpoint source, so it imposes NO message cap
 * (no `limit` is passed to the SDK). `dir` is realpath-resolved first.
 */
export async function getTranscript(
  id: string,
  opts: { dir?: string } = {},
  deps: GetTranscriptDeps = {},
): Promise<TranscriptEntry[]> {
  const get = deps.sdkGetSessionMessages ?? sdkGetSessionMessages
  const dir = opts.dir !== undefined ? realpathCwd(opts.dir) : undefined

  // Intentionally NO limit: full scrollback.
  const messages = await get(id, { dir })

  const out: TranscriptEntry[] = []
  for (const m of messages) {
    const text = extractText(m.message)
    if (text.length === 0) continue // skip tool-only / empty turns
    out.push({ role: m.type, text })
  }
  return out
}

/**
 * Pull the human-readable text out of a transcript line's `message`.
 * `message.content` is either a plain string or an array of content blocks;
 * only `text` blocks contribute (tool_use/thinking/etc. are skipped).
 */
function extractText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('')
}
