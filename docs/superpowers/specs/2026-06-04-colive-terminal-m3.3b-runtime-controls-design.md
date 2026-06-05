# Co-Live Terminal M3.3b — Runtime controls (`/model` + mode toggle) — Design

> **Parent:** the LOCKED M3.0 roadmap `2026-06-01-colive-terminal-m3-design.md` §5/§7 row **M3.3**, split into sub-rungs
> (2026-06-03): **M3.3a = the streaming-input refactor (DONE, merged `fde76c5`)**; **M3.3b (this doc) = runtime controls**
> riding on the persistent `Query`; **M3.3c = `settingSources`+skills, image paste, MCP**. `/compact`+`supportedCommands`
> was trimmed out of b (2026-06-04) into its own follow-on (unverified invocation mechanism, different path).
> **Governing rule:** M3.0 **§0** applies in full — green tests + clean typecheck are the *precondition only*;
> **M3.3b is DONE only when the user exercises it on the real G2 + R1 and signs off.**
> **Confidence legend:** 🧪 self-verified (read our code) · ✅ verified (SDK/lib) · 🟡 community · 🔴 unverified.

## 0. Scope (one sentence)

Add two runtime controls — **`/model`** (a curated model picker) and a **`/mode`** permission toggle
(Default / Accept-edits / Plan) — that act on the live `Query` opened by M3.3a, via a new **desk → Hub → Core control
path**; and, as task 1, **close the M3.3a deferred edge** (a queued prompt dropped on a mid-drain fatal query error).
Unlike M3.1/M3.2/M3.3a this rung **intentionally touches Core + Hub + desk**; the closed Even-app/glasses path stays
byte-compatible.

## 1. Task 1 — close the M3.3a deferred edge (queued-prompt loss)

🧪 In the persistent-`Query` model, if the consumer loop throws a fatal error in the gap between one turn's `result` and
the next queued prompt's first message, that buffered prompt is dropped (`user_prompt → error → idle`, not re-driven —
M3.3a backlog item). **Fix:** in `ClaudeSession.onConsumerError`, if a turn is in flight, **re-queue the in-flight
prompt's text to the FRONT of the FIFO** before settling, so the lazy reopen-with-`resume` re-drives it. (`onConsumerError`
already drains the queue → the re-queued prompt triggers `ensureQueryOpen`'s reopen.) Done first so the foundation is
sound before controls ride on it.

## 2. The SDK primitives (verified)

✅ Both are `Query` methods, documented *"only supported when streaming input/output is used"* (`sdk.d.ts`) — which is
exactly the mode M3.3a put us in:
- `setModel(model?: string): Promise<void>` (2186) — *"Change the model used for subsequent responses."*
- `setPermissionMode(mode: PermissionMode): Promise<void>` (2179) — *"Change the permission mode for the current session."*
- ✅ `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'` (1975). M3.3b exposes
  only **`default`, `acceptEdits`, `plan`** (the safe, useful trio); `bypassPermissions`/`dontAsk`/`auto` are out (dangerous/
  niche — YAGNI).
- Both take effect on **subsequent** turns / permission checks, not the in-flight turn — fine, you switch when idle.

**Curated models (no SDK "list models" call exists):** Opus 4.8 = `claude-opus-4-8`, Sonnet 4.6 = `claude-sonnet-4-6`,
Haiku 4.5 = `claude-haiku-4-5-20251001`. A static curated list (friendly label → id) is the picker source; **no free-text**
(locked: option A). New models are a one-line list edit later.

## 3. The control path (new plumbing)

```
desk slash picker → client.setControl(sessionId, action, value)
   → POST /api/control {sessionId, action, value}
   → SessionManager.control(sessionId, action, value)
   → ClaudeSession.setModel(id) / setPermissionMode(mode)
   → this.q?.setModel/​setPermissionMode(...)  +  update this.config
```

