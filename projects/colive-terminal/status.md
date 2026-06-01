# Co-Live Terminal — Status

**Current state:** ✅ **M2 COMPLETE** — Tailscale remote access hardware-validated end-to-end (setup→serve→glasses→walk-away→tool-use) and **merged to `main`**. 237 tests, typecheck clean. Glasses work from anywhere on the tailnet (cellular+Tailscale, no LAN required). **Next milestones:** M3 (full native parity — see plan's deferred scope). Deferred follow-ups carried forward: fast-`202`, filter internal sessions from the list, per-poll perf, desk single-slot concurrent-permission disambiguation, `bin:{colive}` before any real install/distribution, daemon-not-running vs not-installed distinction (see `knowledge/terminal-mode/tailscale-detection.md` open questions).

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
