# `@anthropic-ai/claude-agent-sdk` reference (v0.3.158)

> Extracted from the installed `sdk.d.ts` on 2026-05-30. This is the **exact API** the
> Session Core builds on. Implementers: trust this over memory; re-grep `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for anything not covered.

Package is ESM (`"type":"module"`), single entry `@anthropic-ai/claude-agent-sdk`.

## `query()` — the live session driver

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

const q = query({
  prompt: string | AsyncIterable<SDKUserMessage>,   // v1: use a plain string per turn
  options?: Options,
})
// q is `Query extends AsyncGenerator<SDKMessage, void>` — iterate with `for await`
for await (const msg of q) { /* normalize msg -> our events */ }
```

### `Options` (the fields we use)
```ts
type Options = {
  model?: string                       // default we pass: 'claude-opus-4-8'
  permissionMode?: PermissionMode      // 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'
  settingSources?: SettingSource[]     // 'user' | 'project' | 'local'  — we default to [] (kills hook latency/leak)
  cwd?: string                         // realpath'd before passing
  resume?: string                      // session id to resume+append (omit to start fresh)
  forkSession?: boolean                // keep false: we want append-in-place (single transcript)
  includePartialMessages?: boolean     // true — needed for streaming text_delta
  maxTurns?: number
  canUseTool?: CanUseTool              // our permission handler (Task 1.4)
  abortController?: AbortController     // v1 interrupt path: abort() to stop a turn (see below)
}
```

### Interrupt — IMPORTANT
`Query.interrupt()` / `setPermissionMode()` / `setModel()` are **only supported in streaming-input mode**
(prompt = AsyncIterable). v1 uses **string prompts**, so interrupt = **`options.abortController.abort()`**.
Create one `AbortController` per turn, pass it in `options`, keep a handle; `interrupt()` calls `.abort()`,
which stops the query and cleans up. (Streaming-input mode + `q.interrupt()` is a possible M2+ upgrade.)

## `SDKMessage` stream — what to normalize (Task 1.3)

`SDKMessage` is a big discriminated union on `type` (+ `subtype`). The variants we map:

| SDK message | Discriminator | Carries | → our event(s) |
|---|---|---|---|
| init | `type:'system', subtype:'init'` | `session_id`, `model`, `permissionMode`, `tools`, `slash_commands`, `skills`, `agents`, `mcp_servers`, `plugins`, `cwd` | capture `session_id` (for resume + 202 + subscribe); optionally surface model/caps |
| partial (stream) | `type:'stream_event'` | `event: BetaRawMessageStreamEvent` | the streaming deltas — see below |
| assistant (final) | `type:'assistant'` | `message: BetaMessage` (content blocks: `text`, `tool_use`, `thinking`) | `tool_use` blocks → `tool_start{name,toolId}`; final text already streamed |
| result | `type:'result'` | success: `result`, `total_cost_usd`, `num_turns`, `duration_ms`, `usage{input_tokens,output_tokens,...}` · error: `errors[]`, `subtype` | `result{success,text,sessionId,costUsd,turns,durationMs,inputTokens,outputTokens}`; on error → `error{message}` |
| session state | `type:'system', subtype:'session_state_changed'` | `state:'idle'|'running'|'requires_action'` | **authoritative turn-over** → `status{state:'idle'}` when idle |
| task progress | `type:'system', subtype:'task_progress'` | `description`, `usage{total_tokens,tool_uses,duration_ms}` | `task_progress{completed,total,current}` |
| tool progress | `type:'tool_progress'` | `tool_use_id`, `tool_name`, `elapsed_time_seconds` | (optional) keep-alive / status |
| notification | `type:'system', subtype:'notification'` | `text`, `priority`, `key` | `notification{title,message}` |
| thinking tokens | `type:'system', subtype:'thinking_tokens'` | `estimated_tokens` | think status only — **never** emit thinking text |

