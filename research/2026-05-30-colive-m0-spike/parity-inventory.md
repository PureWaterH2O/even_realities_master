# Desk-client parity inventory (seeded — M0 Task 4)

> The desk client sits on `@anthropic-ai/claude-agent-sdk` (via our Session Core), **not** the closed TUI.
> Every native feature is classified **Reuse** (capability present in the SDK session) / **Rebuild** (TUI
> affordance we re-implement on the event stream) / **Blocked** (no SDK path — needs a workaround or is a gap).
> Seeded 2026-05-30 from the M0 probes; finalized during M3. Confidence 🧪 where probed, else 🟡 (reasoned).

## Headline finding (🧪) — slash commands do NOT execute via the prompt stream

Sending `/context` as a prompt **hung the turn**: SessionStart hooks fired, then `running_stats` ticked
10s/20s/30s with **0 input/output tokens**, **no `text_delta`, no `result`** — the SDK neither executed the
command nor produced a reply; the turn just stalls until interrupted. → **Slash commands are TUI-level.** The
desk client must **intercept them client-side** and map to the right operation; it must **never** forward
`/cmd` text to `query()`. Capability metadata is present (the `init` exposes the full `slash_commands`,
`skills`, `agents`, `plugins`, `mcp_servers` lists), but *invocation* is the client's job.

**M1/Core rule:** the Session Core should guard against raw `/cmd` prompts (intercept or reject), since a
slash-command prompt produces a hung 0-token turn.

## Inventory

| Native feature | Bucket | Notes / how |
|---|---|---|
| Streaming assistant text | **Reuse** | `text_delta` frames (🧪). |
| Tool-call rendering | **Reuse** | `tool_start`/`tool_end{summary,detail}` (🧪). |
| Thinking display | **Rebuild** | `thinking_delta` is **not** broadcast by the stock bridge (🧪); our Core can choose to forward it; client renders. |
| Permission prompts | **Reuse** | `permission_request`/`permission_result`; decision via API (🧪). |
| AskUserQuestion | **Reuse** | `user_question` + `question_answer` (🧪 — present in handler). |
| TodoWrite / task progress | **Reuse** | `task_progress` frames (🧪 — in handler). |
| Plan mode | **Reuse (config)** | set `permissionMode: "plan"`; `ExitPlanMode` tool present. Client renders the plan + toggle. |
| Auto-accept / permission modes | **Reuse (config)** | `permissionMode` configurable in the Core (we own it). |
| Subagents / Task tools | **Reuse** | `Task*` tools present in `init`. |
| MCP servers/tools | **Reuse** | present in `init` (`mcp_servers`); client surfaces auth prompts. |
| Resume / history / scrollback | **Reuse + Rebuild** | transcript is the shared jsonl (Reuse); **full** scrollback needs a Core endpoint (history caps at 10) + client paging UI (Rebuild). |
| Interrupt (Esc) | **Reuse** | `/api/interrupt` works (🧪 — used it to clear the hung turn). Client binds Esc. |
| **Slash commands** (`/compact`,`/clear`,`/context`,`/usage`, plugin cmds) | **Rebuild** | 🧪 NOT executable via prompt stream. Client intercepts: map `/compact`,`/clear` to SDK/session ops; compute `/context`,`/usage` from `result`/`running_stats` token data; route skill/plugin commands appropriately. |
| `@`-file mentions | **Rebuild** | client-side file picker + inject file content into the prompt (SDK takes the resulting text/content blocks). *Verify exact behavior in M3.* |
| Image paste | **Rebuild** | client captures image → SDK input content block (SDK supports image blocks). |
| Input editor / multiline / vim mode | **Rebuild** | pure client UI. |
| Slash/`@` autocomplete | **Rebuild** | client UI driven by the `init` command/skill lists. |
| Status line | **Rebuild** | client renders from `status`/`running_stats`/`result`. |
| Diff/syntax rendering for edits | **Rebuild** | client renders from `tool_end` detail (Edit/Write inputs). |

## Blocked bucket (genuinely no SDK path)

**None identified as impossible.** Everything is Reuse or Rebuild. The one true gotcha is **slash-command
invocation** (must be client-side, not via prompt) — classified Rebuild, not Blocked. Items flagged
*"verify in M3"* (`@`-mention expansion exactness, image-block round-trip, per-command mappings) are
confirmation tasks, not anticipated blockers.

**Implication for M1/M3:** parity is achievable on the SDK substrate; the desk-client labor is overwhelmingly
**Rebuild (front-end affordances)**, with the slash-command interceptor as the key architectural piece to design early.
