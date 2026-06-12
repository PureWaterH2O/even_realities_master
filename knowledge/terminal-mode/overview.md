---
title: Terminal Mode & Usage
domain: terminal-mode
last_updated: 2026-06-07
overall_confidence: ✅
---

# Terminal Mode & Usage

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

## 🧪 Verified firsthand — live hardware probe (2026-05-30)

We ran the genuine `even-terminal@0.7.9` bridge against the user's real G2 + R1 + Even app and watched the
on-wire traffic. Full audit trail: [`../../research/2026-05-30-terminal-mode-live-probe/findings.md`](../../research/2026-05-30-terminal-mode-live-probe/findings.md). Headlines (all 🧪):

- **The bridge surfaces & renders your *desk-TUI* sessions on the glasses** — it reads the shared
  `~/.claude/projects/*.jsonl` store (`listSessions`/`getSessionMessages` + `findSessionFile`). Monitoring a
  desk session needs **zero engineering**. BUT it's **observe-only**: list + status (10 s poll) + last-10 history
  on open; **no live streaming and no ring-answerable prompts** for a session the bridge isn't itself driving.
  (Live SSE + ring permissions only exist for **bridge-driven** sessions.) ← this gap is the core design problem.
- **App behavior:** on connect → `GET /api/info`,`/api/sessions`,`/api/update-check`; then **polls `/api/sessions`
  every ~10 s with no `cwd`** (list spans *all* projects); on open → SSE `/api/events?sessionId=` + `/sessions/:id/history?limit=10`.
- **Live SSE vocabulary** (bridge-driven): `user_prompt`, `status`(`busy|think_start|think_end|text_start|text_end|idle`),
  `tool_start`, `tool_end{summary,detail}`, `text_delta` (streamed text), `running_stats`, `result{costUsd…}`,
  `permission_request`, `permission_result`, plus `notification`,`task_progress`,`user_question`.
  - 🧪 **Update 2026-06-02 (M3.1):** our Core now ALSO emits a **`thinking_delta{text}`** event, sourced from the
    SDK's `content_block_delta.delta.thinking`. It is **desk-only by convention**: the Hub broadcasts it to every
    subscriber (no allowlist — `src/hub/sse.ts` `JSON.stringify`), and the **closed Even app ignores unknown event
    types**, so thinking still never renders on the glasses HUD. (Supersedes the earlier "thinking is NOT streamed"
    note — thinking text IS now on the wire, but only the desk TUI renders it; hardware B2 UAT pending to confirm
    the app truly ignores it.) The desk client renders the live stream via a **flatten-to-ANSI-rows** viewport
    (`src/desk/render/*`): markdown, syntax-highlighted inline diffs, a Ctrl-O verbose toggle, a todos panel, and
    collapsible thinking.
- **Ring round-trip works:** single **tap = `allow`** (`POST /api/permission-response{decision}` → `permission_result` → tool runs; verified a real file was created). Permission **60 s default-DENY**, AskUserQuestion **120 s default-SKIP**.
- **Dictation = raw speech-to-text** ("touch /tmp/x" → "touch slash temp slash x"); the agent must infer intent.
  **Natural-language instructions beat dictating exact syntax.**
- **Our own `.claude` hooks run inside bridge sessions** (`settingSources:["user","project"]`) — the capture-reminder
  Stop hook leaked "nothing to capture" onto the HUD. Design around it.
- **Replying to an existing session from the glasses `resume`s it and APPENDS IN PLACE** (same session id; verified
  39→53 lines), headless on 4.6, streaming live to the glasses; **no desk window** (use `claude --resume <id>` to see it).
  ⚠️ So pointing the glasses at a session **also live in a desk TUI = two writers on one transcript → collision risk.**
  Naive "literal same live session" needs a **single coordinating owner**, not two independent processes.
- **An *observed* session does not update live on the glasses** — you must exit→reopen to refresh content (only the
  10 s status poll is live). Live streaming exists **only** for sessions the bridge itself drives.

### M0 co-live spike addendum (2026-05-30, all 🧪 — see `../../research/2026-05-30-colive-m0-spike/`)

