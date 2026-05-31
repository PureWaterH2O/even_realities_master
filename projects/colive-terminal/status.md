# Co-Live Terminal — Status

**Current state:** 🟨 in progress — M1 (end-to-end loop). **Phases 0–3 done; permission UAT signed off.**
**Phase:** **Phases 0–3 ✅ COMPLETE.** Phases 0–2 hardware-validated (continuous multi-turn co-live from
the glasses, model `claude-opus-4-8`, live HUD; ring permissions single/sequential/**concurrent** — a full
create→read→delete loop: 6 requests → 6 allow → 0 timeout). **Phase 3 (thin desk client) built via the
`wf-phase3.mjs` subagent workflow** (impl→spec→quality fix-loops, 9 agents): `desk/client.ts` (SSE subscribe
via eventsource-parser + POST helpers + fetchTranscript), `desk/slash.ts` (pure slash interceptor), `desk/
app.tsx` (ink TUI: transcript+input+status+inline permission/question, Esc=interrupt) + `colive desk` wired
in `index.ts`. **211 tests; typecheck clean — both independently re-verified by the controller** (not just
agent self-report). +1 controller fix: `subscribe().close()` now self-sufficient (gates delivery on `closed`,
not just transport abort) — `e9f9f88`.
**Branch:** `feat/colive-terminal-m1` (do NOT build on `main`); ~36 commits, typecheck clean.
**Next action:** **(1) Phase 4.1** — automated in-process e2e: boot Core+Hub, desk client A + stub "glasses"
client B on ONE session, assert both see all events + one transcript id (mirrors M0 harness, now vs our Core).
**(2) Phase 4.2** — hardware UAT (THE loop): `colive serve` + `colive desk` at the desk + real glasses on the
same Core; kick off at desk → respond on glasses → return to desk, one continuous session. **(3) 4.3** finish
the branch (PR/merge). M1 done when 4.1+4.2 pass.
**Open product decision (DECIDED 2026-05-31, revisitable):** keep `permissionMode: default` for now (safe,
already UAT-signed-off; prompts every tool incl. reads). `--permission-mode acceptEdits` is the lighter-touch
per-launch option for the UAT run (fewer ring taps). User: "keep for now, can change anytime."
**Blockers:** none. Minor follow-ups: fast-`202`, filter internal sessions, per-poll perf; desk-client
forward-notes (no auto-reconnect/replay-resume — add at app layer if a UAT disconnect surfaces).
