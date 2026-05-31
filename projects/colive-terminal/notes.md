# Co-Live Terminal — Notes

Working notes, decisions, dead ends. Confidence-tag hardware/protocol claims (🧪/✅/🟡/🔴/❌)
so they can graduate into `knowledge/`.

## Build-time findings (M1, 2026-05-31)

- 🧪 **Claude Code session-store path encoding.** A project dir maps to its
  `~/.claude/projects/<name>` folder by replacing **every non-`[a-zA-Z0-9]` char with `-`**
  (`/private/tmp/colive-spike` → `-private-tmp-colive-spike`; underscores too:
  `random_claude_stuff/even_realities` → `random-claude-stuff-even-realities`). Implemented as
  `encodeProjectDir` in `colive-terminal/src/core/store.ts`. Confirmed against real transcripts.
- 🧪 **Session jsonl idle/busy markers.** A session is **idle** if its LAST non-empty jsonl
  line's `type` ∈ {`last-prompt`, `permission-mode`, `result`, `interrupt`} OR
  (`type:"system"` & `subtype:"stop_hook_summary"`); otherwise recent mtime ⇒ **busy**,
  stale (>120 s) ⇒ idle. `last-prompt` keys: `type,lastPrompt,leafUuid,sessionId`;
  `permission-mode` keys: `type,permissionMode,sessionId`.
- 🧪 **SDK interrupt path.** `Query.interrupt()` / `setPermissionMode()` / `setModel()` are
  **streaming-input-mode only**. v1 uses string prompts → interrupt = `options.abortController.abort()`.
- 🧪 **SDK init carries the new session id.** Starting a fresh `query()` (no `resume`) yields the
  assigned `session_id` in the `type:"system", subtype:"init"` message — capture it for resume +
  the `/api/prompt` 202 + client SSE subscription.
- 🧪 **Workflow-harness gotcha.** Subagents that `Read` the 232 KB `node_modules/.../sdk.d.ts`
  balloon their context until each model turn exceeds the 180 s no-progress timeout → killed.
  Mitigation: distil the SDK surface into `colive-terminal/docs/sdk-reference.md` and forbid
  reading `node_modules` type files. Self-contained tasks never hit this; SDK/fs tasks did.

## Phase 2 (Client Hub) findings (2026-05-31)

- 🧪 **Even-app connect QR = the stock `even-terminal` URL**:
  `http://<host>:<port>?token=<token>&defaultProvider=claude` (verified from `even-terminal`'s
  `common.js` `URLSearchParams({token, defaultProvider})` + the 2026-05-30 live probe). `buildQrPayload`
  in `hub/server.ts` emits exactly this. The Phase 2 implementer had guessed `colive://…` (format was
  flagged unverified in its brief) — corrected to the verified format so the glasses can scan-connect.
- **Permission/question response toolUseId mapping.** The Even app POSTs
  `/api/permission-response {sessionId, decision}` with **no** toolUseId, but the Core broker keys by
  toolUseId. The Hub tracks the latest **pending** permission/question toolUseId per session (from the
  `permission_request`/`user_question` events it broadcasts) and maps the sessionId-only response to it;
  the desk client may send an explicit `toolUseId` (preferred). `allowAlways` → `allow` for the broker.
- **SSE framing.** `:ok\n\n` preamble; `id: N\ndata: <json>\n\n` frames (per-session monotonic N);
  `:heartbeat\n\n` every 15s; ring buffer 500; `needReplay` replays buffered frames before live.
- **`colive serve` boots end-to-end** (controller smoke-test over real HTTP): auth via bearer header
  AND `?token`; `/api/info` shape correct (`model=claude-opus-4-8`, `version=0.1.0`, `provider=claude`).

## Phase 2 HARDWARE ACCEPTANCE — 🧪 findings (2026-05-31, real G2 + Even app)

**Result: PASS.** Real Even app connected; ran a continuous multi-turn conversation from the
glasses on one live session (model `claude-opus-4-8`; first turn ~4.3s SDK cold-start, then
~15ms to `202`; HUD streams live; "thinking" clears between turns).

- 🧪 **App connect probe = a single `GET /api/sessions?provider=claude`** (ua `Dart/3.8 (dart:io)`
  — native HTTP, NOT a WebView, so CORS is not actually required). It then polls that every ~1s
  and fetches `GET /api/sessions/:id/history?limit=10` when a session is opened. It did NOT hit
  `/api/info` during the probe.
- 🧪 **4 protocol bugs found + fixed** (diffed live vs native `even-terminal` 0.7.9):
  1. `/api/sessions` `timestamp` must be an **ISO-8601 string**, not epoch-ms int (Dart parser
     rejected the host → "failed to probe and save"). Also no-cwd ⇒ span all projects. (`a5c82e7`)
  2. Permissive **CORS + `OPTIONS`** added for stock parity (not the real blocker). (`d0af84a`)
  3. **Terminal `status: idle` SSE frame** was never emitted in string-prompt mode → HUD hung
     "thinking" forever. Now emitted at turn end via `emitIdle()`. (`8e20fa1`)
  4. **`ai-title`** last-line read as `busy` for 120s → polled `/api/sessions` showed "thinking".
     Now `ai-title` ⇒ idle. (`bebdc02`)
- Diagnostic aid: `COLIVE_LOG_REQUESTS=1` env enables `[req]` wire logging in the Hub.

## Ring-permission HARDWARE ACCEPTANCE — 🧪 PASS (2026-05-31, real G2 + Even app)

**Result: PASS.** A desk-injected (curl) Write prompt to a glasses-subscribed session rendered a
**tappable ring permission prompt**; tapping "Yes" approved it and the tool executed. Verified
end-to-end across **two co-live turns** from the glasses: Write created `/tmp/colive-hello.txt`
(`hi`, 2 bytes), then a Bash verify confirmed the contents — each gated by its own ring tap. This
closes the **last open Phase-2 acceptance item**. Server logs showed `POST /api/permission-response
-> 200` (ua `Dart/3.8`) per tap. Fix committed in `3f22983`.