- **🧪 Live stream SURVIVES iOS backgrounding.** With the phone **locked + pocketed**, the glasses HUD kept updating
  live for **~2 min continuous** (SSE frames every 10s, zero disconnects). The "out for a run" mechanic works for
  active tasks. *Caveat:* long **idle** pockets (10+ min, no frames) untested — may still drop; reconnect/replay TBD.
- **🧪 Two clients co-live on one session with no collision** — both receive all events; a 2nd client's prompt
  appends to the same transcript (serialized by the one owner). Validates the co-live architecture.
- **🧪 ~20 s first-output latency per bridge turn** caused by the host's **global `.claude` `SessionStart` hooks**
  (superpowers + remember) injecting context (+ MCP-connect attempts). A custom Core that controls `settingSources`
  removes it.
- **🧪 The app subscribes to a session's SSE only when it's *viewed*** — a fast reply can finish before the HUD
  attaches (→ looks "dead" on the first turn). Owning both clients fixes the timing.
- **🧪 Slash commands are NOT invokable via the prompt stream** — sending `/context` as a prompt **hung the turn**
  (0 tokens, no output). A desk client must intercept slash commands client-side; never forward `/cmd` to `query()`.
- **🧪 Terse dictated prompts trigger autonomous multi-step work** — "Go." was read as "proceed," and the agent
  read files / ran Bash for ~110 s on `acceptEdits` until interrupted. Needs guardrails. `/api/interrupt` stops it cleanly.
