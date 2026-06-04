# Co-Live Terminal — Status

**Current state:** 🔄 **M3.3a "Streaming-input Core" — BUILT on `colive-terminal-m3.3a`, awaiting planner validation +
hardware UAT (NOT merged).** The isolated refactor that lands the streaming-input plumbing once, safely, before any
b/c control feature rides on it. Drives the SDK via **one persistent `Query` per session** (was one `query({prompt:string})`
per turn) fed by a new pushable `PromptInbox` (`src/core/promptInbox.ts`); a single long-lived consumer loop reuses the
**existing `handleMessage*` mapping UNCHANGED** (all 12 bodies verified byte-identical) and detects turn-end on `result`;
`AbortController` → `Query.interrupt()`; fatal query error self-heals via lazy reopen-with-`resume`. **Core change CONFINED
to `session.ts` + `promptInbox.ts`** → glasses/Hub/SSE byte-compat preserved. Built via subagent-driven TDD (probe-first,
two-stage review per task).
- **Live SDK probe (🧪):** streaming mode = one `result`/turn ✅, unchanged `stream_event` shapes ✅, per-turn `init`
  (benign — no events, stable `session_id`) → byte-identical mapping. `knowledge/terminal-mode/streaming-input-probe.md`.
- **Interrupt bug caught LIVE + fixed:** real `Query.interrupt()` flushes a **non-success `result`** (doesn't throw) →
  was surfacing a spurious `[ede_diagnostic]` error banner on Esc. The **live self-test (Task 8) caught what unit tests
  missed**; fix suppresses the non-success interrupt-result → **clean idle** (re-verified live, error count 0, session
  immediately usable). Genuine error-results + success-race results unaffected.
- **Gates:** **455 tests / 41 files green** (442 → +13), `tsc` 0, **CONFINED ✓**, no test gaming (5 renamed in the
  abort→`Query.interrupt()` / per-turn→persistent adaptation). **Dual self-test passed** (deterministic preview PNG +
  LIVE serve+desk run with screenshots). Runbook: `projects/colive-terminal/m3.3a-uat-runbook.md` (D1–D5).
- **Out of scope (b/c rungs):** `/model`, mode/plan toggle, `/compact`, `supportedCommands` → M3.3b; `settingSources`+skills,
  image paste, MCP → M3.3c.

**Next:** planner does spec→claims→code validation + hardware UAT (D1–D5), then merges. Build chat does NOT push/merge.

---

_Previously:_ ✅ **M3.2B "`@`-file autocomplete + `!`bash" — DONE: hardware UAT C1–C6 PASS (2026-06-03),
planner-validated, MERGED to `main` `58af6e0`.** Built on branch `colive-terminal-m3.2b` (off `main`) via
subagent-driven TDD (10 tasks: impl → spec-compliance review → code-quality review per task; final whole-branch review
APPROVED FOR HANDBACK). Two **desk-only** typing aids that produce clean text Claude acts on:
- **`@`-file (mid-line):** `@` opens a fuzzy file-path menu (`git ls-files`, walk fallback, cached once/session;
  `src/desk/input/files.ts` fuzzy ranker + DI'd source); Tab/Enter inserts a repo-relative `@path` via
  `EditBuffer.replaceRange` (reuses the M3.2A popup widget; Esc dismisses keeping the line). On submit it's sent
  **verbatim** — Claude reads it with its **Read** tool. New `atContext` in `menu.ts`.
- **`!`bash (whole-line):** `formatBashPrompt` wraps the command as a "run this + show output" instruction;
  `interpretInput` gains a `bash` kind; `app.tsx` POSTs it + echoes `! cmd`, **M1-permission-gated**, rendered as a normal
  `Bash(...)` turn; recorded in composer history.
- **ZERO Core/Hub change** (proven by an empty `git diff main -- src/core src/hub`); the desk **never reads file contents
  and never runs a shell** — only enumerates *filenames*. **442 tests / 39 files, typecheck 0** (baseline 412 → **+30**;
  controller-reverified on-branch). No test gaming. **Self-test GATE passed** (preview rig + vhs PNGs eyeballed — no
  rendering bugs).
- **Plan gap caught:** adding `BashResult` to `InterpretedInput` broke `app.tsx`'s typecheck (the `switch (result.command)`
  narrows by elimination → new member dropped `.message`/`.view`/`.mode`); fixed via a placeholder in Task 5 → real
  dispatch in Task 7.

**Spec §6 R1 — ✅ RESOLVED in UAT:** `@`-mention auto-read relies on Claude's *initiative* (raw-SDK Core, no CC harness
to inject contents). **C1/C2 PASSED on hardware — Claude auto-read the mentioned file(s)** — so the desk-appended "please
read" nudge was **not needed** and not shipped (YAGNI holds). **UAT runbook (signed off):**
`projects/colive-terminal/m3.2b-uat-runbook.md` (C1–C6 all PASS, R1 auto-read YES).

**Next:** planning chat does the spec→claims→code validation, then merges (hardware UAT already signed off). Build chat
will NOT push/merge (per instruction).

