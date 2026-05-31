# Progress Log

Overarching, dated changelog for the whole workspace: what we learned, what we
built, what we decided. Newest entries on top.

## 2026-05-31

### Co-Live Terminal — M1 build: Phase 0 + Phase 1 (Session Core) COMPLETE 🧪

- Building M1 in a fresh ultracode chat on `feat/colive-terminal-m1` via **subagent-driven-development**, each task run as a workflow pipeline: TDD implementer → spec-compliance review → code-quality review (+ fix loops).
- **Phase 0** — scaffolded `colive-terminal/` (TS ESM, `@anthropic-ai/claude-agent-sdk@0.3.158` + Express 5, vitest 4 + supertest, TS 6, Node ≥22). Captured the exact SDK API surface in `colive-terminal/docs/sdk-reference.md`.
- **Phase 1 (Session Core) — DONE; 104 tests green, typecheck clean.** Five modules, all TDD + two-stage-reviewed:
  - `events.ts` — SSE event vocabulary (discriminated union; single source of truth).
  - `config.ts` — model (default `claude-opus-4-8`) / permissionMode (`default`) / settingSources (`[]`) / host / port / token resolution (args > env > default).
  - `store.ts` — session list/transcript/status reader over `~/.claude/projects/*.jsonl`; realpath cwd; **uncapped** transcript for scrollback.
  - `session.ts` — one live `query()` per session; SDK-stream → our events (status/tool_start/tool_end/text_delta/running_stats/result); busy/enqueue; interrupt via `abortController`; **thinking text never broadcast**.
  - `permissions.ts` — permission broker (`canUseTool` → `permission_request`, 60s default-deny; AskUserQuestion → `user_question`, 120s default-skip; honors mode) + slash-command guard (leading-`/` prompts hang `query()` → rejected).
  - `sessionManager.ts` — facade: create/resume/**serialize** multi-client prompts per session + **fan-out** events to all subscribers (the co-live core).
- **🧪 Claude Code session-store path encoding** (vs real transcripts): project dir → `~/.claude/projects/<name>` replaces **every non-alphanumeric char with `-`** (`/private/tmp/colive-spike` → `-private-tmp-colive-spike`; `random_claude_stuff/even_realities` → `random-claude-stuff-even-realities`). → `encodeProjectDir`. Detail: `projects/colive-terminal/notes.md`.
- **🧪 Workflow-harness lesson:** implementer subagents stalled twice (180s no-progress → killed) from **Reading the 232 KB `sdk.d.ts`** (context bloat). Fix: distil the SDK surface into a reference doc + forbid reading `node_modules` type files. Self-contained tasks (1.1) never hit this; SDK/fs tasks did.
- **Next:** Phase 2 — Client Hub (`sse.ts` ring-buffer/broadcast/heartbeat + `routes.ts`/`server.ts` Even-app contract), then the **Task 2.3 hardware-acceptance pause** (real Even app vs `colive serve`). Then Phase 3 desk client, Phase 4 the end-to-end loop.

## 2026-05-30

### Co-Live Terminal — M0 de-risking spike COMPLETE → **GO**

- Ran all four M0 checks (plan: `docs/superpowers/plans/2026-05-30-colive-terminal-m0-spike.md`; raw: `research/2026-05-30-colive-m0-spike/`):
  1. **Source/fork** — `even-terminal` is closed, compiled-only, **no license** → **reimplement** our own protocol-compatible Core (don't fork). 🧪
  2. **Co-live** — two-client harness (`spikes/colive-harness/`) **PASS**: both clients get all events, 2nd client's prompt appends to the **same transcript**, no collision. 🧪
  3. **Parity-blocker hunt** — **no true blockers**; everything Reuse/Rebuild; **slash commands hang via the prompt stream** → desk client must intercept them client-side. Seeded `parity-inventory.md`. 🧪
  4. **iOS backgrounding** — **PASS** (biggest risk retired): glasses streamed live ~2 min with the **phone locked + pocketed**, zero disconnects. 🧪
- **Incidental 🧪:** ~20 s/turn `SessionStart`-hook latency (our global hooks) → Core must control `settingSources`; app subscribes SSE only when a session is viewed (first-turn race); terse dictated prompts trigger autonomous multi-step work (needs guardrails); `/api/interrupt` stops runaways; multi-phone BLE contention can steal the glasses.
- **Decision: GO.** M1 inputs locked (own Core, configurable model/permission/hooks, slash interceptor, realpath cwd, client-owned SSE timing, full-history endpoint; long-idle backgrounding + Tailscale deferred to M2).
- **Next:** write the **M1 implementation plan** (+ likely desk-client sub-spec). Effort: High for the plan, **ultracode** when coding M1.
- **M1 plan written:** `docs/superpowers/plans/2026-05-30-colive-terminal-m1.md` — reimplement a protocol-compatible Session Core (own config: model/permission/settingSources) + Client Hub (Even-app contract) + thin desk client (ink TUI); 4 phases ending in the end-to-end loop acceptance. Build happens in a **fresh ultracode chat on a feature branch** via subagent-driven-development; hardware-acceptance tasks pause for the user + glasses.

### First project chosen + spec drafted — "Co-Live Terminal"

- Decided the first build: a **co-live, single-owner Claude Code session** that a **desk client** and the **glasses** attach to as co-equal live clients — work at the desk, leave and interact freely from the G2+R1 (free-form, not just yes/no), return and pick up the same live session; works off-Wi-Fi via Tailscale.
- Architecture approved: fork `even-terminal` (already a single-owner multi-client SSE server) as the Session Core/Client Hub; reuse the **unmodified Even app** as the glasses client; build a **net-new desk client** that becomes the user's primary workspace (full native-parity is its definition of done).
- Sequencing **B**: prove the end-to-end away-from-desk loop first on a functional desk client, then close parity to "no regression." Effort stays **High** through spec+plan; **switch to ultracode at execution**.
- Spec: `docs/superpowers/specs/2026-05-30-colive-terminal-design.md` (awaiting user review → then writing-plans).

### Terminal Mode — live hardware probe (🧪 first firsthand ground truth)

- Goal: before designing the "monitor my desk Claude Code session from the glasses, anywhere" feature, burn down assumptions against the real bridge + G2 + R1.
- Ran genuine `even-terminal@0.7.9` on the Mac, connected the user's real glasses/ring/app over LAN, observed all on-wire traffic (`VERBOSE=1`) while the user reported on-device behavior.
- **Confirmed firsthand:** bridge **lists & renders the user's desk-TUI sessions** on the glasses (reads shared `~/.claude/projects/*.jsonl`) — but **observe-only** (no live stream / no ring prompts for sessions it doesn't drive); full live SSE vocabulary for **bridge-driven** sessions; **single ring tap = allow** (verified a file got created); permission 60 s default-DENY / question 120 s default-SKIP.
- **Corrected the knowledge base:** (1) only `model`/`permissionMode`/`maxTurns` are hard-coded — `PORT`/`BRIDGE_TOKEN`/`PROJECT_DIR`/`EVEN_HOST_MODE`(incl. **tailscale**)/expose-provider are env-configurable; (2) the ring only sees *mutating* Bash + KillShell/Config/Mcp/RemoteTrigger + AskUserQuestion — reads/edits/writes/safe-bash auto-approve (`acceptEdits` hard-coded).
- **New findings:** `/api/info` shows the *recent-transcript* model ("Opus 4.8") while bridge sessions actually run **4.6**; **dictation is raw speech-to-text** (spoken paths/punctuation come through literally → natural language beats exact syntax); **our own `.claude` hooks run inside bridge sessions** and leak onto the HUD; off-WiFi remote = built-in **Tailscale** flag, not engineering.
- **The crux for the desk-session vision** is now pinned: marry a *live desk-TUI session* with *bridge-driven live SSE + ring-answerable prompts* (the bridge can observe the former and drive the latter, but not both at once). Audit trail: `research/2026-05-30-terminal-mode-live-probe/findings.md`.
- **Next:** return to Option-A design with this ground truth; decide how to bridge observe↔control for the user's seamless same-session goal.

### Phase 1 research sweep — COMPLETE & distilled

- Sweep `wf_302a9f4e-3e2` returned: **80 agents, ~2.9M tokens, 1,649 tool calls, ~38 min**, **207 unique sources, 142 findings** across 5 domains (terminal-mode 35, sdk-app-dev 37, firmware-ble 43, hardware 12, ecosystem 15) + 8 critic gaps filled.
- Raw audit trail written to `research/2026-05-30-initial-survey/` (`findings.md`, `sources.md`, `raw-result.json`).
- Distilled into curated, confidence-tagged docs: `knowledge/{terminal-mode,sdk-app-dev,firmware-ble,hardware,ecosystem}/` + updated `INDEX.md` and `limitations.md`.
- Seeded `ideas/backlog.md` with 7 build ideas (top: fork `even-terminal` to unpin/bump the Claude model; harden the bridge; build a first Hub app).
- **Headline learnings:** Terminal Mode is an official feature (app v2.2.0+) whose host bridge `@evenrealities/even-terminal` hard-codes `claude-opus-4-6`; G2 apps are web apps in the phone WebView (phone = BLE proxy), 576×288/4-bit canvas; BLE is fully community-RE'd (no vendor spec); the internal chip BOM is single-source/unconfirmed (Apollo510-class + EM9305, SKU unresolved).
- **Next:** pick a first project from `ideas/backlog.md` (likely the `even-terminal` model-unpin or a first Hub app) and/or start promoting 🟡 facts to 🧪 by testing on our own G2+R1.

### Setup

- Set up the workspace: knowledge base structure, project/idea tracking, research
  audit-trail format, CLAUDE.md context, and the auto-capture Stop hook.
- Approved design spec: `docs/superpowers/specs/2026-05-30-even-realities-knowledge-base-design.md`.
- Seed sources captured: evenrealities hub docs, GitHub repos nickustinov/even-g2-notes,
  fabioglimb/even-toolkit, even-realities org, i-soxi/even-g2-protocol.
- **Launched** the Phase 1 multi-agent research sweep (ultracode workflow, run `wf_302a9f4e-3e2`):
  scout → per-domain deep-dive → adversarial verify → synthesize → critic → gap-fill.
  Running in background; results pending.
- Next (when sweep returns): write `research/2026-05-30-initial-survey/{findings,sources}.md`,
  distill into `knowledge/<domain>/`, update INDEX/limitations, seed `ideas/backlog.md`.
