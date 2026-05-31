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
