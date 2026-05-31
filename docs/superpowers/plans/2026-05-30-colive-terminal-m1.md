# Co-Live Terminal — M1 Implementation Plan (end-to-end loop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Effort:** ultracode for execution. **Branch:** do NOT build on `main` — create a feature branch/worktree first.

**Goal:** A single-owner, protocol-compatible Session Core that the *unmodified Even app (glasses)* and a *new thin desk client* both attach to as live, co-equal clients — proving the loop: kick off at desk → monitor/respond on glasses → return to desk seamlessly, on one continuous session.

**Architecture:** Reimplement (not fork — `even-terminal` is closed/no-license) a Node/TS server on `@anthropic-ai/claude-agent-sdk`. The **Session Core** owns each live `query()` (sole writer to `~/.claude/projects/*.jsonl`), serializes multi-client input, and broadcasts normalized events. The **Client Hub** exposes the Even-app-compatible HTTP+SSE contract. The **desk client** is just another Hub client (a TUI). Grounded in `docs/superpowers/specs/2026-05-30-colive-terminal-design.md` and the 🧪 M0 results in `research/2026-05-30-colive-m0-spike/`.

**Tech Stack:** TypeScript (ESM), `@anthropic-ai/claude-agent-sdk`, Express 5, `vitest` + `supertest` (tests), `ink` + React (desk TUI), `eventsource-parser` (SSE client). Node ≥ 22.

