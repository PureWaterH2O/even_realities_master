# Terminal Mode — Live Hardware Probe (2026-05-30)

> **Method:** Ran the genuine `@evenrealities/even-terminal@0.7.9` bridge on the user's
> Mac (LAN `192.168.1.45:3456`, `VERBOSE=1`, fixed `BRIDGE_TOKEN`), connected the user's
> **real G2 + R1 + Even app** over the LAN, and observed the on-wire traffic (request log +
> every SSE frame) while the user reported on-glasses/ring behavior. This is a **🧪 self-verified**
> audit trail — first firsthand ground truth, distilled into `knowledge/terminal-mode/overview.md`.
>
> Raw capture lived in `.remember/tmp/bridge.log` (gitignored); key evidence quoted below with line refs.

## Setup confirmed

- `even-terminal@0.7.9` already installed; `claude` 2.1.158; node 25.8.0. Mac LAN IP `192.168.1.45`.
- Bridge banner/QR encodes a plain URL: `http://<host>:<port>?token=<token>&defaultProvider=claude`.
- **Tailscale is a built-in host mode** (`EVEN_HOST_MODE=tailscale` → puts the Tailscale IPv4 in the QR;
  also `EVEN_HOST_MODE=interface` + `EVEN_HOST_INTERFACE`, and `EVEN_TERMINAL_EXPOSE_PROVIDER` for pinggy/bore).
  Source: `dist/startup/common.js` `resolveHost()`. → off-WiFi remote is a **config flag, not engineering**.

## What the closed Even app actually does (on-wire)

1. On connect (from phone `192.168.1.124`): `GET /api/info`, `GET /api/sessions`, `GET /api/update-check`.
2. **Polls `GET /api/sessions?provider=claude` every ~10 s** — *no `cwd` filter*, so the glasses session
   list shows the most-recent sessions **across all projects**, not just the bridge's cwd.
3. On opening a session: opens **SSE** `GET /api/events?sessionId=<id>` **and** fetches
   `GET /api/sessions/<id>/history?limit=10` (that history fetch is what renders the last messages).

## 🧪 Session-store sharing — the Option-A seam

- `GET /api/sessions?cwd=<project>` returned **both desk-TUI sessions** for this repo, incl. the prior
  conversation *"Research Even Realities G2 glasses and R1 ring"*, `status:"idle"`. The user **saw the same
  two sessions in the app, opened one, and saw the last message rendered on the glasses.**
- Mechanism (`dist/claude/provider.js`): `listSessions`/`getSessionMessages` from `@anthropic-ai/claude-agent-sdk`
  + `findSessionFile()` scanning `~/.claude/projects/*/<id>.jsonl` — the **same transcript files the desk TUI writes**.
  Status is computed from the **last jsonl line** (recognizes `stop_hook_summary`, `permission-mode`, `result`,
  interrupt markers; 120 s staleness fallback).
- **Limit (the crux):** the bridge only `broadcast`s live SSE for sessions **it is driving**. A desk-TUI session
  is **observe-only** — list + status (10 s poll) + history-on-open, but **no live streaming and no way to answer
  its permission/question prompts from the ring**. Those prompts live in the desk TUI process the bridge can't reach.

## 🧪 Bridge-driven session — full live SSE vocabulary

Prompt "What is the current Git status…" → new session `e438ab0a…`. Observed SSE frame types:

- `user_prompt {text}`
- `status {state}` where state ∈ `busy | think_start | think_end | text_start | text_end | idle`
- `tool_start {name, toolId}`
- `tool_end {name, toolId, summary, detail:{input,output}}` — `summary` is the ~one-line HUD label
- `text_delta {text}` — streamed assistant text (chunked)
- `running_stats {durationMs, inputTokens, outputTokens}` (every 10 s)
- `result {success, text, sessionId, costUsd, provider, turns, durationMs, inputTokens, outputTokens}`
- `permission_request {toolName, description, detail, toolUseId, options[], suggestions[]}`
- `permission_result {toolName, summary, decision}`
- (also `notification`, `task_progress`, `user_question`, `question_answer`, `error` per source)

**Thinking is NOT streamed to glasses** — `thinking_delta` appears only in the server-side `[claude-sdk]` log
(`includePartialMessages:true`), never in `[SSE-…]` frames. Only final text streams.

## 🧪 Permission model (CORRECTS prior doc)

From `dist/claude/session.js` `handleCanUseTool()` (lines ~350–400), confirmed by behavior:

