# Co-Live Terminal — M0 De-Risking Spike, Findings

> Executes `docs/superpowers/plans/2026-05-30-colive-terminal-m0-spike.md`. Confidence-tagged; dated 2026-05-30.
> Legend: 🧪 self-verified · ✅ verified · 🟡 community-claim · 🔴 unverified · ❌ disproven

## Task 1 — Source availability & fork strategy

**Evidence (🧪, 2026-05-30):**
- `npm view @evenrealities/even-terminal repository bugs author homepage license keywords` → **all empty**; only `version: 0.7.9` resolves. The published `package.json` (shipped locally) contains **only `name`** — **no `license`, `repository`, `homepage`, `author`, or `bugs`.**
- No public repo at `evenrealities/even-terminal` **or** `even-realities/even-terminal` (both 404 via `gh`). Global `gh search repos even-terminal` returns only unrelated projects — **no mirror/fork exists.**
- Shipped `dist/` is clean compiled ESM (readable), **25 JS files**, `claude/session.js` = 687 lines, **no sourcemaps**, **no LICENSE** in the package.

**Conclusion:** `even-terminal` is **closed-source, compiled-only, with NO declared license.** No license ⇒ "all rights reserved" by default — redistributing/publishing a fork of their `dist` is legally murky, and **our repo is public.**

**Decision → fork strategy (c): reimplement our own thin Session Core/Hub.**
- Build a fresh, minimal **protocol-compatible** server in our own TypeScript on the public, licensed `@anthropic-ai/claude-agent-sdk` + Express — **interoperating** with the Even app's observed HTTP/SSE contract (an interface, which we reverse-engineered and documented), **not copying their source.**
- Rationale: avoids the licensing problem entirely; gives us **full ownership** of the Core (the natural home for model-config, permission-config, hook-leak handling, multi-client fan-out, full-history endpoint); depends only on public packages.
- **M1 implication:** M1 is a *clean build to spec*, not a patch of their dist. Slightly more work than patching, but owned and legally sound. Our reverse-engineered protocol (in `knowledge/terminal-mode/overview.md` + `research/2026-05-30-terminal-mode-live-probe/findings.md`) is the implementation target.

## Task 2 — Two-client co-live confirmation (🧪 PASS)

Harness: `spikes/colive-harness/colive.mjs` against a scratch stock bridge (`PORT=3457`, cwd `/tmp/colive-spike`).
Client A started a session (prompt "OK"); A **and** B subscribed; then **client B** sent a second prompt ("DONE").

**Result (🧪, 2026-05-30):**
- Both clients received **identical 14-frame streams** covering *both* turns: `user_prompt, status×, text_delta, result` ×2. **Each client saw the *other's* prompt and result live.**
- **No fork / no collision:** exactly **1 transcript file** in the project dir, containing **both** user turns ("OK" and "DONE"). The second client's prompt **appended to the same session** (serialized by the bridge).
- → The core architectural assumption holds: **one owner serializes multi-client input + broadcasts to all subscribers → true co-presence, zero collision.** This is what M1's Session Core must replicate.

**Incidental (🧪):** the bridge resolves cwd through symlinks (`/tmp` → `/private/tmp`), so the `~/.claude/projects` dir was `-private-tmp-colive-spike`. **M1 note:** normalize/realpath the cwd so session lookups are stable.

## Task 4 — Desk-client parity-blocker hunt (seeded inventory)

Full table: `research/2026-05-30-colive-m0-spike/parity-inventory.md`. Key results:

- **🧪 Slash commands do NOT execute via the prompt stream.** `/context` sent as a prompt **hung the turn** —
  0 input/output tokens, no `text_delta`, no `result` for 30s+ (had to `/api/interrupt`). They're TUI-level;
  the desk client must **intercept slash commands client-side** and never forward `/cmd` to `query()`. The Core
  should also guard against raw slash-command prompts.
- **🧪 Capability metadata is fully present** in the SDK `init`: complete `slash_commands`, `skills`, `agents`,
  `plugins`, `mcp_servers` lists — so the *brain* is there; only TUI *invocation/affordances* are the client's job.
- **No truly Blocked features.** Everything classifies as **Reuse** (streaming, tools, permissions, questions,
  todos, plan mode via `permissionMode`, subagents, MCP, interrupt) or **Rebuild** (input editor, autocomplete,
  scrollback/paging, slash-command interceptor, `@`-mentions, image paste, status line, diff rendering, vim mode).
