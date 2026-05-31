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
