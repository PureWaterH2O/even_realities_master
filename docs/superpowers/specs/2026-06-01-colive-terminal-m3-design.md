# Co-Live Terminal — M3 "Desk Cockpit" design (M3.0 parity inventory + roadmap)

> **Status:** ✅ **LOCKED** — accepted by the user 2026-06-01 (brainstorm w/ 4.8). This document **is** the M3.0 deliverable:
> the feature wishlist, the feasibility classification, and the sequenced milestone roadmap. No M3.1+
> implementation planning happens until this is reviewed and accepted.
> **Relates to:** the original Co-Live design `2026-05-30-colive-terminal-design.md` (§6 "full native parity",
> §7 sequencing — this refines its M3). M1 + M2 are complete and merged (`4881ca4`).
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK type defs) · 🟡 community · 🔴 unverified.

## 0. Definition of done — non-negotiable: real hardware UAT + user validation

**This is the governing rule for every M3 rung. It overrides any agent's or session's claim of completion.**

- **"Code complete + green tests + clean typecheck" is NOT done.** It is the *precondition* for UAT, nothing more.
  Automated tests prove the software side; they do not prove the feature works on the glasses in the user's hand.
- **A rung is DONE only after the user personally exercises it on the real G2 + R1 hardware and signs off.**
  No rung is merged, marked complete, or built upon before that hardware-UAT sign-off. (Both M1 and M2 build
  sessions tried to merge immediately after the last code task, before any real testing — the user blocked both.
  That failure mode is explicitly designed out here.)
- **Build (ultracode) agents must NOT self-declare "done."** Their output is a *candidate*. The controller
  re-verifies tests/typecheck from a clean tree (never on agent self-report), then the work goes to the **user
  for hardware UAT**. Only the user closes a rung.
- **Every rung ships with a written UAT run-book** (concrete steps the user performs on hardware) and a place to
  record the sign-off + any bugs found. Bugs found in UAT are fixed and **re-UAT'd**, not waved through.
- The per-rung "Acceptance" entries in §7 are the *hardware* acceptance criteria — what the user must see work
  on the real device for that rung to count.

## 1. Goal

Make the **desk client** a daily driver: recreate the native `claude` Code TUI experience ("no regression"),
**then build past it**. Bounded as the **daily-driver subset** — recreate what the user actually uses + the
specific "on top" features chosen, not every native feature for its own sake.

**Substrate (decided):** stay a **Terminal TUI** (extend the M1 ink client), not web / VS Code extension /
desktop app. Rationale: lives in the user's VS Code integrated terminal; native parity is concretely achievable
because native *is* a TUI; fastest to value; and the Hub is UI-agnostic, so a richer surface can be added later
as *another* Hub client without touching Core/Hub. Accepted terminal ceilings: inline image **display**
(Sixel/Kitty — finicky), GUI-grade visual polish, very dense multi-pane.

## 2. Scope boundary (decided)

**M3 = the DESK experience only.** The desk cockpit continues to co-live with the glasses exactly as M1/M2 do
(unchanged), but M3 does **not** change glasses-side rendering. Deferred to their own future milestones:

- **Glasses / HUD UX** — smart ~50-char summarization, glasses-side notifications, anything that changes what
  the glasses render.
- **Knowledge-base / Obsidian thought-capture** — the user's second primary use case; its own milestone(s).
- **Push-to-glasses** — 🧪 **Blocked**: the Hub is pull-based (`GET /api/sessions` + `GET /api/events?sessionId=`;
  no "set active session" route — `src/hub/routes.ts`) and the Even app is closed, so the desk cannot force the
  glasses to switch view. What we *have*: desk-started sessions appear in the glasses list instantly and co-live
  once the glasses open them.

## 3. The wishlist (locked)

**Recreate native (the "safe to switch" half) — minus vim:**
- *Composing:* multiline + paste, command history (↑/↓), slash menu, `@`-file autocomplete, `!`bash, `#`memory,
  **image paste** (capture + send; `[image attached]` placeholder display), edit/queue messages.
- *Reading:* streaming, **thinking display**, Ctrl-O expand, diff + syntax, scrollback viewport, todos, markdown.
- *Control:* Esc-interrupt, `/clear`, `/compact`, permission-mode cycle (incl. **plan mode**), `/model`,
  real `/cost` + `/context`, `/config`.
- *Extensibility (render their effects):* subagents, **skills**, plugins, MCP, hooks, custom slash commands,
  output styles, background tasks, `/workflows` *(if reachable — see §6)*.