- **M1/M3 implication:** parity is achievable on the SDK substrate; desk-client work is overwhelmingly front-end
  **Rebuild**, with the **slash-command interceptor** as the key architectural piece to design early. A few items
  (`@`-mention exactness, image round-trip, per-command mappings) are *verify-in-M3*, not anticipated blockers.

## Task 3 — iOS backgrounding / SSE longevity (🧪 PASS — biggest risk retired)

Hardware-in-the-loop on the real G2 + R1 + Even app. User opened a session, **locked the phone and put it in
their pocket**, and watched the **glasses** while a turn ran for ~2 minutes.

**Result (🧪, 2026-05-30):**
- **The live stream survives backgrounding.** With the phone **locked + pocketed**, the glasses HUD kept
  updating live; host log shows `running_stats` delivered **continuously every 10s from +10s → +120s** to the
  session's SSE client, **zero `Client disconnected`**, **zero dead-client removals**. User visually confirmed
  the HUD was live the whole time.
- → **The "out for a run" core mechanic works:** the pocketed phone keeps the SSE alive and the glasses keep
  rendering. The Even app holds its connection active while driving the glasses (BLE accessory keeps it alive);
  the bridge's 15s heartbeat + active frames keep iOS from suspending it.
- **Caveat (untested):** only ~2 min of **continuous activity** was tested. Long **idle** pockets (deep sleep,
  10+ min, no frames) might still drop the socket — M2 should test long-idle + the `needReplay=true` reconnect
  path. For active tasks, it holds.

### Incidental 🧪 findings from this session
- **~20s first-output latency per bridge turn** from our global `.claude` `SessionStart` hooks (superpowers +
  remember) injecting context (+ likely MCP-connect attempts) before the model produces output. **M1: the Core
  must control `settingSources`/hooks** to kill this delay.
- **App subscribes to SSE only when the session is *viewed*** → a fast first reply can complete before the HUD's
  stream attaches (reply landed at :31, app subscribed at :57). With the 20s delay, the first turn looked "dead."
  **M1: our clients control subscription timing — not an issue once we own both ends.**
- **Observed content refreshes on (re)open** — user backed out and re-entered to see the reply (consistent with
  the earlier observe-only finding).
- **Terse dictated prompts trigger autonomous multi-step work.** "Go." (a test signal) was read by the agent as
  "proceed with the work" → it read `.remember` files, listed dirs, read `bridge.log`, ran ~110s on `acceptEdits`
  before interrupt. **M1: guardrails** for ambiguous short prompts (confirm intent / constrain permission mode),
  since acceptEdits + autonomy could make unintended edits.
- **`/api/interrupt` reliably stops a runaway turn** (🧪 used twice).

## M0 synthesis — GO

**Results:** (1) source = closed, compiled-only, **no license** → reimplement our own Core (strategy c).
(2) Co-live **PASS** — two clients, one transcript, all events to both, no collision. (3) Parity — **no blockers**;
everything Reuse/Rebuild; slash-command interceptor is the key piece. (4) iOS backgrounding **PASS** — live stream
survived ~2 min pocketed.

**Decision: GO.** Every load-bearing assumption held; the one true risk (backgrounding) passed; no blockers found.

**M1 architecture inputs (locked by M0):**
1. **Build our own protocol-compatible Session Core** on `@anthropic-ai/claude-agent-sdk` (no fork — license).
2. **Own the session config** the stock bridge hard-codes: **model** (default latest), **`permissionMode`**, and
   **`settingSources`/hooks** — the last kills the **~20s/turn `SessionStart` latency** and the capture-reminder HUD leak.
3. **Slash-command interceptor** in the clients (never forward `/cmd` to `query()` — it hangs the turn).
4. **`realpath` the cwd** before session lookups (symlink encoding gotcha).
5. **Clients own SSE subscription timing** (attach before/at prompt) to eliminate the first-turn race.
6. **Guardrails for terse/ambiguous prompts** — acceptEdits + autonomy let a one-word prompt do multi-step work; the
   Core should confirm intent or constrain permission mode for short inputs.
7. **Full-history endpoint** (stock caps at 10) for desk-client scrollback.
8. **Defer to M2:** long-idle backgrounding (10+ min, no frames) + `needReplay=true` reconnect/catch-up; Tailscale remote.

**Next:** write the **M1 implementation plan** (protocol-compatible Core + thin desk client + end-to-end loop) and a
likely **desk-client sub-spec** for the M3 parity work — grounded in these results. Effort: **High** for the plan,
**ultracode** when we start coding M1.