### The streaming deltas (`SDKPartialAssistantMessage.event`)
`event` is an Anthropic `BetaRawMessageStreamEvent` (from `@anthropic-ai/sdk`). Handle by `event.type`:
- `content_block_start` → if block is `tool_use`: `tool_start{name,toolId}`; if `text`: `status{state:'text_start'}`; if `thinking`: `status{state:'think_start'}`.
- `content_block_delta` → `delta.type === 'text_delta'` ⇒ emit `text_delta{text:delta.text}`. `delta.type === 'thinking_delta'` ⇒ **DO NOT emit** (assert this in tests). `input_json_delta` ⇒ accumulating tool input (optional).
- `content_block_stop` → close text/think (`text_end`/`think_end`).
- `message_start` / `message_stop` → turn framing (`busy` on start).

> For TDD you feed a **fake async-iterable** of these message objects and assert the emitted normalized
> event sequence. You do NOT need real Beta types at runtime — match on the `type`/`subtype`/`delta.type`
> string fields. Define minimal local input types or `any`-cast the fake stream in tests.

## Session store (Task 1.2) — read the shared `~/.claude/projects/*.jsonl`

```ts
import { listSessions, getSessionMessages, getSessionInfo } from '@anthropic-ai/claude-agent-sdk'

listSessions(opts?: { dir?, limit?, offset?, includeWorktrees? }): Promise<SDKSessionInfo[]>
getSessionMessages(id, opts?: { dir?, limit?, offset?, includeSystemMessages? }): Promise<SessionMessage[]>
getSessionInfo(id, opts?: { dir? }): Promise<SDKSessionInfo | undefined>

type SDKSessionInfo = { sessionId, summary, lastModified, fileSize?, customTitle?, firstPrompt?, gitBranch?, cwd?, tag?, createdAt? }
type SessionMessage = { type:'user'|'assistant'|'system', uuid, session_id, message: unknown, parent_tool_use_id }
```
- `dir` = the project cwd (NOT the encoded `~/.claude/projects/<encoded>` path). The SDK encodes it.
- **`realpath` the cwd first** (M0 🧪: `/tmp`→`/private/tmp` symlink gotcha) so lookups are stable.
- `message` is `unknown` — the raw transcript line. For `getTranscript`/status you parse it yourself:
  normalize to `{role,text}`; for status, read the **last** jsonl line and classify
  (`result | stop_hook_summary | permission-mode | last-prompt | interrupt` → idle; else if recent → busy; 120s staleness → idle).

## Permissions (Task 1.4)
```ts
type CanUseTool = (toolName: string, input: Record<string,unknown>, opts: {
  signal: AbortSignal; suggestions?: PermissionUpdate[]; blockedPath?: string; decisionReason?: string; title?: string;
}) => Promise<PermissionResult>

type PermissionResult =
  | { behavior:'allow', updatedInput: Record<string,unknown>, updatedPermissions?: PermissionUpdate[] }
  | { behavior:'deny', message: string, interrupt?: boolean }
```
- `canUseTool` is how a tool call becomes a `permission_request` event: emit it, await the client's
  `/api/permission-response` decision (60s → default **deny**), then resolve allow/deny.
  `opts.title` is the pre-rendered prompt sentence ("Claude wants to read foo.txt") — prefer it for HUD text.
- 🧪 **`updatedInput` is REQUIRED on an allow** — echo the original `input` back unchanged (like native).
  The TS type marks it optional, but the SDK validates the result with Zod at runtime and **rejects an
  allow without it** (`ZodError … path:["updatedInput"], expected:"record"`), failing the tool. (Hardware
  bug, 2026-05-31: bare `{behavior:'allow'}` made every tool fail post-approval.)
- 🧪 **`permission_request.options` are `{text,key}` objects, not strings** — the Even app renders its
  tappable ring buttons from these (`text`=label, `key`=the `decision` it POSTs back). Bare-string options
  render nothing → no prompt → silent timeout. Native minimal set: `[{text:"Yes",key:"allow"},{text:"No",key:"deny"}]`
  (+ a `{text:<desc>,key:"allowAlways"}` when `suggestions` are present). `detail` is a short string
  (file path / command), not the raw input object.
- AskUserQuestion surfaces as a tool too (`toolName === 'AskUserQuestion'`) → emit `user_question`, await
  `/api/question-response` (120s → default **skip**).
- **Slash guard:** independent of the SDK — a prompt whose first non-space char is `/` must be rejected
  before calling `query()` (it hangs the turn → 0-token stall, M0 🧪).
```