**M0 inputs baked into this plan (do not relitigate):**
- Own the config the stock bridge hard-codes: **model** (default the latest available model id, via `--model`/`MODEL` env), **`permissionMode`** (`--permission-mode`, default `default`), and **`settingSources`** — default to **`[]` or `["project"]` only** to avoid the ~20s/turn `SessionStart`-hook latency and the capture-reminder HUD leak.
- **`realpath` the cwd** before all session-store lookups (symlink encoding gotcha).
- **Slash-command interceptor**: clients never forward `/cmd` to `query()` (it hangs). The Core also rejects a raw leading-slash prompt with a clear error.
- **Clients own SSE subscription timing** (subscribe before/at prompt) to avoid the first-turn race.
- **Guardrail**: for short/ambiguous prompts the Core honors the configured permission mode (don't default to `acceptEdits`).
- Provide a **full-history endpoint** (stock caps at 10) for desk scrollback.

---

## Protocol contract to implement (from 🧪 M0; the Even app speaks this)

**Auth:** bearer token; accept `Authorization: Bearer <t>` OR `?token=<t>` (SSE needs the query form). Configurable bind host (default `127.0.0.1`; `--host 0.0.0.0` opt-in; `EVEN_HOST_MODE=tailscale` resolves the Tailscale IP for the QR).

**Endpoints:**
- `GET /api/info` → `{account:{email,organization,subscriptionType}, model, version, provider:"claude"}`
- `GET /api/sessions?cwd=&limit=` → `{sessions:[{id,title,timestamp,cwd,provider,status}]}` (status from jsonl last-line; `realpath` cwd)
- `GET /api/sessions/:id/history?limit=` → `{history:[{role,text}]}` (keep ≤10 for app compat) **and** `GET /api/sessions/:id/transcript` → full normalized transcript (NEW, for desk scrollback)
- `GET /api/events?sessionId=&needReplay=` → SSE: preamble `:ok`, frames `id: N\ndata: <json>\n\n`, `:heartbeat` every 15s, replay buffered (ring buffer 500) when `needReplay=true`
- `POST /api/prompt` `{text, sessionId?, provider?, cwd?}` → `202 {ok, sessionId, provider}` (creates if no id; resumes+serializes if busy)
- `POST /api/permission-response` `{sessionId, decision}` (`allow|allowAlways|deny`)
- `POST /api/question-response` `{sessionId, answer}`
- `POST /api/interrupt` `{sessionId}`
- `GET /api/status?sessionId=` · `GET /api/messages?sessionId=&after=` · `GET /api/update-check`

**SSE event vocabulary (broadcast to all subscribers of a session):**
`user_prompt{text}` · `status{state}` (`busy|think_start|think_end|text_start|text_end|idle`) · `tool_start{name,toolId}` · `tool_end{name,toolId,summary,detail:{input,output}}` · `text_delta{text}` · `running_stats{durationMs,inputTokens,outputTokens}` (10s) · `result{success,text,sessionId,costUsd,provider,turns,durationMs,inputTokens,outputTokens}` · `permission_request{toolName,description,detail,toolUseId,options[],suggestions}` · `permission_result{toolName,summary,decision}` · `question`/`user_question` · `notification{title,message}` · `task_progress{completed,total,current}` · `error{message}`. (Do **not** broadcast `thinking_delta`.)

---

## File structure

```
colive-terminal/                      # new top-level package (build branch)
  package.json  tsconfig.json  vitest.config.ts
  src/
    core/
      sessionManager.ts    # owns query() per session; serialize input; emit events; interrupt
      session.ts           # one ClaudeSession: run/resume, canUseTool, event normalization
      events.ts            # SSE event type definitions (the vocabulary above)
      permissions.ts       # canUseTool logic + slash-command guard + permission/question routing
      store.ts             # listSessions/getSessionMessages/findSessionFile + status-from-jsonl; realpath cwd
      config.ts            # model/permissionMode/settingSources/host/token resolution
    hub/
      server.ts            # express app + auth + route mounting + listen/banner/QR
      routes.ts            # the endpoints above
      sse.ts               # per-session ring buffer (500), clients set, broadcast, heartbeat, replay
    desk/
      app.tsx              # ink TUI root: transcript view + input + status line
      client.ts            # Hub client: SSE subscribe (eventsource-parser) + POST helpers
      slash.ts             # client-side slash-command interceptor (/clear /compact /context ...)
    index.ts               # CLI entry: `colive serve` (Core+Hub) and `colive desk` (desk client)
  test/
    core/*.test.ts  hub/*.test.ts  desk/*.test.ts
  STATUS.md
projects/colive-terminal/             # tracking (use _TEMPLATE): status.md, log.md
```

---

## Phase 0 — Scaffold

### Task 0.1: Branch + package scaffold
- [ ] **Step 1:** `git checkout -b feat/colive-terminal-m1` (or a worktree via superpowers:using-git-worktrees).
- [ ] **Step 2:** Create `colive-terminal/package.json` (`type:module`, scripts: `build`,`test`,`dev`), `tsconfig.json` (ESM, strict), `vitest.config.ts`. Deps: `@anthropic-ai/claude-agent-sdk express`; dev: `vitest supertest @types/express typescript tsx`. (Add `ink react eventsource-parser` in Phase 3.)
- [ ] **Step 3:** `cd colive-terminal && npm install`.
- [ ] **Step 4:** Add a trivial `test/smoke.test.ts` (`expect(1+1).toBe(2)`); run `npx vitest run`; expect PASS.
- [ ] **Step 5:** Commit `chore: scaffold colive-terminal package`.

---

## Phase 1 — Session Core (TDD)

> Each task: write the failing test, run it (FAIL), implement minimally, run (PASS), commit.

### Task 1.1: Event types + config
- [ ] Define `src/core/events.ts` (discriminated union for the SSE vocabulary above) and `src/core/config.ts` (`resolveConfig(env,args)` → `{model, permissionMode, settingSources, host, token, port}` with defaults: model = latest id, permissionMode `"default"`, settingSources `[]`). **Test:** config defaults + env/arg overrides.

### Task 1.2: Session store reader
- [ ] `src/core/store.ts`: `realpathCwd`, `listSessions({dir,limit})`, `getTranscript(id)`, `sessionStatusFromJsonl(id)` (recognize `result|stop_hook_summary|permission-mode|last-prompt|interrupt` → idle; 120s staleness). Reuse `listSessions`/`getSessionMessages` from the SDK. **Test:** status classification from sample jsonl fixtures; symlink cwd resolves to the realpath-encoded dir.

### Task 1.3: ClaudeSession — run/resume + event normalization
- [ ] `src/core/session.ts`: `start(sessionId?,cwd)`, `run(text)` calling `query({prompt,resume,cwd,model,permissionMode,settingSources,includePartialMessages:true,canUseTool,maxTurns})`; map SDK stream → our events (status/tool/text_delta/running_stats/result); `busy` flag + `enqueue`; `interrupt()`. **Test:** feed a fake async-iterable of SDK messages → assert the emitted normalized event sequence; assert thinking_delta is NOT emitted.

### Task 1.4: Permissions + slash guard
- [ ] `src/core/permissions.ts`: `canUseTool` → `permission_request` + await client decision (60s default-deny), `AskUserQuestion` → `user_question` (120s default-skip), honor configured mode. **Slash guard:** a prompt whose first non-space char is `/` → reject with `error{message:"slash commands are client-side"}` (never sent to query). **Test:** slash prompt rejected; permission request emitted + resolves on response; timeout → deny.

### Task 1.5: SessionManager
- [ ] `src/core/sessionManager.ts`: map of sessions; `prompt(id?,text,cwd)` (create/resume/serialize), `respondPermission/respondQuestion/interrupt/getStatus`; subscribe callback for events. **Test:** two concurrent `prompt` calls to one session serialize (2nd enqueues); events fan out to a subscriber.
- [ ] Commit each task.

---

## Phase 2 — Client Hub (TDD; Even-app-compatible)

### Task 2.1: SSE module
- [ ] `src/hub/sse.ts`: per-session ring buffer (500), client set, `broadcast(id,msg)`, 15s heartbeat, `needReplay`. **Test (supertest):** subscribe → receive `:ok` then a broadcast frame; `needReplay=true` replays buffered.

### Task 2.2: Routes + auth + server
- [ ] `src/hub/routes.ts` + `server.ts`: implement every endpoint in the contract; bearer auth (header or `?token`); bind configurable host; startup banner + QR (use a QR lib or render the URL). **Test (supertest):** auth 401 without token; `/api/info` shape; `/api/prompt` 202 returns sessionId; `/api/sessions` shape; full `/transcript` endpoint returns normalized history.

### Task 2.3: Wire CLI `colive serve`
- [ ] `src/index.ts`: `colive serve [--model --permission-mode --host --port --project-dir]` starts Core+Hub. **Test:** process boots, `/api/info` reachable.
- [ ] **Hardware acceptance (manual, 🧪):** connect the **real Even app** to `colive serve`; start a session; confirm: streams live, **no ~20s first-turn delay**, model reported = the configured latest, ring permission works. Record in `research/`/STATUS.
- [ ] Commit.

---

## Phase 3 — Thin desk client (functional, not full parity)

### Task 3.1: Hub client
- [ ] `src/desk/client.ts`: connect to `http://127.0.0.1:<port>`; `subscribe(sessionId)` via SSE (eventsource-parser); `sendPrompt/respondPermission/respondQuestion/interrupt`; `fetchTranscript`. **Test:** against a stub Hub, receives events + posts prompts.

### Task 3.2: Slash interceptor
- [ ] `src/desk/slash.ts`: intercept `/clear` (new session), `/compact` (map to a compaction call or note as M3), `/context`,`/usage` (render from token stats), unknown → hint. Never send `/cmd` to the Hub prompt. **Test:** each command routed locally, not posted as a prompt.

### Task 3.3: Ink TUI
- [ ] `src/desk/app.tsx` + `colive desk` CLI: render the live transcript (scrollback), an input box, a status line (from `status`/`running_stats`), inline **permission/question prompts** (Esc=interrupt). On launch, `fetchTranscript` for full scrollback, then `subscribe`. **Test:** render snapshot for a sample event stream; permission prompt appears and submitting posts the decision.
- [ ] Commit.

---

## Phase 4 — End-to-end loop acceptance

### Task 4.1: Automated loop test
- [ ] `test/e2e.test.ts`: boot Core+Hub in-process; client A (stub "desk") starts a session + subscribes; client B (stub "glasses") subscribes to the same id; A prompts, B prompts; assert **both** see all events and **one** transcript id (mirrors the M0 harness, now against our Core). Run; expect PASS.

### Task 4.2: Hardware acceptance (manual, 🧪) — THE loop
- [ ] Run `colive serve`; open `colive desk` at the desk; connect the **real glasses** (Even app) to the same Core.
- [ ] **Acceptance:** in the desk client, kick off a task → glasses HUD shows it live → dictate a **free-form** follow-up from the glasses → it enters the *same* session → response on both desk + HUD → the desk client shows the full conversation including the glasses turn, live; keep typing. Record 🧪 result + any gaps.
- [ ] Update `STATUS.md`, `PROGRESS.md`, `knowledge/terminal-mode/`, `projects/colive-terminal/`. Commit.

### Task 4.3: Finish the branch
- [ ] Use superpowers:finishing-a-development-branch (tests green → PR/merge to `main`).

---

## Out of scope for M1 (→ M2/M3)
- Tailscale remote + long-idle backgrounding/reconnect (M2). Security hardening beyond localhost default (M2).
- **Full native parity** (M3 — own sub-spec; use `parity-inventory.md`). M1 desk client is "good enough to work in," not regression-free.
- Codex provider; custom Hub glasses app.

## Self-review
- **Spec coverage:** Core/owner (Ph1) ↔ spec §4.1; Client Hub + glasses (Ph2) ↔ §4.2–4.3; desk client (Ph3) ↔ §4.4; loop (Ph4) ↔ §7 M1 acceptance; model/permission/hook config + realpath + slash guard + full-history ↔ M0 inputs. Parity is explicitly deferred (§7 M3).
- **Placeholders:** none — tasks specify files, interfaces, tests, and commands. Implementation bodies are defined by their tests + the protocol contract (greenfield build executed under ultracode).
- **Type consistency:** the SSE vocabulary in the contract == `events.ts` == what `session.ts` emits == what `client.ts` consumes; endpoint names match the contract throughout.