- 🧪 **2 protocol bugs found + fixed** (diffed live vs native `even-terminal` 0.7.9
  `dist/claude/session.js`):
  1. **`permission_request.options` must be `{text,key}` OBJECTS, not strings.** The Even app renders
     its tappable ring buttons from these (`text`=HUD label, `key`=the `decision` it POSTs back). We
     sent `['allow','deny']` (bare strings) → the app rendered nothing → no prompt → silent 60s
     timeout (assistant said *"Write request timed out waiting for permission approval"*). Native
     minimal set: `[{text:'Yes',key:'allow'},{text:'No',key:'deny'}]` (+ `{...,key:'allowAlways'}`
     when `suggestions` present). Also `detail` is a short **string** (file path / command), not the
     raw input object. Keys `allow`/`allowAlways` → our Hub `normalizeDecision` already maps to allow.
  2. **An allow MUST return `updatedInput` (a record).** The SDK validates the `PermissionResult`
     with **Zod at runtime** and rejects a bare `{behavior:'allow'}` with
     `ZodError … path:["updatedInput"], expected:"record"` → the tool fails *after* approval (the
     model then retried Write→Bash, each hitting the same wall = the "second prompt" the user saw).
     The TS type marks `updatedInput` optional → it type-checks but fails live. Now every allow path
     (auto-allow + `resolvePermission`) echoes the original `input` back, mirroring native
     (`{behavior:'allow', updatedInput: toolInput}`). `sdk-reference.md` corrected.
- Diagnostic method that worked: `curl -N --max-time 6 .../api/events?...&needReplay=true` to read the
  ring-buffer replay (the `permission_request`/`permission_result`/`tool_end` frames). NB:
  backgrounded `curl`-to-file does NOT work for SSE — it block-buffers and flushes nothing until close.

### Bug #3 — CONCURRENT permissions all timed out (found in deeper UAT 2026-05-31; fixed `3aa62f3`)
Single-permission-per-turn worked, but the moment the model fired **multiple tool calls needing
permission at once** (observed: 3 parallel `Read`s of 3 files to combine), **every** prompt timed out —
the taps never resolved them. (Single-permission turns are fine; this is strictly the concurrent case.)
- 🧪 **Cause:** the Hub's `PendingTracker` stored only ONE pending toolUseId per session
  (`Map<sessionId,string>`). Concurrent `permission_request`s overwrote each other → only the latest id
  was tracked, and the first `permission_result` deleted the whole entry → later sessionId-only taps
  mapped to `''` (no-op) and the rest hit the 60s default-deny. A single slot cannot represent
  concurrent requests.
- 🧪 **Fix (mirror native):** native even-terminal keeps pending permissions as a FIFO queue and each
  response does `pendingPermissions.shift()` — settling the OLDEST. We moved FIFO into the **broker**
  (the single owner of the pending set, so exactly one result per resolve, no queue desync): an
  empty/unknown toolUseId settles the oldest pending entry (JS `Map` is insertion-ordered); an explicit
  toolUseId (desk client) still targets that exact one. Deleted `PendingTracker`; the Hub now just
  forwards `body.toolUseId || ''`. Applies to permissions AND questions. **Unit-verified (161 tests);
  hardware re-confirm of the 3-file-read scenario PENDING.**
- ⚠️ **Related UX (not a bug):** we run `permissionMode: default` (prompts for EVERY tool incl. reads);
  native runs `acceptEdits` (auto-approves more, only mutating ops reach the ring) → far fewer prompts.
  Deliberate safe default per M0; `--permission-mode acceptEdits` is the lighter-touch option for UAT.

### Remaining follow-ups (not blockers; address during Phase 3/4 or polish)
- **fast-`202`:** `POST /api/prompt` for a NEW session blocks ~4s resolving the real session id
  (awaits the stream init). Consider returning `202` immediately so the app subscribes during the
  turn (avoids the first-turn race where it subscribes after the turn ends).
- **Filter internal sessions:** the list shows the user's `remember` background agents + the very
  agent session driving this build. Consider filtering non-interactive/internal sessions.
- **Per-poll perf:** each `/api/sessions` poll ≈120ms (no-cwd ⇒ status-classify ~100 sessions via
  file reads), every ~1s. Consider a default cap / cheaper status.

## Known-minor items (deferred; from Phase 2 quality reviews)
- SseHub `sessions` Map grows unbounded (no eviction of idle empty sessions) — fine for single-user M1;
  revisit for a long-lived server.
- `SseHub.close()` does not `res.end()` open SSE clients — the server graceful-shutdown path should end
  subscribed clients, else shutdown could hang on open connections.
- No `bin` field yet (run via `npm run dev` / `tsx`); add `bin: {colive}` before any real install/distribution.

## Known-minor items (deferred; from Phase 1 quality reviews)

- `session.ts` is 640 lines (turn driver + heavy JSDoc) — consider extracting the
  SDK-message → event normalizer into its own module in M3.
- `task_progress` currently maps `completed === total` (always 100 %) — latent rendering bug;
  wire a real step count when a consumer needs it.
- `sessionManager.fanOut()` has no per-subscriber try/catch — **harden when wiring the real SSE
  layer (Task 2.1)**; the real subscriber must not throw.
- The slash-guard rejection with no session id fans an event tagged `sessionId:''` — the Hub/SSE
  layer (2.1) **must tolerate an empty session key**.
- `SessionConfig` duplicates fields of `ResolvedConfig` — consider a shared `Pick<>` to prevent drift.