_Previously:_ ✅ **M3.2A "Composer" DONE — merged to `main` `278f7c8` (planner-validated 2026-06-03)** (multiline/cursor/
word nav, per-project history, paste, mouse-wheel scroll, slash menu, `/select`·`/scroll` toggle; zero Core/Hub change;
391 tests; hardware-signed-off composer core). Follow-up **mouse-history-leak fix merged `2370b25`** (VS Code alt-scroll
1007 → wheel becomes dense arrow-bursts; fixed via `isMouseReport` drop + `1007l` + density burst-detection; 412 tests;
tradeoff: wheel no longer scrolls → PageUp/PageDown). **Deferred:** A4 post-paste ↑/↓ stepping (`COLIVE_A4_LOG` wired);
A6 copy → resolved via **Option+drag**, copy/paste phase descoped; A5 full slash set → M3.3.

_Previously:_ ✅ **M3.1 "Readable transcript" DONE — hardware-signed-off 2026-06-02, merged to `main`** (desk
scrollback viewport, inline syntax-highlighted diffs, markdown, Ctrl-O verbose, todos panel, native-style tool
headers, desk-only thinking; one Core change — `thinking_delta`; 314 tests, hardware Part A + B PASS).

_Previously:_ ✅ **M2 COMPLETE** — Tailscale remote access hardware-validated end-to-end (setup→serve→glasses→walk-away→tool-use) and **merged to `main`**. 237 tests, typecheck clean. Glasses work from anywhere on the tailnet (cellular+Tailscale, no LAN required). Deferred follow-ups carried forward: fast-`202`, filter internal sessions from the list, per-poll perf, desk single-slot concurrent-permission disambiguation, `bin:{colive}` before any real install/distribution, daemon-not-running vs not-installed distinction (see `knowledge/terminal-mode/tailscale-detection.md` open questions).

---
_History below is the M1 build log._

**Current state (M1 build):** 🟨 in progress — M1 (end-to-end loop). **Phases 0–3 done; permission UAT signed off.**
**Phase:** **Phases 0–3 ✅ COMPLETE.** Phases 0–2 hardware-validated (continuous multi-turn co-live from
the glasses, model `claude-opus-4-8`, live HUD; ring permissions single/sequential/**concurrent** — a full
create→read→delete loop: 6 requests → 6 allow → 0 timeout). **Phase 3 (thin desk client) built via the
`wf-phase3.mjs` subagent workflow** (impl→spec→quality fix-loops, 9 agents): `desk/client.ts` (SSE subscribe
via eventsource-parser + POST helpers + fetchTranscript), `desk/slash.ts` (pure slash interceptor), `desk/
app.tsx` (ink TUI: transcript+input+status+inline permission/question, Esc=interrupt) + `colive desk` wired
in `index.ts`. **211 tests; typecheck clean — both independently re-verified by the controller** (not just
agent self-report). +1 controller fix: `subscribe().close()` now self-sufficient (gates delivery on `closed`,
not just transport abort) — `2982c30`.
**Branch:** `feat/colive-terminal-m1` (do NOT build on `main`); ~40 commits, typecheck clean.
**Phase 4.1 ✅ DONE** (`32663f4` + hardening): `test/e2e.test.ts` boots the REAL Core+Hub in-process over real
HTTP+SSE (only the SDK `query` + on-disk store faked), driven by the REAL desk `createHubClient`. 3 tests, all
green: (a) desk kicks off → glasses sends a free-form follow-up into the SAME session → both independent clients
get byte-identical streams, one sessionId, transcript agrees; (b) desk-initiated Write permission APPROVED from
the glasses through the real broker; (c) symmetric DENY (proves the decision CONTENT drives the outcome, not just
its arrival). An adversarial reviewer subagent flagged "live-vs-replay" + "permission necessity" — traced both to
be already covered by the post-subscribe ordering + the >=2/timeout waits (the reviewer over-stated severity), but
added its genuinely-useful suggestions: the deny test, explicit toolUseId-identity + replay-then-live ordering
asserts, non-empty guards. **214 tests, typecheck clean — controller-verified.**
**Phase 4.2 hardware UAT — STARTED 🧪:** first real desk+glasses run of the full loop worked end-to-end (kick off
at desk → live on glasses HUD → free-form follow-up from glasses → response on both → permission ring tap), with
ONE co-live bug found+fixed: a glasses-answered permission left the inline prompt stuck on the desk (the desk
`permission_result` handler never cleared `pending`). Fixed `9a232c8` (+2 regression tests; **216 tests, typecheck
clean — controller-reverified**). See notes.md "Phase 4.2 … bug #1".
**Next action:** **(1)** user re-tests the loop on hardware to confirm the desk prompt now dismisses on a glasses
tap (the last open 4.2 acceptance item). **(2) 4.3** finish the branch (PR/merge) once the re-test is clean.
M1 done when the 4.2 re-test passes.
**Open product decision (DECIDED 2026-05-31, revisitable):** keep `permissionMode: default` for now (safe,
already UAT-signed-off; prompts every tool incl. reads). `--permission-mode acceptEdits` is the lighter-touch
per-launch option for the UAT run (fewer ring taps). User: "keep for now, can change anytime."
**Blockers:** none. Minor follow-ups: fast-`202`, filter internal sessions, per-poll perf; desk-client
forward-notes (no auto-reconnect/replay-resume — add at app layer if a UAT disconnect surfaces).