- `allowedTools` = `Read, Edit, Glob, Grep, Agent, WebSearch, WebFetch, TaskOutput, ExitPlanMode,
  ListMcpResources, ReadMcpResource` → auto-allowed (never hit `canUseTool`).
- `permissionMode: "acceptEdits"` (hard-coded) → **`Edit`/`Write` apply silently**.
- **Bash has a hard-coded read-only safelist** auto-allowed without a prompt:
  `ls cat head tail wc pwd echo printf date whoami which where type file stat du df env printenv
  uname hostname id  git(status|log|diff|branch|show|remote|rev-parse)`.
  → This is why `git status` **ran with no ring prompt** (test 1).
- **Reaches the ring:** non-safelisted/mutating **Bash**; `KillShell`, `Config`, `Mcp`, `RemoteTrigger`;
  and `AskUserQuestion`. Everything else hits a **catch-all `allow`**.
- Timeouts: permission **60 s default-DENY**; AskUserQuestion **120 s default-SKIP**.

Ring round-trip (test 2, session `4572a8a6…`, `touch /tmp/even_ring_test.txt`):
`permission_request` (options Yes / "Yes, and always allow Bash rule … in local settings" / No)
→ user single-tapped → `POST /api/permission-response {decision:"allow"}` ~9 s later
→ `permission_result {decision:"allowed"}` → tool ran → **`/tmp/even_ring_test.txt` created on disk.**
**Single ring tap = allow.** `suggestions` carried `addRules`(localSettings) + `addDirectories`(/tmp,session).

## 🧪 Model display gotcha

`GET /api/info` returned `{"model":"Opus 4.8", account:{email…, subscriptionType:"max"}, version:"2.1.158"}`
— derived from the user's **recent session transcripts**, NOT the model the bridge runs. Both bridge-driven
sessions' `init` + `result` show **`claude-opus-4-6`** actually executing (cost $0.13 and $0.08 for trivial tasks).
→ **App shows 4.8; bridge runs 4.6.**

## 🧪 Our own infra leaks into Terminal Mode

Bridge sessions run with `settingSources: ["user","project"]`, so this repo's `.claude` hooks + the global
superpowers `SessionStart` hook execute inside bridge-driven sessions. Observed twice: our **capture-reminder
Stop hook** fired and the agent streamed "Nothing new to capture this session…" onto the **glasses HUD**.
The `SessionStart` hook also injected the full `using-superpowers` skill text (token/latency overhead).
→ Design consideration: a hook that no-ops for headless/bridge sessions, or accept the chatter.

## 🧪 Dictation is raw speech-to-text

Spoken "touch /tmp/even_ring_test.txt" arrived as **`"touch slash temp slash even ring test dot text"`** —
spoken punctuation/paths are literal words; Claude spent significant thinking tokens inferring the real command.
→ **Natural-language intent works far better than dictating exact shell/code syntax.**

## 🧪 Replying to an existing session (the "two clients, one session" probe)

User opened the idle desk session `fa400d3b` ("Understand Claude background processing") on the glasses and
sent **"I am sending this message from my glasses."** Observed:

- **`resume` APPENDS IN PLACE** — `fa400d3b.jsonl` went **39 → 53 lines, SAME session id** (no fork/new id).
  The bridge ran `query({resume:"fa400d3b"})` as a **headless process** on `claude-opus-4-6` ($0.07), appended
  the turn to that session's transcript, **streamed the reply live to the glasses** (SSE now flows because the
  bridge is driving it), then exited.
- **No desk view exists** for it — the resume is headless. To see it at the desk you'd `claude --resume fa400d3b`.
- **Critical consequence:** because resume appends *in place* to the same jsonl, pointing the glasses at a session
  that is **also live in a desk TUI** = **two processes writing one transcript → collision/interleave risk.** So
  the naive "literal same live session, stock TUI + glasses both live" is **unsafe without a single coordinating owner.**
  (We deliberately did NOT test this against the live conversation `7b2f7e58` for this reason.)

## 🧪 Observed (non-bridge-driven) sessions do NOT update live on the glasses

User had this live conversation (`7b2f7e58`) open on the glasses while only typing on the computer. The HUD did
**not** update as new messages arrived; to see new content the user had to **exit the session → open another →
return** (forcing a fresh `/sessions/:id/history` fetch). The 10 s `/api/sessions` poll updates **status only**,
not displayed content. → Monitoring a desk session you didn't start = **manual refresh, no live tail.** (Live
streaming only exists once the bridge itself is driving the session.)

## Housekeeping

- The bridge writes `even-terminal-<timestamp>.log` into its **cwd** (this repo) — added `even-terminal-*.log`
  to `.gitignore`.
