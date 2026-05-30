---
title: Terminal Mode & Usage
domain: terminal-mode
last_updated: 2026-05-30
overall_confidence: ✅
---

# Terminal Mode & Usage

> Confidence legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven
> Source ids `[sN]` resolve in `../../research/2026-05-30-initial-survey/sources.md`.

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
- ✅ **Claude path hard-codes `model: 'claude-opus-4-6'`, `permissionMode: 'acceptEdits'`, `maxTurns: 50`** (dist/claude/session.js:241/248/268), with **no env/CLI/config override**. `allowedTools` = Read/Edit/Glob/Grep/Agent/WebSearch/WebFetch/TaskOutput/ExitPlanMode/ListMcpResources/ReadMcpResource — so Edit auto-applies (acceptEdits) while non-allowlisted tools (e.g. Bash) still route to the ring. _[s107][s109][s113][s114]_
  - 🟡 **Stale model pin:** `claude-opus-4-6` is now two generations behind (Opus 4.7 and 4.8 have shipped). A worthwhile contribution/fork target. → see `../../ideas/backlog.md`.
- ✅ **Permission prompts → ring options Yes / [Yes-always] / No; default-DENY after 60s.** `AskUserQuestion` → default-SKIP after 120s (session.js:471/418; Codex mirrors at 60s/120s). _An earlier adversarial verdict "refuted" this — but it had audited third-party forks, not the official package; the official source confirms it exactly._ _[s107][s108][s109]_
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