### 3.1 `ClaudeSession` (Core) 🧪
- `async setModel(model: string): Promise<void>` — `await this.q?.setModel(model)`; **then `this.config = { ...this.config, model }`**.
- `async setPermissionMode(mode: PermissionMode): Promise<void>` — `await this.q?.setPermissionMode(mode)`; **then update `this.config.permissionMode`**.
- The config write is **load-bearing**: `ensureQueryOpen` builds the query options from `this.config`, so a self-heal
  reopen-with-`resume` (M3.3a Option 1) comes back on the *chosen* model/mode, not the serve default (§6).
- If there is no live query yet (lazy, not opened), the method **updates config only** (next open uses it). No-throw
  (`.catch` swallow, mirroring `interrupt()`), so a control never crashes a session.

### 3.2 `SessionManager` (Core) 🧪
`async control(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>` — looks up the session
and calls the matching method. Unknown sessionId / action → no-op (defensive). `interrupt()`/`prompt()` signatures
unchanged.

### 3.3 Hub (additive route) 🧪
`POST /api/control {sessionId: string, action: 'setModel' | 'setMode', value: string}` → `manager.control(...)` → `202`.
Auth via the existing token middleware. **Additive** — no existing route changes; the Even-app endpoints
(`/prompt`, `/permission-response`, `/events`, …) are byte-identical.

### 3.4 Desk client 🧪
`setControl(sessionId: string, action: 'setModel' | 'setMode', value: string): Promise<void>` on `HubClient` — POSTs
`/api/control`. Injected/faked in tests like the other client methods.

## 4. Desk UX — two-level pickers

- `/model` and `/mode` join `SLASH_COMMANDS` / `slashMenuItems()` so they appear in the slash menu.
- **Two-level menu:** when the composer's command token resolves to a *picker command* (`/model` or `/mode`), the
  `CompletionMenu` switches from the command list to that command's **value list** — Opus 4.8 / Sonnet 4.6 / Haiku 4.5,
  or Default / Accept-edits / Plan. The popup widget + ↑/↓/Tab/Enter nav are **reused verbatim** (M3.2). A new pure
  `menuForCommand(token)` returns the value items (or null), paralleling `filterSlash`.
- **Accept** (Tab/Enter on a value): the desk calls `client.setControl(currentSessionId, action, value)` and drops a
  transcript note — **`✓ model → Sonnet 4.6`** / **`✓ mode → plan`** (a local `dispatch({type:'note'})`, never POSTed as a
  prompt). `interpretInput` gains nothing — pickers resolve in `app.tsx` before submit, like the existing slash menu.
- A bare `/model` / `/mode` submitted with no pick is a no-op note (mirrors the lone-`/` rule).

## 5. Status line — active model + mode

🧪 Extend the desk status line to show the current model (short label) + mode, e.g. `[idle · opus-4.8 · plan]`. This is
native-style and is the user's confirmation the switch took. The desk holds `currentModel` / `currentMode` state
(seeded from the session's config via `/api/info` or the first `result`/status; updated optimistically on a successful
`setControl`). Small, render-only.

## 6. Self-heal interaction (correctness lynchpin) 🧪

