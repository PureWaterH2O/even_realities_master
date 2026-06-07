# Progress Log

Overarching, dated changelog for the whole workspace: what we learned, what we
built, what we decided. Newest entries on top.

## 2026-06-06

### Co-Live Terminal M3.5 — 🟨 Aesthetic pass — STARTED (reordered before M3.4)

- **Decision:** M3.5 (aesthetic pass) moved ahead of M3.4 (multi-session). The rendering layer will change significantly during parity work, so it makes sense to nail the visual foundation first and revisit M3.4's scope afterward.
- **Approach:** Reference Frame Catalog + Replay Harness — 25 scenarios comparing native Claude screenshots against our desk's replay frames. Differences cataloged → fixed by element group → UAT → customization brainstorm.
- **Spec:** `docs/superpowers/specs/2026-06-06-colive-terminal-m3.5-aesthetic-pass-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-06-colive-terminal-m3.5-aesthetic-pass.md`
- **Builder Run 1 (Tasks 1-5) ✅ DONE 2026-06-06 — comparison infrastructure built + self-verified (5 commits `c230ed4..69e769d` on `main`; NOT pushed):**
  - `projects/colive-terminal/aesthetic/snap.sh` (macOS `screencapture` helper, 25 named scenarios, no-arg progress checklist) · `scenarios.md` (25-scenario capture runbook) · `reference/.gitkeep`.
  - `colive-terminal/test/preview/scenarios.ts` **+12 replay event sequences** (idle, simpleQA, streaming, toolRead, toolBash, permission, errorDiag, statusBusy, question, backgroundCmd, subagent, costSummary) — **additive**, the existing 6 (cockpit/markdownDoc/inProgress/tall/thinking/diffEdit) untouched.
  - `colive-terminal/test/preview/aesthetic.preview.test.tsx` (NEW — 25 scenario tests; keystroke-driven states 15/19/21–25 driven via `capture()`/`key()`) + `catalog.md` stub + `replay` symlink → `preview-out/aesthetic/`.
  - **Self-verified (tool output):** `npx tsc --noEmit` exit 0 · `npx vitest run` **501 passed / 44 files** (+25 from 476) · `PREVIEW=1` dump → **56 frames** (28×{txt,ansi}) in `preview-out/aesthetic/` · `snap.sh` no-arg → exit 1 + 25-item checklist, executable.
  - **2 plan-code fixes (documented in commits):** added the required `suggestions: []` to the `permission` event (`events.ts` `PermissionRequestEvent` requires it; the plan's `as CoLiveEvent` cast had hidden the omission); 13-error assertion `toContain('failed')` → `toContain('/tmp/no-such-file-12345.txt')` (`rows.ts` encodes tool errors as **red color only**, computed from `summary` → `stripAnsi` drops it, so "failed" is never in plain text). Plan prose said "13 new scenarios"; its own code block defines exactly the **12** implemented (the set the preview test imports).
  - **Next gate → 👤 user:** reference-capture session — run **native** Claude Code through the 25 scenarios with `snap.sh`, then the planner catalogs diffs (`catalog.md`, D-001…) before Builder Run 2 (Phase B rendering fixes, Tasks 6–15). Tasks 6+ intentionally NOT started (they depend on the reference frames).
  - **Reference capture — 🟨 IN PROGRESS; pipeline hardware-verified 2026-06-06:** native **Claude Code v2.1.168** (`Opus 4.8 (1M context)`). `snap.sh` round-trips valid PNGs of the native pane (verified by viewing 01-idle 1316×548, 02-simple-qa 1306×1180, 03-streaming). First-3 spot-check **confirms the plan's anticipated native diffs are real, not speculative** — startup banner (robot + `Claude Code vX.Y.Z` + model/effort + cwd + "Feature of the week"), `›` prompt char + **full-width dark user-prompt bar**, `●` green assistant bullet, `✱ Brewed/Cogitated for Ns` tool/thinking timing summaries, and a pipe-separated status line `Opus 4.8 (1M context) | ctx: N% | tokens: N | 5h: N% | 7d: N%` (+ `← for agents`). **Process fix:** `03-streaming` first caught the *finished* state (a 1→20 count completes in ~1s, uncatchable mid-stream) → runbook `scenarios.md` 03 re-timed to "Count from 1 to 300… slowly" with an explicit "before the prompt box returns / before any `✱ …for Ns`" note. Full native-vs-ours **catalog (`catalog.md`) pending all 25 references** (planner builds it for Builder Run 2).
  - **Reference capture ✅ COMPLETE + catalog DRAFTED 2026-06-06:** all **25** native references captured (Claude Code v2.1.168) and committed (`69902c1`, local-only — not pushed); `03-streaming` re-shot mid-stream (199→236 of 300); the 10 timing-sensitive states content-verified by viewing. **`catalog.md` drafted (`8037d12`) — 27 entries D-001…D-027**, grouped by Phase B task (T6–T15) with severity + fix-scope + a scenario→entry coverage map. **4 planner decisions flagged:** (1) native prompt glyph is `›` (U+203A), **not** the plan's guessed `❯` (U+2771); (2) collapsed-thinking — keep our `💭 thinking (N lines)` stub or hide like native; (3) keep our managed scrollback viewport (native has **no** in-app indicator — won't-fix recommended); (4) descope deep dashboards `/cost`·`/usage`·`/config`·`/memory` (`/config`+`/memory` currently return *Unknown command* on our desk). **Headline diffs:** no startup banner, `> `→`›` full-width dark user bar, bracketed `[idle · …]`→pipe `Opus 4.8 (1M context) | ctx | tokens | 5h | 7d` status line, missing `●` assistant bullet + `✱ <verb> for Ns` turn footer; markdown tables + `▌` blockquotes already match.
  - **Builder Run 2 (Tasks 6–15 = Phase B rendering fixes) ✅ DONE 2026-06-06 — all 22 active catalog entries implemented + self-verified (11 commits `a057c0b..<post-review>` on branch `m3.5-aesthetic-phase-b`; NOT pushed, NOT merged):**
    - **One commit per task group** (T6 banner+`›` glyph D-001/002 · T7 full-width dark user bar D-003 · T8 tool headers/footer/spinner D-004–008 · T9 pipe status line + `← for agents` D-009 · T10 `●` assistant bullet D-010/011 · T11 thinking stub/`✔■□` todos/`−` bullets D-012–015 · T12 Write `└ Wrote N lines`+numbered content D-016 · T13 native permission/question panels, borders removed D-017/018 · T14 model-picker panel D-019/020 · T15 `└ Interrupted …` D-028), plus a post-review refinement commit.
    - **Descoped per owner:** D-021 `/effort` picker · D-022 scrollback (won't-fix) · D-023–027 deep dashboards. Followed all planner decisions (glyph `›`, thinking stub kept, etc.).
    - **Self-verified (tool output):** `npx tsc --noEmit` exit 0 · `npx vitest run` **510 passed / 44 files** (+9 net from 501; updated assertions to new correct behavior, **no test gaming**) · `PREVIEW=1` dump → all 25 aesthetic frames regenerated and eyeballed vs references.
    - **Adversarial verification (10-agent workflow, one per group):** 8/10 **match**, T8+T12 **partial** (minor), **0 gaming concerns** anywhere. Findings actioned: refined D-004 — native dots ONLY action/agent tools (`● Write`/`● Agent`); read-only tools (Read/Bash/…) are dot-less + dim + indented (pixel-checked vs 05/06/07/18; the catalog's "● for all" was over-general). **Accepted divergences (documented):** Bash shown as the command not native's semantic "Listed 1 directory" (non-derivable); Agent's `└ Done (N tool uses · tokens · Ns)` sub-line omitted (we lack those metrics); Write sub-line path not cwd-relativized (absolute path is cleaner than native's `../../../`); status line lacks ctx%/5h/7d (no data); question chip is a generic `□ Question` (event carries no category).
    - **Next gate → 👤 owner:** review the branch + replay frames; then hardware UAT (Tasks 16–17 — final-catalog cleanup + UAT runbook — intentionally NOT executed this run). Branch is local-only; merge + push await owner sign-off.
  - **Planner review (2026-06-07): PASS.** Independent verification against tool output: `tsc` exit 0; **510/510** tests; **0** `.skip`/`.only`; all removed `it()` have corresponding renamed additions (glyph/assertion updates, not deletions); Core/Hub **0-line diff**; 557 ins / 160 del all in `src/desk/` + tests. Visual spot-check of 8 replay frames against reference PNGs confirms structural parity on banner, prompt bar, tool headers, status line, permission/question panels, model picker, interrupt state, and todos. **Ready for merge + hardware UAT.**

### Co-Live Terminal M3.3b — ✅ HARDWARE UAT PASS (owner sign-off) → runtime controls SHIP (merged to `main` via `--no-ff`)

- **Owner hardware UAT (2026-06-06): PASS — ship M3.3b desk controls.** Re-verified green before merge against tool output (not the notes): `npx tsc --noEmit` exit 0; `npx vitest run` **476 passed / 43 files**; additive invariant re-checked — `events.ts`/`sse.ts` **0-line diff vs main** (glasses byte-compat). 13 commits `main..branch`.
- **E1 model switch — PASS.** Desk stays the **same chat** with the model switched. Independently corroborated by a **live SDK probe** (`@anthropic-ai/claude-agent-sdk@0.3.158`, 2026-06-06): a mid-session `setModel` (and `setPermissionMode`) swaps `model=`/`permissionMode=` in the per-turn `init` and does **NOT fork the `session_id`** (one unique id across 3 turns). **E2 plan — PASS** ("planning worked as expected"). E3 accept-edits / E4 self-heal carried by the pre-UAT live self-test + unit gates (not separately re-run on hardware; owner satisfied).
- **🧪 UAT scare triaged → NOT a bug: "switch model ⇒ glasses start a new session."** Root cause is NOT a fork (probe-verified) and NOT the control path (additive `POST /api/control`, emits no glasses events, never mints a session; `SessionManager` freezes `currentId`). Owner clarified: glasses co-live was **in sync** before the switch; the "new session" was the owner **manually backing out** of the glasses session to reach a menu. Desk↔glasses co-live **session-sharing** (controls reflected on the glasses) is the **documented open engineering problem** (`knowledge/limitations.md`) → **deferred** (out of M3.3b's additive scope).
- **`/context` is thin (shows only `Context: status: …`) — working as built, pre-dates M3.3b.** Not a regression; owner opted not to enrich it this rung (candidate future enhancement: model/mode/session/tokens).
- **Knowledge:** `terminal-mode/streaming-input-probe.md` extended with the M3.3b control-probe fact (no `session_id` fork). **Runbook:** `projects/colive-terminal/m3.3b-uat-runbook.md` signed off (UAT result table + triage). **Next rung (M3.3c):** `/compact` + `supportedCommands` (probe-first); deferred candidates — status-line mode seeded from Hub, pre-session deferred-apply, desk↔glasses co-live session-sharing, `/context` enrichment.
- **✅ PUSHED (planner chat, 2026-06-06):** the builder's auto-mode push was blocked by the safety classifier; the owner gave explicit go-ahead here. Planner re-verified the **merged** tree first (`tsc` exit 0; **476/476** on `main`; additive intact vs `b972c91` — `events`/`sse` 0-diff, no route/test removed), then `git push origin main` → **`b972c91..7998ec0`**. `origin/main` now `7998ec0`, 0 ahead. M3.3b is **DONE + public**.

### Co-Live Terminal M3.3b — ✅ PLANNER-VALIDATED (PASS) — runtime controls; still NOT merged, pending owner hardware UAT E1–E5

- **Validation verdict (planner chat, 2026-06-06): PASS.** Validated spec→claims→code against tool output, not the notes:
  - **Additive invariant ✅** — `git diff main -- routes.ts | grep "^-.*router\.(get|post)"` empty (only `+/control` added); `events.ts`/`sse.ts` 0 changes → glasses byte-compat.
  - **Tests/typecheck ✅** — `npm test` 476 passed / 43 files (delta **+21**: 21 added, 0 removed, re-counted from `main`); `npm run typecheck` exit 0.
  - **No test gaming ✅** — no `it/test/describe` removed across the FULL test diff; no `.skip`/`.only`. The only removed `expect`s = `toHaveLength(1)`→`(2)` in `sessionManager.test.ts`, a legitimate strengthening (Task-1's re-drive surfaces 2 errors on a deterministic pre-init failure; loop still asserts each error's shape+sessionId; `it()` title byte-identical).
  - **Task-1 retry guard ✅** — `onConsumerError` re-queues in-flight prompt to FRONT once; `currentTurnRetried` guard → 2nd death gives up (no infinite loop); test: driven twice / 2 errors / exactly 1 reopen.
  - **Self-heal (E4) ✅** — `setModel`/`setPermissionMode` update `this.config` first (now mutable) then best-effort live call; reopen-carries-choice test + builder's adversarial inverse.
  - **Esc-aborts-turn fix ✅** — `if (pickerChoices) { setBuf(B.empty()); return }` is first in the escape handler; only short-circuits when a picker is open (genuine Esc→interrupt preserved); regression test asserts `interrupts.length === 0` + picker dismissed.
  - **Live self-test E2/E3 🟡** — preview frames + VHS PNGs present/correct; E2/E3 live-SDK behavior is the builder's run log (not independently re-reproducible from artifacts) → definitive re-verification is the hardware UAT.
- **Correction:** branch HEAD is `8bb571f` with **13 commits** (builder reported `a479a34`/11); the two extra are the docs commits (`a479a34` runbook + `8bb571f` this log), both after code freeze.
- **Not merged.** Merge waits on owner hardware UAT E1–E5 (`projects/colive-terminal/m3.3b-uat-runbook.md`). Next rung after merge: `/compact` + `supportedCommands` (probe-first).

### Co-Live Terminal M3.3b — 🟡 Runtime controls (`/model` + `/mode`) — CODE-COMPLETE on branch `colive-terminal-m3.3b` (HEAD `a479a34`, 11 commits) — NOT merged; pending planner validation + hardware UAT E1–E5

- **Scope:** two runtime controls on the M3.3a persistent `Query` — a curated **`/model`** picker (Opus 4.8 / Sonnet 4.6 / Haiku 4.5) and a **`/mode`** toggle (Default / Accept-edits / Plan) — via a new **additive** desk→Hub→Core `POST /api/control` path (`client.setControl` → `SessionManager.control` → `ClaudeSession.setModel`/`setPermissionMode`, which call the live `Query` method AND update `this.config` so a self-heal reopen preserves the choice). Desk reuses the M3.2 `CompletionMenu` as a two-level picker + shows model/mode in the status line. **Task 1** also closed the M3.3a queued-prompt-loss edge: re-drive the in-flight prompt **once** on a fatal query error (single-retry guard).
- **Built via subagent-driven TDD**, two-stage review per task (spec→quality), + a multi-lens adversarial **Workflow** code-review on the high-risk `app.tsx` task. Tests **455 → 476 (+21)**; typecheck clean.
- **Invariants verified (Task 9):** Even-app/glasses **byte-compatible** — `[no existing Hub route removed/changed ✓]`, `events/sse changed: 0`; **no test gaming** — `[none removed ✓]` (no `it/test/describe` deleted, no `.skip`/`.only`).
- **Live self-test PASSED before handback** (real `serve`+Hub+SDK on `127.0.0.1`, driven through the real desk `HubClient`): `/api/control` → 202/400/401; a real prompt mints a session; **E3** `acceptEdits` → a `Write` applied with **0 permission prompts** (file created); **E2** `plan` → the `Write` was **blocked** (no file; model planned + `ExitPlanMode`). Preview frames (`/model` picker, `/mode` picker, `[idle · opus-4-8 · plan]` status) eyeballed + VHS PNGs.
- **🧪 Plan-vs-reality gaps caught during the build** (subagents correctly BLOCKED rather than weakening tests; controller resolved each): (1) **Task 1's re-drive contract breaks two pre-existing tests** that pinned the old drop-on-error contract → fakes/assertions updated faithfully (it() titles byte-identical → no-gaming grep stays clean). (2) **Task 2's gate `controlFake` is broken by Task 1**: the death must occur *after* `setModel` (else the auto-reopen consumes `resume` with the old model before the control is applied) → fake redesigned so open#0 succeeds then dies on its 2nd prompt; gate adversarially re-verified (remove the config write → reopen carries `claude-opus-4-8` not the chosen model). (3) **Widening the required `HubClient` interface** (Task 5) breaks 3 fake implementations → additive no-op stubs.
- **🧪 Workflow caught a real Important UX bug single-pass review missed:** **Esc on an open picker** fell through to `client.interrupt()` (aborting a live turn) and didn't dismiss the picker → fixed (`if (pickerChoices) { setBuf(B.empty()); return }`) + regression test (empirically reproduced: pre-fix `interrupts === ['s1']`).
- **Deferred / flagged for the planner (non-blocking):** (a) status-line **mode** not seeded from the Hub (shows `default` until a `/mode` pick — deferred to avoid touching the byte-compatible `/api/info` shape this rung → M3.3c candidate); (b) **pre-session §7 binding** is note-only (no deferred-apply; the note "(applies once a session starts)" slightly over-promises — accepted YAGNI per §12, planner to confirm wording vs. implementing 2nd-turn apply); (c) picker accepts on **Tab AND Enter**, **Esc** dismisses (spec §4 "Tab/Enter accepts"; the "bare submit = no-op note" clause is superseded by Esc-to-dismiss); (d) note uses friendly labels (`✓ mode → Plan`) consistently (spec example shows lowercase `plan`).
- **Runbook:** `projects/colive-terminal/m3.3b-uat-runbook.md` (copy-paste Pane A/B setup + E1–E5; records E1/E4/E5 as the remaining hardware checks). **Next:** planner validation → owner hardware UAT (E1–E5) on G2 + R1 → merge.

## 2026-06-04

### Co-Live Terminal M3.3a — ✅ Streaming-input Core (the refactor) — DONE: hardware UAT D1–D5 PASS (owner signed off 2026-06-04) + planner-validated + MERGED to `main` `fde76c5`

- **Hardware UAT (2026-06-04):** owner ran the full D1–D5 walk on real G2 + R1 and signed off — all PASS (render parity, FIFO, clean interrupt with no error banner + immediate reuse, glasses byte-compat, self-heal). Runbook signed: `projects/colive-terminal/m3.3a-uat-runbook.md`.

- **Scope:** drive the SDK in **streaming-input mode** via **one persistent `Query` per session** (was: one
  `query({prompt:string})` per turn), fed by a new pushable `PromptInbox` (`src/core/promptInbox.ts`); a single
  long-lived consumer loop maps every message through the **existing `handleMessage*` layer UNCHANGED** and detects
  turn-end on the `result` message; `AbortController` interrupt → `Query.interrupt()`; fatal query error self-heals by
  lazy reopen-with-`resume`. **Core change CONFINED to `session.ts` + `promptInbox.ts`** (no `events.ts`/`sessionManager.ts`/
  `hub/`/`desk/` change → glasses byte-compat preserved).
- **Built via subagent-driven TDD** (probe-first, two-stage review per task; reviewers verified all 12 `handle*` bodies
  byte-identical main↔branch → emitted `CoLiveEvent`s unchanged).
- **Task 1 live SDK probe (🧪 `knowledge/terminal-mode/streaming-input-probe.md`):** streaming mode emits **one `result`
  per turn** ✅ and **unchanged `stream_event` shapes** ✅; **`init` arrives per-turn** (not once) but is BENIGN (emits no
  events; `session_id` stable across turns) → mapping stays byte-identical, build proceeded as written. `SDKUserMessage`
  text shape confirmed live.
- **🔴→🧪 Interrupt behavior discovered + handled:** the real `Query.interrupt()` does **not throw** — it flushes a
  **non-success `result`**, which `handleResult` mapped to a spurious `[ede_diagnostic]` **error banner** on every Esc
  (a regression from the old silent abort). **Caught by the live self-test (Task 8), not by unit tests** (their fakes
  optimistically modeled interrupt as a *success* result). Fixed: an `interrupting` flag makes the consumer loop suppress
  the SDK's non-success interrupt-result → **clean idle** (no error/failed-result), while genuine error-results still
  surface and a success-race result still passes through. Re-verified live: **error count 0**, session immediately usable.
- **Dual self-test before handback (per the "no UAT on green tests alone" rule):** (Task 7) deterministic desk-render
  preview frame + vhs PNG (`shot-m33a-session.png`); (Task 8) **LIVE local serve+desk** through the real Core via the Hub
  HTTP/SSE API — full multi-tool turn arc emitted live & rendered faithfully (`shot-m33a-live.png`), sequential FIFO,
  clean interrupt + immediate reuse, self-heal unit-verified (live trigger = hardware D5).
- **Verified on-branch (controller-reverified):** **455 tests / 41 files green** (442 → **+13**), `tsc` exit 0,
  **CONFINED ✓**, no test deleted/weakened (5 renamed in the abort→`Query.interrupt()` / per-turn→persistent adaptation).
- **Next:** planner validates spec→claims→code, then merges; build chat does NOT push/merge.
  Runbook: `projects/colive-terminal/m3.3a-uat-runbook.md` (D1–D5).

## 2026-06-03

### Co-Live Terminal M3.2B — ✅ `@`-file autocomplete + `!`bash — DONE: hardware UAT C1–C6 PASS + planner-validated + MERGED to `main` `58af6e0`

- **Scope (desk-only, zero Core/Hub change):** typing `@` opens a **mid-line** fuzzy file-path menu that inserts a
  repo-relative `@path` (Claude reads it with its **Read** tool); a `!`-line is delegated to Claude's **Bash** tool
  (M1-permission-gated, renders as a normal `Bash(...)` turn). The desk **never reads file contents and never runs a
  shell** — its only new fs touch is enumerating *filenames* (`git ls-files`, `readdir` fallback). `@` and `/` menus are
  mutually exclusive by construction; `!` opens no menu.
- **Built via subagent-driven TDD** (10 tasks: impl → spec-compliance review → code-quality review per task, fresh
  subagent each; final whole-branch review = APPROVED FOR HANDBACK). New pure/DI'd modules: `src/desk/input/files.ts`
  (fuzzy ranker + git-first/walk-fallback file source, cached once/session), `atContext` in `menu.ts`, `replaceRange` on
  the immutable `EditBuffer`, a `bash` kind + `formatBashPrompt` in `slash.ts`; `app.tsx` unifies the slash/`@` menu
  (Esc-dismiss keeps the line) + dispatches `!bash` + records it in composer history.
- **Verified on-branch (controller-reverified, not agent self-report):** **442 tests / 39 files green** (baseline 412 →
  **+30**), typecheck exit 0, **`git diff main -- src/core src/hub` empty** (zero Core/Hub change proven), no
  `.skip`/`.only`, no deleted tests.
- **Self-test GATE passed:** rendered the `@`-menu / mid-line insert / `!`bash echo / layout via the preview rig + vhs
  PNGs and eyeballed them — no rendering bugs (`test/preview/m32b.preview.test.tsx`, `scripts/screenshots.sh`).
- **Plan gap caught & fixed:** adding `BashResult` to the `InterpretedInput` union broke `app.tsx`'s typecheck — its
  `switch (result.command)` narrows by **elimination**, so the new member dropped `.message`/`.view`/`.mode`. Resolved
  with a minimal placeholder `bash` guard in Task 5, replaced by the real dispatch in Task 7. (Lesson: adding a union
  member is NOT free under elimination-style narrowing.)
- **✅ Hardware UAT — C1–C6 ALL PASS (2026-06-03, user, real G2 + R1).** The mid-line `@` pick + read, two-`@` lines,
  `!`bash permission round-trip, popup nav + no `/`-vs-`@` collision, ignored-file exclusion, and the write-vs-read
  permission flows all work perfectly.
- **Spec §6 R1 — ✅ RESOLVED:** the one real risk was whether Claude *auto-reads* an `@`-mention (raw-SDK Core has no CC
  harness to inject contents). **C1/C2 passed — Claude auto-read the mentioned file(s)** — so the desk-appended "please
  read" nudge is **not needed** and was not shipped (YAGNI holds). Runbook signed off:
  `projects/colive-terminal/m3.2b-uat-runbook.md`.
- **NOT merged by the build chat** (per instruction) — handed to the planning chat for spec→claims→code validation, then
  merge (hardware UAT already signed off). Branch `colive-terminal-m3.2b`, 9 commits (`b43fe2d`…`ced735e`).

### Co-Live Terminal M3.2A — ✅ mouse-history-leak fix VALIDATED + MERGED (`2370b25`); copy/paste phase DESCOPED

- **Copy resolved without a phase:** **Option+drag** selects + copies natively (terminal selection bypass with mouse
  reporting on) — user accepted. So the planned copy/paste phase **collapsed to one bug fix** (the mouse-select leak)
  and is otherwise descoped. (OSC 52 `/copy` is no longer needed; parked as a future nicety if ever wanted.)
- **The bug:** in default `/scroll` mode, an Option+double-click / trackpad scroll populated the composer with a recalled
  command. **Root cause (`COLIVE_A4_LOG`-confirmed, NOT mouse reports):** in the alt-screen, VS Code's terminal uses
  **alternate scroll mode (DECSET 1007)** — it translates wheel/trackpad scroll into dense **arrow-key bursts** (33–66 in
  one ~3 ms stdin tick), byte-identical to real arrows, which drove the composer (↑ = history recall).
- **Layered fix (built by the builder chat, planner-validated):** `isMouseReport()` drops all mouse-report strings;
  disable alt-scroll (`1007l`) on entry; **density burst-detection** — ≥ `ARROW_BURST_THRESHOLD` (4) arrows in one tick =
  scroll-gesture artifact → ignored, < 4 = real input (preserves single keypress + A4 2–3 batched). Env-gated input-trace
  logger kept. Lesson in `knowledge/terminal-mode/ink7-input-internals.md` ("alternate scroll mode").
- **Validation:** zero Core/Hub change, no test gaming, fix real in code, **412 tests / 37 files clean-tree green**,
  hardware-validated by user. Merged `--no-ff` (`2370b25`), pushed.
- **Known tradeoff (accepted):** dropped bursts don't scroll either → **reliable scroll = PageUp/PageDown** (Fn+↑/↓ on
  Mac); the mouse wheel no longer scrolls the transcript. **Future enhancement:** route vertical arrow-bursts → transcript
  scroll (restores wheel-scroll on top of the burst-detection fix). Not a blocker.
- **Next:** scope **M3.2B** (`@`-file autocomplete + `!`bash).

### Glasses + Obsidian integration — 💡 explored, phased plan captured in backlog

- **Planning discussion:** explored how the glasses could integrate with the user's Obsidian "second brain" vault
  (the "anytime thought-capture" use case from the M3.0 scope boundary). Evaluated: structured slash commands,
  context-aware capture, conversational tidy-on-the-go, seamless capture-to-explore, unified interface.
- **Ruled out:** hybrid Terminal Mode + SDK app (glasses can't easily switch modes); two separate Claudes
  (routing layer preferred).
- **Decided:** 4-phase incremental approach. Phase 1 (capture slash commands: `/thought`, `/todo`, `/idea`)
  starts in the **Obsidian project** as Claude Code skills, then wires into Co-Live later. Phases 2–4
  (vault session, routing, full SDK app) are post-M3 in this project.
- **Captured in** `ideas/backlog.md` § "Glasses + Obsidian Vault Integration" — does not interfere with
  the current M3 roadmap. Phase 1 work happens in `~/Documents/random_claude_stuff/obsidian_how_to/`.

### Co-Live Terminal M3.2A "Composer" — ✅ VALIDATED + MERGED to `main` (`278f7c8`)

- **Planner validation pass (Opus 4.8):** audited the candidate spec→claims→code (not PROGRESS notes). Verified:
  **zero Core/Hub change** (`git diff main..branch -- src/core src/hub` empty — the co-live invariant held), **no test
  gaming** (no deleted tests, no `.skip`/`.only`), **391 tests / 36 files green + typecheck clean** (re-run from tree),
  and all three fix claims real in code (A2 readline word-nav, A4 `navRef`+functional-`setBuf`, A6 `mouse-mode.ts`
  toggle with the ESC-strip). Deferrals honestly characterized; A5's slash.ts additions were only `/select`·`/scroll`
  (no smuggled commands).
- **Surfaced for the merge call:** M3.2A defaults **mouse-reporting ON** (`index.ts` `MOUSE_ON`) vs M3.1's alt-screen-only,
  so native click-drag selection is captured by default → A6 isn't just "missing copy," it's a copy *behavior change*.
  `/select` is correctly wired to `MOUSE_OFF` but reportedly didn't restore copy on the VS Code terminal → the proper
  fix is terminal-agnostic **OSC 52 `/copy`** in the next phase.
- **Decision (user):** **merge as-is, copy/paste phase next.** A4-step deferred (net-new, not a regression; logger wired);
  A6-copy → dedicated copy/paste phase; A5 → M3.3. Merged `--no-ff` (`278f7c8`), pushed; run-book sign-off recorded.
- **Next planning:** scope the **copy/paste phase** (OSC 52 `/copy` + paste-in ergonomics; `/select`·`/scroll` +
  `mouse-mode.ts` already in place to build on). A4 deeper diagnosis via `COLIVE_A4_LOG=/tmp/colive-a4.log` whenever picked up.

### Co-Live Terminal M3.2A "Composer" — 🔧 UAT fix pass: A2 fixed + hardware-passed; A4-step & A6-copy DEFERRED — NOT merged

- **First hardware UAT (2026-06-03):** A3, B1, B2 **PASS**; A1 via Ctrl-J (user waved off `\`+Enter). Flagged **A2** (Option+word-nav),
  **A4** (paste→arrow "jump"), **A6** (copy/selection — "critical"); A5 (more slash commands) = scope ask.
- **Triaged via a 4-way parallel investigation workflow** (verified root causes against ground-truth code; killed the runaway
  web-research sub-tree once the 3 load-bearing findings were in). Then fixed via subagent-driven TDD (fresh implementer →
  spec review → quality review per fix; **zero Core/Hub change**):
  - **A2 — Option+word-nav:** VS Code's terminal emits the **readline** form of Option+←/→ (`ESC-b`/`ESC-f` → `ch='b'/'f'+meta`,
    no arrow flag), which the CSI-only dispatcher swallowed. Added that form (kept CSI) **+ Option+Backspace = delete-word**. `29c93c8`.
  - **A4 — paste→arrow "jump": a REAL bug, not the terminal.** ↑/↓ computed next-state from a **stale React closure** + non-functional
    `setBuf`; under input batching (auto-repeat / coalesced bytes — ink drains stdin in one synchronous emit loop, refreshing the
    handler closure only at React commit) every batched arrow read the same frozen buffer → all but the last dropped, edge moves
    fired history recall → "jump to top/bottom." Fixed: **functional `setBuf` updaters** (like `←` always was) + `nav`→`useRef`.
    Shipped an **opt-in logger** (`COLIVE_A4_LOG`) for one-shot hardware confirmation. `c537ac2`. Lesson captured in
    `knowledge/terminal-mode/ink7-input-internals.md`.
  - **A6 — copy:** wheel-scroll and native selection are **mutually exclusive** (same `?1000h` mode; `?1006h` alone emits nothing).
    Added a runtime **`/select` ⇄ `/scroll`** mouse-mode toggle (DECSET literals de-duped into `src/desk/mouse-mode.ts`, shared with
    `index.ts` so on-exit cleanup can't drift; status-line shows `select-mode`). `9001f8a`. Durable **`/copy` (OSC 52)** → M3.2B;
    full skill/CLI command set (**A5**) needs Hub-reported commands → **M3.3**.
- **Re-verified from a clean tree:** `npm ci` clean, typecheck exit 0, **391 tests / 36 files** (was 381; +10).
- **Round-2 hardware UAT (2026-06-03):** **A2 = FULL PASS.** **A4** — paste works, but post-paste one-line ↑/↓ stepping still
  fails on the VS Code terminal (the functional-updater fix corrected a real rig-verified stale-closure bug, but an additional
  cause remains unpinned) → **user deferred (not mission-critical)**; `COLIVE_A4_LOG` logger stays wired. **A6** — copy still does
  not work (couldn't copy anything, even with `/select`) → **user deferred the entire copy/paste surface to a new dedicated phase**
  (to be scoped in the planning chat). A5 → M3.3.
- **Composer core is hardware-validated** (multi-line authoring, char/word/line cursor nav, history, paste, slash menu,
  `/select`·`/scroll` toggle). Two deferrals (A4 per-line step, A6 copy) carried to the planning chat for the merge-scope call.
  **Still NOT merged.**

### Co-Live Terminal M3.2A "Composer" — ✅ BUILT (candidate), awaiting hardware UAT — NOT merged

- **Implemented from the plan** (`docs/superpowers/plans/2026-06-02-colive-terminal-m3.2a-composer.md`) on branch
  `colive-terminal-m3.2a` (off `main` `8f9bb0f`), via **subagent-driven TDD** — one fresh implementer per task, then an
  independent spec-compliance review (re-runs the tests) + a code-quality review, per task.
- **New pure, fully-unit-tested layer `src/desk/input/`:** `buffer.ts` (immutable `EditBuffer` model + cursor/edit ops),
  `history.ts` (pure nav + dedup/cap + DI'd `HistoryStore` w/ file + memory adapters), `mouse.ts` (pure SGR-wheel parser),
  `menu.ts` (`filterSlash`), `input-rows.ts` (multi-line render w/ inverse-video cursor). `app.tsx`'s `useInput` became a
  thin key→op dispatcher; paste rides ink `usePaste`; mouse-wheel read off `useStdin().internal_eventEmitter`'s `'input'`
  channel (ESC-stripped before the parser); SGR mouse enabled at `index.ts`; per-project history defaulted to the on-disk
  store (keyed by the Hub base URL).
- **Keymap shift (hardware UAT confirms):** `↑/↓` now drive the **input** (history at edges, cursor between draft lines);
  the **mouse wheel scrolls the transcript**; PageUp/PageDown page it; text selection now needs **Option-drag** (mouse
  reporting is on). Full keymap w/ macOS Fn-equivalents in the run-book.
- **The review loops caught + fixed real bugs** (not just style): backslash-continuation guard anchored on the **cursor**
  line (was whole-buffer → a stray mid-buffer newline once `↑/↓` could move the cursor off the last line); history nav
  reset after **every** submit (a slash-submit left a stale recall index); `fileHistoryStore.load` now applies
  consecutive-dedup on read (the append path is a raw JSONL log). Tests strengthened to actually prove the buffer model
  (mid-buffer insert → `aXbc`) and the `usePaste` safety property (a `\r` inside a paste never submits).
- **Verification:** **375 tests pass / 35 files, typecheck clean, ZERO Core/Hub change** — controller-reverified from a
  clean tree (`npm ci && npm run typecheck && npm test`). A final holistic review across the whole 19-commit branch =
  **"ready for hardware UAT"** (only 2 non-blocking cosmetic notes: gate the menu render on `!pending`; import `MenuItem`
  in `slashMenuItems`).
- **Pre-UAT visual self-test DONE** (the M3.1 "see it before UAT" discipline — initially skipped, then done on a reminder):
  extended the preview rig with a keystroke-driven composer scenario file (`test/preview/m32a.preview.test.tsx` — the rig's
  `capture()`/`key()` sends arbitrary stdin bytes, so input-driven features render the same way the live desk would),
  dumped frames, rendered PNGs via `vhs`, and **reviewed the screenshots**: multiline authoring, the mid-line inverse-video
  cursor, multi-line paste, the slash menu + highlight, history recall, and a multi-line composer below a live transcript
  all render correctly — **no rendering bugs found**, so no pre-UAT fixes were needed. Committed the preview test as a
  permanent regression+preview asset (suite now **381 tests / 36 files**) and registered the frames in `scripts/screenshots.sh`.
- **STATUS: CANDIDATE — NOT merged.** Per M3.0 §0, M3.2A is DONE only after the user runs
  `projects/colive-terminal/m3.2a-uat-runbook.md` on real **G2 + R1** and signs off. Run-book = Part A (composer:
  multiline, cursor/word/line nav, history-across-restart, paste, slash menu, wheel scroll + Option-drag) + Part B (light
  co-live regression: single-render + permission ring round-trip).

## 2026-06-02

### Co-Live Terminal M3.2 — scoping the "typeable" rung (planner: Opus 4.8)

- **M3.2 split into two rungs** (user call): **M3.2A "Composer"** (editor core) + **M3.2B** (`@`-file autocomplete +
  `!`bash). Boundary = "lives inside the input box" vs "reaches into the host environment."
- **M3.2A design complete** (`docs/superpowers/specs/2026-06-02-colive-terminal-m3.2a-composer-design.md`) — awaiting
  user review → writing-plans. Locked: Enter submits / `Ctrl-J`+`\`-Enter newline; **`↑`/`↓` = input** (history +
  multiline cursor) with **real mouse-wheel reporting for transcript scroll** (replaces M3.1's wheel→arrows hack);
  full keymap saved **with macOS-laptop Fn-equivalents**; **per-project persisted history**; slash-menu over the
  existing `slash.ts` commands (reusable `CompletionMenu` for M3.2B); **zero Core change**.
- **Decided NOT to do a broad TUI-research spike** — our M3.1 pain was mostly integration/protocol ("Bucket B",
  UAT-discoverable), not TUI-craft; a survey would be low-transfer. Revisit only if we hit a craft wall.
- **🧪 Probed ink 7.0.5 input internals before locking §7** (recoups some skipped-spike value): `usePaste` gives
  built-in bracketed paste (full string, separate channel); mouse isn't auto-enabled but ink assembles SGR mouse
  sequences and re-emits them raw on `internal_eventEmitter`'s `'input'` channel (wheel = btn 64/65). → captured in
  `knowledge/terminal-mode/ink7-input-internals.md`. Mouse/paste plumbing is GREEN; one hardware caveat (does the VS
  Code terminal forward SGR mouse) with graceful PageUp/PageDown fallback.

### Co-Live Terminal M3.1 "Readable transcript" — ✅ DONE, hardware-signed-off, MERGED to `main`

- **Merged to `main` 2026-06-02** as a `--no-ff` merge commit **`fda7e26`** (branch `colive-terminal-m3.1`).
  **314 tests, typecheck clean, 0 vulns — controller re-verified from a clean tree** (`npm ci` → `typecheck` →
  `test`), not agent self-report.
- **Shipped (desk-side only):** flatten-to-ANSI-rows render layer + viewport (PgUp/PgDn/End **+ arrow/wheel
  scroll**, exact `rows X–Y of N`), inline syntax-highlighted **diffs**, **markdown** (with a `│` code border +
  `▌` blockquote bar), **Ctrl-O** global verbose, **todos panel** (repositions to latest activity; live ✔/▶/☐
  glyphs), native-style **`⏺ Tool(arg)`** headers, and **desk-only thinking** (one additive `thinking_delta`
  event; Hub untouched, so the closed Even app ignores it).
- **Hardware UAT (real G2 + R1, 2026-06-02):** Part A A1–A6 reviewed ("looks good"); Part B B1–B4 all PASS
  (live HUD stream; thinking stayed desk-only; ring dictation → same session; ring permission tap). One bug
  found on hardware (desk-sent prompt double-rendered — optimistic echo + Hub broadcast) **fixed + re-glanced**.
- **Process wins this rung:** a self-test rig (replay harness + VHS screenshots + Tier-3 record/replay) let the
  controller *see* the desk before UAT; an 18-agent adversarial audit workflow caught **4 real render bugs**
  (ANSI-severing wrap, phantom diff row, lost TaskUpdate status, header nit) unit tests had missed — all fixed
  pre-merge. See [[self-test-tui-before-uat]].
- **Next rung (M3.2) is scoped by the planner chat — no M3.2 work until then.**


- **Built via subagent-driven development on branch `colive-terminal-m3.1`** (Opus 4.8 ultracode). Task 1 (deps)
  + the de-risking probes done by the controller directly; **Tasks 2–12 executed as a sequential workflow** (35
  agents, ~59 min) — each task: implement (TDD) → independent spec-compliance review (re-runs the tests) → fix-loop
  → code-quality review (full `npm test` + typecheck) → fix-loop. **Controller re-verified from a clean tree**
  (`npm ci` → typecheck → test), NOT agent self-report: **279 tests pass (was 237, +42), typecheck clean, 0 vulns.**
- **Shipped (desk-side only):** flatten-to-ANSI-rows render layer (`src/desk/render/` — `ansi`/`wrap`/`highlight`/
  `markdown`/`diff`/`blocks`/`rows`/`window`) + `app.tsx` rewired to a scrollback **viewport** (PgUp/PgDn/End,
  pin-to-bottom, exact `rows X–Y of N` indicator), **inline +/- diffs** (Edit/Write/MultiEdit), **syntax
  highlighting** (cli-highlight), **markdown** (marked + marked-terminal), **Ctrl-O global verbose toggle**, a
  **todos panel** (in-place), and **desk-only thinking display**.
- **One Core change only** (`src/core/events.ts` + `src/core/session.ts`): a new `thinking_delta` event sourced
  from the SDK's `content_block_delta.delta.thinking`. **Hub untouched** — it serializes any event via
  `JSON.stringify` (no allowlist), so the new type flows to subscribers automatically and the closed Even app
  ignores it. An e2e test boots the real Core+Hub and proves the broadcast-and-ignore invariant (UAT B2) in software.
- **🧪 Findings surfaced while building (verified by the controller, fed to the build agents):** (1) `marked-terminal`
  defaults `showSectionPrefix:true`, which keeps the heading `#` — must pass `showSectionPrefix:false`. (2) `chalk`
  gates ANSI on TTY, so `marked-terminal`/`cli-highlight` emit **no color under vitest** (non-TTY) — set
  `FORCE_COLOR=3` in `vitest.config.ts` so tests exercise the same colored path the live `colive desk` terminal
  uses (verified the prior 237 stayed green). (3) `cli-highlight` **throws** on an unknown language → the
  `highlight.ts` try/catch fallback is load-bearing. (4) ink's `Key` has real `pageUp`/`pageDown`/`end` booleans.
- **Invariants preserved:** desk client stays a **pure Hub client** (DI'd `HubClient`, no SDK); the M1 co-live
  permission-dismiss fix, Esc-interrupt, Ctrl-C, `/clear`, slash handling, and transcript seeding are all intact.
- **NOT done (spec §0):** green tests are the precondition only. **M3.1 is DONE only when the user runs
  `projects/colive-terminal/m3.1-uat-runbook.md` on the real G2 + R1 and signs off.** No merge before that.
- **Next:** user hardware UAT (Part A A1–A6 desk features + Part B B1–B4 co-live regression). Bugs → fix → re-UAT.

### Co-Live Terminal M3.1 — hardware UAT round-3 (desk Part A) — in progress

- **A1–A4 PASS on hardware.** A1 scroll fixed by (a) entering the **alternate screen** at the CLI entry point on the
  real `process.stdout` — the earlier React-effect version silently no-op'd because ink's stdout wrapper hid `isTTY`
  (`c04d5c7`); and (b) adding **arrow-key + trackpad/mouse-wheel scrolling** (`scrollLine`; terminals map wheel→↑/↓ in
  the alt screen), tuned to `WHEEL_STEP=3` rows/notch after "a little slow" feedback (`c77557c`, `21f5d7a`). A2 inline
  diff + A3 Ctrl-O verbose confirmed once `serve` was restarted (the empty-`input:{}` was a stale-process artifact, the
  Core fix was correct). A4 markdown (heading/bold/lists/table/fenced code) clean.
- **A5 todos panel — polished toward native parity** (`7050d17`): the single panel now **repositions to the latest
  activity** (was frozen at first-appearance, so the final all-done state rendered *above* the steps that produced it),
  and plain `[x]/[~]/[ ]` became colored glyphs (green ✔ done / yellow ▶ active / dim ☐ pending). **287 tests.**
- **A6 thinking — DECISION (2026-06-02): defer "liveness".** Native's animated status line ("Forging… 9s · ↓506
  tokens": spinner + elapsed timer + live token counter) is a **cross-cutting status-line concern, not transcript
  rendering** → out of M3.1 scope; logged as a **Cockpit liveness rung (M3.x)** in `ideas/backlog.md`. M3.1 keeps the
  readable-transcript pass criterion (thinking *text* streams then collapses to a Ctrl-O stub) — to confirm on a clean run.
- **Still open:** Part B (B1–B4) glasses co-live regression; then user sign-off → merge.

### Co-Live Terminal M3.1 — cosmetics + Tier-3 + adversarial audit (2026-06-02, ultracode)

- **Minor cosmetics** (screenshot-verified): fenced code now has a dim `│` left border (custom marked code
  renderer reusing our cli-highlight wrapper); collapsed the stray blank line marked-terminal leaves between
  nested bullet items (ANSI-tolerant gap matcher). `scripts/screenshots.sh` rewritten to one VHS run per frame
  (the single multi-Screenshot tape raced → mislabeled frames).
- **Tier-3 record/replay** (`src/desk/record.ts`): `recordingClient` tees every desk event to a JSONL fixture
  (gated on `COLIVE_RECORD`; best-effort), `loadEvents` replays it; the harness renders a recording deterministically
  — closes the loop on Core data-shape bugs. README documents Tiers 1/2/3.
- **UAT walk** (`test/preview/uat.preview.test.tsx`): one canonical captured frame per runbook item A1–A6, each
  screenshot-mapped. Scenarios end a turn with running_stats+result+status:idle, so the status line reads
  "[idle · N tokens]" like hardware (desk relies on the Core's emitIdle() in the turn finally — verified, not a bug).
- **Adversarial audit workflow** (18 agents: 9 reviewers + per-finding skeptics over frames + render source) →
  4 real render bugs, all fixed TDD: (1) wrap.ts hard-split severed ANSI escapes on long highlighted tokens →
  visible-char split; (2) extractEditDiff returned a diff for null input → phantom blank row (guard + caller skips
  no-op diff); (3) TaskUpdate-before-TaskCreate lost status → upsert by id; (4) tool-header ANSI boundary nit.
  Removed dead highlight()+stripAnsi() in diff.ts + corrected its docstring. **311 tests, typecheck clean.**
- **Self-driven loop proven:** render → screenshot (Read PNG) → fix, plus an adversarial workflow, caught bugs unit
  tests missed (thinking-never-collapsing; 4 audit bugs) BEFORE hardware. See [[self-test-tui-before-uat]].
- **Next:** user validates the A1–A6 screenshot walk, then Part B (glasses) → sign-off → merge.

### Co-Live Terminal M3.1 — self-test rig + autonomous polish pass (2026-06-02)

- **Built a render-and-screenshot self-test rig** so the desk TUI can be iterated WITHOUT hardware (user
  request: "test it live and look at the results … iterate until requirements met, THEN I UAT"). Tier 1
  (`test/preview/`, zero deps): a replay `HubClient` drives the REAL `App` against scripted/curated event
  scenarios via the injected-client seam; captures exact frames (windowed + full-flatten) to `preview-out/`
  under `PREVIEW=1`. Tier 2 (`scripts/screenshots.sh` + `.tape`, needs `brew install vhs`): renders the
  full-colour `.ansi` frames to PNGs the controller reads. See [[self-test-tui-before-uat]].
- **The rig immediately caught a real bug** unit tests missed: a thinking block only collapsed on an explicit
  `status: think_end`; when assistant text followed directly the tracking index reset without marking it
  closed → thinking stayed expanded forever. Fixed (text/thinking deltas now `closeOpen()` on transition).
- **Autonomous polish pass toward native parity** (screenshot → assess → fix, judged against native Claude):
  (1) markdown — `tab` 4→2, `* `→`•` bullets, blockquote now a gray `▌` bar + dim italic; (2) tool headers —
  the generic Core summary ("Bash completed") replaced by native-style `⏺ Name(keyArg)` (green dot / red on
  fail; arg = command/file_path/pattern/url/query); (3) `(N line[s])` pluralization. Todos panel (earlier
  this session) repositions to latest activity + colored ✔/▶/☐ glyphs. **294 tests, typecheck clean.**
- **Still desk-side only; no merge.** Next: hand the polished build back for a fresh Part-A UAT, then Part B.

### Co-Live Terminal M3.1 — ✅ spec + plan LOCKED (Readable transcript); plan reviewed → built

- **Brainstorm (4.8, visual companion):** locked five decisions for the desk "readable transcript" rung —
  **(D1)** render architecture = **flatten-to-ANSI-rows** viewport (chosen over entry-windowing via an A/B
  terminal mockup: a tall block must be reachable row-by-row, not all-or-nothing per entry); **(D2)** add focused
  ANSI libs `marked`+`marked-terminal`, `cli-highlight`, `diff`/jsdiff (departs from the M1/M2 zero-dep ethos
  deliberately — real syntax highlighting + markdown are impractical to hand-roll); **(D3)** Ctrl-O = **global**
  verbose toggle (default off, matches native, avoids a selection cursor); **(D4)** diffs render **inline** the
  moment an edit lands (not behind expand); **(D5)** thinking **broadcasts** to all subscribers and the closed
  Even app ignores it (UAT B2 proves it on hardware; server-side filter is the fallback).
- **🧪 Verified while planning:** the SDK carries thinking text in `content_block_delta` `delta.thinking` (NOT
  `delta.text`) — confirmed in `test/core/session.test.ts` happyTurn (`thinking:'secret'`); the Hub serializes any
  event via `JSON.stringify` with **no allowlist** (`src/hub/sse.ts:72`) so a new event type flows automatically;
  no event-exhaustive `never` switch exists in app code, so the additive union member is safe. The **only**
  non-desk change is one `thinking_delta` event (`events.ts` union + `session.ts:473-481` emit).
- **Spec:** `docs/superpowers/specs/2026-06-01-colive-terminal-m3.1-design.md` (accepted). **Plan:**
  `docs/superpowers/plans/2026-06-01-colive-terminal-m3.1-readable-transcript.md` — 13-task TDD, subagent-driven,
  new desk `src/desk/render/` layer (ansi/wrap/highlight/markdown/diff/blocks/rows/window) + `app.tsx` viewport &
  PgUp/PgDn/End/Ctrl-O. **UAT run-book finalized** (`projects/colive-terminal/m3.1-uat-runbook.md`) to match.
- **Governing rule (spec §0) restated:** green tests + clean typecheck are the *precondition only*; the build
  produces a **CANDIDATE**; **M3.1 is DONE only when the user runs the run-book on the real G2 + R1 and signs
  off.** No merge before hardware sign-off.
- **Next:** user reviews spec + plan (4.8 planning chat) → then `/ultracode` build in a separate session →
  controller re-verifies from a clean tree → user hardware UAT.

### Co-Live Terminal M3.0 — ✅ LOCKED: "Desk Cockpit" parity inventory + roadmap

- **Locked 2026-06-01** after a user-requested tweak: §0 makes **real-hardware UAT + user sign-off the non-negotiable definition of done** (green tests are only the precondition; build agents produce candidates, not "done"; M1/M2's "merge-before-testing" failure mode designed out).
- **Post-lock addition (2026-06-01):** new feature **message source tags** — colored `[glasses]`/`[mac]` provenance on user messages — folded into the spec under **M3.4** (+ §3 wishlist, §4 needs a small `source` field on the `user_prompt` event). Best fit M3.4 (co-live presence/provenance milestone), not M3.1 (locked).

- **Spec:** `docs/superpowers/specs/2026-06-01-colive-terminal-m3-design.md` — the M3.0 deliverable (wishlist + feasibility sort + sequenced roadmap M3.1→M3.5 + parked backlog). No M3.1+ planning until reviewed.
- **🔑 Headline finding (✅ verified vs `@anthropic-ai/claude-agent-sdk@0.3.158` `sdk.d.ts`):** our Core runs the SDK in **string-prompt mode**; the SDK's runtime controls — `setModel` (2186), `setPermissionMode` (2179), `supportedCommands` (2237), `mcpServerStatus` (2255), `setMaxThinkingTokens` (2203), real `interrupt` (2172), image-content prompts — exist **only in streaming-input mode** (`query({prompt: AsyncIterable<SDKUserMessage>})`, 2391). So `/model`, mode toggle/plan, `/compact`, MCP, image paste, clean interrupt all hinge on **one Core refactor** (string-prompt → streaming-input). Isolated as M3.3, the riskiest rung; reading/input/multi-session ship first.
- **🧪 Other findings:** Ctrl-O expand detail is *already* in `tool_end.detail` (client just doesn't render it); thinking text *is* streamed by the SDK but the Core deliberately drops it (M0 anti-HUD-leak) → small new event for desk-only render; `settingSources:[]` means skills/hooks/CLAUDE.md don't load — **decided to flip to `project`+`user`** (user needs skills), accepting the latency and rendering startup/hook output in the desk transcript.
- **Scope locked:** M3 = DESK experience only; glasses/HUD UX + KB/Obsidian = future milestones; push-to-glasses = Blocked (pull-based Hub + closed Even app). Parked backlog: rewind/checkpoint, auto-compact, cross-session search, diff/review queue, saved templates, workflow launcher, bookmarks.
- **Next:** user reviews the M3.0 spec → then brainstorm M3.1 (readable transcript) as its own spec→plan→build→hardware-UAT cycle.

### Co-Live Terminal M3 — brainstorm underway: "Desk Cockpit" (native-parity daily driver), decisions locked

- **Direction (4.8 brainstorm):** M3 = make the desk client a full daily driver — recreate the native `claude` TUI ("no regression") **then build past it**. Bounded as the **daily-driver subset, inventory-first** (user's call).
- **Substrate DECIDED — Terminal TUI** (extend the M1 ink client), over web cockpit / VS Code extension / desktop app. Rationale: lives in the user's VS Code integrated terminal, native parity is concretely achievable (native *is* a TUI), fastest to value, and the Hub is UI-agnostic so a richer surface (e.g. VS Code-extension webview) can be added later as *another* Hub client without touching Core/Hub. Terminal ceilings accepted: inline image *display* (Sixel/Kitty — finicky), GUI-grade polish, dense multi-pane.
- **Scope boundary DECIDED — M3 is DESK-side only.** Deferred to their own future milestones: glasses/HUD UX (smart ~50-char summarization, glasses-side notifications) and the KB/Obsidian thought-capture integration (user's use-case #2). Desk cockpit still co-lives with the glasses exactly as M1/M2 — M3 just doesn't change glasses-side rendering.
- **Finding — push-to-glasses is Blocked.** The Hub is pull-based (`GET /api/sessions` + `GET /api/events?sessionId=`; no "set active session" route) and the Even app is closed, so the desk cannot force the glasses to switch view. What we *have*: desk-started sessions appear in the glasses list instantly and co-live once opened. (Corollary of the already-documented "app subscribes to SSE only when a session is viewed.")
- **Wishlist (forming):** recreate-native minus vim (+ low-pri: `/resume` picker, MCP auth/mgmt, management commands); image paste = capture+send with `[image attached]` placeholder; build-past-native desk-side picks = **session command-center** + **live file-watch pane**. Two items still open (rewind/checkpoint, auto-compact) + an optional bucket (cross-session search, diff/review queue, saved templates, workflow launcher, bookmarks).
- **Next:** lock the wishlist → feasibility-probe each item (Agent SDK + our Core) into 🟢 reuse / 🔵 rebuild / 🔴 blocked → write the **M3.0 spec** (parity inventory + sequenced build order). No M3.1+ planning until M3.0 defines scope. Method per session: 4.8 brainstorm/plan → Opus 4.8 ultracode execute → 4.6 validate; **hardware UAT gates every milestone**.

### Co-Live Terminal M2 complete — Tailscale remote access, hardware-validated, merged

- **Build** (separate Opus 4.8 ultracode session, subagent-driven): 6 code tasks on branch `colive-terminal-m2`. Same pattern as M1 — session tried to merge immediately after last code task, before any real testing. User blocked it.
- **Audit #1** (this session): reviewed full chat log + all source. Found 3 bugs: (1) JSON.parse outside try in `tailscale.ts` and `config.ts`, (2) empty `tailscaleIp` accepted by `readRemoteConfig`. Flagged bare-catch misdetection as highest risk — turned out narrower than feared after Tailscale CLI probe showed `--json` exits 0 for NeedsLogin/Stopped (only daemon-not-running is misclassified).
- **UAT** (build session, user-driven): Tailscale installed, `colive setup` ran against real tailnet, `colive serve` emitted Tailscale QR, glasses connected, phone dropped WiFi → cellular+Tailscale, kept working. Write+Bash tool sequence with ring permissions (Hello5.txt create/delete). All 3 bugs fixed with tests (`5a1a3d2`).
- **Audit #2** (this session): verified all 3 fixes landed correctly, confirmed Tailscale state on disk matches claims (IP `100.97.23.106`, MagicDNS `thomass-macbook-pro.taild4a2b0.ts.net`), caught version typo in knowledge doc (1.98.3 → 1.98.2, fixed in `eae7643`). 237 tests pass, typecheck clean.
- **Final state:** 11 commits on branch, 14 files changed (+682/−9). Merged to main.

## 2026-05-31

### Post-M1 documentation audit — all docs verified accurate; 3 Opus 4.8 fabrications catalogued + corrected

- Ran a full cross-reference audit of PROGRESS.md, `projects/colive-terminal/` (status/notes/log), `knowledge/terminal-mode/overview.md`, and `.remember/` against git history, tests, and code. **Result: the code, git state, and substantive documentation are all accurate.**
- **22 commit SHAs checked: 21 verified, 1 fabricated** (`57cbedc0` in `.remember/today-2026-05-31.md` — a hardware observation tagged with a non-existent commit; corrected in-place). A second fabricated SHA (`e9f9f88`) had already been caught and fixed in `f39c140`. Combined with the fabricated npm-audit-vulnerability claim (fixed in `181a717`), that's **3 total fabrication incidents from the Opus 4.8 session** — all now corrected.
- **216 tests confirmed** (ran `npm test`); **typecheck confirmed clean** (ran `npm run typecheck`). All module files exist where documented. E2e test has exactly 3 tests matching descriptions. Package deps match claimed versions.
- **Merge state verified:** `a6412d0` is a real no-ff merge (43 commits on the feature branch, docs said "~40"), branch deleted, HEAD=`181a717` up to date with origin.
- **Minor doc hygiene issues found (not corrected — cosmetic):** (1) `log.md` stops at Phase 2; Phases 3–4 never logged. (2) `status.md` retains "in progress" build log below the "M1 COMPLETE" header with present-tense language. (3) PROGRESS.md line 110 says "fork" without a superseded note (the decision changed to "reimplement" in the M0 spike). (4) The vulnerability correction calls the fabrication a "transcription error" — the commit message `181a717` is more precise.

### Co-Live Terminal — ✅ M1 COMPLETE: end-to-end loop hardware-validated + merged to `main` (`a6412d0`)

- 🧪 **M1 definition of done MET on real G2 + R1.** The full co-live loop runs: kick off a task at the thin desk client → live on the glasses HUD → dictate a **free-form** follow-up from the glasses → it enters the **same** session → response on **both** → continue at the desk. Hardware-confirmed across this session: allow + **deny** permission paths (model recovers gracefully on deny), **Esc-interrupt**, `/clear`→new session, and **bidirectional permission-prompt dismissal** (answer on the desk OR the glasses ring → prompt clears on both).
- **Shipped:** Session Core (single writer + serialized input + normalized event fan-out) + Even-app-compatible Client Hub (HTTP+SSE, bearer auth, ring buffer/replay) + thin ink desk client (`colive serve` / `colive desk`). **216 automated tests, typecheck clean**, incl. an in-process e2e that drives the real Core+Hub with the real desk client. Merged `feat/colive-terminal-m1` → `main` (no-ff merge `a6412d0`), pushed to origin; tests re-verified green on the merged result.
- **Deferred (→ M2/M3):** Tailscale remote + long-idle reconnect/replay-resume (M2); full native parity (M3); desk single-slot concurrent-permission disambiguation; fast-`202`; filter internal sessions; `bin:{colive}` for real install. **Security:** `npm audit` in `colive-terminal/` is **clean — 0 vulnerabilities** (full + prod-only; lockfile tracked). GitHub Dependabot is disabled on the repo, so there are no external alerts. (Corrects an earlier draft of this entry that claimed "6 push-flagged vulnerabilities" — that was a transcription error; no such report occurred.)
- Full build detail: `projects/colive-terminal/` (status/notes/log) and `knowledge/terminal-mode/overview.md`.

### Co-Live Terminal — M1 Phase 4.2 hardware UAT: full loop runs 🧪 + fixed desk-prompt-stuck bug (`9a232c8`)

- 🧪 **First real desk + glasses hardware run of the full M1 loop — almost everything worked:** kick off at the desk → live on the glasses HUD → free-form follow-up dictated from the glasses → response on BOTH → permission ring tap. One co-live UI bug found: a permission answered FROM THE GLASSES (ring tap) correctly continued the conversation but left the inline permission prompt **stuck on the desk terminal** (a local desk answer dismissed fine; only the remote answer didn't).
- 🧪 **Root cause + fix (one line):** `src/desk/app.tsx`'s `permission_result` handler appended a note but never `setPending(undefined)`. The prompt was cleared only in the local-answer paths; a glasses tap produces no local keypress, only the broker's broadcast `permission_result` — the client-agnostic dismiss signal (broadcast to ALL subscribers on every settle path, for permissions + questions). Added `setPending(undefined)` to that branch so a remote answer dismisses the desk prompt too. Built via `wf-permfix.mjs` (systematic debugging: failing test first, minimal fix, adversarial verifier that reverted the line to confirm fail-without/pass-with). **216 tests green, typecheck clean — controller-reverified from a clean tree.** Noted (out of scope): the desk's single `pending` slot can't disambiguate concurrent permissions (the glasses is the primary multi-permission UI; the broker FIFO-resolves correctly).
- **Next:** re-test the loop on hardware (confirm the desk prompt now clears on a glasses tap) → 4.3 finish-the-branch.

### Co-Live Terminal — M1 Phase 4.1 (automated co-live e2e) COMPLETE + adversarially hardened

- `colive-terminal/test/e2e.test.ts` boots the REAL Core+Hub in-process over real HTTP+SSE (only the SDK `query` + on-disk store faked, injected into a real `SessionManager` + `createApp` + `createSseHub`), driven by the REAL desk `createHubClient`. 3 tests green: (a) desk kicks off → glasses sends a **free-form follow-up into the SAME session** → both independent clients receive byte-identical streams, exactly one sessionId, transcript endpoint agrees; (b) desk-initiated **Write permission APPROVED from the glasses** through the real broker (same toolUseId + `{text,key}` options seen by both); (c) symmetric **DENY** (proves the decision *content* drives the outcome, not just that some resolution arrived). The **software side of the M1 loop is proven.** (`32663f4`, `c9203ca`)
- The test caught two integration bugs in its own first draft (`RunningServer.port` not `.url`; fake-turn message shape) before going green — composed startServer's wiring in-test so the validated `hub/server.ts` is untouched.
- **Adversarial-reviewer subagent** verdict "WEAK PROOF" flagged live-vs-replay + permission-necessity; traced both to be already covered (turn 2 is initiated only after both clients confirm turn 1, with no reconnect/replay path → live-only; Write isn't auto-allowed in `default` mode and an ignored decision would block to the 60s timeout) — reviewer over-stated severity, but adopted its useful adds (the deny test, explicit `toolUseId` identity + replay-then-live ordering asserts, non-empty guards). **214 tests green, typecheck clean — controller-verified (not agent self-report).**
- **Next: Phase 4.2 hardware UAT** — the full loop on real G2 + R1 (run-book in `projects/colive-terminal/notes.md`): `colive serve` + `colive desk` at the desk + glasses on the same Core. Then 4.3 finish the branch. `permissionMode` stays `default` (user's call; `--permission-mode acceptEdits` = fewer ring taps).

### Co-Live Terminal — M1 Phase 3 (thin desk client) COMPLETE

- Built via the `wf-phase3.mjs` subagent workflow (impl→spec→quality fix-loops, 9 agents, ~698k tok): `desk/client.ts` (HTTP/SSE client of the Hub — `eventsource-parser` subscribe + POST helpers + fetchTranscript), `desk/slash.ts` (pure slash interceptor — never POSTs a `/cmd`), `desk/app.tsx` (ink TUI: transcript + input + status + inline permission/question, Esc=interrupt; injected `HubClient` for `ink-testing-library`) + `colive desk` wired in `index.ts`. **Both `npm test` + `npm run typecheck` independently re-verified** (agent self-reports had transient false BLOCKED/DONE from tool-output glitches — not trusted on faith).
- Controller fix `2982c30`: `subscribe().close()` made self-sufficient (gate delivery on a `closed` flag, not just transport abort) + regression test driving a fetch that ignores abort — matters for the TUI re-subscribing on a session change.
- ⚠️ ink+vitest gotcha (carried into the 4.1 e2e): async React state landing outside `act()` pollutes the next file's `console.error` spy under a shared worker → `act()`-flush. permissionMode decision recorded (keep `default` for now). Commits `444c0d1` (3.1), `053bf5b` (3.2), `4b55745`+`c3d2b41` (3.3), `71d6905` (docs).

### Co-Live Terminal — M1 permission UAT SIGNED OFF 🧪 + Phase 3 env ready

- Hardware re-test confirmed the concurrent-permission fix: a full agentic loop from the glasses — create (incl. **2 concurrent Writes**) → read (3 files) → delete — gave **6 permission requests → 6 allow → 0 timeout**. The concurrent Writes each got their own allow (the case that was 100% failing pre-fix). Files created in the project dir + correctly deleted; git tree clean. **Permission UAT signed off — single/sequential/concurrent all work.**
- **7 hardware-surfaced bugs** found + fixed across Phase-2 UAT total (4 conn/stream + 2 permission-shape + 1 concurrent-FIFO). 161 tests green, typecheck clean.
- **Phase 3 build env prepared** (`ca23f47`): ink@7 + react@19 + eventsource-parser@3 + ink-testing-library@4; `.tsx` renders headlessly under vitest 4 (oxc automatic JSX). Phase 3 itself NOT started — to be built next via the subagent workflow (author `wf-phase3.mjs` modeling `wf-phase2.mjs`).
- Open product decision (not a blocker): keep `permissionMode: default` (prompts for every tool) vs move toward native's `acceptEdits` (fewer taps).

### Co-Live Terminal — M1 permission UAT: fixed CONCURRENT-permission timeout (bug #3, `3aa62f3`)

- Deeper hardware UAT (pushing past the single-file Write) surfaced a real bug: when the model fires **multiple tool calls needing permission at once** (e.g. 3 parallel `Read`s), **all** the prompts time out — taps never resolve them. Single-permission turns were fine.
- Cause: the Hub's `PendingTracker` held only ONE pending toolUseId per session — concurrent `permission_request`s clobbered each other and the first `permission_result` cleared the slot, so later sessionId-only taps mapped to `''` (no-op) and stranded to the 60s default-deny.
- Fix (mirror native's FIFO `shift()`): the **broker** now settles the OLDEST pending request on an empty/unknown toolUseId (Map insertion order), while an explicit toolUseId still targets that exact one. Deleted `PendingTracker`; the Hub forwards `body.toolUseId || ''`. The broker is the single owner of the pending set, so no queue-desync. Applies to permissions + questions. **161 tests green, typecheck clean; hardware re-confirm of the 3-file-read scenario pending.**
- Related (not a bug): we run `permissionMode: default` (every tool prompts, incl. reads); native runs `acceptEdits` (only mutating ops reach the ring). `--permission-mode acceptEdits` is the lighter-touch UAT option. Phase 3 (desk client) is parked until permission UAT is signed off.

### Co-Live Terminal — M1 ring-permission HARDWARE ACCEPTANCE: PASS 🧪 (Phase 2 now fully complete)

- The **last open Phase-2 acceptance item** is done. A desk-injected (curl) Write prompt to a glasses-subscribed session rendered a **tappable ring permission prompt**; tapping "Yes" approved it and the tool ran. Verified end-to-end across **two co-live turns** from the glasses: `Write` created `/tmp/colive-hello.txt` (`hi`), then a `Bash` verify confirmed the contents — each gated by its own ring tap. Server logs showed `POST /api/permission-response -> 200` (ua `Dart/3.8`) per tap.
- Surfaced **2 more protocol bugs** (both fixed, `3f22983`; diffed vs native `even-terminal` 0.7.9 `dist/claude/session.js`):
  1. **`permission_request.options` must be `{text,key}` objects, not bare strings** — the Even app renders its ring buttons from these (`text`=label, `key`=the `decision` POSTed back). With `['allow','deny']` it rendered nothing → no prompt → silent 60s timeout. Now `[{text:'Yes',key:'allow'},{text:'No',key:'deny'}]`; `detail` is a short string (file path/command), not the raw input object.
  2. **An allow MUST return `updatedInput` (a record)** — the SDK Zod-validates `PermissionResult` at runtime and rejects bare `{behavior:'allow'}` (`ZodError path:["updatedInput"], expected:"record"`), failing the tool *after* approval (caused the retry / "second prompt"). The TS type marks it optional → type-checks but fails live. Now every allow path echoes the original `input` back (mirrors native). `sdk-reference.md` corrected.
- Diagnostic that worked: `curl -N --max-time 6 .../api/events?...&needReplay=true` reads the SSE ring-buffer replay. NB backgrounded `curl`-to-file does **not** work for SSE (block-buffers, flushes nothing until close).
- **6 hardware bugs total** found + fixed across Phase 2 (4 conn/stream + 2 permission). 158 tests green. **Next:** Phase 3 (thin desk client) → Phase 4 (desk+glasses-on-one-session loop) → finish branch.

### Co-Live Terminal — M1 Phase 2 HARDWARE ACCEPTANCE: core co-live loop PROVEN on real G2 🧪

- Connected the **real Even app** to `colive serve` and ran a **continuous multi-turn conversation from the glasses** (3+ messages, each response live on the HUD, can keep going on one session). The M1 core mechanic works on real hardware. Model = `claude-opus-4-8`; first turn ~4.3s (SDK cold start — **not** the old ~20s hook lag), subsequent turns ~15ms to `202`.
- The hardware run surfaced **4 protocol bugs no unit test could** (all fixed; diffed live against native `even-terminal` 0.7.9):
  1. **`/api/sessions` `timestamp` must be an ISO-8601 string**, not an epoch-ms int — the app's `dart:io` deserializer rejected the host ("failed to probe and save"). Also: no `cwd` ⇒ span **all** projects. (`a5c82e7`)
  2. **CORS** — added permissive CORS + `OPTIONS` preflight for stock parity (not the actual blocker here, since the app uses `dart:io`, not a WebView). (`d0af84a`)
  3. **Missing terminal `status: idle` SSE frame** — string-prompt mode never emitted it (only `session_state_changed:idle` did, which the SDK sends only in streaming mode), so the HUD hung "thinking" forever and blocked the next prompt. Now emitted reliably at turn end. (`8e20fa1`)
  4. **`ai-title` status misclassification** — a just-finished session read `busy` for 120s (last jsonl line is `ai-title`), so the polled `/api/sessions` showed "thinking". Now `ai-title` ⇒ idle. (`bebdc02`)
- Added `COLIVE_LOG_REQUESTS=1` wire logging to the Hub. 🧪 The app's connect probe is a **single `GET /api/sessions?provider=claude`** (ua `Dart/3.8 (dart:io)`); it polls that every ~1s and fetches `/sessions/:id/history?limit=10` on open.
- **Remaining for M1:** ring-permission hardware check; **Phase 3** thin desk client; **Phase 4** the full desk+glasses-on-one-session loop (M1's definition of done). Minor follow-ups: fast-`202` (first POST blocks ~4s resolving the new id), filter internal/agent sessions from the list, per-poll perf.

### Co-Live Terminal — M1 Phase 2 (Client Hub) COMPLETE 🧪

- **Phase 2 (Client Hub) — DONE; 153 tests green, typecheck clean; `colive serve` boots end-to-end** (controller smoke-test over real HTTP: 401 without token; 200 + correct `/api/info` via bearer header AND `?token`; `/api/sessions` shape). Four modules:
  - `hub/sse.ts` — per-session SSE: ring buffer (500), `:ok` preamble, `id:/data:` frames, 15s heartbeat, `needReplay` replay; tolerates empty/unknown sessions; broadcast never throws (drops dead clients).
  - `hub/routes.ts` — every Even-app endpoint + bearer auth (header or `?token`, constant-time); maps the app's **sessionId-only** permission/question responses to the **latest pending `toolUseId`** (tracked from broadcasts) and `allowAlways`→`allow`.
  - `hub/server.ts` — `createApp(deps)` (testable) + `startServer(config)` (listens, banner + QR).
  - `index.ts` — `colive serve [--model --permission-mode --host --port --project-dir]`.
- **🧪 Fixed the QR connect-URL** to the verified Even-app format `http://<host>:<port>?token=<token>&defaultProvider=claude` (implementer had guessed a `colive://` scheme; our M0 research already had the real format from `even-terminal`'s `common.js`).
- **Next: Task 2.3 hardware-acceptance pause** — connect the real Even app to `colive serve` (confirm live stream, no ~20s first-turn delay, model = `claude-opus-4-8`, ring permission). Then Phase 3 (desk client) + Phase 4 (the loop).

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
