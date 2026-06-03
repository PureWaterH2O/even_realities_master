# Co-Live Terminal — Status

**Current state:** 🔧 **M3.2A "Composer" — composer core hardware-validated; A4-step & A6-copy DEFERRED; in planning
review (NOT merged).** Branch `colive-terminal-m3.2a` (off `main` `8f9bb0f`) @ `b17be70`, built + fixed via
subagent-driven TDD (impl → spec review → quality review per task). New pure `src/desk/input/` layer (`EditBuffer`
model, per-project DI'd history, SGR-wheel parser, slash-filter, multi-line cursor render) + `app.tsx` rewired into a
composer. **`↑/↓` drive the INPUT** (wheel scrolls the transcript). **ZERO Core/Hub change** — desk stays a pure Hub
client. **391 tests / 36 files, typecheck 0 (clean-tree verified 2026-06-03).**

**Hardware UAT (2026-06-03, two rounds):** R1 — A3/B1/B2 PASS, A1 via Ctrl-J; flagged A2/A4/A6, A5=scope. Fix pass
(each TDD'd + independently reviewed). R2 results:
- **A2 ✅ FULL PASS** `29c93c8` — Option+word-nav via the readline `ESC-b`/`ESC-f` form (VS Code sends that, not the CSI
  form) + Option+Backspace delete-word. Additive (CSI form kept).
- **A4 ⏸ DEFERRED (not mission-critical)** `c537ac2` — fixed a **real, rig-verified stale-closure bug** (↑/↓ now functional
  `setBuf` updaters + `nav`→ref), but post-paste **one-line stepping still fails on the VS Code terminal** → an additional
  cause remains unpinned. Paste itself works. Opt-in `COLIVE_A4_LOG` logger stays wired for the next pass.
- **A6 ⏸ DEFERRED → dedicated copy/paste phase** `9001f8a` (+ `21c6ead`) — shipped a runtime **`/select` ⇄ `/scroll`**
  mouse-mode toggle, but **copy still does not work** in the user's VS Code setup. Whole copy/paste surface (selection
  bypass, OSC 52 `/copy`, paste ergonomics) → its own phase, to be scoped in the planning chat.
- **A5 ⏸** full skill/CLI slash set needs Hub-reported commands → **M3.3**.

**Next:** planning chat reviews and decides whether M3.2A merges as-is (with A4/A6 deferred) or splits A4/A6 out. (The
build's earlier review loops also caught 3 real bugs: backslash-continuation cursor anchor; history nav-reset after every
submit; history read-dedup.)

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