- **🧪 `even-terminal` is closed-source / compiled-only / no declared license** → we **reimplement** a
  protocol-compatible Core rather than fork. (Multi-phone BLE contention can also silently steal the glasses — keep
  other paired phones' Bluetooth off.)

## Summary

**Terminal Mode** is an official, built-in G2 feature (shipped in the Even Realities app **v2.2.0**, live ~late Apr 2026; **Codex** support added in **v2.2.1**; multi-session streaming in **v2.2.2**). It turns the glasses into an ambient control surface for AI coding agents: the agent's running output "tail" appears in the green HUD, status is glanceable (Thinking / Listening / Executing), and you respond hands-free with the R1 ring (tap = approve, hold = dictate). The host side is the official npm CLI **`@evenrealities/even-terminal`** (current 0.7.9), a local Express + SSE bridge (default port 3456, bearer-token auth) that drives **Claude** via `@anthropic-ai/claude-agent-sdk` and **Codex** via `codex app-server` JSON-RPC. Note: this is unrelated to the Even **Hub** "terminal"/CLI naming, which is just their Claude Code dev tooling.

> ⚠️ **Naming collision to keep straight:** (1) *Terminal Mode* = this AI-agent-control feature. (2) *`evenhub-cli`* = the app-packaging CLI (see [[overview]] in `sdk-app-dev`). (3) Even Hub's "AI tooling / Claude Code" docs section = guidance for building Hub apps with Claude. Three different "terminal/CLI" things.

## What it is & how to set up

- ✅ **Official built-in feature, not a Hub SDK app.** Announced on Even's changelog ("Even G2 Update v2.2.0 is now live. Introducing Terminal Mode"); Codex added in v2.2.1. Corroborated by Engadget, Digital Trends, AndroidGuys. _[s60][s106][s56][s55][s62]_
- ✅ **Setup:** enable Terminal Mode in the Even app **Settings**, then connect a host machine by **info, port, and auth token** — in practice by scanning a **QR code** printed by the `even-terminal` CLI. _[s51][s107]_
- ✅ **Host tool:** `npm install -g @evenrealities/even-terminal`, run `even-terminal` (optionally `--provider codex`), enable Terminal Mode in app, scan the QR. Maintained by `@evenrealities.com` staff; v0.7.9 is current. _[s107][s108]_

## Interaction model (R1 ring + HUD)

- ✅ **HUD shows the agent's "tail"** — current action / pending question / latest result — quietly in peripheral vision; glance up ~half a second to stay current. _[s52]_
- ✅ **Status indicators:** Thinking / Listening / Executing, shown ambiently; display shifts when the agent needs attention. _[s55][s62][s52]_
- ✅ **R1 ring: single tap = confirm/approve.** _[s52][s51][s62]_
- 🟡 **Double-tap is ambiguous in Even's own materials:** the blog says double-tap = **reject**; the /terminal product page says double-tap = **minimize** the live session to a lighter background view while it keeps running. Likely **context-dependent** (decision prompt vs idle view). _[s52][s51]_
- ✅ **Hold the ring (or glasses touchpad) to dictate;** the 4-mic array transcribes live (blog: "bright green" prompts, "dim green" transcription) and commits when you stop speaking. _[s52][s51][s62]_
- ✅ **Multi-session monitoring:** see what's running / blocked / waiting across sessions in your line of sight. Bridge confirms via `GET /api/sessions` (checks first 10). _[s51][s107]_

## The `even-terminal` bridge (verified against the official npm tarball)

The agents downloaded v0.7.9 and confirmed its integrity hash matched npm's published `dist.shasum` (`bbf831b7…`), so these code-level facts are from the genuine artifact:

- ✅ **Local Express HTTP server, default port 3456, bearer-token auth, SSE stream** to the glasses app (`GET /api/events`, 15s heartbeat, 500-msg/session ring buffer). Endpoints: `/api/prompt`, `/permission-response`, `/question-response`, `/interrupt`, `/status`, `/messages`, `/sessions`, `/info`. _[s107][s108]_
- ✅ **Two providers:** `claude` (default) via `@anthropic-ai/claude-agent-sdk`, and `codex` via `codex app-server` JSON-RPC over WebSocket (port 8765). _[s107][s108]_
- 🧪 **Claude path hard-codes `model: 'claude-opus-4-6'`, `permissionMode: 'acceptEdits'`, `maxTurns: 50`** (dist/claude/session.js). These three have **no override**. _But correcting our earlier "no env/CLI/config override" overreach:_ `PORT`, `BRIDGE_TOKEN`, `PROJECT_DIR`, `EVEN_HOST_MODE` (incl. `tailscale`), `EVEN_TERMINAL_NAME`, and `EVEN_TERMINAL_EXPOSE_PROVIDER` **are** env-configurable. _[s107] + 2026-05-30 probe_
  - 🟡 **Stale model pin:** `claude-opus-4-6` is two generations behind (4.7/4.8 shipped). Fork/contribution target. → `../../ideas/backlog.md`.
  - 🧪 **Model-display gotcha:** `GET /api/info` reports the model from your **recent session transcripts** (showed "Opus 4.8"), *not* the pinned model the bridge actually runs. **App shows 4.8; bridge runs 4.6.**
- 🧪 **Permission model (CORRECTED — earlier doc was wrong that "non-allowlisted Bash routes to the ring").** What actually reaches the ring is narrow:
  - **Auto-approved silently:** `allowedTools` (Read/Edit/Glob/Grep/Agent/WebSearch/WebFetch/TaskOutput/ExitPlanMode/ListMcpResources/ReadMcpResource), all `Write`/`Edit` (via `acceptEdits`), **read-only Bash on a hard-coded safelist** (`ls cat head tail wc pwd echo printf date whoami which type file stat du df env uname id  git status|log|diff|branch|show|remote|rev-parse`), `TodoWrite`, `TaskUpdate`, and a **catch-all `allow`** for anything else.
  - **Reaches the ring:** non-safelisted/mutating **Bash**; `KillShell`/`Config`/`Mcp`/`RemoteTrigger`; and `AskUserQuestion`. Options **Yes / [Yes, and always allow…] / No**; permission **60 s default-DENY**, question **120 s default-SKIP**. Single tap = `allow` (verified). _[s107] + 2026-05-30 probe_
    - ⚠️ Consequence for "approve everything from the ring": **you can't**, with the stock bridge — edits/writes/safe-bash apply silently because `acceptEdits` is hard-coded. Tighter ring control is a **fork lever**.
- ✅ **Tool calls condensed to one-liners** for the small display: `Bash <~50-char desc>`, `Grep "<~25-char>"`, `Agent <~40-char>`; permission detail fields sliced to ~200 chars. This is the de-facto HUD text budget. _[s107][s108]_

## Native vs third-party-bridge behavior (important distinction)

- ✅ **The open-source community bridge `claude-code-g2` is NOT tail-only:** it renders a full-screen **scrollable** 576×288 transcript (collapsed tool calls, turn separators, scroll bar), swipe up/down scrolls 5 lines, and its tap/double-tap gestures differ from native Terminal Mode. So scroll vs tail-only and gesture meaning **depend on which implementation you're using**. _[s54][s115]_
- 🟡 **No independent hands-on demo with on-glasses screenshots of *native* Terminal Mode was found;** existing community hands-on (cc-g2, OpenClaw) are third-party bridges. Real-device native rendering is grounded in vendor copy + bridge analogues. _[s53][s116][s117]_

## Security model of the bridge (reconstructed from source — under-documented officially)

- ✅ **Binds to `0.0.0.0`** (all interfaces, not localhost) → reachable from the whole LAN on port 3456, despite the banner saying `localhost`. _[s109]_
- ✅ **Bearer token also accepted as plaintext `?token=` query param** (necessary because SSE/EventSource can't set headers) and **leaks** into request logs, the stdout/QR connect URL, and any public tunnel URL. _[s109]_
- ✅ **Plain HTTP, no TLS, CORS fully open;** non-constant-time token compare; no rate limiting. _[s109]_
- ✅ **Only built-in remote access = temporary `pinggy`/`bore` tunnels** (publish the LAN service to the public internet; README says not for long-term use). No official authenticated remote path; secure remote use is delegated to user networking (Tailscale), but the same shared bearer token is the sole credential. _[s109][s119]_

## Limitations

- The Even mobile app side is **closed-source**; exact HUD layout, status-icon mapping, and QR-pairing flow are inferred from the open host bridge + marketing, not the app binary.
- Bridge facts are from **static reading** of the integrity-verified v0.7.9 JS; runtime behavior on real G2+R1 hardware was not exercised.
- Hard-coded `claude-opus-4-6` and the 60s/120s timeout defaults are **specific to v0.7.9/0.7.7** and may change without notice — re-check against the current published `dist`.
- 🟡 Single community report claims enabling Terminal Mode **suppresses normal G2 dashboard features**; 🔴 unconfirmed and the only first-party mechanic found is "minimize to a lighter background view," which implies coexistence, not suppression. _[s111][s51]_
- Community sources disagree on HUD geometry: **576×288** (claude-code-g2) vs **576×136** (OpenClaw). See `../hardware/specs.md` for the panel-vs-canvas reconciliation. _[s54][s116]_

## Open questions

- Will a future `even-terminal` make the Claude model selectable and update the pin to 4.7/4.8?
- What exactly does Terminal Mode suppress on the G2 (dashboard, notifications, translate, teleprompter), if anything?
- How does the **native** Even app render multi-line output on the 576×288 HUD — paginate, scroll, or tail-only — and what's the real on-glasses char budget vs the bridge's truncation budget?
- Does the Codex provider expose the same ring options and minimize gesture as Claude?
- Is there an official authenticated remote-access path planned beyond pinggy/bore?

## Change log

- 2026-05-30: created from initial multi-agent survey (run `wf_302a9f4e-3e2`). Bridge internals verified against the integrity-checked npm tarball.
- 2026-05-31: **M1 END-TO-END LOOP COMPLETE + hardware-validated (`colive-terminal/`).** 🧪 The full co-live loop runs on real G2 + R1: kick off a task at a **thin desk client** (an ink TUI we built) → it streams live on the glasses HUD → dictate a **free-form** follow-up from the glasses → it enters the *same* session → response on **both** → continue at the desk. Verified on hardware: allow **and deny** permission paths (the model recovers gracefully on a deny — acknowledges, retries an alternative, then asks for confirmation rather than hanging), Esc-interrupt, `/clear`→new session, and **bidirectional permission dismissal**. The desk client is just another HTTP/SSE client of our Even-app-compatible Hub (Session Core + Hub + desk TUI; 216 automated tests). 🧪 **New protocol fact:** `permission_result` is the **client-agnostic dismiss signal** — the broker broadcasts exactly one to ALL co-live clients on every settle path (allow/deny/answered/timeout/aborted), so a prompt answered on the glasses ring dismisses the desk's inline prompt too (and vice-versa), for permissions AND questions. (A desk bug where it only cleared on a *local* answer was found + fixed in hardware UAT.) Known: the desk holds a single pending-prompt slot so it can't disambiguate *concurrent* permissions (the glasses is the primary multi-permission UI; the broker FIFO-resolves correctly). Build log: `projects/colive-terminal/` (status/notes/log).
- 2026-05-31: **M1 permission UAT — concurrent permissions are FIFO.** 🧪 Native even-terminal keeps pending permissions as a queue and each `/api/permission-response` does `pendingPermissions.shift()` — settling the OLDEST pending request (the app POSTs `{sessionId, decision}` with NO toolUseId). This is REQUIRED to support **concurrent** permission requests (the model firing several parallel tool calls): a single "latest pending id per session" mapping silently strands all-but-one to the 60s default-deny. Our Core now resolves the oldest pending on an empty/unknown toolUseId (explicit id still targets that exact one). Source: native `dist/claude/session.js` + our 2026-05-31 hardware UAT. Detail: `projects/colive-terminal/notes.md` (bug #3).
- 2026-05-31: **M1 Phase 2 hardware acceptance (real G2 + Even app, our reimplemented Core).** 🧪 Continuous multi-turn co-live conversation from the glasses on one session works; **ring-permission round-trip works** (desk-injected tool prompt → tappable ring → tap=allow → tool runs, verified across two turns). **Wire-shape facts the Core MUST honor** (diffed vs native `even-terminal` 0.7.9 `dist/claude/session.js`): (1) **`permission_request.options` are `{text,key}` objects, not strings** — the app renders ring buttons from these (`text`=label, `key`=the POSTed `decision`); bare strings render nothing → no prompt → silent timeout. Minimal set `[{text:'Yes',key:'allow'},{text:'No',key:'deny'}]` (+ `key:'allowAlways'` when SDK `suggestions` present); `detail` is a short string, not the raw input. (2) **A `canUseTool` allow MUST return `updatedInput` (a record)** — the SDK Zod-validates the result at runtime and rejects bare `{behavior:'allow'}` (`path:["updatedInput"]`), failing the tool after approval; the TS type marks it optional (trap). Echo the original input back, like native. (3) The HUD clears "thinking" only on a terminal `status:idle` SSE frame; `/api/sessions.timestamp` must be ISO-8601 (Dart parser); `ai-title` last-line ⇒ idle. Build detail: `projects/colive-terminal/notes.md`.
- 2026-05-31: **M1 build (Phase 1 — Session Core).** 🧪 Confirmed the Claude Code session-store **path encoding** — a project dir maps to `~/.claude/projects/<name>` by replacing every non-`[a-zA-Z0-9]` char with `-` (`/private/tmp/colive-spike` → `-private-tmp-colive-spike`; underscores too). 🧪 Session jsonl **idle-markers**: last-line `type` ∈ {`last-prompt`,`permission-mode`,`result`,`interrupt`} or `system`/`stop_hook_summary` subtype ⇒ idle (else mtime-based, 120s staleness). 🧪 `Query.interrupt()` is streaming-input-mode only (v1 uses `abortController.abort()`). Build detail: `projects/colive-terminal/notes.md`.
- 2026-05-30: **M0 co-live spike** (real G2+R1). 🧪 Live stream survives iOS backgrounding (~2 min pocketed); two-client co-live confirmed (no collision); ~20 s/turn `SessionStart`-hook latency; app subscribes SSE only on view; slash commands hang via prompt stream; terse prompts trigger autonomy; even-terminal closed/no-license → reimplement. Detail: `../../research/2026-05-30-colive-m0-spike/`.
- 2026-05-30: **live hardware probe** (real G2+R1+app vs genuine 0.7.9 bridge). Promoted bridge internals to 🧪. **Corrected** two claims: (1) "no env/CLI/config override" → only model/permissionMode/maxTurns are fixed; PORT/BRIDGE_TOKEN/PROJECT_DIR/EVEN_HOST_MODE etc. are configurable; (2) "non-allowlisted Bash routes to the ring" → only *mutating* Bash + KillShell/Config/Mcp/RemoteTrigger + AskUserQuestion do; reads/edits/writes/safe-bash auto-approve. Added: desk-TUI sessions are listable/observable but not live-interactable; full SSE vocabulary; model-display gotcha; dictation=raw STT; our hooks leak into bridge sessions. Audit trail: `../../research/2026-05-30-terminal-mode-live-probe/findings.md`.
- 2026-06-01: **M3.0 "Desk Cockpit" design — Agent SDK control surface mapped.** ✅ (vs `@anthropic-ai/claude-agent-sdk@0.3.158` `sdk.d.ts`): the SDK exposes runtime controls — `setModel`, `setPermissionMode`, `supportedCommands` (slash commands), `mcpServerStatus`, `setMaxThinkingTokens`, real `interrupt`, and image-content prompts — **only in streaming-input mode** (`query({prompt: AsyncIterable<SDKUserMessage>})`); our Co-Live Core currently uses **string-prompt mode** (abort-based interrupt), so unlocking `/model`/mode-toggle/`/compact`/MCP/image-paste requires a single string→streaming-input Core refactor. 🧪 Also: `tool_end.detail` already carries full tool input/output (Ctrl-O expand is client-render-only); the Core deliberately drops streamed thinking text (M0 anti-HUD-leak) — desk display needs a small new event; `settingSources:[]` disables skills/hooks/CLAUDE.md (M3 flips to `project`+`user`). Full design: `docs/superpowers/specs/2026-06-01-colive-terminal-m3-design.md`.
- 2026-06-07: **M3.5 UAT fix — `AskUserQuestion` answer wire-shape (4th broker wire-fact).** 🧪 A resolved `AskUserQuestion` must return `updatedInput.answers` — a **MAP keyed by the question TEXT** (`{answers: {[questionText]: answerString}, response?: string}`), per the Agent SDK's `AskUserQuestionOutput` (`@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`). A bare `{answer: string}` is an unrecognized shape: the tool **errors and the model falls back to asking in plain text** (the desk's "picker hit an error" UAT symptom). The broker now stores the parsed question text on the pending entry and builds the map in `resolveQuestion` (the wire answer the client POSTs is unchanged). Companion to the 2026-05-31 wire-facts (allow needs an `updatedInput` record; `permission_request.options` are `{text,key}`). Self-verified 2026-06-07 via the SDK type + unit test; `colive-terminal` `02c659e`.
- 2026-06-12: **M3.5 D-033 fix — `allowAlways` persists via `updatedPermissions` (5th broker wire-fact).** 🧪 The SDK's `canUseTool` opts carry permission **`suggestions: PermissionUpdate[]`** (addRules / addDirectories / setMode…), and the sdk.d.ts contract says: when the user chooses "allow always", return the **full suggestion set verbatim** as `updatedPermissions` on the allow result — that is what persists the choice (session/project/user destination is encoded in each suggestion). A plain `allow` must NOT include them (one-time approval). Wire: the desk/glasses POST decision `allowAlways` (the Hub used to flatten it to `allow`, silently dropping persistence — now forwarded verbatim); the terminal `permission_result` still says `allow`, so client dismissal vocab is unchanged. The native option-2 label derives from the first suggestion (`Yes, and always allow access to <dir> from this project`). Self-verified via sdk.d.ts + unit tests; `colive-terminal` `f3d7a54`.
- 2026-06-12: **D-037 — session cwd comes from the prompt, else SERVE's projectDir; the store-path encoding is LOSSY and lays traps.** 🧪 Two compounding facts from a live UAT triage (verified via `lsof` on the running serve + SDK child): (1) a Co-Live session's working directory is `realpath(promptCwd ?? serve's projectDir)` — the desk never sent its cwd (the designed-for `AppConfig.cwd` was unwired), so every desk session silently ran wherever `colive serve` was started while the banner displayed the desk's own dir. Fixed: `runDesk` now passes `process.cwd()`, matching native `claude` semantics (launch dir = session dir). (2) The `~/.claude/projects/<name>` encoding (`[^a-zA-Z0-9] → '-'`, M1 fact) is **lossy and collides**: `random_claude_stuff/even_realities` and `random-claude-stuff/even-realities` map to the SAME store dir — and a model that sees the encoded name in its context (e.g. an auto-memory path) can reverse-engineer a plausible-but-wrong hyphenated path; if a phantom dir exists there (an earlier session's auto-allowed `mkdir` of the same wrong guess), `ls` "confirms" it. Phantom `…/random-claude-stuff/even-realities` (empty, created 2026-06-01) removed. Never decode an encoded store name back to a path. `colive-terminal` D-037 fix; catalog UAT round-3.