- *Ambient:* status line, notifications, git-state.
- *Low-priority adds:* interactive `/resume` picker, MCP auth + management, management commands
  (`/agents` `/memory` `/permissions` `/hooks` `/init` `/export`).

**Build past native (desk-side):**
- 🌟 **Session command-center** — a dashboard of all chats with live status badges (thinking · blocked-on-permission
  · idle · done) to glance and jump.
- **Live file-watch pane** — files updating as the agent edits them.
- **Message source tags** — each user message in the transcript shows a colored origin tag (e.g. `[glasses]` /
  `[mac]`) so it's clear where it came from. A co-live presence/provenance cue; generalizes to any client.
  *(Added post-lock 2026-06-01.)*

**Parked backlog (explicitly out of M3, kept so they're not lost):** conversation rewind/checkpoint,
auto-compact at context limit, cross-session search, diff/review queue, saved prompt templates, workflow launcher
UI, transcript bookmarks.

## 4. Feasibility inventory (the M3.0 sort)

Verified by reading our Core (`src/core/*.ts`) and the Agent SDK type defs
(`@anthropic-ai/claude-agent-sdk@0.3.158` `sdk.d.ts`).

### 🟢 Already works — just render it
Streaming text, tool start/end, permission + question prompts, notifications, result/cost data, todos data.
🧪 **Ctrl-O expand detail is already in the event** — `tool_end.detail.{input,output}` exists in the event
vocabulary (`src/core/events.ts`); the client simply doesn't render it yet.

### 🔵 Rebuild — client-only (no Core change)
Scrollback viewport, diff + syntax rendering, Ctrl-O expand, markdown, input editor (cursor / history /
multiline), slash-command menu, `@`-file autocomplete (the desk client runs locally → it reads the filesystem),
`!`bash, status line, git-state, real `/cost` + `/context` (token + cost data already present), **session
command-center**, **file-watch pane**.

### 🔵 Rebuild — needs Core work
- **Thinking display** — 🧪 the SDK *does* stream thinking (the Core sees `content_block_delta` /
  `thinking_delta`), but the Core **deliberately drops it** (`src/core/session.ts` — an M0 anti-HUD-leak choice).
  Fix: add a `thinking_delta` event to the vocabulary + emit it + render it **on the desk only** (the closed Even
  app ignores unknown events, so the glasses are unaffected). *Small change.*
- **The runtime-control layer** — see §5; gated on the streaming-input upgrade.
- **Message source/provenance** — the `user_prompt` event carries no origin today (`{type,text}` in
  `src/core/events.ts`); add a `source` field + Hub logic to label it (our desk client marks itself; a prompt
  POST without that marker ⇒ glasses). Feeds the M3.4 message source tags. *Small.*

### 🔴 Blocked / verify-in-build
- **`/workflows`** — reachable *only if* it appears in the SDK's `supportedCommands()` once we're in
  streaming-input mode. Probe live during M3.3; if absent, document as a gap (don't promise it).

## 5. 🔑 Headline finding — the streaming-input upgrade (foundation for the control layer)

✅ Our Core drives the SDK in **string-prompt mode** (`query({prompt: string})`, abort-based interrupt —
`src/core/session.ts`). The SDK also supports **streaming-input mode** (`query({prompt: AsyncIterable<SDKUserMessage>})`,
confirmed `sdk.d.ts:2391`), and *only that mode* exposes the `Query` control methods we need:

| Method (`sdk.d.ts`) | Unlocks |
|---|---|
| `setModel()` (2186) | `/model` switch at runtime |
| `setPermissionMode()` (2179) | mode cycle incl. **plan mode** at runtime |
| `supportedCommands()` (2237) + local slash handling | `/compact` and other real slash commands |
| `mcpServerStatus()` (2255) + `Options.mcpServers` (1601) | MCP servers + auth |
| `setMaxThinkingTokens()` (2203) | thinking control |
| `interrupt()` (2172) | clean interrupt |
| `SDKUserMessage` content blocks | **image paste** (structured content, not a bare string) |

**Decision (made by choosing the control features as must-haves):** we **commit to upgrading the Core to
streaming-input mode**. It is a real refactor — the turn-driver currently assumes a string prompt per turn and
an abort-based stop — so it is the single **riskiest** piece of M3 and is isolated into its own milestone (M3.3)
with a full hardware-UAT gate. Features that do **not** need it (reading, input, autocomplete, multi-session,
aesthetics) ship first so a usable daily driver exists before the refactor lands.

## 6. `settingSources` decision (made)

🧪 The Core currently runs with `settingSources: []` (`src/core/config.ts`) to kill a ~20s/turn SessionStart-hook
latency + a HUD leak (M0 findings). The cost: the user's **skills, hooks, custom slash commands, output styles,
and CLAUDE.md do not load** — which native Claude Code *does* load.

**Decision:** flip `settingSources` to include **`project`** (and **`user`**) for desk-driven sessions so skills
(a must-have for the user) and project config load — i.e. real parity. We accept the re-introduced latency and
will handle the former HUD-leak by rendering hook/startup output in the **desk transcript** (where it belongs)
rather than leaking to the glasses. Open sub-questions for M3.3: whether to make this **per-session**
(desk-full vs glasses-observed) and whether to mitigate the startup latency (e.g. trim which SessionStart hooks run).

## 7. Milestone roadmap (recommended order — revisitable)

Each rung is its own spec → plan → build → **hardware-UAT** cycle. Method: 4.8 brainstorm/plan → Opus 4.8
ultracode execute → 4.6 validate → **user hardware UAT sign-off**. Per **§0 (non-negotiable)**: green tests are
only the precondition; a rung is **done only when the user has exercised it on the real G2 + R1 and signed off**.
Each rung carries a written UAT run-book; bugs found on hardware are fixed and re-UAT'd, never waved through.

| Rung | Contents | Core change | Acceptance (hardware-UAT) |
|---|---|---|---|
| **M3.1 — Readable transcript** | scrollback viewport, diff/syntax, Ctrl-O expand, markdown, todos panel, **thinking display** | tiny (thinking event) | read a real multi-tool session end-to-end: scroll back, expand a tool, see a diff + the thinking |
| **M3.2 — Input & autocomplete** | editor (cursor / history / multiline / paste), slash menu, `@`-file autocomplete, `!`bash | none | compose a real multiline prompt with file refs without friction; recall history |
| **M3.3 — Streaming-input Core + controls** | **the refactor** → `/compact`, `/model`, mode toggle / plan mode, MCP, **image paste**, clean interrupt, `settingSources` flip (+ skills loading) | **big** | flip mode mid-session, switch model, run `/compact`, paste an image, load a skill — all on hardware |
| **M3.4 — Multi-session** | session command-center (status badges) + live file-watch pane + **message source tags** (`[glasses]`/`[mac]` provenance; adds `source` to `user_prompt`) | some (+ `source` event field) | run ≥2 chats; glance the dashboard; jump between; watch files change; **see colored source tags distinguishing glasses- vs desk-sent messages** |
| **M3.5 — Aesthetic pass** | theming / polish gate (aesthetics also folded into each rung) | none | "I want to look at this all day" sign-off |

After **M3.1 + M3.2** the cockpit is a usable daily driver (readable + typeable) *before* the risky refactor.
Aesthetics are folded into every rung; M3.5 is the final polish gate, not the only place polish happens.

## 8. Risks

- **Streaming-input refactor (highest).** Rewrites the turn-driver + interrupt path; many invariants (FIFO queue,
  single-writer, idle/permission framing) must be preserved. Mitigation: isolated milestone, full test + hardware
  UAT, keep the M1/M2 co-live + glasses behavior byte-compatible.
- **`settingSources` latency/leak regression.** Flipping it on can re-introduce the ~20s startup latency and
  hook output on the HUD. Mitigation: render startup/hook output in the desk transcript; consider per-session
  setting + hook trimming (M3.3).
- **`/workflows` may be a documented gap** (see §4) — don't promise until probed.
- **Terminal ceilings** (image display, dense panes) are accepted, not solved.
- **Scope creep** — the parked backlog (§3) stays parked unless deliberately pulled in.

## 9. Open questions (resolve in the relevant milestone, not now)

1. `settingSources`: per-session or global? How to mitigate startup latency? (M3.3)
2. Is `/workflows` in `supportedCommands()`? (M3.3 live probe)
3. Exact `SDKUserMessage` image-content shape for paste. (M3.3)
4. Multi-session: subscribe-all vs subscribe-on-view; how many concurrent SSE streams is comfortable? (M3.4)
5. Does the streaming-input refactor change how the **glasses** drive a session, or only the desk? (M3.3 — must
   stay backward-compatible with the Even app.)