A runtime `/model` or `/mode` updates `this.config` (§3.1). If the query later dies and `ensureQueryOpen` reopens with
`resume`, it rebuilds options from `this.config` → the session returns on the **chosen** model/mode. This is an explicit
test (set model → simulate query death → next prompt's reopened query options carry the chosen model + `resume`).

## 7. Pre-session handling (accepted YAGNI, §5 of brainstorm)

Controls act on the **active** session. If the user picks a model/mode **before the first prompt** (no session yet), the
desk holds the selection and applies it once the session id resolves (after the first prompt) — so it may take effect
from the **second** turn. The `serve --model` flag already covers "start in model X." Building prompt-carries-override
plumbing to bind the first turn is **out of scope** (revisit only if it bites).

## 8. Invariants (must hold) 🧪
- **Even-app / glasses path byte-compatible** — `/api/control` is additive; no existing route or event shape changes.
- **Self-heal preserves runtime choice** — control updates `config`; reopen rebuilds from `config` (§6).
- **A control never crashes a session** — `setModel`/`setPermissionMode` are no-throw; unknown session/action = no-op.
- **FIFO / single-writer / byte-identical events** from M3.3a still hold (controls don't drive turns).
- New desk logic is pure / DI'd and unit-tested; `app.tsx` stays a thin wiring layer; the popup widget is reused.
- No test gaming; typecheck clean.

## 9. Testing

**Unit:**
- `ClaudeSession.setModel/setPermissionMode`: calls the `Query` method (fake `q` records it) **and** updates `config`;
  with no live query, updates config only; after a simulated death+reopen, the reopened options carry the chosen value
  (§6); no-throw on a rejecting `q.setModel`.
- `onConsumerError` re-queues the in-flight prompt (task 1): a mid-drain death → the dropped prompt is re-driven on reopen.
- `SessionManager.control` delegates to the right method; unknown session/action = no-op.
- Hub `POST /api/control` → `manager.control` called with the parsed body; bad body → `400`; missing auth → `401`.
- Desk `client.setControl` POSTs the right shape; `menuForCommand('/model'|'/mode')` returns the value list, else null;
  accepting a value calls `setControl` + emits the confirmation note.
- Status line renders the active model/mode.

**Self-test (before UAT — per the standing rule):**
- Preview frames: the `/model` value picker open, the `/mode` value picker open, and the status line showing `· opus-4.8 · plan`.
- **LIVE `serve`+`desk` run** (real SDK, real Core): switch model mid-session and confirm the next turn uses it; enter
  **plan** mode and confirm Claude **plans without editing**; **accept-edits** and confirm an edit applies with **no**
  permission prompt; screenshots. This is the gate that proves the controls actually drive the live `Query`.

## 10. Acceptance (hardware UAT — the real bar)

Runbook `projects/colive-terminal/m3.3b-uat-runbook.md` with **copy-paste setup + per-walk commands**:

| # | Walk | Pass = |
|---|------|--------|
| E1 | `/model` → pick Sonnet 4.6; send a prompt | Status line shows `sonnet-4.6`; the turn runs on Sonnet |
| E2 | `/mode` → Plan; ask for a change | Claude **plans**, does not edit/run tools that mutate; status shows `plan` |
| E3 | `/mode` → Accept-edits; ask for a small edit | Edit applies with **no permission prompt** |
| E4 | After a `/model` switch, induce a brief connectivity drop, then prompt (self-heal) | Session resumes **on the chosen model** (not the serve default) |
| E5 | From the **glasses**, send a prompt during all this | Glasses send/receive unchanged (control path is desk-only) |

## 11. Risks + mitigations

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| R1 | A runtime `setModel`/`setPermissionMode` doesn't visibly take effect (timing: applies next turn) | Low | §2 documents "subsequent turns"; E1–E3 verify on hardware; status line gives immediate visual confirmation. |
| R2 | Self-heal reverts to serve-default model/mode | Med (if config not updated) | §3.1 config write + §6 dedicated test + E4 hardware check. |
| R3 | Two-level menu collides with the slash/`@` menus | Low | `menuForCommand` is gated on an exact recognized picker token; mutually exclusive with `filterSlash`/`atContext` by construction (tested). |
| R4 | Plan/accept-edits mode change races a permission prompt mid-turn | Low | switch when idle (the natural flow); `setPermissionMode` affects subsequent checks per the SDK contract. |
| R5 | Control path regresses the Even-app endpoints | Low | additive route only; invariant test asserts existing routes unchanged. |

## 12. Out of scope
- **`/compact` + `supportedCommands`** (real SDK slash-command invocation — unverified mechanism, probe-first) → next rung.
- **Shift+Tab mode cycle** (native-parity fast-toggle) → deferred; needs a terminal key-reliability probe.
- **Pre-session first-turn binding** of model/mode (§7) → revisit only if it bites.
- `setMaxThinkingTokens` / settings-merge, `settingSources`+skills, image paste, MCP → **M3.3c**.
